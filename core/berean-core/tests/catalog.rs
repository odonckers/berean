//! Catalog ingest and queries against the real JW Library catalog. The
//! fixtures are not committed: run `core/scripts/fetch-fixtures.sh` to
//! download them into `core/fixtures/`. One test ingests the full pinned
//! catalog; the rest use a trimmed cut of it (see `common/trimmed_catalog.rs`).

mod common;
#[path = "common/trimmed_catalog.rs"]
mod trimmed_catalog;

use std::cell::{Cell, RefCell};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use berean_core::catalog::{Catalog, CatalogFilter, CatalogRevision, CatalogUpdate};
use berean_core::jwpub::Publication;
use berean_core::languages::{self, Language};
use berean_core::library::{DownloadPlan, Library, PubKind, PublicationSummary};
use berean_core::{CancelToken, Core, CoreError};
use common::fixture;
use rusqlite::Connection;
use sha1::{Digest, Sha1};
use trimmed_catalog::trimmed;

const W_E: &str = "w26:0:20260800";
const W_S: &str = "w26:1:20260800";
const LL_E: &str = "ll:0:0";
const W_E_TITLE: &str = "The Watchtower Announcing Jehovah’s Kingdom (Study)—2026";
const W_S_TITLE: &str = "La Atalaya. Anunciando el Reino de Jehová (estudio) 2026";
const LL_E_TITLE: &str = "Listen to God and Live Forever";
const W_E_ISSUE_TITLE: &str = "The Watchtower, August 2026";
const REVISION: u64 = 2624030;
const MWB_E: &str = "mwb26:0:20260900";
const PUB_MEDIA: &str = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS";
/// The steps `ingest_file` counts for copying the file.
const COPY_STEPS: u64 = 100;

struct Env {
    dir: tempfile::TempDir,
    data: PathBuf,
    cache: PathBuf,
}

impl Env {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Env {
            data: dir.path().join("data"),
            cache: dir.path().join("cache"),
            dir,
        }
    }

    fn core(&self) -> Core {
        Core::open(&self.data, &self.cache).unwrap_or_else(|e| panic!("open core: {e:?}"))
    }

    /// A scratch path outside the data dir.
    fn scratch(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    /// A copy of the trimmed catalog, changed by `sql`.
    fn edited_trimmed(&self, name: &str, sql: &str) -> PathBuf {
        let path = self.scratch(name);
        std::fs::copy(trimmed(), &path).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute_batch(sql).unwrap();
        path
    }

    /// The catalog's staging directory exists and is empty.
    fn assert_no_leftovers(&self) {
        let staging = self.data.join("catalog/.staging");
        let left: Vec<_> = std::fs::read_dir(&staging)
            .unwrap_or_else(|e| panic!("read {}: {e}", staging.display()))
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(left.is_empty(), "left in staging: {left:?}");
    }
}

fn ingest(catalog: &Catalog, path: impl AsRef<Path>) -> Result<(), CoreError> {
    catalog.ingest_file(path, &|_, _| {}, &CancelToken::new())
}

/// The distinct MEPS language ids of the ingested catalog, read straight
/// from the stored file.
fn catalog_language_ids(env: &Env) -> Vec<u32> {
    let conn = Connection::open(env.data.join("catalog/catalog.db")).unwrap();
    let mut stmt = conn
        .prepare("SELECT DISTINCT MepsLanguageId FROM Publication ORDER BY 1")
        .unwrap();
    let ids = stmt.query_map([], |r| r.get(0)).unwrap();
    ids.collect::<Result<_, _>>().unwrap()
}

/// `catalog.languages()` is exactly the catalog's ids the language table
/// maps, each round-tripping id -> code -> id. Returns how many ids it maps.
fn assert_languages_round_trip(env: &Env, catalog: &Catalog) -> usize {
    let ids = catalog_language_ids(env);
    let listed = catalog.languages().unwrap();
    let expected: Vec<Language> = ids
        .iter()
        .filter_map(|&id| languages::by_meps_id(id).cloned())
        .collect();
    assert_eq!(listed, expected);
    for language in &listed {
        assert_eq!(
            languages::by_code(&language.code).unwrap().meps_id,
            language.meps_id
        );
    }
    listed.len()
}

fn filter(meps_language: Option<u32>, kind: Option<PubKind>) -> CatalogFilter {
    CatalogFilter {
        meps_language,
        kind,
        ..Default::default()
    }
}

fn find<'a>(list: &'a [PublicationSummary], key: &str) -> Option<&'a PublicationSummary> {
    list.iter().find(|s| s.pub_key == key)
}

fn keys(list: &[PublicationSummary]) -> Vec<&str> {
    list.iter().map(|s| s.pub_key.as_str()).collect()
}

