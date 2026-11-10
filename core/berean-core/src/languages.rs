//! The MEPS language table: which JW language code and English name belong
//! to each numeric MEPS language id the catalog uses.
//!
//! The table is `languages.tsv`, compiled in and parsed once. It is built by
//! `core/scripts/gen-languages.py`: codes and names come from JW's mediator
//! languages API; the catalog has only numeric ids, so each code was matched
//! to its id by asking pub-media for a widely translated publication in that
//! language and finding the single catalog row whose `.jwpub` size equals
//! pub-media's filesize. Ids without an unambiguous match are left out, so a
//! catalog language may have no entry here. [`version`] names the catalog
//! revision and mediator snapshot the table was built from.

use std::sync::OnceLock;

const TSV: &str = include_str!("languages.tsv");

/// A MEPS language and its JW code, e.g. `0`, `E`, `English`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Language {
    pub meps_id: u32,
    /// The JW language code, e.g. `E` or `S`, as pub-media's `langwritten`.
    pub code: String,
    /// The English name of the language.
    pub name: String,
    /// The language's name for itself, e.g. `español`.
    pub vernacular: String,
}

struct Table {
    version: String,
    /// Sorted by `meps_id`.
    languages: Vec<Language>,
}

/// The parsed table. `languages.tsv` is part of the build, so a malformed
/// line is a bug and panics (the unit tests parse it).
fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut version = String::new();
        let mut languages = Vec::new();
        for line in TSV.lines() {
            if let Some(v) = line.strip_prefix("# version\t") {
                version = v.to_string();
                continue;
            }
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let fields: Vec<&str> = line.split('\t').collect();
            let [meps_id, code, name, vernacular] = fields[..] else {
                panic!("languages.tsv: malformed line {line:?}");
            };
            languages.push(Language {
                meps_id: meps_id
                    .parse()
                    .unwrap_or_else(|_| panic!("languages.tsv: bad id in {line:?}")),
                code: code.to_string(),
                name: name.to_string(),
                vernacular: vernacular.to_string(),
            });
        }
        languages.sort_by_key(|l| l.meps_id);
        Table { version, languages }
    })
}

/// Which snapshot the table was built from.
pub fn version() -> &'static str {
    &table().version
}

/// Every language in the table, by MEPS id.
pub fn all() -> &'static [Language] {
    &table().languages
}

/// The language with MEPS id `meps_id`, if the table maps it.
pub fn by_meps_id(meps_id: u32) -> Option<&'static Language> {
    let languages = all();
    languages
        .binary_search_by_key(&meps_id, |l| l.meps_id)
        .ok()
        .map(|i| &languages[i])
}

/// The language with JW code `code`, if the table maps it.
pub fn by_code(code: &str) -> Option<&'static Language> {
    all().iter().find(|l| l.code == code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_languages() {
        let e = by_meps_id(0).unwrap();
        assert_eq!((e.code.as_str(), e.name.as_str()), ("E", "English"));
        let s = by_meps_id(1).unwrap();
        assert_eq!((s.code.as_str(), s.name.as_str()), ("S", "Spanish"));
        assert_eq!(s.vernacular, "español");
        assert_eq!(by_code("S").unwrap().meps_id, 1);
        assert!(by_code("no such code").is_none());
    }

    #[test]
    fn ids_and_codes_are_unique() {
        let languages = all();
        assert!(languages.len() >= 940, "{} languages", languages.len());
        assert!(languages.windows(2).all(|w| w[0].meps_id < w[1].meps_id));
        let mut codes: Vec<&str> = languages.iter().map(|l| l.code.as_str()).collect();
        codes.sort();
        codes.dedup();
        assert_eq!(codes.len(), languages.len());
        assert!(languages
            .iter()
            .all(|l| !l.code.is_empty() && !l.name.is_empty() && !l.vernacular.is_empty()));
        for l in languages {
            assert_eq!(by_meps_id(l.meps_id), Some(l));
            assert_eq!(by_code(&l.code), Some(l));
        }
    }

    #[test]
    fn version_is_recorded() {
        assert!(version().contains("2624030"), "{:?}", version());
    }
}
