//! Helpers shared by the integration tests.

use std::io::Read;
use std::path::PathBuf;

use berean_core::reader::{LocationSpan, Resolved};
use berean_core::CoreError;
use rusqlite::Connection;

/// The path of a real JWPUB fixture. The fixtures are not committed: run
/// `core/scripts/fetch-fixtures.sh` to download them into `core/fixtures/`.
pub fn fixture(name: &str) -> PathBuf {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures")
        .join(name);
    assert!(
        path.is_file(),
        "fixture missing: run core/scripts/fetch-fixtures.sh ({})",
        path.display()
    );
    path
}

/// Extract the fixture's database independently of `jwpub`, for cross-checks.
#[allow(dead_code)] // Not every test crate that includes `common` uses it.
pub fn raw_db(name: &str) -> (tempfile::TempDir, Connection) {
    let mut outer = zip::ZipArchive::new(std::fs::File::open(fixture(name)).unwrap()).unwrap();
    let mut contents = Vec::new();
    outer
        .by_name("contents")
        .unwrap()
        .read_to_end(&mut contents)
        .unwrap();
    let mut inner = zip::ZipArchive::new(std::io::Cursor::new(contents)).unwrap();
    let db_name = name.replace(".jwpub", ".db");
    let mut db = Vec::new();
    inner
        .by_name(&db_name)
        .unwrap()
        .read_to_end(&mut db)
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db_name);
    std::fs::write(&path, db).unwrap();
    let conn = Connection::open(&path).unwrap();
    (dir, conn)
}

/// The span a `Reader::resolve` result names; panics on an error or an
/// external link.
#[allow(dead_code)] // Not every test crate that includes `common` uses it.
#[track_caller]
pub fn span_of(resolved: Result<Resolved, CoreError>) -> LocationSpan {
    match resolved {
        Ok(Resolved::Span { span }) => span,
        other => panic!("expected a span, got {other:?}"),
    }
}