fn sha1_hex(path: &Path) -> String {
    hex(&Sha1::digest(std::fs::read(path).unwrap()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn gzip(path: &Path, out: &Path) {
    let mut gz = flate2::write::GzEncoder::new(
        std::fs::File::create(out).unwrap(),
        flate2::Compression::fast(),
    );
    gz.write_all(&std::fs::read(path).unwrap()).unwrap();
    gz.finish().unwrap();
}

/// Everything the catalog answers, for comparing two states.
#[derive(Debug, PartialEq)]
struct Snapshot {
    revision: Option<CatalogRevision>,
    languages: Vec<Language>,
    english: Vec<PublicationSummary>,
    spanish: Vec<PublicationSummary>,
    w_e_size: Option<u64>,
}

fn snapshot(catalog: &Catalog) -> Snapshot {
    Snapshot {
        revision: catalog.revision().unwrap(),
        languages: catalog.languages().unwrap(),
        english: catalog.publications(&filter(Some(0), None)).unwrap(),
        spanish: catalog.publications(&filter(Some(1), None)).unwrap(),
        w_e_size: catalog.asset(W_E).ok().map(|a| a.size),
    }
}

#[test]
fn full_catalog_end_to_end() {
    let env = Env::new();
    let catalog = env.core().catalog();

    let start = Instant::now();
    ingest(&catalog, fixture(trimmed_catalog::FULL)).unwrap();
    eprintln!("full catalog ingest: {:?}", start.elapsed());
    env.assert_no_leftovers();

    assert_eq!(catalog.revision().unwrap().unwrap().level, REVISION);
    // The language table maps nearly every catalog language.
    assert_eq!(catalog_language_ids(&env).len(), 983);
    let mapped = assert_languages_round_trip(&env, &catalog);
    assert!(mapped >= 940, "{mapped} languages mapped");

    let watchtowers = catalog
        .publications(&CatalogFilter {
            meps_language: Some(0),
            kind: Some(PubKind::Watchtower),
            key_symbol: Some("w".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(find(&watchtowers, W_E).unwrap().title, W_E_TITLE);
    assert!(watchtowers
        .iter()
        .all(|s| s.meps_language == 0 && s.kind == PubKind::Watchtower));

    // A real duplicate key: Finnish (67) Kingdom Ministry, January 2010, is
    // catalogued twice, as KeySymbol `km10` (Id 107265, modified 2017) and as
    // `km` (Id 485719, modified 2025). The later one wins.
    let km = "km:67:20100100";
    let asset = catalog.asset(km).unwrap();
    assert_eq!(asset.last_modified, "2025-09-15T05:53:20+00:00");
    assert_eq!(asset.size, 168265);
    assert_eq!(asset.sha1, "25439c1cac6355f8bc0994077abdfe8eb32b06a4");
    let finnish = catalog.publications(&filter(Some(67), None)).unwrap();
    assert_eq!(finnish.iter().filter(|s| s.pub_key == km).count(), 1);
    let losing = CatalogFilter {
        meps_language: Some(67),
        key_symbol: Some("km10".into()),
        ..Default::default()
    };
    assert!(find(&catalog.publications(&losing).unwrap(), km).is_none());
}

#[test]
fn trimmed_catalog_queries() {
    let env = Env::new();
    let catalog = env.core().catalog();
    ingest(&catalog, trimmed()).unwrap();

    let english = Language {
        meps_id: 0,
        code: "E".into(),
        name: "English".into(),
    };
    let spanish_language = Language {
        meps_id: 1,
        code: "S".into(),
        name: "Spanish".into(),
    };
    assert_eq!(catalog.languages().unwrap(), [english, spanish_language]);
    assert_eq!(assert_languages_round_trip(&env, &catalog), 2);
    assert_eq!(
        catalog.revision().unwrap(),
        Some(CatalogRevision {
            level: REVISION,
            created: "2026-10-28T01:05:28+00:00".into(),
        })
    );

    let spanish = catalog
        .publications(&filter(Some(1), Some(PubKind::Watchtower)))
        .unwrap();
    assert_eq!(
        find(&spanish, W_S),
        Some(&PublicationSummary {
            pub_key: W_S.into(),
            symbol: "w26".into(),
            meps_language: 1,
            issue_tag: 20260800,
            year: 2026,
            title: W_S_TITLE.into(),
            issue_title: Some("La Atalaya, agosto de 2026".into()),
            kind: PubKind::Watchtower,
        })
    );
    assert!(spanish
        .iter()
        .all(|s| s.meps_language == 1 && s.kind == PubKind::Watchtower));

    let brochures = catalog
        .publications(&filter(Some(0), Some(PubKind::Brochure)))
        .unwrap();
    assert_eq!(find(&brochures, LL_E).unwrap().title, LL_E_TITLE);
    assert!(find(&brochures, W_E).is_none());

    // Meeting Workbooks (PublicationTypeId 30) have a kind of their own.
    let workbooks = catalog
        .publications(&filter(Some(0), Some(PubKind::MeetingWorkbook)))
        .unwrap();
    assert_eq!(
        find(&workbooks, MWB_E),
        Some(&PublicationSummary {
            pub_key: MWB_E.into(),
            symbol: "mwb26".into(),
            meps_language: 0,
            issue_tag: 20260900,
            year: 2026,
            title: "Our Christian Life and Ministry—Meeting Workbook—2026".into(),
            issue_title: Some("Life and Ministry Meeting Workbook, September-October 2026".into()),
            kind: PubKind::MeetingWorkbook,
        })
    );
    assert!(workbooks.iter().all(|s| s.kind == PubKind::MeetingWorkbook));

    // Kinds without a variant of their own (e.g. Kingdom Ministry) are Other.
    let other = catalog
        .publications(&filter(Some(0), Some(PubKind::Other)))
        .unwrap();
    assert!(find(&other, "km:0:20151200").is_some());
    assert!(other.iter().all(|s| s.kind == PubKind::Other));
    assert!(find(&other, LL_E).is_none());
    assert!(find(&other, MWB_E).is_none());

    // Newest first: year, then issue, descending.
    let all = catalog.publications(&CatalogFilter::default()).unwrap();
    assert!(all
        .windows(2)
        .all(|w| (w[0].year, w[0].issue_tag) >= (w[1].year, w[1].issue_tag)));
    let mut unique = keys(&all);
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), all.len());

    // Title text, ignoring case — Unicode case too.
    for text in ["listen to god", "LISTEN TO GOD"] {
        let found = catalog
            .publications(&CatalogFilter {
                meps_language: Some(0),
                text: Some(text.into()),
                ..Default::default()
            })
            .unwrap();
        assert!(find(&found, LL_E).is_some(), "{text}");
        assert!(found
            .iter()
            .all(|s| s.title.to_lowercase().contains("listen to god")));
    }
    let found = catalog
        .publications(&CatalogFilter {
            text: Some("REINO DE JEHOVÁ (ESTUDIO)".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(find(&found, W_S).is_some());
    assert!(find(&found, W_E).is_none());

    // The limit keeps the first results of the same order.
    let study = CatalogFilter {
        meps_language: Some(0),
        kind: Some(PubKind::Watchtower),
        key_symbol: Some("w".into()),
        ..Default::default()
    };
    let unlimited = catalog.publications(&study).unwrap();
    assert!(unlimited.len() > 3);
    let limited = catalog
        .publications(&CatalogFilter {
            limit: Some(3),
            ..study.clone()
        })
        .unwrap();
    assert_eq!(limited, unlimited[..3]);
    let none = catalog
        .publications(&CatalogFilter {
            limit: Some(0),
            ..study
        })
        .unwrap();
    assert!(none.is_empty());
}

const MWB27_JAN: &str = "mwb27:0:20270100";
const MWB27_MAR: &str = "mwb27:0:20270300";

#[test]
fn issue_titles() {
    let env = Env::new();
    let catalog = env.core().catalog();
    ingest(&catalog, trimmed()).unwrap();
    let english = catalog.publications(&filter(Some(0), None)).unwrap();

    // Dated issues share a title; the issue title tells them apart.
    let jan = find(&english, MWB27_JAN).unwrap();
    let mar = find(&english, MWB27_MAR).unwrap();
    assert_eq!(
        jan.issue_title.as_deref(),
        Some("Life and Ministry Meeting Workbook, January-February 2027")
    );
    assert_eq!(
        mar.issue_title.as_deref(),
        Some("Life and Ministry Meeting Workbook, March-April 2027")
    );
    assert_eq!(jan.title, mar.title);

    // Undated publications have none.
    assert_eq!(find(&english, LL_E).unwrap().issue_title, None);
    assert!(english
        .iter()
        .filter(|s| s.issue_tag == 0)
        .all(|s| s.issue_title.is_none()));
}

#[test]
fn empty_issue_title_is_none() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let edited = env.edited_trimmed(
        "empty-issue-title.db",
        "UPDATE Publication SET IssueTitle = '' \
         WHERE Symbol = 'mwb27' AND MepsLanguageId = 0 AND IssueTagNumber = 20270100;",
    );
    ingest(&catalog, edited).unwrap();
    let english = catalog.publications(&filter(Some(0), None)).unwrap();
    assert_eq!(find(&english, MWB27_JAN).unwrap().issue_title, None);
    assert!(find(&english, MWB27_MAR).unwrap().issue_title.is_some());
}

fn install_fixture(library: &Library, file: &str, key: &str) {
    library
        .install(key, fixture(file), &|_, _| {}, &CancelToken::new())
        .unwrap();
}

#[test]
fn installed_issue_title_comes_from_the_catalog() {
    let env = Env::new();
    let core = env.core();
    let library = core.library();
    install_fixture(&library, "w_E_202608.jwpub", W_E);
    install_fixture(&library, "ll_E.jwpub", LL_E);

    // No catalog: no issue titles.
    let installed = library.installed().unwrap();
    assert_eq!(find(&installed, W_E).unwrap().issue_title, None);
    assert_eq!(find(&installed, LL_E).unwrap().issue_title, None);

    // With one, a dated issue gets the catalog's; an undated one has none.
    ingest(&core.catalog(), trimmed()).unwrap();
    let installed = library.installed().unwrap();
    assert_eq!(
        find(&installed, W_E).unwrap().issue_title.as_deref(),
        Some(W_E_ISSUE_TITLE)
    );
    assert_eq!(find(&installed, LL_E).unwrap().issue_title, None);
}

#[test]
fn installed_survives_an_unreadable_catalog() {
    let env = Env::new();
    let core = env.core();
    let catalog = core.catalog();
    let library = core.library();
    install_fixture(&library, "w_E_202608.jwpub", W_E);
    install_fixture(&library, "ll_E.jwpub", LL_E);
    ingest(&catalog, trimmed()).unwrap();
    let installed = library.installed().unwrap();
    assert!(find(&installed, W_E).unwrap().issue_title.is_some());

    // Damage the stored catalog: it is no longer a SQLite database.
    std::fs::write(env.data.join("catalog/catalog.db"), b"not a database").unwrap();

    // The installed list is whole, just without issue titles...
    let installed = library.installed().unwrap();
    let keys: Vec<&str> = installed.iter().map(|s| s.pub_key.as_str()).collect();
    assert_eq!(keys, [LL_E, W_E]);
    assert!(installed.iter().all(|s| s.issue_title.is_none()));

    // ...while the catalog's own calls still report the damage.
    assert!(catalog.publications(&CatalogFilter::default()).is_err());
}

#[test]
fn assets_match_the_jwpub_files() {
    let env = Env::new();
    let core = env.core();
    let catalog = core.catalog();
    let library = core.library();
    ingest(&catalog, trimmed()).unwrap();
    let listed = catalog.publications(&CatalogFilter::default()).unwrap();

    for (file, key) in [
        ("w_E_202608.jwpub", W_E),
        ("w_S_202608.jwpub", W_S),
        ("ll_E.jwpub", LL_E),
    ] {
        let path = fixture(file);
        // The key the .jwpub gives itself is the catalog's key.
        assert_eq!(Publication::open(&path).unwrap().meta().pub_key(), key);

        let asset = catalog.asset(key).unwrap();
        assert_eq!(asset.size, std::fs::metadata(&path).unwrap().len(), "{key}");
        assert_eq!(asset.sha1, sha1_hex(&path), "{key}");

        // And installing it lists the same summary the catalog does, issue
        // title included (taken from the catalog, as a .jwpub has none).
        library
            .install(key, &path, &|_, _| {}, &CancelToken::new())
            .unwrap();
        let installed = library.installed().unwrap();
        assert_eq!(find(&installed, key), find(&listed, key), "{key}");
    }

    let w_e = catalog.asset(W_E).unwrap();
    assert_eq!(w_e.size, 3541859);
    assert_eq!(w_e.sha1, "c9f3832f42a88c7e9460d6c38b5f62e4ef1f68f0");
    assert_eq!(w_e.schema_version, 9);
    assert_eq!(w_e.min_platform_version, 1);
    assert_eq!(w_e.last_modified, "2026-04-29T04:32:02+00:00");

    assert!(matches!(
        catalog.asset("w26:2:20260800"),
        Err(CoreError::NotFound)
    ));
    assert!(matches!(catalog.asset("w26"), Err(CoreError::Invalid(_))));
}

#[test]
fn no_catalog_yet() {
    let env = Env::new();
    let catalog = env.core().catalog();
    assert_eq!(catalog.revision().unwrap(), None);
    assert!(catalog.languages().unwrap().is_empty());
    assert!(catalog
        .publications(&CatalogFilter::default())
        .unwrap()
        .is_empty());
    assert!(matches!(catalog.asset(W_E), Err(CoreError::NotFound)));
    env.assert_no_leftovers();
}

#[test]
fn reingest_is_idempotent_and_replaces() {
    let env = Env::new();
    let catalog = env.core().catalog();

    ingest(&catalog, trimmed()).unwrap();
    let first = snapshot(&catalog);
    ingest(&catalog, trimmed()).unwrap();
    assert_eq!(snapshot(&catalog), first);

    // The gzipped form ingests to the same catalog.
    let gz = env.scratch("trimmed.db.gz");
    gzip(&trimmed(), &gz);
    ingest(&catalog, &gz).unwrap();
    assert_eq!(snapshot(&catalog), first);

    let edited = env.edited_trimmed(
        "edited.db",
        "DELETE FROM PublicationAsset WHERE MepsLanguageId = 1;
         DELETE FROM Publication WHERE MepsLanguageId = 1;
         UPDATE Publication SET Title = 'Edited' WHERE Symbol = 'll' AND MepsLanguageId = 0;
         UPDATE Revision SET Level = Level + 1;",
    );
    ingest(&catalog, &edited).unwrap();
    assert_eq!(catalog.revision().unwrap().unwrap().level, REVISION + 1);
    // English only.
    assert_eq!(catalog.languages().unwrap(), first.languages[..1]);
    assert!(catalog
        .publications(&filter(Some(1), None))
        .unwrap()
        .is_empty());
    assert!(matches!(catalog.asset(W_S), Err(CoreError::NotFound)));
    let english = catalog.publications(&filter(Some(0), None)).unwrap();
    assert_eq!(find(&english, LL_E).unwrap().title, "Edited");
    assert_eq!(english.len(), first.english.len());
    env.assert_no_leftovers();
}

#[test]
fn bad_catalog_is_corrupt_and_keeps_the_old_one() {
    let env = Env::new();
    let catalog = env.core().catalog();
    ingest(&catalog, trimmed()).unwrap();
    let before = snapshot(&catalog);

    // Deterministic noise.
    let mut x: u32 = 0x2545_f491;
    let noise: Vec<u8> = (0..65536)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            x as u8
        })
        .collect();
    let random = env.scratch("random.bin");
    std::fs::write(&random, &noise).unwrap();

    let gz = env.scratch("trimmed.db.gz");
    gzip(&trimmed(), &gz);
    let bytes = std::fs::read(&gz).unwrap();
    let truncated_gz = env.scratch("truncated.db.gz");
    std::fs::write(&truncated_gz, &bytes[..bytes.len() / 2]).unwrap();

    let gz_noise = env.scratch("noise.db.gz");
    gzip(&random, &gz_noise);

    let empty = env.scratch("empty.db");
    std::fs::write(&empty, b"").unwrap();

    let no_publication = env.edited_trimmed("no_publication.db", "DROP TABLE Publication;");
    let no_column = env.edited_trimmed(
        "no_column.db",
        "ALTER TABLE PublicationAsset DROP COLUMN Signature;",
    );
    let no_revision = env.edited_trimmed("no_revision.db", "DELETE FROM Revision;");

    // A database whose pages are damaged past its header.
    let damaged = env.scratch("damaged.db");
    let mut db = std::fs::read(trimmed()).unwrap();
    let mid = db.len() / 2 / 4096 * 4096;
    db[mid..mid + 4096].fill(0xa5);
    std::fs::write(&damaged, &db).unwrap();

    for path in [
        &random,
        &truncated_gz,
        &gz_noise,
        &empty,
        &no_publication,
        &no_column,
        &no_revision,
        &damaged,
    ] {
        let err = ingest(&catalog, path).unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{path:?}: {err:?}");
        assert_eq!(snapshot(&catalog), before, "{path:?}");
        env.assert_no_leftovers();
    }

    // A missing file is an I/O error, not a bad catalog.
    let err = ingest(&catalog, env.scratch("missing.db")).unwrap_err();
    assert!(matches!(err, CoreError::Io(_)), "{err:?}");
    assert_eq!(snapshot(&catalog), before);
    env.assert_no_leftovers();
}

#[test]
fn catalog_persists_across_reopen() {
    let env = Env::new();
    let core = env.core();
    ingest(&core.catalog(), trimmed()).unwrap();
    let before = snapshot(&core.catalog());
    drop(core);

    // A crash mid-ingest leaves a staged copy; reopening clears it.
    let staged = env.data.join("catalog/.staging/.tmpcrash");
    std::fs::create_dir_all(&staged).unwrap();
    std::fs::copy(trimmed(), staged.join("catalog.db")).unwrap();

    let core = env.core();
    env.assert_no_leftovers();
    assert_eq!(snapshot(&core.catalog()), before);
    assert!(find(&before.english, W_E).is_some());
}

/// Copies `w26:0:20260800`'s rows as a second catalog row with the same key
/// but `KeySymbol` `key_symbol`, `Title` `title`, size `size` and
/// `LastModified` `modified` (`NULL` = the original's).
fn duplicate_w_e(key_symbol: &str, title: &str, size: u64, modified: &str) -> String {
    format!(
        "INSERT INTO Publication (PublicationRootKeyId, MepsLanguageId, PublicationTypeId,
             IssueTagNumber, Title, IssueTitle, ShortTitle, CoverTitle, UndatedTitle,
             UndatedReferenceTitle, Year, Symbol, KeySymbol, Reserved, Id)
         SELECT PublicationRootKeyId, MepsLanguageId, PublicationTypeId, IssueTagNumber,
             '{title}', IssueTitle, ShortTitle, CoverTitle, UndatedTitle, UndatedReferenceTitle,
             Year, Symbol, '{key_symbol}', Reserved, (SELECT MAX(Id) + 1 FROM Publication)
         FROM Publication WHERE Symbol = 'w26' AND MepsLanguageId = 0
             AND IssueTagNumber = 20260800 AND KeySymbol = 'w';
         INSERT INTO PublicationAsset (PublicationId, MepsLanguageId, Signature, Size,
             ExpandedSize, MimeType, SchemaVersion, MinPlatformVersion, CatalogedOn,
             LastUpdated, LastModified, GenerallyAvailableDate, ConventionReleaseDayNumber, Id)
         SELECT (SELECT MAX(Id) FROM Publication), a.MepsLanguageId, a.Signature, {size},
             a.ExpandedSize, a.MimeType, a.SchemaVersion, a.MinPlatformVersion, a.CatalogedOn,
             a.LastUpdated, COALESCE({modified}, a.LastModified), a.GenerallyAvailableDate,
             a.ConventionReleaseDayNumber, (SELECT MAX(Id) + 1 FROM PublicationAsset)
         FROM PublicationAsset a JOIN Publication p ON p.Id = a.PublicationId
         WHERE p.Symbol = 'w26' AND p.MepsLanguageId = 0 AND p.IssueTagNumber = 20260800
             AND p.KeySymbol = 'w';"
    )
}

/// The trimmed catalog has no duplicate keys (the real ones are in other
/// languages; see `full_catalog_end_to_end`), so these add some. A key
/// resolves to the row with the latest `LastModified`, then the lowest `Id`;
/// listings show only that row, whatever the filter.
#[test]
fn duplicate_key_resolves_to_latest_then_lowest_id() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let original_size = 3541859;
    let by_key_symbol = |catalog: &Catalog, key_symbol: &str| {
        catalog
            .publications(&CatalogFilter {
                meps_language: Some(0),
                key_symbol: Some(key_symbol.into()),
                ..Default::default()
            })
            .unwrap()
    };
    let english_w_e = |catalog: &Catalog| {
        let english = catalog.publications(&filter(Some(0), None)).unwrap();
        let rows: Vec<String> = english
            .iter()
            .filter(|s| s.pub_key == W_E)
            .map(|s| s.title.clone())
            .collect();
        assert_eq!(rows.len(), 1, "{rows:?}");
        rows.into_iter().next().unwrap()
    };

    // Older duplicate: the original wins.
    let older = env.edited_trimmed(
        "older.db",
        &duplicate_w_e("wx", "Older", 1, "'2000-01-01T00:00:00+00:00'"),
    );
    ingest(&catalog, &older).unwrap();
    assert_eq!(catalog.asset(W_E).unwrap().size, original_size);
    assert_eq!(english_w_e(&catalog), W_E_TITLE);
    assert!(by_key_symbol(&catalog, "wx").is_empty());

    // Newer duplicate: it wins, and the original no longer lists.
    let newer = env.edited_trimmed(
        "newer.db",
        &duplicate_w_e("wx", "Newer", 2, "'2099-01-01T00:00:00+00:00'"),
    );
    ingest(&catalog, &newer).unwrap();
    let asset = catalog.asset(W_E).unwrap();
    assert_eq!(asset.size, 2);
    assert_eq!(asset.last_modified, "2099-01-01T00:00:00+00:00");
    assert_eq!(english_w_e(&catalog), "Newer");
    assert_eq!(keys(&by_key_symbol(&catalog, "wx")), [W_E]);
    assert!(find(&by_key_symbol(&catalog, "w"), W_E).is_none());

    // Same LastModified: the lower Id (the original) wins.
    let tie = env.edited_trimmed("tie.db", &duplicate_w_e("wx", "Tie", 3, "NULL"));
    ingest(&catalog, &tie).unwrap();
    assert_eq!(catalog.asset(W_E).unwrap().size, original_size);
    assert_eq!(english_w_e(&catalog), W_E_TITLE);
    assert!(by_key_symbol(&catalog, "wx").is_empty());
}

#[test]
fn ingest_cancelled_keeps_the_old_catalog() {
    let env = Env::new();
    let catalog = env.core().catalog();
    ingest(&catalog, trimmed()).unwrap();
    let before = snapshot(&catalog);
    let edited = env.edited_trimmed("edited.db", "UPDATE Revision SET Level = Level + 1;");

    // Cancelled before it starts.
    let cancel = CancelToken::new();
    cancel.cancel();
    let err = catalog
        .ingest_file(&edited, &|_, _| {}, &cancel)
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    assert_eq!(snapshot(&catalog), before);
    env.assert_no_leftovers();

    // Cancelled at the first report of the copy, at its end, and after
    // validating and indexing (just before the swap).
    for step in [1, COPY_STEPS, COPY_STEPS + 1, COPY_STEPS + 2] {
        let cancel = CancelToken::new();
        let fired = Cell::new(false);
        let on_progress = |done: u64, _total: u64| {
            if done >= step && !fired.get() {
                fired.set(true);
                cancel.cancel();
            }
        };
        let err = catalog
            .ingest_file(&edited, &on_progress, &cancel)
            .unwrap_err();
        assert!(fired.get(), "step {step}: never reported");
        assert!(matches!(err, CoreError::Cancelled), "step {step}: {err:?}");
        assert_eq!(snapshot(&catalog), before, "step {step}");
        env.assert_no_leftovers();
    }

    // Not cancelled: it replaces the catalog.
    ingest(&catalog, &edited).unwrap();
    assert_eq!(catalog.revision().unwrap().unwrap().level, REVISION + 1);
}

#[test]
fn ingest_progress_reaches_completion() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let calls = RefCell::new(Vec::new());
    let record = |done: u64, total: u64| calls.borrow_mut().push((done, total));
    catalog
        .ingest_file(trimmed(), &record, &CancelToken::new())
        .unwrap();

    let calls = calls.into_inner();
    assert!(!calls.is_empty());
    let total = calls[0].1;
    assert!(calls.iter().all(|&(_, t)| t == total), "{calls:?}");
    assert!(calls.windows(2).all(|w| w[0].0 < w[1].0), "{calls:?}");
    assert_eq!(calls.last().unwrap().0, total);
}

/// Ingest `path` over the trimmed catalog, cancelling at the first report
/// that is part way through the copy: it is cancelled and leaves the old
/// catalog and nothing else.
fn assert_cancels_mid_copy(env: &Env, catalog: &Catalog, path: &Path) {
    let before = snapshot(catalog);
    let cancel = CancelToken::new();
    let mid_copy = RefCell::new(Vec::new());
    let on_progress = |done: u64, total: u64| {
        assert_eq!(total, COPY_STEPS + 3);
        if done > 0 && done < COPY_STEPS {
            mid_copy.borrow_mut().push(done);
            cancel.cancel();
        }
    };
    let err = catalog
        .ingest_file(path, &on_progress, &cancel)
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{path:?}: {err:?}");
    // Cancelling stops the copy at the next chunk, so it reports once.
    assert_eq!(mid_copy.borrow().len(), 1, "{path:?}: {mid_copy:?}");
    assert_eq!(snapshot(catalog), before, "{path:?}");
    env.assert_no_leftovers();
}

#[test]
fn ingest_cancels_mid_copy() {
    let env = Env::new();
    let catalog = env.core().catalog();
    ingest(&catalog, trimmed()).unwrap();
    // Gunzipping the full catalog, and copying a plain one.
    assert_cancels_mid_copy(&env, &catalog, &fixture(trimmed_catalog::FULL));
    let edited = env.edited_trimmed("edited.db", "UPDATE Revision SET Level = Level + 1;");
    assert_cancels_mid_copy(&env, &catalog, &edited);
}

#[test]
fn ingest_progress_over_a_gz_is_bounded_and_complete() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let gz = env.scratch("trimmed.db.gz");
    gzip(&trimmed(), &gz);
    let calls = RefCell::new(Vec::new());
    let record = |done: u64, total: u64| calls.borrow_mut().push((done, total));
    catalog
        .ingest_file(&gz, &record, &CancelToken::new())
        .unwrap();

    let calls = calls.into_inner();
    let total = COPY_STEPS + 3;
    assert!(calls.iter().all(|&(_, t)| t == total), "{calls:?}");
    assert!(calls.len() as u64 <= total, "{calls:?}");
    assert!(calls.windows(2).all(|w| w[0].0 < w[1].0), "{calls:?}");
    assert_eq!(calls.last().unwrap().0, total);
    // Progress during the copy, not only after it.
    let copying = calls.iter().filter(|&&(d, _)| d < COPY_STEPS).count();
    assert!(copying > 1, "{calls:?}");
    assert!(calls.len() > 4, "{calls:?}");
}

