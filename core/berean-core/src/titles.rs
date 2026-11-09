//! Title search: finds publications by title, as JW Library's Library search
//! does, among the installed publications and the catalog.
//!
//! A query and each title are folded the same way: lowercased, Latin letters
//! stripped of diacritics, and punctuation (`’`, `—`, `,`, `(`, …) read as a
//! space, so `jehova` finds "Jehová" and `watchtower august` finds "The
//! Watchtower, August 2026". A publication matches when every word of the
//! query is in its title, its issue title or its symbol (`lff`, `w26`), in
//! any order and anywhere in a word. Matches rank by how closely they fit:
//!
//! 1. the whole query is a title, an issue title or a symbol;
//! 2. a title or issue title starts with the query;
//! 3. every query word starts a word of the title or issue title;
//! 4. anything else that matches.
//!
//! Within a rank, newer publications come first (year, then issue,
//! descending), then by title.

use std::collections::HashSet;

use crate::catalog::CatalogFilter;
use crate::library::{Library, PublicationSummary};
use crate::CoreError;

/// One publication a title search found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleMatch {
    pub publication: PublicationSummary,
    /// Whether it is installed; otherwise it comes from the catalog.
    pub installed: bool,
}

impl Library {
    /// The publications whose title, issue title or symbol matches `query`
    /// (see the module docs): first every installed match, in any language,
    /// then at most `limit` catalog matches in `meps_language` (every
    /// language when `None`) that are not installed. Each group is ranked
    /// on its own. A query with no letters or digits finds nothing; with no
    /// catalog only installed publications are searched.
    pub fn find_titles(
        &self,
        query: &str,
        meps_language: Option<u32>,
        limit: u32,
    ) -> Result<Vec<TitleMatch>, CoreError> {
        let query = Query::new(query);
        if query.words.is_empty() {
            return Ok(Vec::new());
        }

        let installed = self.installed()?;
        let installed_keys: HashSet<String> = installed.iter().map(|p| p.pub_key.clone()).collect();
        let mut out: Vec<TitleMatch> = ranked(&query, installed, usize::MAX)
            .into_iter()
            .map(|publication| TitleMatch {
                publication,
                installed: true,
            })
            .collect();

        let catalog = self.catalog().publications(&CatalogFilter {
            meps_language,
            ..CatalogFilter::default()
        })?;
        let catalog = catalog
            .into_iter()
            .filter(|p| !installed_keys.contains(&p.pub_key));
        out.extend(
            ranked(&query, catalog, limit as usize)
                .into_iter()
                .map(|publication| TitleMatch {
                    publication,
                    installed: false,
                }),
        );
        Ok(out)
    }
}

/// The publications of `pubs` that match, best first, at most `limit`.
fn ranked(
    query: &Query,
    pubs: impl IntoIterator<Item = PublicationSummary>,
    limit: usize,
) -> Vec<PublicationSummary> {
    let mut hits: Vec<(u8, PublicationSummary)> = pubs
        .into_iter()
        .filter_map(|p| query.rank(&p).map(|rank| (rank, p)))
        .collect();
    hits.sort_by(|(ra, a), (rb, b)| {
        ra.cmp(rb)
            .then((b.year, b.issue_tag).cmp(&(a.year, a.issue_tag)))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.pub_key.cmp(&b.pub_key))
    });
    hits.truncate(limit);
    hits.into_iter().map(|(_, p)| p).collect()
}

/// A folded query.
struct Query {
    /// The query's words, joined by single spaces.
    phrase: String,
    words: Vec<String>,
}

impl Query {
    fn new(text: &str) -> Self {
        let phrase = fold(text);
        let words = phrase
            .split(' ')
            .filter(|w| !w.is_empty())
            .map(String::from)
            .collect();
        Query { phrase, words }
    }

