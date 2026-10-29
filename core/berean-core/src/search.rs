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

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, OptionalExtension, Transaction};

use crate::jwpub::Publication;
use crate::library::{parse_pub_key, Library, PubKind};
use crate::reader::{self, Location};
use crate::{CancelToken, CoreError, Inner, ProgressSink, Steps};

/// The most hits one query returns; a larger `limit` is capped to it.
pub const MAX_LIMIT: u32 = 500;

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
        if let Some(keys) = keys {
            let marks = vec!["?"; keys.len()].join(", ");
            sql.push_str(&format!(" AND pub_key IN ({marks})"));
            values.extend(keys.into_iter().map(Value::from));
        }
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
    }
    Ok(())
}

/// Drop `pub_key`'s rows from the index.
pub(crate) fn delete_rows(tx: &Transaction, pub_key: &str) -> Result<(), CoreError> {
    tx.execute("DELETE FROM search_index WHERE pub_key = ?1", [pub_key])?;
    Ok(())
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
    fn indexed_text_is_cleaned() {
        assert_eq!(clean("  a\u{a0}\n b\u{2}c\u{3} "), "a bc");
        assert_eq!(clean("Abʹsa·lom, Je·hoʹvah’s"), "Absalom, Jehovah’s");
        // Not between letters: kept.
        assert_eq!(clean("ʹa 1·2 a· ·b"), "ʹa 1·2 a· ·b");
    }
}