/// Copies of the trimmed catalog whose W_E asset row is changed by `set`.
fn w_e_asset_set(env: &Env, name: &str, set: &str) -> PathBuf {
    env.edited_trimmed(
        name,
        &format!(
            "UPDATE PublicationAsset SET {set} WHERE PublicationId IN (
                 SELECT Id FROM Publication
                 WHERE Symbol = 'w26' AND MepsLanguageId = 0 AND IssueTagNumber = 20260800);"
        ),
    )
}

/// The publication store's staging and trash directories are empty.
fn assert_no_store_leftovers(env: &Env) {
    for sub in [".staging", ".trash"] {
        let dir = env.data.join("publications").join(sub);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "{dir:?}");
    }
}

#[test]
fn install_checks_the_catalog_size_and_sha1() {
    let w_e = fixture("w_E_202608.jwpub");
    let size = std::fs::metadata(&w_e).unwrap().len();
    let keys = |library: &Library| -> Vec<String> {
        let installed = library.installed().unwrap();
        installed.into_iter().map(|s| s.pub_key).collect()
    };

    // The matching file installs, also against an upper-case SHA-1.
    let env = Env::new();
    let core = env.core();
    let library = core.library();
    let upper = w_e_asset_set(&env, "upper.db", "Signature = upper(Signature)");
    for catalog_file in [trimmed(), upper] {
        ingest(&core.catalog(), &catalog_file).unwrap();
        library
            .install(W_E, &w_e, &|_, _| {}, &CancelToken::new())
            .unwrap();
        assert_eq!(keys(&library), [W_E]);
        assert_no_store_leftovers(&env);
    }

    // A wrong SHA-1 or size is corrupt, and installs nothing.
    let wrong_sha1 = format!("Signature = '{}'", "0".repeat(40));
    let wrong_size = format!("Size = {}", size + 1);
    for (name, set) in [("sha1.db", &wrong_sha1), ("size.db", &wrong_size)] {
        let env = Env::new();
        let core = env.core();
        let library = core.library();
        library
            .install(LL_E, fixture("ll_E.jwpub"), &|_, _| {}, &CancelToken::new())
            .unwrap();
        ingest(&core.catalog(), w_e_asset_set(&env, name, set)).unwrap();
        let err = library
            .install(W_E, &w_e, &|_, _| {}, &CancelToken::new())
            .unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{name}: {err:?}");
        assert_eq!(keys(&library), [LL_E], "{name}");
        let dirs = std::fs::read_dir(env.data.join("publications"))
            .unwrap()
            .filter(|e| {
                !e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with('.')
            })
            .count();
        assert_eq!(dirs, 1, "{name}");
        assert_no_store_leftovers(&env);
    }

    // A key the catalog does not list, or no catalog at all: not checked.
    let env = Env::new();
    let core = env.core();
    core.library()
        .install(W_E, &w_e, &|_, _| {}, &CancelToken::new())
        .unwrap();
    let unlisted = env.edited_trimmed(
        "unlisted.db",
        "DELETE FROM Publication
         WHERE Symbol = 'w26' AND MepsLanguageId = 0 AND IssueTagNumber = 20260800;",
    );
    ingest(&core.catalog(), &unlisted).unwrap();
    assert!(matches!(
        core.catalog().asset(W_E),
        Err(CoreError::NotFound)
    ));
    core.library()
        .install(W_E, &w_e, &|_, _| {}, &CancelToken::new())
        .unwrap();
    assert_eq!(keys(&core.library()), [W_E]);
    assert_no_store_leftovers(&env);
}