    /// The rank of `p` (lower is better), or `None` when it does not match.
    fn rank(&self, p: &PublicationSummary) -> Option<u8> {
        let title = fold(&p.title);
        let issue = p.issue_title.as_deref().map(fold).unwrap_or_default();
        let symbol = fold(&p.symbol);
        let haystack = format!("{title} {issue} {symbol}");
        if !self.words.iter().all(|w| haystack.contains(w.as_str())) {
            return None;
        }
        let titles = [&title, &issue];
        if titles.iter().any(|t| **t == self.phrase) || symbol == self.phrase {
            return Some(0);
        }
        if titles
            .iter()
            .any(|t| !t.is_empty() && t.starts_with(&self.phrase))
        {
            return Some(1);
        }
        let word_starts = |t: &str| {
            let words: Vec<&str> = t.split(' ').collect();
            self.words
                .iter()
                .all(|q| words.iter().any(|w| w.starts_with(q.as_str())))
        };
        if titles.iter().any(|t| word_starts(t)) {
            return Some(2);
        }
        Some(3)
    }
}

/// `text` lowercased, Latin letters stripped of diacritics, and every run of
/// characters that are not letters or digits made one space, trimmed.
pub(crate) fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = true;
    for c in text.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(crate::reader::strip_diacritic(c));
            space = false;
        } else if !space {
            out.push(' ');
            space = true;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::PubKind;

    fn pub_(
        key: &str,
        symbol: &str,
        year: u32,
        title: &str,
        issue: Option<&str>,
    ) -> PublicationSummary {
        PublicationSummary {
            pub_key: key.into(),
            symbol: symbol.into(),
            meps_language: 0,
            issue_tag: 0,
            year,
            title: title.into(),
            issue_title: issue.map(Into::into),
            kind: PubKind::Book,
        }
    }

    #[test]
    fn folding() {
        assert_eq!(
            fold("  La Atalaya. Anunciando el Reino de Jehová (estudio) "),
            "la atalaya anunciando el reino de jehova estudio"
        );
        assert_eq!(fold("Jehovah’s—Kingdom"), "jehovah s kingdom");
        assert_eq!(fold("¿¡…!?"), "");
        assert_eq!(fold("ÉXODO"), "exodo");
    }

    #[test]
    fn ranks() {
        let lff = pub_(
            "lff:0:0",
            "lff",
            2021,
            "Enjoy Life Forever!—An Interactive Bible Course",
            None,
        );
        let w = pub_(
            "w26:0:20260800",
            "w26",
            2026,
            "The Watchtower Announcing Jehovah’s Kingdom (Study)—2026",
            Some("The Watchtower, August 2026"),
        );
        let rank = |q: &str, p: &PublicationSummary| Query::new(q).rank(p);
        assert_eq!(rank("LFF", &lff), Some(0));
        assert_eq!(rank("the watchtower, august 2026", &w), Some(0));
        assert_eq!(rank("enjoy life", &lff), Some(1));
        assert_eq!(rank("august watch", &w), Some(2));
        assert_eq!(rank("tower", &w), Some(3));
        assert_eq!(rank("jehova", &w), Some(2));
        assert_eq!(rank("forever watchtower", &lff), None);
        assert_eq!(rank("w26 august", &w), Some(3));
    }

    #[test]
    fn ranked_orders_by_rank_then_newest() {
        let old = pub_("a:0:0", "a", 2010, "Draw Close", None);
        let new = pub_("b:0:0", "b", 2020, "Draw Close", None);
        let prefix = pub_("c:0:0", "c", 2025, "Draw Close to Jehovah", None);
        let other = pub_("d:0:0", "d", 2026, "Why Draw Close", None);
        let q = Query::new("draw close");
        let got: Vec<String> = ranked(&q, [other, old, prefix, new], usize::MAX)
            .into_iter()
            .map(|p| p.pub_key)
            .collect();
        assert_eq!(got, ["b:0:0", "a:0:0", "c:0:0", "d:0:0"]);
        assert_eq!(
            ranked(&q, [pub_("x:0:0", "x", 1, "Draw Close", None)], 0),
            []
        );
    }
}
