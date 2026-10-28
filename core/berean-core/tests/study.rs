//! Research Guide study references against real JW Library publications.
//! The fixtures are not committed: run `core/scripts/fetch-fixtures.sh` to
//! download them into `core/fixtures/`.

mod common;
#[path = "common/trimmed_catalog.rs"]
mod trimmed_catalog;

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use berean_core::reader::{Location, StudyAvailability, StudyReferences};
use berean_core::{CancelToken, Core, CoreError};
use common::{fixture, raw_db};

const NWT_E: &str = "nwt:0:0";
const NWT_S: &str = "nwt:1:0";
const RSG_E: &str = "rsg:0:0";
const W_E: &str = "w26:0:20260800";
const IT_E: &str = "it:0:0";

/// The commentary rows, references and `$`-separated multi-target links in
/// the pinned `rsg_E.jwpub`.
const ENTRIES: usize = 14899;
const REFERENCES: usize = 44546;
const MULTI_TARGET: usize = 3037;
/// The distinct Insight documents the guide's verse references target, and
/// how many references target Insight. The guide's `Extract`s quote 2424
/// Insight documents in all: the other 182 are quoted only by its own
/// documents, not by a verse entry.
const INSIGHT_DOCS: usize = 2242;
const INSIGHT_REFERENCES: usize = 12404;
const INSIGHT_EXTRACT_DOCS: usize = 2424;

fn new_core(name: &str, fixtures: &[(&str, &str)]) -> Core {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    let core = Core::open(dir.join("data"), dir.join("cache")).unwrap();
    for (key, file) in fixtures {
        core.library()
            .install(key, fixture(file), &|_, _| {}, &CancelToken::new())
            .unwrap_or_else(|e| panic!("install {file}: {e:?}"));
    }
    core
}

/// English and Spanish Bibles, the English guide, a Watchtower, Insight and
/// the (trimmed) catalog; shared by most tests.
fn core() -> &'static Core {
    static CORE: OnceLock<Core> = OnceLock::new();
    CORE.get_or_init(|| {
        let core = new_core(
            "study",
            &[
                (NWT_E, "nwt_E.jwpub"),
                (NWT_S, "nwt_S.jwpub"),
                (RSG_E, "rsg_E.jwpub"),
                (W_E, "w_E_202608.jwpub"),
                (IT_E, "it_E.jwpub"),
            ],
        );
        core.catalog()
            .ingest_file(trimmed_catalog::trimmed(), &|_, _| {}, &CancelToken::new())
            .unwrap();
        core
    })
}

fn verse(pub_key: &str, book: u32, chapter: u32, verse: u32) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: None,
        book: Some(book),
        chapter: Some(chapter),
        verse: Some(verse),
        paragraph: None,
    }
}

fn document(pub_key: &str, doc_id: i64, paragraph: Option<u32>) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: Some(doc_id),
        book: None,
        chapter: None,
        verse: None,
        paragraph,
    }
}

fn study(location: &Location) -> Result<StudyReferences, CoreError> {
    core().reader().study_references(location)
}

#[test]
fn john_3_16() {
    let location = core().reader().resolve("John 3:16").unwrap().start;
    let refs = study(&location).unwrap();
    assert_eq!(refs.availability, StudyAvailability::Installed);
    assert_eq!(refs.items.len(), 32);

    let first = &refs.items[0];
    assert_eq!(first.label, "What Jehovah Has Done to Rescue Sinful Humans");
    assert!(
        first
            .html
            .starts_with(r#"<div id="tt468" class="du-margin-children-bottom--0">"#),
        "{}",
        first.html
    );
    assert!(first.html.contains("<em>w24.08 pp. 2-6</em>"));
    assert!(first.html.ends_with("</div>"));
    assert_eq!(
        first.target,
        Some(document("w24:0:20240800", 2024530, Some(1)))
    );

    // Linked to `p/E:1102002048/6-12$p/E:1102002048/16-16`: the first target.
    let second = &refs.items[1];
    assert_eq!(second.label, "“He First Loved Us”");
    assert!(second.html.contains('$'));
    assert!(second.html.contains("<em>cl chap. 23</em>"));
    assert_eq!(second.target, Some(document("cl:0:0", 1102002048, Some(6))));
}

/// The study references of every verse the guide has an entry for, read
/// once: `(book:chapter:verse, references)`.
fn every_entry() -> &'static [(String, StudyReferences)] {
    static ENTRIES: OnceLock<Vec<(String, StudyReferences)>> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        let (_dir, db) = raw_db("rsg_E.jwpub");
        let mut stmt = db.prepare("SELECT Label FROM VerseCommentary").unwrap();
        let headers: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let reader = core().reader();
        headers
            .iter()
            .map(|header| {
                // `... href="jwpub://b/NWTR/43:3:16-43:3:16" ...`
                let at = header.find("jwpub://b/NWTR/").unwrap() + "jwpub://b/NWTR/".len();
                let (start, _) = header[at..].split_once('-').unwrap();
                let n: Vec<u32> = start.split(':').map(|n| n.parse().unwrap()).collect();
                let refs = reader
                    .study_references(&verse(NWT_E, n[0], n[1], n[2]))
                    .unwrap_or_else(|e| panic!("{start}: {e:?}"));
                (start.to_string(), refs)
            })
            .collect()
    })
}