/// A recorded pub-media reply (see `core/scripts/fixtures.txt`).
fn reply(name: &str) -> Vec<u8> {
    std::fs::read(fixture(name)).unwrap()
}

#[test]
fn download_requests() {
    let env = Env::new();
    let core = env.core();
    let library = core.library();

    // No catalog yet.
    assert!(matches!(
        library.download_request(W_E),
        Err(CoreError::NotFound)
    ));
    ingest(&core.catalog(), trimmed()).unwrap();

    for (key, query) in [
        (W_E, "pub=w&langwritten=E&issue=202608"),
        (W_S, "pub=w&langwritten=S&issue=202608"),
        (LL_E, "pub=ll&langwritten=E"),
        (MWB_E, "pub=mwb&langwritten=E&issue=202609"),
    ] {
        assert_eq!(
            library.download_request(key).unwrap().url,
            format!("{PUB_MEDIA}?output=json&fileformat=JWPUB&{query}"),
            "{key}"
        );
    }

    assert!(matches!(
        library.download_request("w26:2:20260800"),
        Err(CoreError::NotFound)
    ));
    assert!(matches!(
        library.download_request("w26"),
        Err(CoreError::Invalid(_))
    ));
}

#[test]
fn day_level_issue_sends_the_whole_tag() {
    // The English Watchtower of 15 December 2015 has a day-level issue tag;
    // pub-media lists its `w_E_20151215.jwpub` only for `issue=20151215`.
    let key = "w15:0:20151215";
    let env = Env::new();
    let core = env.core();
    ingest(&core.catalog(), fixture(trimmed_catalog::FULL)).unwrap();
    assert_eq!(core.catalog().asset(key).unwrap().size, 6612985);
    assert_eq!(
        core.library().download_request(key).unwrap().url,
        format!("{PUB_MEDIA}?output=json&fileformat=JWPUB&pub=w&langwritten=E&issue=20151215")
    );
}

