//! The languages a document can be read in: JW Library's "Languages" for
//! the article being read.
//!
//! A document keeps its MEPS id in every language, so the same article in
//! Spanish is the document with the same id in a Spanish publication. The
//! catalog's `PublicationDocument` table lists, for each MEPS document id,
//! every publication in any language that holds it; installed publications
//! are checked in their own files, so a side-loaded edition the catalog
//! doesn't list (or a catalog that is missing or unreadable) still counts.
//!
//! Each language gets one edition. The publication being read stands for its
//! own language. Elsewhere an installed edition wins over one to download,
//! and among either kind the one with the same symbol and issue as the
//! publication being read wins, then the same symbol, then the newest issue,
//! then the lowest key. Languages the language table doesn't map have no
//! code or name, so they are left out.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::languages::{self, Language};
use crate::library::{parse_pub_key, PublicationSummary};
use crate::reader::{find_document, Reader};
use crate::CoreError;

/// One language a document can be read in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentLanguage {
    pub language: Language,
    /// The edition in that language that holds the document.
    pub publication: PublicationSummary,
    /// Whether `publication` is installed. Otherwise it is the catalog's, to
    /// download; once installed it holds the document by the same MEPS id.
    pub installed: bool,
}

impl Reader {
    /// The languages the document with MEPS id `doc_id` of the installed
    /// publication `pub_key` can be read in, its own language included, by
    /// language name. Malformed key => `Invalid`; not installed, or no such
    /// document => `NotFound`.
    pub fn document_languages(
        &self,
        pub_key: &str,
        doc_id: i64,
    ) -> Result<Vec<DocumentLanguage>, CoreError> {
        let (symbol, _, issue) = parse_pub_key(pub_key)?;
        let library = self.library();
        library
            .with_publication(pub_key, |p| find_document(p, doc_id))?
            .ok_or(CoreError::NotFound)?;
        let installed = library.installed()?;
        let current = installed
            .iter()
            .find(|p| p.pub_key == pub_key)
            .cloned()
            .ok_or(CoreError::NotFound)?;
        // A catalog that cannot be read counts as none: the library's
        // editions still list.
        let listed = self.catalog().holding_document(doc_id).unwrap_or_default();

        let rank = |p: &PublicationSummary| {
            (
                !(p.symbol == symbol && p.issue_tag == issue),
                p.symbol != symbol,
                std::cmp::Reverse(p.issue_tag),
                p.pub_key.clone(),
            )
        };
        let better = |a: &PublicationSummary, b: &PublicationSummary| rank(a).cmp(&rank(b));

        let mut chosen: BTreeMap<u32, DocumentLanguage> = BTreeMap::new();
        let mut offer = |publication: PublicationSummary, installed: bool| {
            let language = publication.meps_language;
            let replace = match chosen.get(&language) {
                None => true,
                Some(have) => {
                    (installed && !have.installed)
                        || (installed == have.installed
                            && better(&publication, &have.publication) == Ordering::Less)
                }
            };
            if replace {
                if let Some(language) = languages::by_meps_id(language) {
                    chosen.insert(
                        language.meps_id,
                        DocumentLanguage {
                            language: language.clone(),
                            publication,
                            installed,
                        },
                    );
                }
            }
        };

        // Installed editions: the catalog's, and the same symbol and issue
        // in any language, each checked for the document in its own file.
        for p in &installed {
            if p.meps_language == current.meps_language {
                continue;
            }
            let candidate = (p.symbol == symbol && p.issue_tag == issue)
                || listed.iter().any(|l| l.pub_key == p.pub_key);
            if candidate && self.holds(&p.pub_key, doc_id)? {
                offer(p.clone(), true);
            }
        }
        for p in listed {
            if p.meps_language != current.meps_language
                && !installed.iter().any(|i| i.pub_key == p.pub_key)
            {
                offer(p, false);
            }
        }
        let own = current.meps_language;
        chosen.remove(&own);
        let mut out: Vec<DocumentLanguage> = chosen.into_values().collect();
        if let Some(language) = languages::by_meps_id(own) {
            out.push(DocumentLanguage {
                language: language.clone(),
                publication: current,
                installed: true,
            });
        }
        out.sort_by(|a, b| {
            a.language
                .name
                .cmp(&b.language.name)
                .then(a.language.meps_id.cmp(&b.language.meps_id))
        });
        Ok(out)
    }

    /// Whether the installed publication `pub_key` has the document. A
    /// publication that can't be read, or is gone, doesn't.
    fn holds(&self, pub_key: &str, doc_id: i64) -> Result<bool, CoreError> {
        match self
            .library()
            .with_publication(pub_key, |p| find_document(p, doc_id))
        {
            Ok(found) => Ok(found.is_some()),
            Err(CoreError::NotFound | CoreError::Corrupt) => Ok(false),
            Err(e) => Err(e),
        }
    }
}
