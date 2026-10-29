//! User data (`userData.db`) and `.jwlibrary` backups. There is no real user
//! export to test against: the backups here are synthetic, built in code
//! from the pinned jwlManager blank v16 database (`jwlmanager_blank_v16.zip`,
//! fetched by `core/scripts/fetch-fixtures.sh`).

mod common;

use std::io::Read;
use std::path::{Path, PathBuf};

use berean_core::Core;
use common::fixture;
use rusqlite::types::Value;
use rusqlite::Connection;

struct Env {
    _dir: tempfile::TempDir,
    data: PathBuf,
    cache: PathBuf,
}

impl Env {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Env {
            data: dir.path().join("data"),
            cache: dir.path().join("cache"),
            _dir: dir,
        }
    }

    fn core(&self) -> Core {
        Core::open(&self.data, &self.cache).unwrap_or_else(|e| panic!("open core: {e:?}"))
    }

    fn userdata_db(&self) -> PathBuf {
        self.data.join("userData.db")
    }
}

/// The pinned blank's `userData.db`, extracted into a temp dir.
fn blank_db() -> (tempfile::TempDir, PathBuf) {
    let mut zip =
        zip::ZipArchive::new(std::fs::File::open(fixture("jwlmanager_blank_v16.zip")).unwrap())
            .unwrap();
    let mut bytes = Vec::new();
    zip.by_name("userData.db")
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("userData.db");
    std::fs::write(&path, bytes).unwrap();
    (dir, path)
}

/// `sqlite_master` in creation order as (type, name, tbl_name, sql), with
/// the SQL's whitespace collapsed.
fn schema(path: &Path) -> Vec<(String, String, String, Option<String>)> {
    let conn = Connection::open(path).unwrap();
    let mut stmt = conn
        .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid")
        .unwrap();
    stmt.query_map([], |r| {
        let sql: Option<String> = r.get(3)?;
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            sql.map(|s| s.split_whitespace().collect::<Vec<_>>().join(" ")),
        ))
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

fn user_version(path: &Path) -> u32 {
    Connection::open(path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap()
}

/// Every table's full contents, all columns, by table name; rows in rowid
/// order, or primary-key order for a `WITHOUT ROWID` table.
fn contents(path: &Path) -> Vec<(String, Vec<Vec<Value>>)> {
    let conn = Connection::open(path).unwrap();
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    tables
        .into_iter()
        .map(|t| {
            let order = if conn.prepare(&format!("SELECT rowid FROM \"{t}\"")).is_ok() {
                "rowid".to_string()
            } else {
                conn.prepare("SELECT name FROM pragma_table_info(?1) WHERE pk > 0 ORDER BY pk")
                    .unwrap()
                    .query_map([&t], |r| r.get::<_, String>(0))
                    .unwrap()
                    .map(|c| format!("\"{}\"", c.unwrap()))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let mut stmt = conn
                .prepare(&format!("SELECT * FROM \"{t}\" ORDER BY {order}"))
                .unwrap();
            let n = stmt.column_count();
            let rows = stmt
                .query_map([], |r| (0..n).map(|i| r.get::<_, Value>(i)).collect())
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            (t, rows)
        })
        .collect()
}

#[test]
fn new_userdata_db_matches_the_pinned_blank() {
    let env = Env::new();
    drop(env.core());
    let (_blank_dir, blank) = blank_db();

    let ours = schema(&env.userdata_db());
    let theirs = schema(&blank);
    assert_eq!(ours, theirs);
    // 18 tables, 23 triggers, 14 explicit indexes (design §5).
    let count = |kind: &str| theirs.iter().filter(|e| e.0 == kind).count();
    assert_eq!((count("table"), count("trigger")), (18, 23));
    assert_eq!(
        theirs
            .iter()
            .filter(|e| e.0 == "index" && e.3.is_some())
            .count(),
        14
    );

    assert_eq!(user_version(&env.userdata_db()), 16);
    assert_eq!(user_version(&blank), 16);
    // The same initial rows: the locale, the one LastModified row and the
    // Favorites tag.
    assert_eq!(contents(&env.userdata_db()), contents(&blank));
    assert_eq!(
        contents(&env.userdata_db())
            .into_iter()
            .find(|(t, _)| t == "Tag")
            .unwrap()
            .1,
        vec![vec![
            Value::Integer(1),
            Value::Integer(0),
            Value::Text("Favorite".into())
        ]]
    );
}

#[test]
fn reopening_keeps_the_existing_userdata_db() {
    let env = Env::new();
    drop(env.core());
    Connection::open(env.userdata_db())
        .unwrap()
        .execute("INSERT INTO Tag (Type, Name) VALUES (1, 'Kept')", [])
        .unwrap();
    let before = contents(&env.userdata_db());

    drop(env.core());
    assert_eq!(contents(&env.userdata_db()), before);
    // The user-data DB keeps JW's schema version; the core DB's migrations
    // never touch it.
    assert_eq!(user_version(&env.userdata_db()), 16);
    // Creating it left no temporary files behind.
    let mut names: Vec<String> = std::fs::read_dir(&env.data)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|n| n.starts_with('.') || n.contains("userData"))
        .collect();
    names.sort();
    assert_eq!(names, ["userData.db"]);
}

#[test]
fn open_with_corrupt_userdata_db_is_corrupt() {
    let env = Env::new();
    std::fs::create_dir_all(&env.data).unwrap();
    std::fs::write(env.userdata_db(), b"definitely not a sqlite database").unwrap();
    let err = match Core::open(&env.data, &env.cache) {
        Ok(_) => panic!("expected a corrupt error"),
        Err(e) => e,
    };
    assert!(
        matches!(err, berean_core::CoreError::Corrupt),
        "got {err:?}"
    );
}