#[test]
fn unmapped_language_has_no_download_request() {
    // Move the English watchtower to a MEPS id the table doesn't map.
    let unmapped = (0..u32::MAX)
        .find(|&id| languages::by_meps_id(id).is_none())
        .unwrap();
    let env = Env::new();
    let core = env.core();
    let edited = env.edited_trimmed(
        "unmapped.db",
        &format!(
            "UPDATE Publication SET MepsLanguageId = {unmapped}
             WHERE Symbol = 'w26' AND MepsLanguageId = 0 AND IssueTagNumber = 20260800;"
        ),
    );
    ingest(&core.catalog(), &edited).unwrap();
    let key = format!("w26:{unmapped}:20260800");
    assert!(core.catalog().asset(&key).is_ok());
    assert!(matches!(
        core.library().download_request(&key),
        Err(CoreError::NotFound)
    ));
    assert!(matches!(
        core.library()
            .plan_download(&key, &reply("pubmedia-w_E_202608.json")),
        Err(CoreError::NotFound)
    ));
    // Unmapped languages are not listed.
    assert!(!core
        .catalog()
        .languages()
        .unwrap()
        .iter()
        .any(|l| l.meps_id == unmapped));
}

#[test]
fn download_plans_match_the_jwpub_files() {
    let env = Env::new();
    let core = env.core();
    let library = core.library();
    ingest(&core.catalog(), trimmed()).unwrap();

    for (key, reply_file, jwpub, url) in [
        (
            W_E,
            "pubmedia-w_E_202608.json",
            "w_E_202608.jwpub",
            "https://cfp2.jw-cdn.org/a/d1b56ee/2/o/w_E_202608.jwpub",
        ),
        (
            W_S,
            "pubmedia-w_S_202608.json",
            "w_S_202608.jwpub",
            "https://cfp2.jw-cdn.org/a/1e7c39/4/o/w_S_202608.jwpub",
        ),
        (
            LL_E,
            "pubmedia-ll_E.json",
            "ll_E.jwpub",
            "https://cfp2.jw-cdn.org/a/33502e/2/o/ll_E.jwpub",
        ),
    ] {
        let path = fixture(jwpub);
        let plan = library.plan_download(key, &reply(reply_file)).unwrap();
        assert_eq!(
            plan,
            DownloadPlan {
                url: url.into(),
                size: std::fs::metadata(&path).unwrap().len(),
                checksum: sha1_hex(&path),
            },
            "{key}"
        );
        let asset = core.catalog().asset(key).unwrap();
        assert_eq!((plan.size, plan.checksum), (asset.size, asset.sha1));
    }
}

