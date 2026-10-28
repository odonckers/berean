//! Catalog ingest and queries against the real JW Library catalog. The
//! fixtures are not committed: run `core/scripts/fetch-fixtures.sh` to
//! download them into `core/fixtures/`. One test ingests the full pinned
//! catalog; the rest use a trimmed cut of it (see `common/trimmed_catalog.rs`).

mod common;
#[path = "common/trimmed_catalog.rs"]
mod trimmed_catalog;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use berean_core::catalog::{Catalog, CatalogFilter, CatalogRevision};
use berean_core::jwpub::Publication;
use berean_core::library::{PubKind, PublicationSummary};
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
const REVISION: u64 = 2624030;

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
    languages: Vec<u32>,
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
    catalog.ingest_file(fixture(trimmed_catalog::FULL)).unwrap();
    eprintln!("full catalog ingest: {:?}", start.elapsed());
    env.assert_no_leftovers();

    assert_eq!(catalog.revision().unwrap().unwrap().level, REVISION);
    let languages = catalog.languages().unwrap();
    assert!(languages.contains(&0) && languages.contains(&1));
    assert!(languages.len() > 100, "{} languages", languages.len());

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
    catalog.ingest_file(trimmed()).unwrap();

    assert_eq!(catalog.languages().unwrap(), [0, 1]);
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

    // Kinds without a variant of their own (e.g. Meeting Workbook) are Other.
    let other = catalog
        .publications(&filter(Some(0), Some(PubKind::Other)))
        .unwrap();
    assert!(find(&other, "mwb26:0:20260100").is_some());
    assert!(other.iter().all(|s| s.kind == PubKind::Other));
    assert!(find(&other, LL_E).is_none());

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

#[test]
fn assets_match_the_jwpub_files() {
    let env = Env::new();
    let core = env.core();
    let catalog = core.catalog();
    let library = core.library();
    catalog.ingest_file(trimmed()).unwrap();
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

        // And installing it lists the same summary the catalog does.
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

    catalog.ingest_file(trimmed()).unwrap();
    let first = snapshot(&catalog);
    catalog.ingest_file(trimmed()).unwrap();
    assert_eq!(snapshot(&catalog), first);

    // The gzipped form ingests to the same catalog.
    let gz = env.scratch("trimmed.db.gz");
    gzip(&trimmed(), &gz);
    catalog.ingest_file(&gz).unwrap();
    assert_eq!(snapshot(&catalog), first);

    let edited = env.edited_trimmed(
        "edited.db",
        "DELETE FROM PublicationAsset WHERE MepsLanguageId = 1;
         DELETE FROM Publication WHERE MepsLanguageId = 1;
         UPDATE Publication SET Title = 'Edited' WHERE Symbol = 'll' AND MepsLanguageId = 0;
         UPDATE Revision SET Level = Level + 1;",
    );
    catalog.ingest_file(&edited).unwrap();
    assert_eq!(catalog.revision().unwrap().unwrap().level, REVISION + 1);
    assert_eq!(catalog.languages().unwrap(), [0]);
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
    catalog.ingest_file(trimmed()).unwrap();
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
        let err = catalog.ingest_file(path).unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{path:?}: {err:?}");
        assert_eq!(snapshot(&catalog), before, "{path:?}");
        env.assert_no_leftovers();
    }

    // A missing file is an I/O error, not a bad catalog.
    let err = catalog.ingest_file(env.scratch("missing.db")).unwrap_err();
    assert!(matches!(err, CoreError::Io(_)), "{err:?}");
    assert_eq!(snapshot(&catalog), before);
    env.assert_no_leftovers();
}

#[test]
fn catalog_persists_across_reopen() {
    let env = Env::new();
    let core = env.core();
    core.catalog().ingest_file(trimmed()).unwrap();
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
    catalog.ingest_file(&older).unwrap();
    assert_eq!(catalog.asset(W_E).unwrap().size, original_size);
    assert_eq!(english_w_e(&catalog), W_E_TITLE);
    assert!(by_key_symbol(&catalog, "wx").is_empty());

    // Newer duplicate: it wins, and the original no longer lists.
    let newer = env.edited_trimmed(
        "newer.db",
        &duplicate_w_e("wx", "Newer", 2, "'2099-01-01T00:00:00+00:00'"),
    );
    catalog.ingest_file(&newer).unwrap();
    let asset = catalog.asset(W_E).unwrap();
    assert_eq!(asset.size, 2);
    assert_eq!(asset.last_modified, "2099-01-01T00:00:00+00:00");
    assert_eq!(english_w_e(&catalog), "Newer");
    assert_eq!(keys(&by_key_symbol(&catalog, "wx")), [W_E]);
    assert!(find(&by_key_symbol(&catalog, "w"), W_E).is_none());

    // Same LastModified: the lower Id (the original) wins.
    let tie = env.edited_trimmed("tie.db", &duplicate_w_e("wx", "Tie", 3, "NULL"));
    catalog.ingest_file(&tie).unwrap();
    assert_eq!(catalog.asset(W_E).unwrap().size, original_size);
    assert_eq!(english_w_e(&catalog), W_E_TITLE);
    assert!(by_key_symbol(&catalog, "wx").is_empty());
}

#[test]
fn plan_download_is_still_not_available() {
    let env = Env::new();
    let core = env.core();
    core.catalog().ingest_file(trimmed()).unwrap();
    assert!(core.catalog().asset(W_E).is_ok());
    assert!(matches!(
        core.library().plan_download(W_E),
        Err(CoreError::NotFound)
    ));
}
