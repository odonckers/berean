//! The languages a document can be read in, against the real Watchtower
//! issues and the pinned catalog. The fixtures are not committed: run
//! `core/scripts/fetch-fixtures.sh` to download them into `core/fixtures/`.

mod common;
#[path = "common/trimmed_catalog.rs"]
mod trimmed_catalog;

use std::path::PathBuf;
use std::time::Instant;

use berean_core::library::PubKind;
use berean_core::translations::DocumentLanguage;
use berean_core::{CancelToken, Core, CoreError};
use common::fixture;

const W_E: &str = "w26:0:20260800";
const W_S: &str = "w26:1:20260800";
const W_E_FILE: &str = "w_E_202608.jwpub";
const W_S_FILE: &str = "w_S_202608.jwpub";
const W_S_TITLE: &str = "La Atalaya. Anunciando el Reino de Jehová (estudio) 2026";
/// "You Can Win the Battle!", in both issues.
const WIN_THE_BATTLE_DOC: i64 = 2026521;

/// A fresh core in its own directory under Cargo's per-target temp dir,
/// with `installs` installed and then `catalog` ingested.
fn core(name: &str, installs: &[(&str, &str)], catalog: Option<PathBuf>) -> Core {
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("translations")
        .join(name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    let core = Core::open(dir.join("data"), dir.join("cache")).unwrap();
    // Installed before the catalog, so the files aren't held to its sizes.
    for (key, file) in installs {
        core.library()
            .install(key, fixture(file), &|_, _| {}, &CancelToken::new())
            .unwrap_or_else(|e| panic!("install {file}: {e:?}"));
    }
    if let Some(catalog) = catalog {
        core.catalog()
            .ingest_file(catalog, &|_, _| {}, &CancelToken::new())
            .unwrap();
    }
    core
}

/// `(language code, pub_key, installed)` per language.
fn summary(languages: &[DocumentLanguage]) -> Vec<(&str, &str, bool)> {
    languages
        .iter()
        .map(|l| {
            (
                l.language.code.as_str(),
                l.publication.pub_key.as_str(),
                l.installed,
            )
        })
        .collect()
}

#[test]
fn installed_editions_without_a_catalog() {
    let core = core("no-catalog", &[(W_E, W_E_FILE), (W_S, W_S_FILE)], None);
    let languages = core
        .reader()
        .document_languages(W_E, WIN_THE_BATTLE_DOC)
        .unwrap();
    // By English name; the edition being read stands for its language.
    assert_eq!(summary(&languages), [("E", W_E, true), ("S", W_S, true)]);
    assert_eq!(languages[1].language.name, "Spanish");
    assert_eq!(languages[1].language.vernacular, "español");
    // From the Spanish issue, the same two.
    assert_eq!(
        summary(
            &core
                .reader()
                .document_languages(W_S, WIN_THE_BATTLE_DOC)
                .unwrap()
        ),
        [("E", W_E, true), ("S", W_S, true)]
    );

    // Alone, the edition has only its own language.
    let alone = self::core("alone", &[(W_E, W_E_FILE)], None);
    assert_eq!(
        summary(
            &alone
                .reader()
                .document_languages(W_E, WIN_THE_BATTLE_DOC)
                .unwrap()
        ),
        [("E", W_E, true)]
    );
}

#[test]
fn catalog_editions_to_download() {
    let core = core(
        "trimmed",
        &[(W_E, W_E_FILE)],
        Some(trimmed_catalog::trimmed()),
    );
    let languages = core
        .reader()
        .document_languages(W_E, WIN_THE_BATTLE_DOC)
        .unwrap();
    assert_eq!(summary(&languages), [("E", W_E, true), ("S", W_S, false)]);
    let spanish = &languages[1].publication;
    assert_eq!(spanish.title, W_S_TITLE);
    assert_eq!(spanish.kind, PubKind::Watchtower);
    assert_eq!(spanish.meps_language, 1);
    // An installed summary carries the catalog's issue title.
    assert_eq!(
        languages[0].publication.issue_title.as_deref(),
        Some("The Watchtower, August 2026")
    );

    // Once the Spanish issue is installed, it is listed as installed.
    core.library()
        .side_load(fixture(W_S_FILE), false, &|_, _| {}, &CancelToken::new())
        .unwrap();
    assert_eq!(
        summary(
            &core
                .reader()
                .document_languages(W_E, WIN_THE_BATTLE_DOC)
                .unwrap()
        ),
        [("E", W_E, true), ("S", W_S, true)]
    );
}

#[test]
fn errors() {
    let core = core("errors", &[(W_E, W_E_FILE)], None);
    let reader = core.reader();
    assert!(matches!(
        reader.document_languages(W_E, 999),
        Err(CoreError::NotFound)
    ));
    assert!(matches!(
        reader.document_languages(W_S, WIN_THE_BATTLE_DOC),
        Err(CoreError::NotFound)
    ));
    assert!(matches!(
        reader.document_languages("not a key", WIN_THE_BATTLE_DOC),
        Err(CoreError::Invalid(_))
    ));
}

#[test]
fn every_language_in_the_full_catalog() {
    let core = core(
        "full",
        &[(W_E, W_E_FILE)],
        Some(fixture(trimmed_catalog::FULL)),
    );
    let start = Instant::now();
    let languages = core
        .reader()
        .document_languages(W_E, WIN_THE_BATTLE_DOC)
        .unwrap();
    eprintln!(
        "document_languages over the full catalog: {} languages in {:?}",
        languages.len(),
        start.elapsed()
    );
    // The study edition is translated into hundreds of languages.
    assert!(languages.len() > 100, "{} languages", languages.len());
    assert!(languages
        .windows(2)
        .all(|w| w[0].language.name <= w[1].language.name));
    let mut ids: Vec<u32> = languages.iter().map(|l| l.language.meps_id).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), languages.len(), "one edition per language");
    assert!(languages
        .iter()
        .all(|l| l.installed == (l.publication.pub_key == W_E)));
    let spanish = languages.iter().find(|l| l.language.code == "S").unwrap();
    assert_eq!(spanish.publication.pub_key, W_S);
    let other: Vec<&str> = languages
        .iter()
        .filter(|l| l.publication.symbol != "w26")
        .map(|l| l.publication.pub_key.as_str())
        .collect();
    eprintln!("editions under another symbol: {other:?}");
}