#[test]
fn bad_download_replies() {
    let env = Env::new();
    let core = env.core();
    let library = core.library();
    ingest(&core.catalog(), trimmed()).unwrap();

    // A reply for another publication in the same language: wrong size.
    let err = library
        .plan_download(W_E, &reply("pubmedia-ll_E.json"))
        .unwrap_err();
    assert!(matches!(err, CoreError::Corrupt), "{err:?}");

    // Not a pub-media reply at all.
    for garbage in [&b"\x00\xffnot json"[..], b"", b"{}", b"{\"files\": 3}"] {
        let err = library.plan_download(W_E, garbage).unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{garbage:?}: {err:?}");
    }

    // A reply that lists only Spanish, for the English issue.
    let err = library
        .plan_download(W_E, &reply("pubmedia-w_S_202608.json"))
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound), "{err:?}");
    let err = library
        .plan_download(W_E, br#"{"files": {"E": {"PDF": []}}}"#)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound), "{err:?}");

    // Unknown or malformed key.
    let w_e = reply("pubmedia-w_E_202608.json");
    assert!(matches!(
        library.plan_download("w26:2:20260800", &w_e),
        Err(CoreError::NotFound)
    ));
    assert!(matches!(
        library.plan_download("w26", &w_e),
        Err(CoreError::Invalid(_))
    ));
}

