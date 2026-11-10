//! Search: full-text query over the installed library, returning hits with
//! snippets and locations.
//!
//! # Index
//!
//! One SQLite FTS5 table in the user DB, `search_index`, holds a row per
//! searchable unit, tokenized with `unicode61 remove_diacritics 2` (so
//! matching ignores case and diacritics: `JEHOVÁ` matches `jehova`):
//!
//! - A Bible: one row per verse (a psalm's superscription is verse 0), as
//!   plain text, titled `<book> <chapter>` (`John 3`, the book named as in
//!   the Bible's own tables), at the verse's [`Location`] as
//!   [`Reader::resolve`](crate::reader::Reader::resolve) gives it. Its other
//!   documents with content (introduction, outlines, glossary, appendixes, …)
//!   are indexed as paragraphs, as below. Its book documents have no content
//!   of their own (the text is in its chapters) and are not indexed again.
//! - Any other publication: one row per paragraph of each document with
//!   content: the plain text of the paragraph's whole element, titled with
//!   the document's title, at `{pub_key, doc_id, paragraph}`. Paragraphs the
//!   publication gives no position for, or with no text, are skipped.
//! - An index ([`PubKind::Index`], e.g. the Research Guide): no rows. It
//!   points into other publications rather than holding text to find.
//!
//! [`Library::install`](crate::library::Library::install) indexes a
//! publication as part of installing it (in the transaction that records
//! it), and [`Library::remove`](crate::library::Library::remove) drops its
//! rows the same way, so the index always matches the installed set. A user
//! DB that had publications installed before the index existed needs one
//! [`Search::rebuild_index`].
//!
//! # Queries
//!
//! The query text is never passed to FTS5 as syntax: it is split at
//! whitespace into terms, each searched as a literal string, all of which
//! must match. Text wrapped in double quotes (`"loved the world"`) is
//! searched as one exact phrase instead. Hits are ranked by BM25, ties in
//! location order (key, then book, chapter, verse, document, paragraph), so
//! the same query over the same publications gives the same order, however
//! often they were reinstalled or the index rebuilt.
//!
//! # Suggestions
//!
//! [`Search::suggest`] offers, while the text is being typed:
//!
//! - **Queries:** the text with the word being typed completed, from the
//!   words of the publications in scope, most common first. Where the text
//!   has other words (or is an open phrase, `"loved the wo`), only
//!   completions that the search would find are offered.
//! - **Topics:** the articles of a topic publication (*Insight on the
//!   Scriptures*) whose title starts with the text, opened directly.
//!
//! Both come from two tables kept beside the index and written with it:
//! `search_term`, each publication's words (folded as the tokenizer folds
//! them: lowercase, diacritics removed) with their most common spelling and
//! how often they occur, and `search_topic`, the topic publications' article
//! titles. Words of one letter, and words with no letter (`3`, `16`), are
//! left out.

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, OptionalExtension, Transaction};
use rusqlite_migration::HookResult;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

use crate::jwpub::Publication;
use crate::library::{parse_pub_key, Library, PubKind};
use crate::reader::{self, Location};
use crate::{CancelToken, CoreError, Inner, ProgressSink, Steps};

/// The most hits one query returns; a larger `limit` is capped to it.
pub const MAX_LIMIT: u32 = 500;

/// The most suggestions of each kind one call returns; a larger `limit` is
/// capped to it.
pub const MAX_SUGGESTIONS: u32 = 20;

/// The symbols of the publications whose articles are topics: *Insight on
/// the Scriptures*, in every language.
const TOPIC_SYMBOLS: &[&str] = &["it"];

/// How many completions to try, per suggestion asked for, when each has to
/// be checked against the index.
const CANDIDATES_PER_SUGGESTION: u32 = 4;

/// How many progress steps indexing one publication counts as, however many
/// documents and chapters it has.
pub(crate) const INDEX_STEPS: u64 = 100;

/// About how many tokens a snippet holds.
const SNIPPET_TOKENS: i64 = 16;
/// Where `snippet()` marks a match; never in indexed text.
const MARK_OPEN: char = '\u{2}';
const MARK_CLOSE: char = '\u{3}';

/// Which installed publications a query searches: those passing every
/// non-empty filter (an empty one does not filter). A key in `pub_keys` that
/// is not installed matches nothing; a malformed one is `Invalid`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchScope {
    pub pub_keys: Vec<String>,
    pub kinds: Vec<PubKind>,
    /// MEPS language ids.
    pub languages: Vec<u32>,
    /// How many hits to skip, for paging.
    pub offset: u32,
}