#[test]
fn every_entry_parses() {
    let entries = every_entry();
    assert_eq!(entries.len(), ENTRIES);
    let (mut references, mut multi_target) = (0, 0);
    for (start, refs) in entries {
        assert_eq!(refs.availability, StudyAvailability::Installed);
        assert!(!refs.items.is_empty(), "{start}");
        for item in &refs.items {
            assert!(!item.label.is_empty(), "{start}");
            assert!(item.target.is_some(), "{start}: {}", item.label);
            multi_target += usize::from(item.html.contains('$'));
        }
        references += refs.items.len();
    }
    assert_eq!(references, REFERENCES);
    assert_eq!(multi_target, MULTI_TARGET);
}

#[test]
fn insight_targets_resolve() {
    let mut targets: HashMap<i64, Vec<u32>> = HashMap::new();
    let mut references = 0;
    for (_, refs) in every_entry() {
        for target in refs.items.iter().filter_map(|i| i.target.as_ref()) {
            if target.pub_key == IT_E {
                let paragraph = target.paragraph.expect("a paragraph");
                targets
                    .entry(target.doc_id.unwrap())
                    .or_default()
                    .push(paragraph);
                references += 1;
            }
        }
    }
    assert_eq!(targets.len(), INSIGHT_DOCS);
    assert_eq!(references, INSIGHT_REFERENCES);

    let reader = core().reader();
    // Every Insight document any `Extract` of the guide quotes is there.
    let (_dir, db) = raw_db("rsg_E.jwpub");
    let mut stmt = db
        .prepare(
            "SELECT DISTINCT e.RefMepsDocumentId FROM Extract e \
             JOIN RefPublication p ON p.RefPublicationId = e.RefPublicationId \
             WHERE p.Symbol = 'it'",
        )
        .unwrap();
    let quoted: Vec<i64> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(quoted.len(), INSIGHT_EXTRACT_DOCS);
    assert!(targets.keys().all(|d| quoted.contains(d)));
    for doc_id in &quoted {
        let document = reader
            .document(IT_E, *doc_id)
            .unwrap_or_else(|e| panic!("{doc_id}: {e:?}"));
        for paragraph in targets.get(doc_id).into_iter().flatten() {
            assert!(
                document
                    .paragraphs
                    .iter()
                    .any(|p| p.paragraph == *paragraph),
                "{doc_id}/{paragraph}"
            );
        }
    }
}

#[test]
fn verse_without_an_entry_is_empty() {
    // Genesis 1:10 has no entry; 1:9 and 1:11 do.
    let refs = study(&verse(NWT_E, 1, 1, 10)).unwrap();
    assert_eq!(refs.availability, StudyAvailability::Installed);
    assert!(refs.items.is_empty());
    assert!(!study(&verse(NWT_E, 1, 1, 9)).unwrap().items.is_empty());
}

#[test]
fn guide_not_installed_is_listed_from_the_catalog() {
    let refs = study(&verse(NWT_S, 43, 3, 16)).unwrap();
    assert_eq!(
        refs,
        StudyReferences {
            availability: StudyAvailability::NotInstalled {
                pub_key: "rsg:1:0".into()
            },
            items: Vec::new(),
        }
    );
}

#[test]
fn no_guide_and_no_catalog_is_not_found() {
    let core = new_core("study-bare", &[(NWT_S, "nwt_S.jwpub")]);
    let err = core
        .reader()
        .study_references(&verse(NWT_S, 43, 3, 16))
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound), "{err:?}");
}

#[test]
fn non_verses_are_invalid() {
    let chapter = Location {
        verse: None,
        ..verse(NWT_E, 43, 3, 16)
    };
    let paragraph = Location {
        paragraph: Some(1),
        ..verse(NWT_E, 43, 3, 16)
    };
    for location in [
        chapter,
        paragraph,
        document(NWT_E, 1001061147, None),
        document(W_E, 2026521, Some(1)),
        // A verse, but not of a Bible.
        verse(W_E, 43, 3, 16),
        verse(RSG_E, 43, 3, 16),
        verse("nwt", 43, 3, 16),
    ] {
        match study(&location) {
            Err(CoreError::Invalid(_)) => {}
            other => panic!("{location:?}: {other:?}"),
        }
    }
}

#[test]
fn unknown_verses_are_not_found() {
    for location in [
        verse(NWT_E, 43, 3, 99),
        verse(NWT_E, 43, 99, 1),
        verse(NWT_E, 67, 1, 1),
        // Not installed.
        verse("nwt:2:0", 43, 3, 16),
    ] {
        match study(&location) {
            Err(CoreError::NotFound) => {}
            other => panic!("{location:?}: {other:?}"),
        }
    }
}