#[test]
fn several_jwpub_files_pick_the_catalog_size() {
    let env = Env::new();
    let core = env.core();
    let library = core.library();
    ingest(&core.catalog(), trimmed()).unwrap();
    let size = core.catalog().asset(W_E).unwrap().size;

    let file = |url: &str, filesize: u64| {
        format!(r#"{{"file": {{"url": "{url}", "checksum": "x"}}, "filesize": {filesize}}}"#)
    };
    let two = format!(
        r#"{{"files": {{"E": {{"JWPUB": [{}, {}]}}}}}}"#,
        file("https://example.invalid/other.jwpub", size + 1),
        file("https://example.invalid/right.jwpub", size)
    );
    let plan = library.plan_download(W_E, two.as_bytes()).unwrap();
    assert_eq!(plan.url, "https://example.invalid/right.jwpub");
    assert_eq!(plan.size, size);

    let none = format!(
        r#"{{"files": {{"E": {{"JWPUB": [{}, {}]}}}}}}"#,
        file("https://example.invalid/a.jwpub", size + 1),
        file("https://example.invalid/b.jwpub", size - 1)
    );
    let err = library.plan_download(W_E, none.as_bytes()).unwrap_err();
    assert!(matches!(err, CoreError::Corrupt), "{err:?}");
}

const MANIFEST_URL: &str = "https://app.jw-cdn.org/catalogs/publications/v5/manifest.json";
const CURRENT_ID: &str = "84939357-be37-4893-8a5b-f3e87f137b08";
const OTHER_ID: &str = "0b5c2f1e-3d4a-4b6c-8e9f-a0b1c2d3e4f5";

/// A minimal catalog with only the columns the core reads and one
/// publication, built from scratch so the update tests need no fixture.
fn small_catalog(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        "CREATE TABLE Revision (Level INTEGER, Created TEXT);
         CREATE TABLE Publication (Id INTEGER PRIMARY KEY, Symbol TEXT, KeySymbol TEXT,
             MepsLanguageId INTEGER, IssueTagNumber INTEGER, PublicationTypeId INTEGER,
             Year INTEGER, Title TEXT);
         CREATE TABLE PublicationAsset (PublicationId INTEGER, Signature TEXT, Size INTEGER,
             SchemaVersion INTEGER, MinPlatformVersion INTEGER, LastModified TEXT);
         INSERT INTO Revision VALUES (7, '2026-10-28T01:05:28+00:00');
         INSERT INTO Publication VALUES (1, 'll', 'll', 0, 0, 4, 2011,
             'Listen to God and Live Forever');
         INSERT INTO PublicationAsset VALUES (1, 'abc', 123, 8, 1,
             '2026-01-15T12:36:43+00:00');",
    )
    .unwrap();
}