/// One match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    /// A verse (`pub_key`, `doc_id` of its book, `book`, `chapter`, `verse`)
    /// or a paragraph (`pub_key`, `doc_id`, `paragraph`).
    pub location: Location,
    /// `John 3`, or the document's title.
    pub title: String,
    /// Plain text around the match, as HTML: escaped, with each matched
    /// word in `<mark>…</mark>`, and no other tags.
    pub snippet: String,
}

/// What [`Search::suggest`] offers for some text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Suggestions {
    /// Topic articles whose title starts with the text, best first.
    pub topics: Vec<TopicSuggestion>,
    /// The text with its last word completed, most common first.
    pub queries: Vec<String>,
}

/// An article of a topic publication, e.g. Insight's "Absalom".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicSuggestion {
    pub title: String,
    /// The article: `pub_key` and `doc_id`.
    pub location: Location,
}

/// Handle to search. Cheap to clone; shares the core's state.
#[derive(Clone)]
pub struct Search {
    inner: Arc<Inner>,
}

impl Search {
    pub(crate) fn new(inner: Arc<Inner>) -> Self {
        Search { inner }
    }

    /// Up to `limit` (at most [`MAX_LIMIT`]) hits for `text` in the
    /// publications `scope` selects, best first, after skipping
    /// `scope.offset`. Empty or whitespace-only text (or `""`), a `limit` of
    /// 0, or a malformed key in the scope => `Invalid`.
    pub fn query(
        &self,
        text: &str,
        scope: &SearchScope,
        limit: u32,
    ) -> Result<Vec<Hit>, CoreError> {
        if limit == 0 {
            return Err(CoreError::Invalid("limit must be at least 1".into()));
        }
        let expression = match_expression(text)?;
        let keys = self.scope_keys(scope)?;
        if keys.as_ref().is_some_and(Vec::is_empty) {
            return Ok(Vec::new());
        }

        let mut sql = String::from(
            "SELECT pub_key, doc_id, book, chapter, verse, paragraph, title, \
             snippet(search_index, 0, ?1, ?2, '…', ?3) \
             FROM search_index WHERE search_index MATCH ?4",
        );
        let mut values: Vec<Value> = vec![
            MARK_OPEN.to_string().into(),
            MARK_CLOSE.to_string().into(),
            SNIPPET_TOKENS.into(),
            expression.into(),
        ];
        push_key_filter(&mut sql, &mut values, keys.as_deref());
        // Ties go in location order, which (unlike rowid) survives a
        // reinstall or rebuild.
        sql.push_str(
            " ORDER BY bm25(search_index), pub_key, book, chapter, verse, doc_id, paragraph, \
             rowid LIMIT ? OFFSET ?",
        );
        values.push(i64::from(limit.min(MAX_LIMIT)).into());
        values.push(i64::from(scope.offset).into());

        let conn = self.inner.conn();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values), |r| {
            Ok(Hit {
                location: Location {
                    pub_key: r.get(0)?,
                    doc_id: r.get(1)?,
                    book: r.get(2)?,
                    chapter: r.get(3)?,
                    verse: r.get(4)?,
                    paragraph: r.get(5)?,
                },
                title: r.get(6)?,
                snippet: snippet_html(&r.get::<_, String>(7)?),
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Suggestions for `text` as it is typed, from the publications `scope`
    /// selects (its offset is ignored): up to `limit` (at most
    /// [`MAX_SUGGESTIONS`]) of each kind. See the module docs. Text with
    /// nothing to complete gives none; a `limit` of 0 or a malformed key in
    /// the scope => `Invalid`.
    pub fn suggest(
        &self,
        text: &str,
        scope: &SearchScope,
        limit: u32,
    ) -> Result<Suggestions, CoreError> {
        if limit == 0 {
            return Err(CoreError::Invalid("limit must be at least 1".into()));
        }
        let limit = limit.min(MAX_SUGGESTIONS);
        let keys = self.scope_keys(scope)?;
        if keys.as_ref().is_some_and(Vec::is_empty) {
            return Ok(Suggestions::default());
        }
        let text = strip_pronunciation(text);
        Ok(Suggestions {
            topics: self.topic_suggestions(&text, keys.as_deref(), limit)?,
            queries: self.query_suggestions(&text, keys.as_deref(), limit)?,
        })
    }

    /// Topics whose folded title starts with the folded text (quotes
    /// dropped, whitespace collapsed): an exact title first, then shorter
    /// titles, then in title order.
    fn topic_suggestions(
        &self,
        text: &str,
        keys: Option<&[String]>,
        limit: u32,
    ) -> Result<Vec<TopicSuggestion>, CoreError> {
        let prefix = fold(
            &text
                .replace('"', " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" "),
        );
        if !prefix.chars().any(word_char) {
            return Ok(Vec::new());
        }
        let mut sql = String::from(
            "SELECT pub_key, doc_id, title FROM search_topic WHERE folded >= ?1 AND folded < ?2",
        );
        let mut values: Vec<Value> = vec![prefix.clone().into(), above(&prefix).into()];
        push_key_filter(&mut sql, &mut values, keys);
        sql.push_str(" ORDER BY folded <> ?1, length(folded), folded, pub_key, doc_id LIMIT ?");
        values.push(i64::from(limit).into());

        let conn = self.inner.conn();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values), |r| {
            Ok(TopicSuggestion {
                location: Location {
                    pub_key: r.get(0)?,
                    doc_id: Some(r.get(1)?),
                    book: None,
                    chapter: None,
                    verse: None,
                    paragraph: None,
                },
                title: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// The text with the word at its end completed. Nothing when the text
    /// does not end in a word (it ends in a space, or a closing quote).
    fn query_suggestions(
        &self,
        text: &str,
        keys: Option<&[String]>,
        limit: u32,
    ) -> Result<Vec<String>, CoreError> {
        let start = text
            .char_indices()
            .rev()
            .take_while(|&(_, c)| word_char(c))
            .last()
            .map(|(i, _)| i);
        let Some(start) = start else {
            return Ok(Vec::new());
        };
        let (head, partial) = text.split_at(start);
        // A word starts the text, or follows a space or an opening mark;
        // `s` in `Jehovah’s` is not a word being typed.
        if !head
            .chars()
            .last()
            .is_none_or(|c| c.is_whitespace() || matches!(c, '"' | '“' | '(' | '[' | '¿' | '¡'))
        {
            return Ok(Vec::new());
        }
        let prefix = fold(partial);
        // `"loved the wo` completes to `"loved the world"`.
        let open_phrase = head
            .trim_start()
            .strip_prefix('"')
            .is_some_and(|rest| !rest.contains('"'));
        let close = if open_phrase { "\"" } else { "" };
        // Other words: a completion must still find something with them.
        let others: Vec<String> = words(head).map(fold).collect();
        let check = !others.is_empty();
        let wanted = if check {
            limit * CANDIDATES_PER_SUGGESTION
        } else {
            limit
        };

        let mut sql = String::from(
            "SELECT term, form, max(count), sum(count) AS total FROM search_term \
             WHERE term > ?1 AND term < ?2",
        );
        let mut values: Vec<Value> = vec![prefix.clone().into(), above(&prefix).into()];
        push_key_filter(&mut sql, &mut values, keys);
        sql.push_str(" GROUP BY term ORDER BY total DESC, term LIMIT ?");
        values.push(i64::from(wanted).into());
        let candidates: Vec<(String, String)> = {
            let conn = self.inner.conn();
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(values), |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<Result<_, _>>()?
        };

        let mut queries = Vec::new();
        for (term, form) in candidates {
            if queries.len() == limit as usize {
                break;
            }
            if others.contains(&term) {
                continue;
            }
            let query = format!("{head}{form}{close}");
            if check && !self.finds_any(&query, keys)? {
                continue;
            }
            queries.push(query);
        }
        Ok(queries)
    }

    /// Whether `text` has a hit in the publications `keys` selects.
    fn finds_any(&self, text: &str, keys: Option<&[String]>) -> Result<bool, CoreError> {
        let mut sql = String::from("SELECT 1 FROM search_index WHERE search_index MATCH ?");
        let mut values: Vec<Value> = vec![match_expression(text)?.into()];
        push_key_filter(&mut sql, &mut values, keys);
        sql.push_str(" LIMIT 1");
        let conn = self.inner.conn();
        Ok(conn
            .query_row(&sql, params_from_iter(values), |_| Ok(()))
            .optional()?
            .is_some())
    }

    /// Rebuild every installed publication's rows from its files. Progress
    /// counts a fixed 100 steps per publication, plus one for committing. The
    /// new rows replace the old in one transaction at the end; cancelled (or
    /// failed) => `Cancelled` (or the error), and the index is unchanged. A
    /// publication removed or reinstalled while this runs keeps the rows its
    /// remove or install left. Progress is never reported while a core lock
    /// is held, so `progress` may call back into the core.
    pub fn rebuild_index(
        &self,
        progress: &dyn ProgressSink,
        cancel: &CancelToken,
    ) -> Result<(), CoreError> {
        cancel.check()?;
        let library = Library::new(self.inner.clone());
        let installed = library.installed()?;
        let total = installed.len() as u64 * INDEX_STEPS + 1;
        progress.on_progress(0, total);

        let mut built = Vec::with_capacity(installed.len());
        for (i, summary) in installed.iter().enumerate() {
            cancel.check()?;
            let (dir, publication) = match library.publication_and_dir(&summary.pub_key) {
                Err(CoreError::NotFound) => continue,
                other => other?,
            };
            let base = i as u64 * INDEX_STEPS;
            let rows = index_rows(&publication, progress, base, total, cancel)?;
            built.push((&summary.pub_key, dir, rows));
        }
        cancel.check()?;

        // Progress is never reported with a core lock held (a sink may call
        // back into the core), so the connection is released before the
        // final step is.
        {
            let mut conn = self.inner.conn();
            let tx = conn.transaction()?;
            tx.execute(
                "DELETE FROM search_index \
                 WHERE pub_key NOT IN (SELECT pub_key FROM installed_publication)",
                [],
            )?;
            for (pub_key, dir, rows) in &built {
                let current: Option<String> = tx
                    .query_row(
                        "SELECT dir FROM installed_publication WHERE pub_key = ?1",
                        [pub_key],
                        |r| r.get(0),
                    )
                    .optional()?;
                if current.as_ref() == Some(dir) {
                    replace_rows(&tx, pub_key, rows)?;
                }
            }
            tx.commit()?;
        }
        progress.on_progress(total, total);
        Ok(())
    }

    /// The keys of the installed publications `scope` selects; `None` when
    /// it selects all of them.
    fn scope_keys(&self, scope: &SearchScope) -> Result<Option<Vec<String>>, CoreError> {
        for key in &scope.pub_keys {
            parse_pub_key(key)?;
        }
        if scope.pub_keys.is_empty() && scope.kinds.is_empty() && scope.languages.is_empty() {
            return Ok(None);
        }
        let keys = Library::new(self.inner.clone())
            .installed()?
            .into_iter()
            .filter(|p| {
                (scope.pub_keys.is_empty() || scope.pub_keys.contains(&p.pub_key))
                    && (scope.kinds.is_empty() || scope.kinds.contains(&p.kind))
                    && (scope.languages.is_empty() || scope.languages.contains(&p.meps_language))
            })
            .map(|p| p.pub_key)
            .collect();
        Ok(Some(keys))
    }
}

/// One row of the index.
pub(crate) struct IndexRow {
    text: String,
    title: String,
    doc_id: i64,
    /// Book, chapter and verse, for a verse.
    verse: Option<(u32, u32, u32)>,
    paragraph: Option<u32>,
}

/// The index rows of `publication` (see the module docs). Reports progress
/// from `base` to `base + INDEX_STEPS` of `total` as it goes through the
/// documents and chapters, and checks `cancel` between them.
pub(crate) fn index_rows(
    publication: &Publication,
    progress: &dyn ProgressSink,
    base: u64,
    total: u64,
    cancel: &CancelToken,
) -> Result<Vec<IndexRow>, CoreError> {
    let kind = PubKind::from_publication_type(&publication.meta().publication_type);
    if kind == PubKind::Index {
        progress.on_progress(base + INDEX_STEPS, total);
        return Ok(Vec::new());
    }
    let pub_key = publication.meta().pub_key();
    let documents = reader::documents_by_id(publication)?;
    let is_bible = kind == PubKind::Bible;
    let (books, chapters) = if is_bible {
        (
            publication.bible_books()?,
            publication.bible_chapter_numbers()?,
        )
    } else {
        (Vec::new(), Vec::new())
    };
    let mut docs: Vec<_> = documents
        .values()
        .filter(|d| d.has_content && !books.iter().any(|b| b.book_document_id == d.document_id))
        .collect();
    docs.sort_by_key(|d| d.document_id);

    let mut paragraphs: HashMap<i64, Vec<_>> = HashMap::new();
    for p in publication.all_document_paragraphs()? {
        paragraphs.entry(p.document_id).or_default().push(p);
    }

    let units = (chapters.len() + docs.len()) as u64;
    let mut steps = Steps::new(progress, base, INDEX_STEPS, units, total);

    let mut rows = Vec::new();
    let mut done = 0;
    for &(book, chapter) in &chapters {
        cancel.check()?;
        let book_row = books
            .iter()
            .find(|b| b.bible_book_id == i64::from(book))
            .ok_or(CoreError::Corrupt)?;
        let doc = documents
            .get(&book_row.book_document_id)
            .ok_or(CoreError::Corrupt)?;
        let title = format!("{} {chapter}", doc.title.trim());
        for verse in reader::read_chapter(publication, &pub_key, book, chapter)?.verses {
            let text = clean(&verse.text);
            if !text.is_empty() {
                rows.push(IndexRow {
                    text,
                    title: title.clone(),
                    doc_id: doc.meps_document_id,
                    verse: Some((book, chapter, verse.verse)),
                    paragraph: None,
                });
            }
        }
        done += 1;
        steps.report(done);
    }
    for doc in docs {
        cancel.check()?;
        let html = publication.document_html(doc.document_id)?;
        let title = doc.title.trim();
        for p in paragraphs.remove(&doc.document_id).unwrap_or_default() {
            let anchor = reader::paragraph_anchor(&html, p)?;
            let (Some(begin), Some(end)) = (anchor.begin, anchor.end) else {
                continue;
            };
            let text = clean(&reader::plain_text(&html[begin as usize..end as usize]));
            if !text.is_empty() {
                rows.push(IndexRow {
                    text,
                    title: title.to_string(),
                    doc_id: doc.meps_document_id,
                    verse: None,
                    paragraph: Some(anchor.paragraph),
                });
            }
        }
        done += 1;
        steps.report(done);
    }
    if units == 0 {
        progress.on_progress(base + INDEX_STEPS, total);
    }
    Ok(rows)
}

/// Replace `pub_key`'s rows in the index with `rows`.
pub(crate) fn replace_rows(
    tx: &Transaction,
    pub_key: &str,
    rows: &[IndexRow],
) -> Result<(), CoreError> {
    delete_rows(tx, pub_key)?;
    let mut stmt = tx.prepare(
        "INSERT INTO search_index \
         (text, title, pub_key, doc_id, book, chapter, verse, paragraph) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    let mut derived = Derived::new(pub_key);
    for row in rows {
        let (book, chapter, verse) = match row.verse {
            Some((b, c, v)) => (Some(b), Some(c), Some(v)),
            None => (None, None, None),
        };
        stmt.execute(params![
            row.text,
            row.title,
            pub_key,
            row.doc_id,
            book,
            chapter,
            verse,
            row.paragraph
        ])?;
        derived.add(&row.text, &row.title, row.doc_id, row.verse.is_some());
    }
    derived.write(tx)?;
    Ok(())
}

/// Drop `pub_key`'s rows from the index.
pub(crate) fn delete_rows(tx: &Transaction, pub_key: &str) -> Result<(), CoreError> {
    tx.execute("DELETE FROM search_index WHERE pub_key = ?1", [pub_key])?;
    tx.execute("DELETE FROM search_term WHERE pub_key = ?1", [pub_key])?;
    tx.execute("DELETE FROM search_topic WHERE pub_key = ?1", [pub_key])?;
    Ok(())
}

/// The migration hook that adds suggestions: fills `search_term` and
/// `search_topic` from the rows already in the index, in one pass over it.
pub(crate) fn backfill_suggestions(tx: &Transaction) -> HookResult {
    let mut by_pub: HashMap<String, Derived> = HashMap::new();
    {
        let mut stmt =
            tx.prepare("SELECT pub_key, text, title, doc_id, verse IS NOT NULL FROM search_index")?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let pub_key: String = r.get(0)?;
            let text: String = r.get(1)?;
            let title: String = r.get(2)?;
            by_pub
                .entry(pub_key.clone())
                .or_insert_with(|| Derived::new(&pub_key))
                .add(&text, &title, r.get(3)?, r.get(4)?);
        }
    }
    for derived in by_pub.into_values() {
        derived.write(tx)?;
    }
    Ok(())
}

/// One publication's suggestion rows, gathered from its index rows.
struct Derived {
    pub_key: String,
    /// Folded word => spelling => occurrences.
    words: HashMap<String, HashMap<String, i64>>,
    /// Article => title, for a topic publication.
    topics: Option<HashMap<i64, String>>,
}

impl Derived {
    fn new(pub_key: &str) -> Self {
        let topical =
            parse_pub_key(pub_key).is_ok_and(|(symbol, _, _)| TOPIC_SYMBOLS.contains(&symbol));
        Derived {
            pub_key: pub_key.to_string(),
            words: HashMap::new(),
            topics: topical.then(HashMap::new),
        }
    }

    fn add(&mut self, text: &str, title: &str, doc_id: i64, is_verse: bool) {
        for word in words(text) {
            let term = fold(word);
            if term.chars().count() < 2 || !term.chars().any(char::is_alphabetic) {
                continue;
            }
            *self
                .words
                .entry(term)
                .or_default()
                .entry(word.to_string())
                .or_default() += 1;
        }
        if let Some(topics) = &mut self.topics {
            if !is_verse && !title.trim().is_empty() {
                topics
                    .entry(doc_id)
                    .or_insert_with(|| title.trim().to_string());
            }
        }
    }

    fn write(self, tx: &Transaction) -> rusqlite::Result<()> {
        let mut stmt = tx.prepare(
            "INSERT INTO search_term (term, pub_key, form, count) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for (term, spellings) in &self.words {
            // The most common spelling; a tie goes to the lowercase one,
            // then in text order.
            let (form, _) = spellings
                .iter()
                .max_by(|a, b| {
                    a.1.cmp(b.1)
                        .then_with(|| is_lowercase(a.0).cmp(&is_lowercase(b.0)))
                        .then_with(|| b.0.cmp(a.0))
                })
                .expect("a word has a spelling");
            let count: i64 = spellings.values().sum();
            stmt.execute(params![term, self.pub_key, form, count])?;
        }
        if let Some(topics) = &self.topics {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO search_topic (folded, pub_key, doc_id, title) \
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for (doc_id, title) in topics {
                let folded = fold(
                    &strip_pronunciation(title)
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                );
                stmt.execute(params![folded, self.pub_key, doc_id, title])?;
            }
        }
        Ok(())
    }
}

fn is_lowercase(s: &str) -> bool {
    !s.chars().any(char::is_uppercase)
}

/// Whether `c` is part of a word: a letter, digit or combining mark. Close
/// to what the index's tokenizer keeps.
fn word_char(c: char) -> bool {
    c.is_alphanumeric() || is_combining_mark(c)
}

/// The words of `text`, as written.
fn words(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !word_char(c))
        .filter(|w| !w.is_empty())
}

/// `text` as the tokenizer compares it: diacritics removed, lowercase.
fn fold(text: &str) -> String {
    text.nfd()
        .filter(|&c| !is_combining_mark(c))
        .flat_map(char::to_lowercase)
        .collect()
}

/// The least string greater than every string starting with `prefix`, for
/// a range scan.
fn above(prefix: &str) -> String {
    format!("{prefix}\u{10ffff}")
}

/// Narrow a query on a table with a `pub_key` column to `keys`, when given.
fn push_key_filter(sql: &mut String, values: &mut Vec<Value>, keys: Option<&[String]>) {
    if let Some(keys) = keys {
        let marks = vec!["?"; keys.len()].join(", ");
        sql.push_str(&format!(" AND pub_key IN ({marks})"));
        values.extend(keys.iter().cloned().map(Value::from));
    }
}

/// Text as indexed: whitespace runs collapsed to one space, the snippet
/// markers removed, and pronunciation marks dropped (see
/// [`strip_pronunciation`]).
fn clean(text: &str) -> String {
    strip_pronunciation(
        &text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .replace([MARK_OPEN, MARK_CLOSE], ""),
    )
}

/// `text` without the pronunciation marks some publications print in names
/// (`Abʹsa·lom`): a stress mark (U+02B9) after a letter, and a middle dot
/// between letters. The tokenizer would split a name at the dot, so
/// `Absalom` would not match it. Applied to indexed text and query terms
/// alike.
fn strip_pronunciation(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let letter = |i: Option<usize>| {
        i.and_then(|i| chars.get(i))
            .is_some_and(|c| c.is_alphabetic())
    };
    chars
        .iter()
        .enumerate()
        .filter(|&(i, &c)| match c {
            '\u{2b9}' => !letter(i.checked_sub(1)),
            '\u{b7}' => !(letter(i.checked_sub(1)) && letter(Some(i + 1))),
            _ => true,
        })
        .map(|(_, &c)| c)
        .collect()
}

/// The FTS5 query for user text: each whitespace-separated term as a quoted
/// string (inner quotes doubled), joined with `AND`; text wrapped in double
/// quotes as one quoted phrase. No text => `Invalid`.
fn match_expression(text: &str) -> Result<String, CoreError> {
    let text = strip_pronunciation(text.trim());
    let text = text.as_str();
    let quote = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
    let expression = match text.strip_prefix('"').and_then(|t| t.strip_suffix('"')) {
        Some(phrase) if phrase.trim().is_empty() => String::new(),
        Some(phrase) => quote(phrase.trim()),
        None => text
            .split_whitespace()
            .map(quote)
            .collect::<Vec<_>>()
            .join(" AND "),
    };
    if expression.is_empty() {
        return Err(CoreError::Invalid("empty search text".into()));
    }
    Ok(expression)
}

/// A `snippet()` result as HTML: escaped, with the match markers as
/// `<mark>` tags.
fn snippet_html(snippet: &str) -> String {
    let mut html = String::with_capacity(snippet.len() + 16);
    for c in snippet.chars() {
        match c {
            '&' => html.push_str("&amp;"),
            '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"),
            '"' => html.push_str("&quot;"),
            '\'' => html.push_str("&#39;"),
            MARK_OPEN => html.push_str("<mark>"),
            MARK_CLOSE => html.push_str("</mark>"),
            c => html.push(c),
        }
    }
    html
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_text_is_quoted() {
        assert_eq!(
            match_expression(" God  love ").unwrap(),
            r#""God" AND "love""#
        );
        assert_eq!(
            match_expression(r#"NEAR( a"b * -x OR"#).unwrap(),
            r#""NEAR(" AND "a""b" AND "*" AND "-x" AND "OR""#
        );
        assert_eq!(
            match_expression(r#" "loved the  world" "#).unwrap(),
            r#""loved the  world""#
        );
        assert_eq!(match_expression(r#"""#).unwrap(), r#""""""#);
        for text in ["", "  \t\n", r#""""#, r#"" ""#] {
            assert!(
                matches!(match_expression(text), Err(CoreError::Invalid(_))),
                "{text:?}"
            );
        }
    }

    #[test]
    fn snippets_are_escaped_html() {
        assert_eq!(
            snippet_html("a <b> & \"c\" 'd' \u{2}love\u{3}…"),
            "a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; <mark>love</mark>…"
        );
    }

    #[test]
    fn words_are_folded_like_the_tokenizer() {
        assert_eq!(fold("JEHOVÁ"), "jehova");
        assert_eq!(fold("Niño"), "nino");
        assert_eq!(
            words("“Jehovah’s (love)”, 3:16 é").collect::<Vec<_>>(),
            ["Jehovah", "s", "love", "3", "16", "é"]
        );
        assert_eq!(above("lo"), "lo\u{10ffff}");
        assert!("love" > "lo" && "love" < above("lo").as_str());
        assert!("lp" > above("lo").as_str());
    }

    #[test]
    fn spellings_and_topics_are_derived() {
        let mut d = Derived::new("it:0:0");
        d.add("Love, love and LOVE. God is love.", "Love", 7, false);
        d.add("God", "Love", 7, false);
        d.add("a 3 x", "God", 8, false);
        let love = &d.words["love"];
        assert_eq!((love["love"], love["Love"], love["LOVE"]), (2, 1, 1));
        assert_eq!(d.words["god"]["God"], 2);
        assert!(!d.words.contains_key("a") && !d.words.contains_key("3"));
        assert_eq!(d.topics.as_ref().unwrap()[&7], "Love");
        assert!(Derived::new("nwt:0:0").topics.is_none());
    }

    /// A core with `rows` indexed for each key, each key recorded as
    /// installed (so a scope can select it).
    fn core_with(pubs: &[(&str, Vec<IndexRow>)]) -> (tempfile::TempDir, crate::Core) {
        let dir = tempfile::tempdir().unwrap();
        let core = crate::Core::open(dir.path().join("data"), dir.path().join("cache")).unwrap();
        {
            let mut conn = core.inner.conn();
            let tx = conn.transaction().unwrap();
            for (i, (key, rows)) in pubs.iter().enumerate() {
                let (symbol, lang, issue) = parse_pub_key(key).unwrap();
                tx.execute(
                    "INSERT INTO installed_publication VALUES (?1, ?2, ?3, ?4, 2024, 'T', 'Book', ?5, 0)",
                    params![key, symbol, lang, issue, format!("d{i}")],
                )
                .unwrap();
                replace_rows(&tx, key, rows).unwrap();
            }
            tx.commit().unwrap();
        }
        (dir, core)
    }

    fn verse(text: &str, verse: u32) -> IndexRow {
        IndexRow {
            text: text.into(),
            title: "John 3".into(),
            doc_id: 1,
            verse: Some((43, 3, verse)),
            paragraph: None,
        }
    }

    fn paragraph(text: &str, title: &str, doc_id: i64) -> IndexRow {
        IndexRow {
            text: text.into(),
            title: title.into(),
            doc_id,
            verse: None,
            paragraph: Some(1),
        }
    }

    fn bible_and_insight() -> (tempfile::TempDir, crate::Core) {
        core_with(&[
            (
                "nwt:0:0",
                vec![
                    verse("For God loved the world so much", 16),
                    verse("God did not send his Son into the world", 17),
                    verse("Love, LOVE, love; the lowly lord", 18),
                    verse("Jehovah’s salvation is low", 19),
                ],
            ),
            (
                "it:0:0",
                vec![
                    paragraph("Love is a quality", "Love", 100),
                    paragraph("Lowliness of mind", "Lowliness", 101),
                    paragraph("The lot was cast", "Lot", 102),
                    paragraph("Lotan, a son of Seir", "Lotan", 103),
                ],
            ),
            (
                "nwt:1:0",
                vec![verse("Porque Jehová amó tanto al mundo", 16)],
            ),
        ])
    }

    fn queries(core: &crate::Core, text: &str, scope: &SearchScope) -> Vec<String> {
        core.search().suggest(text, scope, 5).unwrap().queries
    }

    fn all() -> SearchScope {
        SearchScope::default()
    }

    #[test]
    fn completes_the_last_word_most_common_first() {
        let (_dir, core) = bible_and_insight();
        // love 4, then one each in term order, each as it is written.
        assert_eq!(
            queries(&core, "lo", &all()),
            ["love", "lord", "lot", "Lotan", "loved"]
        );
        // The typed word itself is not offered; case and diacritics are ignored.
        assert_eq!(queries(&core, "LOVE", &all()), ["loved"]);
        assert_eq!(queries(&core, "jeho", &all()), ["Jehová", "Jehovah"]);
        // Scoped to one publication.
        assert_eq!(
            queries(
                &core,
                "jeho",
                &SearchScope {
                    pub_keys: vec!["nwt:1:0".into()],
                    ..all()
                }
            ),
            ["Jehová"]
        );
        // Nothing to complete.
        for text in ["", "  ", "love ", "\"love\"", "John 3", "Jehovah’s", "3:1"] {
            assert_eq!(
                queries(&core, text, &all()),
                Vec::<String>::new(),
                "{text:?}"
            );
        }
    }

    #[test]
    fn completions_with_other_words_must_find_something() {
        let (_dir, core) = bible_and_insight();
        // "god lot" finds nothing; "god love" neither (God and love are in
        // different verses); "god lowly" neither.
        assert_eq!(queries(&core, "God lo", &all()), ["God loved"]);
        assert_eq!(queries(&core, "world wo", &all()), Vec::<String>::new());
        assert_eq!(
            queries(&core, "\"loved the wo", &all()),
            ["\"loved the world\""]
        );
        assert_eq!(queries(&core, "(lowl", &all()), ["(Lowliness", "(lowly"]);
    }

    #[test]
    fn topics_start_with_the_text() {
        let (_dir, core) = bible_and_insight();
        let topics = core.search().suggest("lo", &all(), 3).unwrap().topics;
        let titles: Vec<_> = topics.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, ["Lot", "Love", "Lotan"]);
        assert_eq!(topics[0].location.pub_key, "it:0:0");
        assert_eq!(topics[0].location.doc_id, Some(102));
        // An exact title first.
        let topics = core.search().suggest(" LOTAN ", &all(), 3).unwrap().topics;
        assert_eq!(topics[0].title, "Lotan");
        let topics = core.search().suggest("lot", &all(), 3).unwrap().topics;
        assert_eq!(
            topics.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
            ["Lot", "Lotan"]
        );
        // Out of scope, or no letters: none.
        let bible = SearchScope {
            kinds: vec![PubKind::Bible],
            ..all()
        };
        assert!(core
            .search()
            .suggest("lo", &bible, 3)
            .unwrap()
            .topics
            .is_empty());
        assert!(core
            .search()
            .suggest("\" ", &all(), 3)
            .unwrap()
            .topics
            .is_empty());
    }

    #[test]
    fn suggest_checks_its_arguments() {
        let (_dir, core) = bible_and_insight();
        let search = core.search();
        assert!(matches!(
            search.suggest("lo", &all(), 0),
            Err(CoreError::Invalid(_))
        ));
        let bad = SearchScope {
            pub_keys: vec!["nope".into()],
            ..all()
        };
        assert!(matches!(
            search.suggest("lo", &bad, 5),
            Err(CoreError::Invalid(_))
        ));
        let missing = SearchScope {
            pub_keys: vec!["w:0:0".into()],
            ..all()
        };
        assert_eq!(
            search.suggest("lo", &missing, 5).unwrap(),
            Suggestions::default()
        );
    }

    #[test]
    fn removing_rows_removes_suggestions_and_backfill_restores_them() {
        let (_dir, core) = bible_and_insight();
        let before = core.search().suggest("lo", &all(), 20).unwrap();
        {
            let mut conn = core.inner.conn();
            let tx = conn.transaction().unwrap();
            tx.execute_batch("DELETE FROM search_term; DELETE FROM search_topic;")
                .unwrap();
            backfill_suggestions(&tx).unwrap();
            tx.commit().unwrap();
        }
        assert_eq!(core.search().suggest("lo", &all(), 20).unwrap(), before);
        {
            let mut conn = core.inner.conn();
            let tx = conn.transaction().unwrap();
            delete_rows(&tx, "it:0:0").unwrap();
            tx.commit().unwrap();
        }
        let after = core.search().suggest("lo", &all(), 20).unwrap();
        assert!(after.topics.is_empty());
        assert!(!after.queries.contains(&"lotan".to_string()));
        assert!(after.queries.contains(&"love".to_string()));
    }

    #[test]
    fn indexed_text_is_cleaned() {
        assert_eq!(clean("  a\u{a0}\n b\u{2}c\u{3} "), "a bc");
        assert_eq!(clean("Abʹsa·lom, Je·hoʹvah’s"), "Absalom, Jehovah’s");
        // Not between letters: kept.
        assert_eq!(clean("ʹa 1·2 a· ·b"), "ʹa 1·2 a· ·b");
    }
}