fn manifest(current: &str) -> Vec<u8> {
    format!(r#"{{"version": 1, "current": "{current}"}}"#).into_bytes()
}

fn update_for(id: &str) -> CatalogUpdate {
    CatalogUpdate {
        url: format!("https://app.jw-cdn.org/catalogs/publications/v5/{id}/catalog.db.gz"),
        id: id.into(),
    }
}

fn install(catalog: &Catalog, update: &CatalogUpdate, path: &Path) -> Result<(), CoreError> {
    catalog.install_update(update, path, &|_, _| {}, &CancelToken::new())
}

#[test]
fn manifest_request_is_the_v5_manifest() {
    let env = Env::new();
    assert_eq!(env.core().catalog().manifest_request().url, MANIFEST_URL);
}

#[test]
fn plan_update_before_any_install() {
    let env = Env::new();
    let catalog = env.core().catalog();
    assert_eq!(
        catalog.plan_update(&manifest(CURRENT_ID)).unwrap(),
        Some(update_for(CURRENT_ID))
    );
    // Upper case is normalized.
    assert_eq!(
        catalog
            .plan_update(&manifest(&CURRENT_ID.to_uppercase()))
            .unwrap(),
        Some(update_for(CURRENT_ID))
    );
}

#[test]
fn bad_manifests_are_corrupt() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let wrong_hyphens = "84939357b-e37-4893-8a5b-f3e87f137b08";
    let not_hex = "84939357-be37-4893-8a5b-f3e87f137b0g";
    assert_eq!(wrong_hyphens.len(), 36);
    assert_eq!(not_hex.len(), 36);
    let mut bad: Vec<Vec<u8>> = ["../x", "abc", wrong_hyphens, not_hex, ""]
        .iter()
        .map(|id| manifest(id))
        .collect();
    bad.extend(
        [
            format!(r#"{{"version": 2, "current": "{CURRENT_ID}"}}"#),
            format!(r#"{{"current": "{CURRENT_ID}"}}"#),
            r#"{"version": 1}"#.to_string(),
            format!(r#"{{"version": "1", "current": "{CURRENT_ID}"}}"#),
            "not json".to_string(),
            "{".to_string(),
            String::new(),
        ]
        .map(String::into_bytes),
    );
    for reply in bad {
        let err = catalog.plan_update(&reply).unwrap_err();
        assert!(
            matches!(err, CoreError::Corrupt),
            "{}: {err:?}",
            String::from_utf8_lossy(&reply)
        );
    }
}

#[test]
fn install_update_records_the_id() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let path = env.scratch("small.db");
    small_catalog(&path);
    let update = catalog.plan_update(&manifest(CURRENT_ID)).unwrap().unwrap();

    let calls = RefCell::new(Vec::new());
    let record = |done: u64, total: u64| calls.borrow_mut().push((done, total));
    catalog
        .install_update(&update, &path, &record, &CancelToken::new())
        .unwrap();
    let (done, total) = *calls.borrow().last().unwrap();
    assert_eq!(done, total);

    assert_eq!(catalog.revision().unwrap().unwrap().level, 7);
    assert_eq!(catalog.asset(LL_E).unwrap().size, 123);
    assert_eq!(catalog.plan_update(&manifest(CURRENT_ID)).unwrap(), None);
    assert_eq!(
        catalog
            .plan_update(&manifest(&CURRENT_ID.to_uppercase()))
            .unwrap(),
        None
    );
    assert_eq!(
        catalog.plan_update(&manifest(OTHER_ID)).unwrap(),
        Some(update_for(OTHER_ID))
    );
    env.assert_no_leftovers();

    // The record survives reopening the core.
    let catalog = env.core().catalog();
    assert_eq!(catalog.plan_update(&manifest(CURRENT_ID)).unwrap(), None);

    // An uppercase id in the update is recorded lowercased.
    install(&catalog, &update_for(&OTHER_ID.to_uppercase()), &path).unwrap();
    assert_eq!(catalog.plan_update(&manifest(OTHER_ID)).unwrap(), None);
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());
}

#[test]
fn install_update_cancelled_records_nothing() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let path = env.scratch("small.db");
    small_catalog(&path);
    let cancelled = CancelToken::new();
    cancelled.cancel();

    let err = catalog
        .install_update(&update_for(CURRENT_ID), &path, &|_, _| {}, &cancelled)
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    assert_eq!(catalog.revision().unwrap(), None);
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());
    env.assert_no_leftovers();

    // A previously recorded id stays.
    install(&catalog, &update_for(OTHER_ID), &path).unwrap();
    let err = catalog
        .install_update(&update_for(CURRENT_ID), &path, &|_, _| {}, &cancelled)
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    assert_eq!(catalog.plan_update(&manifest(OTHER_ID)).unwrap(), None);
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());

    // Cancelled just before the swap: still nothing recorded.
    let cancel = CancelToken::new();
    let on_progress = |done: u64, _total: u64| {
        if done >= COPY_STEPS + 2 {
            cancel.cancel();
        }
    };
    let err = catalog
        .install_update(&update_for(CURRENT_ID), &path, &on_progress, &cancel)
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    assert_eq!(catalog.plan_update(&manifest(OTHER_ID)).unwrap(), None);
    env.assert_no_leftovers();
}

#[test]
fn install_update_failure_records_nothing() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let path = env.scratch("small.db");
    small_catalog(&path);
    let not_catalog = env.scratch("not_catalog.db");
    std::fs::write(&not_catalog, b"not a catalog").unwrap();

    let err = install(&catalog, &update_for(CURRENT_ID), &not_catalog).unwrap_err();
    assert!(matches!(err, CoreError::Corrupt), "{err:?}");
    let err = install(&catalog, &update_for(CURRENT_ID), &env.scratch("missing")).unwrap_err();
    assert!(matches!(err, CoreError::Io(_)), "{err:?}");
    assert_eq!(catalog.revision().unwrap(), None);
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());
    env.assert_no_leftovers();

    // A previously recorded id stays.
    install(&catalog, &update_for(OTHER_ID), &path).unwrap();
    let err = install(&catalog, &update_for(CURRENT_ID), &not_catalog).unwrap_err();
    assert!(matches!(err, CoreError::Corrupt), "{err:?}");
    assert_eq!(catalog.plan_update(&manifest(OTHER_ID)).unwrap(), None);
    env.assert_no_leftovers();
}

#[test]
fn install_update_with_a_bad_id_installs_nothing() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let path = env.scratch("small.db");
    small_catalog(&path);
    for id in ["../x", "abc", "84939357b-e37-4893-8a5b-f3e87f137b08", ""] {
        let err = install(&catalog, &update_for(id), &path).unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{id}: {err:?}");
        assert_eq!(catalog.revision().unwrap(), None, "{id}");
    }
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());
    env.assert_no_leftovers();
}

#[test]
fn ingest_file_clears_the_recorded_id() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let path = env.scratch("small.db");
    small_catalog(&path);
    install(&catalog, &update_for(CURRENT_ID), &path).unwrap();
    assert_eq!(catalog.plan_update(&manifest(CURRENT_ID)).unwrap(), None);

    ingest(&catalog, &path).unwrap();
    assert_eq!(
        catalog.plan_update(&manifest(CURRENT_ID)).unwrap(),
        Some(update_for(CURRENT_ID))
    );
    // With nothing recorded, ingesting again is fine too.
    ingest(&catalog, &path).unwrap();
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());
}

#[test]
fn unreadable_recorded_id_counts_as_none() {
    let env = Env::new();
    let catalog = env.core().catalog();
    let path = env.data.join("catalog/manifest-id");
    std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());
    std::fs::write(&path, format!("{CURRENT_ID}\n")).unwrap();
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());

    // A temp id file a crash left in staging is cleared on open.
    std::fs::write(env.data.join("catalog/.staging/.tmpid"), CURRENT_ID).unwrap();
    let catalog = env.core().catalog();
    env.assert_no_leftovers();
    assert!(catalog
        .plan_update(&manifest(CURRENT_ID))
        .unwrap()
        .is_some());
}
