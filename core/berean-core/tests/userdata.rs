//! User data (`userData.db`) and `.jwlibrary` backups. There is no real user
//! export to test against: the backups here are synthetic, built in code
//! from the pinned jwlManager blank v16 database (`jwlmanager_blank_v16.zip`,
//! fetched by `core/scripts/fetch-fixtures.sh`).

mod common;

use std::io::Read;
use std::path::{Path, PathBuf};

use berean_core::reader::{Location, LocationSpan};
use berean_core::userdata::{
    Bookmark, Highlight, HighlightColor, ImportPreview, ImportSummary, NoteFilter, Tag, TextRange,
    UserData,
};
use berean_core::{CancelToken, Core, CoreError};
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

    /// A second, raw connection to `userData.db`, to check or plant rows.
    fn raw(&self) -> Connection {
        Connection::open(self.userdata_db()).unwrap()
    }
}

// Synthetic locations: the user-data calls don't need the publications
// installed.
const W_E: &str = "w26:0:20260800";
const W_S: &str = "w26:1:20260800";
const NWT_E: &str = "nwtsty:0:0";
const NWT_S: &str = "nwtsty:1:0";
/// The plain New World Translation, beside the study edition.
const NWT_PLAIN_E: &str = "nwt:0:0";

fn publication(pub_key: &str) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: None,
        book: None,
        chapter: None,
        verse: None,
        paragraph: None,
    }
}

fn document(pub_key: &str, doc_id: i64) -> Location {
    Location {
        doc_id: Some(doc_id),
        ..publication(pub_key)
    }
}

fn paragraph(pub_key: &str, doc_id: i64, paragraph: u32) -> Location {
    Location {
        paragraph: Some(paragraph),
        ..document(pub_key, doc_id)
    }
}

fn chapter(pub_key: &str, book: u32, chapter: u32) -> Location {
    Location {
        book: Some(book),
        chapter: Some(chapter),
        ..publication(pub_key)
    }
}

fn verse(pub_key: &str, book: u32, chapter_: u32, verse: u32) -> Location {
    Location {
        verse: Some(verse),
        ..chapter(pub_key, book, chapter_)
    }
}

fn range(start: Location, end: Location, tokens: (Option<u32>, Option<u32>)) -> TextRange {
    TextRange {
        span: LocationSpan { start, end },
        start_token: tokens.0,
        end_token: tokens.1,
    }
}

fn is_invalid<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::Invalid(_)))
}

fn is_not_found<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::NotFound))
}

/// The rows of `sql` as values, for checking what was stored.
fn rows(conn: &Connection, sql: &str) -> Vec<Vec<Value>> {
    let mut stmt = conn.prepare(sql).unwrap();
    let n = stmt.column_count();
    stmt.query_map([], |r| (0..n).map(|i| r.get::<_, Value>(i)).collect())
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn int(n: i64) -> Value {
    Value::Integer(n)
}

fn is_iso_utc(s: &str) -> bool {
    // `2026-10-28T06:54:00Z`
    s.len() == 20
        && s.chars().enumerate().all(|(i, c)| match i {
            4 | 7 => c == '-',
            10 => c == 'T',
            13 | 16 => c == ':',
            19 => c == 'Z',
            _ => c.is_ascii_digit(),
        })
}

fn is_v4_uuid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.iter().map(|p| p.len()).collect::<Vec<_>>() == [8, 4, 4, 4, 12]
        && s.chars()
            .all(|c| c == '-' || matches!(c, '0'..='9' | 'a'..='f'))
        && parts[2].starts_with('4')
        && matches!(parts[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b')
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

/// Whether a table is Berean's rather than JW's: its own tables, and the
/// `sqlite_sequence` SQLite adds for their `AUTOINCREMENT`.
fn is_berean_table(name: &str) -> bool {
    name.starts_with("Berean") || name == "sqlite_sequence"
}

/// [`schema`] without Berean's tables and their indexes.
fn jw_schema(path: &Path) -> Vec<(String, String, String, Option<String>)> {
    let mut s = schema(path);
    s.retain(|e| !is_berean_table(&e.2));
    s
}

/// [`contents`] without Berean's tables.
fn jw_contents(path: &Path) -> Vec<(String, Vec<Vec<Value>>)> {
    let mut c = contents(path);
    c.retain(|(t, _)| !is_berean_table(t));
    c
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

    // JW's part is the blank exactly; Berean's tables come on top.
    let ours = jw_schema(&env.userdata_db());
    let theirs = schema(&blank);
    assert_eq!(ours, theirs);
    let berean: Vec<(String, String)> = schema(&env.userdata_db())
        .into_iter()
        .filter(|e| is_berean_table(&e.2))
        .map(|e| (e.0, e.1))
        .filter(|(_, name)| !name.starts_with("sqlite_autoindex"))
        .collect();
    let pair = |t: &str, n: &str| (t.to_string(), n.to_string());
    assert_eq!(
        berean,
        [
            pair("table", "BereanFolder"),
            pair("table", "sqlite_sequence"),
            pair("index", "IX_BereanFolder_Sibling_Name"),
            pair("index", "IX_BereanFolder_ParentId"),
            pair("table", "BereanNoteFolder"),
            pair("index", "IX_BereanNoteFolder_FolderId"),
            pair("table", "BereanWorkspace"),
            pair("index", "IX_BereanWorkspace_Name"),
            pair("table", "BereanStudyspace"),
            pair("table", "BereanCanvasItem"),
            pair("index", "IX_BereanCanvasItem_Note"),
            pair("index", "IX_BereanCanvasItem_Workspace"),
        ]
    );
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
    // Favorites tag. Berean's tables start empty.
    assert_eq!(jw_contents(&env.userdata_db()), contents(&blank));
    assert!(contents(&env.userdata_db())
        .iter()
        .all(|(t, rows)| !is_berean_table(t) || rows.is_empty()));
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

#[test]
fn paragraph_highlight_spans_blocks_with_tokens() {
    let env = Env::new();
    let ud = env.core().userdata();
    let r = range(
        paragraph(W_E, 2026601, 3),
        paragraph(W_E, 2026601, 5),
        (Some(2), Some(7)),
    );
    let h = ud.add_highlight(&r, HighlightColor::Green).unwrap();
    assert!(is_v4_uuid(&h.id), "{}", h.id);
    assert_eq!(h.range, r);
    assert_eq!(h.color, HighlightColor::Green);
    assert_eq!(
        ud.highlights(W_E, &document(W_E, 2026601)).unwrap(),
        std::slice::from_ref(&h)
    );
    // Other documents and languages have none.
    assert!(ud
        .highlights(W_E, &document(W_E, 2026602))
        .unwrap()
        .is_empty());
    assert!(ud
        .highlights(W_S, &document(W_S, 2026601))
        .unwrap()
        .is_empty());

    // As JW stores it: one mark on the document's Location, one block range
    // per paragraph, the tokens only on the first and last.
    let raw = env.raw();
    assert_eq!(
        rows(
            &raw,
            "SELECT Type, KeySymbol, MepsLanguage, IssueTagNumber, DocumentId, BookNumber, \
             ChapterNumber FROM Location"
        ),
        [vec![
            int(0),
            Value::Text("w26".into()),
            int(0),
            int(20260800),
            int(2026601),
            Value::Null,
            Value::Null
        ]]
    );
    assert_eq!(
        rows(
            &raw,
            "SELECT ColorIndex, StyleIndex, Version, UserMarkGuid FROM UserMark"
        ),
        [vec![int(2), int(0), int(1), Value::Text(h.id.clone())]]
    );
    assert_eq!(
        rows(
            &raw,
            "SELECT BlockType, Identifier, StartToken, EndToken FROM BlockRange ORDER BY Identifier"
        ),
        [
            vec![int(1), int(3), int(2), Value::Null],
            vec![int(1), int(4), Value::Null, Value::Null],
            vec![int(1), int(5), Value::Null, int(7)],
        ]
    );
}

#[test]
fn verse_highlights_in_both_languages() {
    let env = Env::new();
    let ud = env.core().userdata();
    // Our Bible doc_id is dropped: it reads back as None.
    let mut start = verse(NWT_E, 43, 3, 16);
    start.doc_id = Some(1001070143);
    let en = ud
        .add_highlight(
            &range(start, verse(NWT_E, 43, 3, 17), (None, None)),
            HighlightColor::Yellow,
        )
        .unwrap();
    assert_eq!(
        en.range,
        range(
            verse(NWT_E, 43, 3, 16),
            verse(NWT_E, 43, 3, 17),
            (None, None)
        )
    );
    let es = ud
        .add_highlight(
            &range(
                verse(NWT_S, 43, 3, 16),
                verse(NWT_S, 43, 3, 16),
                (Some(0), Some(4)),
            ),
            HighlightColor::Purple,
        )
        .unwrap();
    assert_ne!(en.id, es.id);
    assert_eq!(ud.highlights(NWT_E, &chapter(NWT_E, 43, 3)).unwrap(), [en]);
    assert_eq!(ud.highlights(NWT_S, &chapter(NWT_S, 43, 3)).unwrap(), [es]);
    assert!(ud
        .highlights(NWT_E, &chapter(NWT_E, 43, 4))
        .unwrap()
        .is_empty());

    let raw = env.raw();
    assert_eq!(
        rows(
            &raw,
            "SELECT Type, KeySymbol, MepsLanguage, DocumentId, BookNumber, ChapterNumber \
             FROM Location ORDER BY LocationId"
        ),
        [
            vec![
                int(0),
                Value::Text("nwtsty".into()),
                int(0),
                Value::Null,
                int(43),
                int(3)
            ],
            vec![
                int(0),
                Value::Text("nwtsty".into()),
                int(1),
                Value::Null,
                int(43),
                int(3)
            ],
        ]
    );
    assert_eq!(
        rows(
            &raw,
            "SELECT BlockType, Identifier, StartToken, EndToken FROM BlockRange ORDER BY BlockRangeId"
        ),
        [
            vec![int(2), int(16), Value::Null, Value::Null],
            vec![int(2), int(17), Value::Null, Value::Null],
            vec![int(2), int(16), int(0), int(4)],
        ]
    );
}

#[test]
fn highlight_tokens_round_trip() {
    let env = Env::new();
    let ud = env.core().userdata();
    let tokens = [
        (None, None),
        (Some(3), None),
        (None, Some(9)),
        (Some(1), Some(12)),
    ];
    let mut made = Vec::new();
    for (i, t) in tokens.into_iter().enumerate() {
        let p = 10 * (i as u32 + 1);
        for (start, end) in [(p, p), (p, p + 2)] {
            let r = range(paragraph(W_E, 7, start), paragraph(W_E, 7, end), t);
            let h = ud.add_highlight(&r, HighlightColor::Blue).unwrap();
            assert_eq!(h.range, r);
            made.push(h);
        }
    }
    assert_eq!(ud.highlights(W_E, &document(W_E, 7)).unwrap(), made);
    // Reading again (a new core) gives the same.
    drop(ud);
    assert_eq!(
        env.core()
            .userdata()
            .highlights(W_E, &document(W_E, 7))
            .unwrap(),
        made
    );
}

#[test]
fn highlight_color_and_removal() {
    let env = Env::new();
    let ud = env.core().userdata();
    let h = ud
        .add_highlight(
            &range(paragraph(W_E, 7, 1), paragraph(W_E, 7, 2), (None, None)),
            HighlightColor::Yellow,
        )
        .unwrap();
    ud.set_highlight_color(&h.id, HighlightColor::Orange)
        .unwrap();
    let got = ud.highlights(W_E, &document(W_E, 7)).unwrap();
    assert_eq!(got[0].color, HighlightColor::Orange);
    assert!(is_not_found(
        ud.set_highlight_color("nope", HighlightColor::Pink)
    ));

    let note = ud
        .add_note(
            "On it",
            "text",
            Some(&paragraph(W_E, 7, 1)),
            Some(&h.id),
            None,
        )
        .unwrap();
    assert_eq!(note.highlight_id.as_deref(), Some(h.id.as_str()));
    ud.remove_highlight(&h.id).unwrap();
    assert!(ud.highlights(W_E, &document(W_E, 7)).unwrap().is_empty());
    // The note stays, detached.
    let notes = ud.notes(&NoteFilter::default()).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, note.id);
    assert_eq!(notes[0].highlight_id, None);
    let raw = env.raw();
    assert!(rows(&raw, "SELECT * FROM BlockRange").is_empty());
    assert!(rows(&raw, "SELECT * FROM UserMark").is_empty());
    assert!(is_not_found(ud.remove_highlight(&h.id)));
    assert!(is_not_found(ud.add_note("x", "y", None, Some(&h.id), None)));
}

#[test]
fn bad_highlights_are_invalid() {
    let env = Env::new();
    let ud = env.core().userdata();
    let bad = [
        // Across documents, chapters, books, languages, publications.
        range(paragraph(W_E, 7, 1), paragraph(W_E, 8, 1), (None, None)),
        range(verse(NWT_E, 1, 1, 1), verse(NWT_E, 1, 2, 1), (None, None)),
        range(verse(NWT_E, 1, 1, 1), verse(NWT_E, 2, 1, 1), (None, None)),
        range(verse(NWT_E, 1, 1, 1), verse(NWT_S, 1, 1, 1), (None, None)),
        range(paragraph(W_E, 7, 1), paragraph(W_S, 7, 1), (None, None)),
        // Backwards.
        range(paragraph(W_E, 7, 5), paragraph(W_E, 7, 4), (None, None)),
        range(
            paragraph(W_E, 7, 5),
            paragraph(W_E, 7, 5),
            (Some(4), Some(3)),
        ),
        // Not paragraphs or verses.
        range(document(W_E, 7), document(W_E, 7), (None, None)),
        range(chapter(NWT_E, 1, 1), verse(NWT_E, 1, 1, 3), (None, None)),
        range(publication(W_E), publication(W_E), (None, None)),
        // Malformed.
        range(paragraph("w26", 7, 1), paragraph("w26", 7, 1), (None, None)),
        range(
            Location {
                verse: Some(1),
                ..publication(NWT_E)
            },
            Location {
                verse: Some(1),
                ..publication(NWT_E)
            },
            (None, None),
        ),
    ];
    for r in bad {
        assert!(
            is_invalid(ud.add_highlight(&r, HighlightColor::Yellow)),
            "{r:?}"
        );
    }
    assert!(rows(&env.raw(), "SELECT * FROM UserMark").is_empty());
    // Listing needs a document or chapter of that publication.
    assert!(is_invalid(ud.highlights(W_E, &document(W_S, 7))));
    assert!(is_invalid(ud.highlights(W_E, &paragraph(W_E, 7, 1))));
    assert!(is_invalid(ud.highlights(W_E, &publication(W_E))));
}

#[test]
fn rows_the_reads_cant_map_are_skipped_but_kept() {
    let env = Env::new();
    let ud = env.core().userdata();
    let h = ud
        .add_highlight(
            &range(paragraph(W_E, 7, 1), paragraph(W_E, 7, 1), (None, None)),
            HighlightColor::Yellow,
        )
        .unwrap();
    let raw = env.raw();
    // A mark with no color, and one with a color we don't know, on the
    // same document.
    raw.execute_batch(
        "INSERT INTO UserMark (ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version)
             VALUES (0, 1, 0, 'g0', 1), (7, 1, 0, 'g7', 1);
         INSERT INTO BlockRange (BlockType, Identifier, UserMarkId) VALUES (1, 2, 2), (1, 3, 3);
         -- An audio location (Track) and a note on it; a Specialty'd document.
         INSERT INTO Location (Type, KeySymbol, MepsLanguage, IssueTagNumber, Track)
             VALUES (2, 'w26', 0, 20260800, 4);
         INSERT INTO Note (Guid, LocationId, Title, Content) VALUES ('n-audio', 2, 't', 'c');
         INSERT INTO Location (Type, KeySymbol, MepsLanguage, IssueTagNumber, DocumentId,
             Specialty) VALUES (0, 'w26', 0, 20260800, 8, 'x');
         INSERT INTO Note (Guid, LocationId, Title, Content) VALUES ('n-special', 3, 't', 'c');",
    )
    .unwrap();
    assert_eq!(ud.highlights(W_E, &document(W_E, 7)).unwrap(), [h]);
    assert!(ud.notes(&NoteFilter::default()).unwrap().is_empty());
    // A new note on doc 8 makes its own Location row; the Specialty one
    // stays as it was.
    let n = ud
        .add_note("t", "c", Some(&document(W_E, 8)), None, None)
        .unwrap();
    assert_eq!(n.location, Some(document(W_E, 8)));
    assert_eq!(rows(&raw, "SELECT COUNT(*) FROM UserMark"), [vec![int(3)]]);
    assert_eq!(rows(&raw, "SELECT COUNT(*) FROM Note"), [vec![int(3)]]);
    assert_eq!(rows(&raw, "SELECT COUNT(*) FROM Location"), [vec![int(4)]]);
}

#[test]
fn notes_by_location_and_tag() {
    let env = Env::new();
    let ud = env.core().userdata();
    let free = ud.add_note("Free", "standing", None, None, None).unwrap();
    assert_eq!(free.location, None);
    assert!(
        is_iso_utc(&free.created) && is_iso_utc(&free.modified),
        "{free:?}"
    );
    assert!(is_v4_uuid(&free.id));
    let in_doc = ud
        .add_note("Doc", "", Some(&document(W_E, 7)), None, None)
        .unwrap();
    let in_para = ud
        .add_note("Para", "p", Some(&paragraph(W_E, 7, 4)), None, None)
        .unwrap();
    let mut v = verse(NWT_E, 43, 3, 16);
    v.doc_id = Some(1001070143);
    let in_verse = ud.add_note("Verse", "v", Some(&v), None, None).unwrap();
    assert_eq!(in_verse.location, Some(verse(NWT_E, 43, 3, 16)));
    let in_es = ud
        .add_note("Versículo", "v", Some(&verse(NWT_S, 43, 3, 16)), None, None)
        .unwrap();
    let ids = |f: NoteFilter| -> Vec<String> {
        ud.notes(&f).unwrap().into_iter().map(|n| n.id).collect()
    };
    let at = |loc: Location| NoteFilter {
        location: Some(loc),
        ..NoteFilter::default()
    };

    assert_eq!(
        ids(NoteFilter::default()),
        [
            free.id.as_str(),
            in_doc.id.as_str(),
            in_para.id.as_str(),
            in_verse.id.as_str(),
            in_es.id.as_str()
        ]
    );
    assert_eq!(
        ids(at(document(W_E, 7))),
        [in_doc.id.as_str(), in_para.id.as_str()]
    );
    assert_eq!(ids(at(paragraph(W_E, 7, 4))), [in_para.id.as_str()]);
    assert!(ids(at(paragraph(W_E, 7, 5))).is_empty());
    assert_eq!(
        ids(at(publication(W_E))),
        [in_doc.id.as_str(), in_para.id.as_str()]
    );
    assert_eq!(ids(at(chapter(NWT_E, 43, 3))), [in_verse.id.as_str()]);
    assert_eq!(ids(at(chapter(NWT_S, 43, 3))), [in_es.id.as_str()]);
    assert!(is_invalid(ud.notes(&at(paragraph("bad", 7, 1)))));

    let tag = ud.add_tag("Study").unwrap();
    ud.tag_note(&in_para.id, tag.id).unwrap();
    ud.tag_note(&in_verse.id, tag.id).unwrap();
    ud.tag_note(&in_verse.id, tag.id).unwrap(); // no-op
    let tagged = NoteFilter {
        tag_ids: vec![tag.id],
        ..NoteFilter::default()
    };
    assert_eq!(
        ids(tagged.clone()),
        [in_para.id.as_str(), in_verse.id.as_str()]
    );
    assert_eq!(
        ids(NoteFilter {
            location: Some(document(W_E, 7)),
            ..tagged.clone()
        }),
        [in_para.id.as_str()]
    );
    let read = ud.notes(&at(paragraph(W_E, 7, 4))).unwrap();
    assert_eq!(read[0].tag_ids, [tag.id]);
    assert_eq!(read[0].title, "Para");
    assert_eq!(read[0].content, "p");
    assert_eq!(read[0].location, Some(paragraph(W_E, 7, 4)));

    // Stored as JW does: block on the note row.
    assert_eq!(
        rows(
            &env.raw(),
            "SELECT BlockType, BlockIdentifier FROM Note ORDER BY NoteId"
        ),
        [
            vec![int(0), Value::Null],
            vec![int(0), Value::Null],
            vec![int(1), int(4)],
            vec![int(2), int(16)],
            vec![int(2), int(16)],
        ]
    );

    ud.update_note(&in_para.id, "New title", "new text")
        .unwrap();
    let read = ud.notes(&at(paragraph(W_E, 7, 4))).unwrap();
    assert_eq!(
        (read[0].title.as_str(), read[0].content.as_str()),
        ("New title", "new text")
    );
    assert_eq!(read[0].created, in_para.created);
    assert!(read[0].modified >= in_para.modified);
    assert!(is_not_found(ud.update_note("nope", "a", "b")));

    ud.remove_note(&in_para.id).unwrap();
    assert_eq!(ids(tagged), [in_verse.id.as_str()]);
    assert!(is_not_found(ud.remove_note(&in_para.id)));
    assert_eq!(
        rows(&env.raw(), "SELECT COUNT(*) FROM TagMap"),
        [vec![int(1)]]
    );
}

#[test]
fn tags() {
    let env = Env::new();
    let ud = env.core().userdata();
    // The built-in Favorites tag isn't a user tag.
    assert!(ud.tags().unwrap().is_empty());
    assert!(is_not_found(ud.rename_tag(1, "Mine")));
    assert!(is_not_found(ud.remove_tag(1)));

    let a = ud.add_tag("  Prayer ").unwrap();
    assert_eq!(a.name, "Prayer");
    let b = ud.add_tag("Family").unwrap();
    assert_eq!(ud.tags().unwrap(), [a.clone(), b.clone()]);
    for name in ["", "   ", "Prayer", " Family"] {
        assert!(is_invalid(ud.add_tag(name)), "{name:?}");
    }
    assert!(is_invalid(ud.rename_tag(b.id, "Prayer")));
    assert!(is_invalid(ud.rename_tag(b.id, " ")));
    ud.rename_tag(b.id, "Family").unwrap(); // its own name
    ud.rename_tag(b.id, "Home").unwrap();
    assert_eq!(
        ud.tags().unwrap(),
        [
            a.clone(),
            Tag {
                id: b.id,
                name: "Home".into()
            }
        ]
    );
    assert!(is_not_found(ud.rename_tag(999, "X")));

    let n1 = ud.add_note("1", "", None, None, None).unwrap();
    let n2 = ud.add_note("2", "", None, None, None).unwrap();
    ud.tag_note(&n1.id, a.id).unwrap();
    ud.tag_note(&n2.id, a.id).unwrap();
    ud.tag_note(&n2.id, b.id).unwrap();
    assert!(is_not_found(ud.tag_note("nope", a.id)));
    assert!(is_not_found(ud.tag_note(&n1.id, 999)));
    assert!(is_not_found(ud.untag_note(&n1.id, 999)));
    // Members are appended.
    assert_eq!(
        rows(
            &env.raw(),
            "SELECT TagId, Position FROM TagMap ORDER BY TagMapId"
        ),
        [
            vec![int(a.id), int(0)],
            vec![int(a.id), int(1)],
            vec![int(b.id), int(0)],
        ]
    );
    let notes = ud.notes(&NoteFilter::default()).unwrap();
    assert_eq!(notes[1].tag_ids, [a.id, b.id]);

    ud.untag_note(&n2.id, b.id).unwrap();
    ud.untag_note(&n2.id, b.id).unwrap(); // not tagged: no-op
    assert_eq!(ud.notes(&NoteFilter::default()).unwrap()[1].tag_ids, [a.id]);

    // Removing a tag untags its notes but keeps them.
    ud.remove_tag(a.id).unwrap();
    assert_eq!(
        ud.tags().unwrap(),
        [Tag {
            id: b.id,
            name: "Home".into()
        }]
    );
    let notes = ud.notes(&NoteFilter::default()).unwrap();
    assert_eq!(notes.len(), 2);
    assert!(notes.iter().all(|n| n.tag_ids.is_empty()));
    assert!(rows(&env.raw(), "SELECT * FROM TagMap").is_empty());
    assert!(is_not_found(ud.remove_tag(a.id)));
}

#[test]
fn favorites_keep_their_order() {
    let env = Env::new();
    let ud = env.core().userdata();
    assert!(ud.favorites().unwrap().is_empty());
    let mut john = chapter(NWT_E, 43, 3);
    let favs = [
        publication(W_E),
        document(W_S, 7),
        john.clone(),
        publication(NWT_S),
    ];
    for f in &favs {
        ud.add_favorite(f).unwrap();
    }
    // Our Bible doc_id is dropped, so this is the same favorite: a no-op.
    john.doc_id = Some(1001070143);
    ud.add_favorite(&john).unwrap();
    assert_eq!(ud.favorites().unwrap(), favs);
    // On JW's Favorites tag.
    assert_eq!(
        rows(&env.raw(), "SELECT DISTINCT TagId FROM TagMap"),
        [vec![int(1)]]
    );
    assert!(is_invalid(ud.add_favorite(&paragraph(W_E, 7, 1))));
    assert!(is_invalid(ud.add_favorite(&verse(NWT_E, 43, 3, 16))));

    // [W_E, W_S doc, John 3, NWT_S] → move NWT_S first, W_E last.
    ud.move_favorite(&publication(NWT_S), 0).unwrap();
    ud.move_favorite(&publication(W_E), 3).unwrap();
    let want = [
        publication(NWT_S),
        document(W_S, 7),
        chapter(NWT_E, 43, 3),
        publication(W_E),
    ];
    assert_eq!(ud.favorites().unwrap(), want);
    assert_eq!(
        rows(&env.raw(), "SELECT Position FROM TagMap ORDER BY Position"),
        [vec![int(0)], vec![int(1)], vec![int(2)], vec![int(3)]]
    );
    ud.move_favorite(&document(W_S, 7), 1).unwrap(); // in place
    assert_eq!(ud.favorites().unwrap(), want);
    assert!(is_invalid(ud.move_favorite(&publication(W_E), 4)));
    assert!(is_not_found(ud.move_favorite(&publication(W_S), 0)));

    ud.remove_favorite(&chapter(NWT_E, 43, 3)).unwrap();
    assert_eq!(
        ud.favorites().unwrap(),
        [publication(NWT_S), document(W_S, 7), publication(W_E)]
    );
    assert!(is_not_found(ud.remove_favorite(&chapter(NWT_E, 43, 3))));
    // Adding after a removal still appends.
    ud.add_favorite(&chapter(NWT_E, 1, 1)).unwrap();
    assert_eq!(ud.favorites().unwrap().last(), Some(&chapter(NWT_E, 1, 1)));
}

#[test]
fn bookmarks_by_slot() {
    let env = Env::new();
    let ud = env.core().userdata();
    assert!(ud.bookmarks(W_E).unwrap().is_empty());
    ud.set_bookmark(W_E, 3, &paragraph(W_E, 7, 4), "Para 4", Some("snip"))
        .unwrap();
    ud.set_bookmark(W_E, 0, &document(W_E, 8), "Doc 8", None)
        .unwrap();
    ud.set_bookmark(NWT_S, 9, &verse(NWT_S, 43, 3, 16), "Juan 3:16", None)
        .unwrap();
    let bm = |pub_key: &str, slot, location, title: &str, snippet: Option<&str>| Bookmark {
        pub_key: pub_key.into(),
        slot,
        location,
        title: title.into(),
        snippet: snippet.map(Into::into),
    };
    assert_eq!(
        ud.bookmarks(W_E).unwrap(),
        [
            bm(W_E, 0, document(W_E, 8), "Doc 8", None),
            bm(W_E, 3, paragraph(W_E, 7, 4), "Para 4", Some("snip")),
        ]
    );
    assert_eq!(
        ud.bookmarks(NWT_S).unwrap(),
        [bm(NWT_S, 9, verse(NWT_S, 43, 3, 16), "Juan 3:16", None)]
    );
    assert!(ud.bookmarks(NWT_E).unwrap().is_empty());
    // Stored against the publication's Type-1 Location.
    assert_eq!(
        rows(
            &env.raw(),
            "SELECT p.Type, p.KeySymbol, p.MepsLanguage, b.Slot, b.BlockType, b.BlockIdentifier \
             FROM Bookmark b JOIN Location p ON p.LocationId = b.PublicationLocationId \
             ORDER BY b.BookmarkId"
        ),
        [
            vec![
                int(1),
                Value::Text("w26".into()),
                int(0),
                int(3),
                int(1),
                int(4)
            ],
            vec![
                int(1),
                Value::Text("w26".into()),
                int(0),
                int(0),
                int(0),
                Value::Null
            ],
            vec![
                int(1),
                Value::Text("nwtsty".into()),
                int(1),
                int(9),
                int(2),
                int(16)
            ],
        ]
    );

    // Setting a used slot replaces it.
    ud.set_bookmark(W_E, 0, &paragraph(W_E, 9, 1), "Doc 9", Some("s"))
        .unwrap();
    assert_eq!(
        ud.bookmarks(W_E).unwrap()[0],
        bm(W_E, 0, paragraph(W_E, 9, 1), "Doc 9", Some("s"))
    );
    assert_eq!(
        rows(&env.raw(), "SELECT COUNT(*) FROM Bookmark"),
        [vec![int(3)]]
    );

    // Bibles get slots per edition (Decision 5): English nwt and nwtsty
    // each keep their own slot 5.
    ud.set_bookmark(NWT_E, 5, &verse(NWT_E, 43, 3, 16), "John 3:16", None)
        .unwrap();
    ud.set_bookmark(
        NWT_PLAIN_E,
        5,
        &verse(NWT_PLAIN_E, 1, 1, 1),
        "Gen 1:1",
        None,
    )
    .unwrap();
    assert_eq!(
        ud.bookmarks(NWT_E).unwrap(),
        [bm(NWT_E, 5, verse(NWT_E, 43, 3, 16), "John 3:16", None)]
    );
    assert_eq!(
        ud.bookmarks(NWT_PLAIN_E).unwrap(),
        [bm(
            NWT_PLAIN_E,
            5,
            verse(NWT_PLAIN_E, 1, 1, 1),
            "Gen 1:1",
            None
        )]
    );
    ud.remove_bookmark(NWT_PLAIN_E, 5).unwrap();
    assert_eq!(ud.bookmarks(NWT_E).unwrap().len(), 1);
    ud.remove_bookmark(NWT_E, 5).unwrap();

    assert!(is_invalid(ud.set_bookmark(
        W_E,
        10,
        &document(W_E, 8),
        "x",
        None
    )));
    assert!(is_invalid(ud.set_bookmark(
        W_E,
        1,
        &document(W_S, 8),
        "x",
        None
    )));
    assert!(is_invalid(ud.set_bookmark(
        "bad",
        1,
        &document("bad", 8),
        "x",
        None
    )));
    assert!(is_invalid(ud.remove_bookmark(W_E, 10)));
    assert!(is_invalid(ud.bookmarks("bad")));

    ud.remove_bookmark(W_E, 3).unwrap();
    assert_eq!(ud.bookmarks(W_E).unwrap().len(), 1);
    assert!(is_not_found(ud.remove_bookmark(W_E, 3)));
    assert!(is_not_found(ud.remove_bookmark(NWT_E, 0)));
}

#[test]
fn userdata_handles_share_state() {
    let env = Env::new();
    let core = env.core();
    let (a, b): (UserData, UserData) = (core.userdata(), core.userdata().clone());
    let h: Highlight = a
        .add_highlight(
            &range(paragraph(W_E, 7, 1), paragraph(W_E, 7, 1), (None, None)),
            HighlightColor::Pink,
        )
        .unwrap();
    assert_eq!(b.highlights(W_E, &document(W_E, 7)).unwrap(), [h]);
}

/// Some of everything the typed calls make, in both languages.
fn populate(ud: &UserData) {
    let h = ud
        .add_highlight(
            &range(
                paragraph(W_E, 7, 2),
                paragraph(W_E, 7, 4),
                (Some(1), Some(6)),
            ),
            HighlightColor::Blue,
        )
        .unwrap();
    ud.add_highlight(
        &range(
            verse(NWT_S, 43, 3, 16),
            verse(NWT_S, 43, 3, 16),
            (None, None),
        ),
        HighlightColor::Yellow,
    )
    .unwrap();
    let n = ud
        .add_note(
            "On it",
            "text",
            Some(&paragraph(W_E, 7, 2)),
            Some(&h.id),
            None,
        )
        .unwrap();
    let t = ud.add_tag("Study").unwrap();
    ud.tag_note(&n.id, t.id).unwrap();
    ud.add_note("Free", "", None, None, None).unwrap();
    ud.add_favorite(&publication(NWT_S)).unwrap();
    ud.set_bookmark(W_E, 0, &paragraph(W_E, 7, 3), "Para 3", Some("s"))
        .unwrap();
}

/// The members of the zip at `path`, by name, in zip order.
fn zip_members(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut f = zip.by_index(i).unwrap();
            assert_eq!(
                f.compression(),
                zip::CompressionMethod::Deflated,
                "{}",
                f.name()
            );
            let mut bytes = Vec::new();
            f.read_to_end(&mut bytes).unwrap();
            (f.name().to_string(), bytes)
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    hex::encode(sha2::Sha256::digest(bytes))
}

/// Names in `dir`, sorted.
fn dir_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

fn no_progress(_: u64, _: u64) {}

#[test]
fn export_writes_the_database_and_its_manifest() {
    let env = Env::new();
    let ud = env.core().userdata();
    populate(&ud);
    let out_dir = tempfile::tempdir().unwrap();
    let out = out_dir.path().join("backup.jwlibrary");
    ud.export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();
    assert_eq!(dir_names(out_dir.path()), ["backup.jwlibrary"]);

    let members = zip_members(&out);
    let names: Vec<&str> = members.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(names, ["manifest.json", "userData.db"]);
    let db = &members[1].1;
    let manifest: serde_json::Value = serde_json::from_slice(&members[0].1).unwrap();
    let live_modified: String = env
        .raw()
        .query_row("SELECT LastModified FROM LastModified", [], |r| r.get(0))
        .unwrap();
    let created = manifest["creationDate"].as_str().unwrap();
    assert!(is_iso_utc(created), "{created}");
    assert_eq!(
        manifest,
        serde_json::json!({
            "name": "Berean",
            "creationDate": created,
            "version": 1,
            "type": 0,
            "userDataBackup": {
                "lastModifiedDate": live_modified,
                "deviceName": "Berean",
                "databaseName": "userData.db",
                "hash": sha256_hex(db),
                "schemaVersion": 16,
            }
        })
    );

    // The database is the live one without Berean's tables: JW's schema,
    // user_version and rows, and nothing else.
    let copy_dir = tempfile::tempdir().unwrap();
    let copy = copy_dir.path().join("userData.db");
    std::fs::write(&copy, db).unwrap();
    assert_eq!(user_version(&copy), 16);
    assert_eq!(contents(&copy), jw_contents(&env.userdata_db()));
    let (_blank_dir, blank) = blank_db();
    assert_eq!(schema(&copy), schema(&blank));
}

/// The (type, name) of every schema object the vendored v16 DDL makes, on a
/// database with no Berean tables yet, sorted.
fn vendored_v16_names() -> Vec<(String, String)> {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(include_str!("../src/userdata_v16.sql"))
        .unwrap();
    names(&conn)
}

fn names(conn: &Connection) -> Vec<(String, String)> {
    let mut names: Vec<(String, String)> = conn
        .prepare("SELECT type, name FROM sqlite_master")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    names.sort();
    names
}

/// The `userData.db` member of the backup at `path`, written to a file.
fn exported_db(path: &Path) -> (tempfile::TempDir, PathBuf) {
    let (_, bytes) = zip_members(path)
        .into_iter()
        .find(|(n, _)| n == "userData.db")
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("userData.db");
    std::fs::write(&db, bytes).unwrap();
    (dir, db)
}

#[test]
fn export_drops_the_berean_tables() {
    let env = Env::new();
    let ud = env.core().userdata();
    populate(&ud);
    let top = ud.create_folder("Gospel of John", None).unwrap();
    let sub = ud.create_folder("Signs", Some(top.id)).unwrap();
    ud.add_note("Filed", "", None, None, Some(sub.id)).unwrap();
    let ws = ud.create_workspace("John").unwrap();
    ud.set_last_workspace(Some(ws.id)).unwrap();
    // The live file has Berean's tables, and the `sqlite_sequence` their
    // `AUTOINCREMENT` adds.
    let live = names(&env.raw());
    assert!(live.iter().any(|(_, n)| n == "BereanFolder"), "{live:?}");
    assert!(
        live.iter().any(|(_, n)| n == "BereanStudyspace"),
        "{live:?}"
    );
    assert!(live.iter().any(|(_, n)| n == "sqlite_sequence"), "{live:?}");

    let out_dir = tempfile::tempdir().unwrap();
    let out = out_dir.path().join("backup.jwlibrary");
    ud.export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();
    let (_db_dir, db) = exported_db(&out);
    let conn = Connection::open(&db).unwrap();
    let exported = names(&conn);
    assert!(
        !exported
            .iter()
            .any(|(_, n)| n.starts_with("Berean") || n.starts_with("IX_Berean")),
        "{exported:?}"
    );
    // Exactly JW's schema objects, `sqlite_sequence` not among them.
    assert_eq!(exported, vendored_v16_names());
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    // No free pages are left over from the dropped tables.
    let free: i64 = conn
        .query_row("PRAGMA freelist_count", [], |r| r.get(0))
        .unwrap();
    assert_eq!(free, 0);
    // The manifest's hash is of the database as written.
    let members = zip_members(&out);
    let manifest: serde_json::Value = serde_json::from_slice(&members[0].1).unwrap();
    assert_eq!(
        manifest["userDataBackup"]["hash"],
        sha256_hex(&std::fs::read(&db).unwrap())
    );
    // The live data still has its folders.
    assert_eq!(ud.folders().unwrap().len(), 2);
}

#[test]
fn markdown_note_bodies_round_trip_byte_identical() {
    let ex = Existing::new();
    let body = "# Light\r\n\nIn **him** was _life_ ~~not~~ — see \
                [John 1:4](berean://bible/nwtsty:0:0/43/1/4).\n\n\
                - [ ] read\n- [x] pray  \n\t`code` #study #wörd\n\n\
                > quote\n\n```\nfenced\n```\n<b>raw</b>\n\n\n";
    let note = ex
        .ud()
        .add_note("Markdown", body, None, None, None)
        .unwrap();
    let out = ex.file("out.jwlibrary");
    ex.ud()
        .export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();

    // The file holds the body as written.
    let (_db_dir, db) = exported_db(&out);
    let stored: Vec<u8> = Connection::open(&db)
        .unwrap()
        .query_row(
            "SELECT CAST(Content AS BLOB) FROM Note WHERE Guid = ?1",
            [&note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, body.as_bytes());

    // And it comes back the same through an import.
    let other = Existing::new();
    other.import(&out).unwrap();
    let back = other
        .ud()
        .notes(&NoteFilter::default())
        .unwrap()
        .into_iter()
        .find(|n| n.id == note.id)
        .unwrap();
    assert_eq!(back.content.as_bytes(), body.as_bytes());
    let raw: Vec<u8> = other
        .env
        .raw()
        .query_row(
            "SELECT CAST(Content AS BLOB) FROM Note WHERE Guid = ?1",
            [&note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, body.as_bytes());
}

/// A core with the English Watchtower fixture installed.
fn core_with_w_e(env: &Env) -> Core {
    let core = env.core();
    core.library()
        .install(
            W_E,
            fixture("w_E_202608.jwpub"),
            &|_, _| {},
            &CancelToken::new(),
        )
        .unwrap();
    core
}

/// A paragraph bookmark made the way the apps make one (its snippet the
/// start of the paragraph's text) survives a backup and still locates
/// exactly.
#[test]
fn paragraph_bookmark_round_trips_and_locates() {
    // "You Can Win the Battle!", paragraph 7.
    let (doc_id, pid) = (2026521, 7);
    let env = Env::new();
    let core = core_with_w_e(&env);
    let doc = core.reader().document(W_E, doc_id).unwrap();
    let anchor = doc.paragraphs.iter().find(|p| p.paragraph == pid).unwrap();
    let snippet: String = anchor.text.chars().take(100).collect();
    assert!(snippet.starts_with("AS SERVANTS of Jehovah"), "{snippet:?}");
    let title = format!("{} ¶ {}", doc.title, anchor.label.as_deref().unwrap());
    let at = paragraph(W_E, doc_id, pid);
    core.userdata()
        .set_bookmark(W_E, 2, &at, &title, Some(&snippet))
        .unwrap();
    let saved = core.userdata().bookmarks(W_E).unwrap();

    let files = tempfile::tempdir().unwrap();
    let out = files.path().join("out.jwlibrary");
    core.userdata()
        .export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();
    let fresh_env = Env::new();
    let fresh = core_with_w_e(&fresh_env);
    fresh
        .userdata()
        .import_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();

    let back = fresh.userdata().bookmarks(W_E).unwrap();
    assert_eq!(back, saved);
    assert_eq!(back[0].location, at);
    assert_eq!(back[0].snippet.as_deref(), Some(snippet.as_str()));
    assert_eq!(
        rows(
            &fresh_env.raw(),
            "SELECT l.DocumentId, b.BlockType, b.BlockIdentifier FROM Bookmark b \
             JOIN Location l ON l.LocationId = b.LocationId"
        ),
        [vec![int(doc_id), int(1), int(pid.into())]]
    );
    let located = fresh.reader().locate(&back[0].location, None).unwrap();
    assert!(located.exact);
    assert_eq!(located.location, at);
}

#[test]
fn export_carries_media_files_and_replaces_the_target() {
    let env = Env::new();
    let ud = env.core().userdata();
    let media = env.data.join("userData.media");
    std::fs::create_dir_all(media.join("sub")).unwrap();
    std::fs::write(media.join("default_thumbnail.png"), b"\x89PNG thumb").unwrap();
    std::fs::write(media.join("sub/clip.mp4"), vec![7u8; 70_000]).unwrap();
    let out_dir = tempfile::tempdir().unwrap();
    let out = out_dir.path().join("backup.jwlibrary");
    std::fs::write(&out, b"an older file").unwrap();

    ud.export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();
    let members = zip_members(&out);
    let names: Vec<&str> = members.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        [
            "manifest.json",
            "userData.db",
            "default_thumbnail.png",
            "sub/clip.mp4"
        ]
    );
    assert_eq!(members[2].1, b"\x89PNG thumb");
    assert_eq!(members[3].1, vec![7u8; 70_000]);
    assert_eq!(dir_names(out_dir.path()), ["backup.jwlibrary"]);
}

#[test]
fn export_progress_is_fixed_and_holds_no_lock() {
    let env = Env::new();
    let ud = env.core().userdata();
    populate(&ud);
    let out_dir = tempfile::tempdir().unwrap();
    let seen = std::cell::RefCell::new(Vec::new());
    let progress = |done: u64, total: u64| {
        // Calling back into the user data here would deadlock if a lock were
        // held.
        assert_eq!(ud.tags().unwrap().len(), 1);
        seen.borrow_mut().push((done, total));
    };
    ud.export_backup(
        out_dir.path().join("b.jwlibrary"),
        &progress,
        &CancelToken::new(),
    )
    .unwrap();
    let seen = seen.into_inner();
    assert!(!seen.is_empty());
    let total = seen[0].1;
    assert!(seen.iter().all(|&(_, t)| t == total), "{seen:?}");
    assert!(seen.windows(2).all(|w| w[0].0 <= w[1].0), "{seen:?}");
    assert_eq!(seen.last(), Some(&(total, total)));
}

#[test]
fn cancelled_export_leaves_no_file() {
    let env = Env::new();
    let ud = env.core().userdata();
    populate(&ud);
    let out_dir = tempfile::tempdir().unwrap();
    let out = out_dir.path().join("b.jwlibrary");

    let cancel = CancelToken::new();
    cancel.cancel();
    let r = ud.export_backup(&out, &no_progress, &cancel);
    assert!(matches!(r, Err(CoreError::Cancelled)), "{r:?}");
    assert!(dir_names(out_dir.path()).is_empty());

    // Cancelled from inside the progress callback, at each step: nothing
    // is left behind, and a file already at the target is untouched.
    let steps = std::cell::Cell::new(0);
    ud.export_backup(
        out_dir.path().join("probe"),
        &|_, total| steps.set(total),
        &CancelToken::new(),
    )
    .unwrap();
    std::fs::remove_file(out_dir.path().join("probe")).unwrap();
    std::fs::write(&out, b"keep me").unwrap();
    assert!(steps.get() > 2, "{}", steps.get());
    for at in 1..steps.get() {
        let cancel = CancelToken::new();
        let progress = |done: u64, _: u64| {
            if done == at {
                cancel.cancel();
            }
        };
        let r = ud.export_backup(&out, &progress, &cancel);
        assert!(matches!(r, Err(CoreError::Cancelled)), "step {at}: {r:?}");
        assert_eq!(dir_names(out_dir.path()), ["b.jwlibrary"], "step {at}");
        assert_eq!(std::fs::read(&out).unwrap(), b"keep me");
    }
}

#[test]
fn export_to_a_missing_directory_is_io() {
    let env = Env::new();
    let ud = env.core().userdata();
    let out_dir = tempfile::tempdir().unwrap();
    let r = ud.export_backup(
        out_dir.path().join("missing/b.jwlibrary"),
        &no_progress,
        &CancelToken::new(),
    );
    assert!(matches!(r, Err(CoreError::Io(_))), "{r:?}");
}

// Import. The backups are synthetic: the pinned blank, filled with raw SQL
// the way JW Library fills it (tokens on every block, titles on locations),
// plus an `InputField` row and a table JW doesn't have, `ZzExtra`.

const SYNTHETIC: &str = "
    INSERT INTO Location (LocationId, BookNumber, ChapterNumber, DocumentId, Track,
        IssueTagNumber, KeySymbol, MepsLanguage, Type, Title) VALUES
        (1, NULL, NULL, 2026601, NULL, 20260800, 'w26', 0, 0, 'Study Article 1'),
        (2, NULL, NULL, 2026601, NULL, 20260800, 'w26', 1, 0, 'Artículo de estudio 1'),
        (3, 43, 3, NULL, NULL, 0, 'nwtsty', 0, 0, 'John 3'),
        (4, 43, 3, NULL, NULL, 0, 'nwtsty', 1, 0, 'Juan 3'),
        (5, NULL, NULL, NULL, NULL, 20260800, 'w26', 0, 1, 'The Watchtower'),
        (6, NULL, NULL, NULL, NULL, 0, 'nwtsty', 1, 1, 'Biblia');
    INSERT INTO UserMark (UserMarkId, ColorIndex, LocationId, StyleIndex, UserMarkGuid,
        Version) VALUES
        (1, 1, 1, 0, '0d2a6b8e-41a1-4c1b-9b7e-3f6f0b1c2d01', 1),
        (2, 3, 4, 0, '0d2a6b8e-41a1-4c1b-9b7e-3f6f0b1c2d02', 1),
        (3, 6, 2, 0, '0d2a6b8e-41a1-4c1b-9b7e-3f6f0b1c2d03', 1);
    INSERT INTO BlockRange (BlockType, Identifier, StartToken, EndToken, UserMarkId) VALUES
        (1, 3, 2, 30, 1), (1, 4, 0, 25, 1), (1, 5, 0, 7, 1),
        (2, 16, 0, 22, 2), (2, 17, 0, 14, 2),
        (1, 1, 0, 4, 3);
    INSERT INTO Note (NoteId, Guid, UserMarkId, LocationId, Title, Content, LastModified,
        Created, BlockType, BlockIdentifier) VALUES
        (1, '5b1e7c2a-0f3d-4e7a-8c11-2a9d3e4f5a01', 1, 1, 'On a highlight', 'Note text',
            '2026-09-01T10:00:00Z', '2026-09-01T09:00:00Z', 1, 3),
        (2, '5b1e7c2a-0f3d-4e7a-8c11-2a9d3e4f5a02', NULL, NULL, 'Free', 'Free text',
            '2026-09-02T10:00:00Z', '2026-09-02T10:00:00Z', 0, NULL),
        (3, '5b1e7c2a-0f3d-4e7a-8c11-2a9d3e4f5a03', NULL, 3, 'Verse', 'Juan',
            '2026-09-03T10:00:00Z', '2026-09-03T10:00:00Z', 2, 16);
    INSERT INTO Tag (TagId, Type, Name) VALUES (2, 1, 'Study');
    INSERT INTO TagMap (NoteId, LocationId, TagId, Position) VALUES
        (1, NULL, 2, 0), (3, NULL, 2, 1), (NULL, 6, 1, 0);
    INSERT INTO Bookmark (LocationId, PublicationLocationId, Slot, Title, Snippet,
        BlockType, BlockIdentifier) VALUES
        (1, 5, 0, 'Study Article 1', 'snippet', 1, 3),
        (4, 6, 2, 'Juan 3', NULL, 2, 16);
    INSERT INTO InputField (LocationId, TextTag, Value) VALUES (1, 'tt12', 'My answer');
    CREATE TABLE ZzExtra (Key TEXT NOT NULL, Data BLOB);
    INSERT INTO ZzExtra VALUES ('a', x'00ff10'), ('b', NULL);
";

/// What a backup of [`SYNTHETIC`] holds, as the typed reads count it.
const SYNTHETIC_SUMMARY: ImportSummary = ImportSummary {
    highlights: 3,
    notes: 3,
    tags: 1,
    bookmarks: 2,
    favorites: 1,
};

/// jwlManager's `downgrade_schema` (v16 → v14), the statements verbatim
/// (© 2026 Eryk J., jwlManager, MIT). Its first part, merging duplicate
/// non-Bible locations, is left out: [`SYNTHETIC`] has none.
const DOWNGRADE_V16: &str = "
    CREATE TABLE Location_new (
        LocationId     INTEGER NOT NULL PRIMARY KEY,
        BookNumber     INTEGER,
        ChapterNumber  INTEGER,
        DocumentId     INTEGER,
        Track          INTEGER,
        IssueTagNumber INTEGER NOT NULL DEFAULT 0,
        KeySymbol      TEXT,
        MepsLanguage   INTEGER,
        Type           INTEGER NOT NULL,
        Title          TEXT,
        UNIQUE (BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type),
        UNIQUE (KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type),
        CHECK ((Type = 0 AND
            ((DocumentId IS NOT NULL AND DocumentId != 0) OR
            (Track IS NOT NULL AND
            ((KeySymbol IS NOT NULL AND length(KeySymbol) > 0) OR
                (DocumentId IS NOT NULL AND DocumentId != 0))) OR
            (BookNumber IS NOT NULL AND BookNumber != 0 AND
            KeySymbol IS NOT NULL AND length(KeySymbol) > 0 AND
            (ChapterNumber IS NULL OR ChapterNumber = 0)) OR
            (ChapterNumber IS NOT NULL AND ChapterNumber != 0 AND
            BookNumber IS NOT NULL AND BookNumber != 0 AND
            KeySymbol IS NOT NULL AND length(KeySymbol) > 0))) OR
            Type != 0),
        CHECK ((Type = 1 AND
            (BookNumber IS NULL OR BookNumber = 0) AND
            (ChapterNumber IS NULL OR ChapterNumber = 0) AND
            (DocumentId IS NULL OR DocumentId = 0) AND
            KeySymbol IS NOT NULL AND length(KeySymbol) > 0 AND
            Track IS NULL) OR
            Type != 1),
        CHECK ((Type IN (2, 3) AND
            (BookNumber IS NULL OR BookNumber = 0) AND
            (ChapterNumber IS NULL OR ChapterNumber = 0)) OR
            Type NOT IN (2, 3)));
    INSERT INTO Location_new SELECT
        LocationId, BookNumber, ChapterNumber, DocumentId, Track,
        IssueTagNumber, KeySymbol, MepsLanguage, Type, Title
    FROM Location;
    DROP TABLE Location;
    ALTER TABLE Location_new RENAME TO Location;
    PRAGMA user_version = 14;
";

/// The pinned blank's thumbnail, a media member of real backups.
fn blank_thumbnail() -> Vec<u8> {
    let mut zip =
        zip::ZipArchive::new(std::fs::File::open(fixture("jwlmanager_blank_v16.zip")).unwrap())
            .unwrap();
    let mut bytes = Vec::new();
    zip.by_name("default_thumbnail.png")
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap();
    bytes
}

/// A synthetic backup: its database, manifest and other members, each of
/// which a test may spoil before writing it.
struct Backup {
    _dir: tempfile::TempDir,
    /// The database member's file.
    db: PathBuf,
    manifest: serde_json::Value,
    media: Vec<(String, Vec<u8>)>,
}

impl Backup {
    /// The blank filled with [`SYNTHETIC`], with its thumbnail.
    fn synthetic() -> Self {
        let (dir, db) = blank_db();
        Connection::open(&db)
            .unwrap()
            .execute_batch(SYNTHETIC)
            .unwrap();
        let mut b = Backup {
            _dir: dir,
            db,
            manifest: serde_json::Value::Null,
            media: vec![("default_thumbnail.png".into(), blank_thumbnail())],
        };
        b.seal();
        b
    }

    /// A copy of this backup, database rows (`LastModified` too) included.
    fn duplicate(&self) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("userData.db");
        std::fs::copy(&self.db, &db).unwrap();
        Backup {
            _dir: dir,
            db,
            manifest: self.manifest.clone(),
            media: self.media.clone(),
        }
    }

    /// Run `sql` on the database (foreign keys off), then
    /// [`seal`](Self::seal) it.
    fn alter(&mut self, sql: &str) {
        Connection::open(&self.db)
            .unwrap()
            .execute_batch(&format!("PRAGMA foreign_keys = OFF;\n{sql}"))
            .unwrap();
        self.seal();
    }

    /// Write the manifest JW would for the database as it now is.
    fn seal(&mut self) {
        let bytes = std::fs::read(&self.db).unwrap();
        self.manifest = serde_json::json!({
            "name": "Synthetic",
            "creationDate": "2026-10-28T06:54:00Z",
            "version": 1,
            "type": 0,
            "userDataBackup": {
                "lastModifiedDate": "2026-10-28T06:50:00Z",
                "deviceName": "Synthetic",
                "databaseName": "userData.db",
                "hash": sha256_hex(&bytes),
                "schemaVersion": user_version(&self.db),
            }
        });
    }

    fn write(&self, path: &Path) {
        self.write_with_manifest(path, Some(&serde_json::to_vec(&self.manifest).unwrap()));
    }

    fn write_with_manifest(&self, path: &Path, manifest: Option<&[u8]>) {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        if let Some(manifest) = manifest {
            zip.start_file("manifest.json", options).unwrap();
            zip.write_all(manifest).unwrap();
        }
        zip.start_file("userData.db", options).unwrap();
        zip.write_all(&std::fs::read(&self.db).unwrap()).unwrap();
        for (name, bytes) in &self.media {
            zip.start_file(name.as_str(), options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }
}

/// What an import could change in a data dir: the database's contents,
/// the media files, and the names in the dir.
type DataState = (
    Vec<(String, Vec<Vec<Value>>)>,
    Vec<(String, Vec<u8>)>,
    Vec<String>,
);

/// A core holding some data of its own, and a dir for backup files.
struct Existing {
    env: Env,
    core: Core,
    files: tempfile::TempDir,
}

impl Existing {
    fn new() -> Self {
        let env = Env::new();
        let core = env.core();
        populate(&core.userdata());
        let media = env.data.join("userData.media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("old.png"), b"old media").unwrap();
        Existing {
            env,
            core,
            files: tempfile::tempdir().unwrap(),
        }
    }

    fn ud(&self) -> UserData {
        self.core.userdata()
    }

    fn file(&self, name: &str) -> PathBuf {
        self.files.path().join(name)
    }

    fn state(&self) -> DataState {
        (
            contents(&self.env.userdata_db()),
            media_contents(&self.env.data.join("userData.media")),
            dir_names(&self.env.data),
        )
    }

    fn import(&self, path: &Path) -> Result<ImportSummary, CoreError> {
        self.ud()
            .import_backup(path, &no_progress, &CancelToken::new())
    }
}

/// The files under `dir`, relative, with their bytes; empty if it's missing.
fn media_contents(dir: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<(String, Vec<u8>)>) {
        for name in dir_names(dir) {
            let path = dir.join(&name);
            if path.is_dir() {
                walk(&path, &format!("{prefix}{name}/"), out);
            } else {
                out.push((format!("{prefix}{name}"), std::fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    if dir.is_dir() {
        walk(dir, "", &mut out);
    }
    out
}

/// How many rows `foreign_key_check` reports for the database at `path`.
fn fk_violations(path: &Path) -> usize {
    rows(&Connection::open(path).unwrap(), "PRAGMA foreign_key_check").len()
}

#[test]
fn import_replaces_the_data_with_the_backup() {
    let ex = Existing::new();
    let backup = Backup::synthetic();
    let file = ex.file("in.jwlibrary");
    backup.write(&file);
    let ud = ex.ud();
    assert_eq!(ex.import(&file).unwrap(), SYNTHETIC_SUMMARY);

    // The database is the backup's, exactly, plus Berean's (empty) tables;
    // the old one is kept.
    assert_eq!(jw_contents(&ex.env.userdata_db()), contents(&backup.db));
    assert_eq!(jw_schema(&ex.env.userdata_db()), schema(&backup.db));
    assert_eq!(
        media_contents(&ex.env.data.join("userData.media")),
        [("default_thumbnail.png".to_string(), blank_thumbnail())]
    );
    assert_eq!(
        media_contents(&ex.env.data.join("userData.prev.media")),
        [("old.png".to_string(), b"old media".to_vec())]
    );
    assert!(ex.env.data.join("userData.prev.db").is_file());
    assert!(!dir_names(&ex.env.data).iter().any(|n| n.starts_with('.')));

    // The typed reads see it.
    let hl = ud.highlights(W_E, &document(W_E, 2026601)).unwrap();
    assert_eq!(hl.len(), 1);
    assert_eq!(hl[0].id, "0d2a6b8e-41a1-4c1b-9b7e-3f6f0b1c2d01");
    assert_eq!(
        hl[0].range,
        range(
            paragraph(W_E, 2026601, 3),
            paragraph(W_E, 2026601, 5),
            (Some(2), Some(7))
        )
    );
    assert_eq!(hl[0].color, HighlightColor::Yellow);
    let es = ud.highlights(NWT_S, &chapter(NWT_S, 43, 3)).unwrap();
    assert_eq!(
        es[0].range,
        range(
            verse(NWT_S, 43, 3, 16),
            verse(NWT_S, 43, 3, 17),
            (Some(0), Some(14))
        )
    );
    assert_eq!(es[0].color, HighlightColor::Blue);
    assert_eq!(
        ud.highlights(W_S, &document(W_S, 2026601)).unwrap()[0].color,
        HighlightColor::Purple
    );
    let notes = ud.notes(&NoteFilter::default()).unwrap();
    assert_eq!(notes.len(), 3);
    assert_eq!(notes[0].title, "On a highlight");
    assert_eq!(notes[0].location, Some(paragraph(W_E, 2026601, 3)));
    assert_eq!(notes[0].highlight_id.as_deref(), Some(hl[0].id.as_str()));
    assert_eq!(notes[0].tag_ids, [2]);
    assert_eq!(notes[0].created, "2026-09-01T09:00:00Z");
    assert_eq!(notes[0].modified, "2026-09-01T10:00:00Z");
    assert_eq!(notes[1].location, None);
    assert_eq!(notes[2].location, Some(verse(NWT_E, 43, 3, 16)));
    assert_eq!(
        ud.tags().unwrap(),
        [Tag {
            id: 2,
            name: "Study".into()
        }]
    );
    assert_eq!(ud.favorites().unwrap(), [publication(NWT_S)]);
    assert_eq!(
        ud.bookmarks(W_E).unwrap(),
        [Bookmark {
            pub_key: W_E.into(),
            slot: 0,
            location: paragraph(W_E, 2026601, 3),
            title: "Study Article 1".into(),
            snippet: Some("snippet".into()),
        }]
    );
    assert_eq!(
        ud.bookmarks(NWT_S).unwrap()[0].location,
        verse(NWT_S, 43, 3, 16)
    );

    // Writes go to the new database, with its constraints.
    ud.add_tag("After").unwrap();
    assert!(is_invalid(ud.add_tag("Study")));
    assert_eq!(fk_violations(&ex.env.userdata_db()), 0);
}

#[test]
fn export_then_import_round_trips_every_table() {
    let ex = Existing::new();
    let backup = Backup::synthetic();
    let file = ex.file("in.jwlibrary");
    backup.write(&file);
    ex.import(&file).unwrap();
    // Highlights made here, with and without tokens, go through too.
    let made = [
        (Some(3), Some(9)),
        (None, None),
        (Some(4), None),
        (None, Some(2)),
    ]
    .map(|t| {
        ex.ud()
            .add_highlight(
                &range(paragraph(W_E, 9, 1), paragraph(W_E, 9, 3), t),
                HighlightColor::Green,
            )
            .unwrap()
    });
    let out = ex.file("out.jwlibrary");
    ex.ud()
        .export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();
    assert_eq!(
        zip_members(&out)[2],
        ("default_thumbnail.png".to_string(), blank_thumbnail())
    );

    let other = Existing::new();
    assert_eq!(
        other.import(&out).unwrap(),
        ImportSummary {
            highlights: SYNTHETIC_SUMMARY.highlights + 4,
            ..SYNTHETIC_SUMMARY
        }
    );
    let ours = contents(&ex.env.userdata_db());
    assert_eq!(contents(&other.env.userdata_db()), ours);
    for t in ["InputField", "LastModified", "ZzExtra", "android_metadata"] {
        let (_, rows) = ours.iter().find(|(name, _)| name == t).unwrap();
        assert!(!rows.is_empty(), "{t}");
    }
    // The same JW schema; `VACUUM INTO` lists it tables first.
    let sorted = |path: &Path| {
        let mut s = jw_schema(path);
        s.sort();
        s
    };
    assert_eq!(sorted(&other.env.userdata_db()), sorted(&backup.db));
    assert_eq!(
        media_contents(&other.env.data.join("userData.media")),
        [("default_thumbnail.png".to_string(), blank_thumbnail())]
    );
    assert_eq!(other.ud().highlights(W_E, &document(W_E, 9)).unwrap(), made);
}

#[test]
fn v14_backup_is_upgraded_to_v16() {
    let ex = Existing::new();
    let v16 = Backup::synthetic();
    // A copy, not a second fill: the fill stamps `LastModified` with the
    // time, which could tick between two.
    let mut v14 = v16.duplicate();
    v14.alter(DOWNGRADE_V16);
    assert_eq!(user_version(&v14.db), 14);
    assert_ne!(location_shape(&v14.db), location_shape(&v16.db));
    let file = ex.file("v14.jwlibrary");
    v14.write(&file);
    assert_eq!(ex.import(&file).unwrap(), SYNTHETIC_SUMMARY);

    let db = ex.env.userdata_db();
    assert_eq!(user_version(&db), 16);
    // Location has v16's columns and indexes; every row of every table
    // survives.
    let (_blank_dir, blank) = blank_db();
    assert_eq!(location_shape(&db), location_shape(&blank));
    assert_eq!(jw_contents(&db), contents(&v16.db));
    assert_eq!(fk_violations(&db), 0);
}

/// `Location`'s columns, and its indexes with their columns, uniqueness
/// and partial-ness.
type Shape = (Vec<Vec<Value>>, Vec<Vec<Value>>);

fn location_shape(path: &Path) -> Shape {
    let conn = Connection::open(path).unwrap();
    let columns = rows(
        &conn,
        "SELECT * FROM pragma_table_info('Location') ORDER BY cid",
    );
    let indexes = rows(
        &conn,
        "SELECT il.name, il.\"unique\", il.partial, ii.seqno, ii.name, ii.desc, ii.coll, ii.key \
         FROM pragma_index_list('Location') il, pragma_index_xinfo(il.name) ii \
         WHERE il.origin = 'c' ORDER BY il.name, ii.seqno",
    );
    (columns, indexes)
}

#[test]
fn bad_backups_are_rejected_without_touching_the_data() {
    let ex = Existing::new();
    let before = ex.state();
    let check = |what: &str, file: &Path, want: fn(&CoreError) -> bool| {
        let r = ex.import(file);
        assert!(r.as_ref().is_err_and(want), "{what}: {r:?}");
        assert_eq!(ex.state(), before, "{what}");
        assert!(!ex.env.data.join("userData.prev.db").exists(), "{what}");
    };
    let corrupt = |e: &CoreError| matches!(e, CoreError::Corrupt);
    let invalid = |e: &CoreError| matches!(e, CoreError::Invalid(_));
    let file = ex.file("bad.jwlibrary");

    std::fs::write(&file, b"PK\x03\x04 not really a zip").unwrap();
    check("corrupt zip", &file, corrupt);

    let good = Backup::synthetic();
    good.write_with_manifest(&file, None);
    check("missing manifest", &file, corrupt);

    let mut b = Backup::synthetic();
    b.manifest["userDataBackup"]["databaseName"] = "missing.db".into();
    b.write(&file);
    check("missing database", &file, corrupt);

    let mut b = Backup::synthetic();
    b.manifest["userDataBackup"]["hash"] = sha256_hex(b"something else").into();
    b.write(&file);
    check("wrong hash", &file, corrupt);

    good.write_with_manifest(&file, Some(b"{not json"));
    check("bad JSON", &file, invalid);
    good.write_with_manifest(&file, Some(br#"{"name": "x", "version": 1}"#));
    check("manifest missing fields", &file, invalid);

    let mut b = Backup::synthetic();
    b.manifest["userDataBackup"]["schemaVersion"] = 14.into();
    b.write(&file);
    check("schemaVersion mismatch", &file, corrupt);

    for v in [13, 15, 17] {
        let mut b = Backup::synthetic();
        b.alter(&format!("PRAGMA user_version = {v};"));
        b.write(&file);
        let r = ex.import(&file);
        let msg = match &r {
            Err(CoreError::Invalid(m)) => m.clone(),
            other => panic!("version {v}: {other:?}"),
        };
        match v {
            13 => assert!(msg.contains("re-export from JW Library"), "{msg}"),
            17 => assert!(msg.contains("update Berean"), "{msg}"),
            _ => {}
        }
        assert_eq!(ex.state(), before, "version {v}");
    }

    for name in ["../evil.png", "/abs/evil.png"] {
        let mut b = Backup::synthetic();
        b.media.push((name.into(), b"x".to_vec()));
        b.write(&file);
        check(name, &file, corrupt);
        assert!(!ex.env.data.parent().unwrap().join("evil.png").exists());
    }

    let mut b = Backup::synthetic();
    b.alter("INSERT INTO BlockRange (BlockType, Identifier, UserMarkId) VALUES (1, 1, 999);");
    b.write(&file);
    check("foreign key", &file, corrupt);

    let mut b = Backup::synthetic();
    b.alter(
        "CREATE INDEX IX_ZzExtra ON ZzExtra (Key);
         PRAGMA writable_schema = ON;
         UPDATE sqlite_master SET sql = 'CREATE INDEX IX_ZzExtra ON ZzExtra (Data)'
             WHERE name = 'IX_ZzExtra';",
    );
    let integrity = rows(&Connection::open(&b.db).unwrap(), "PRAGMA integrity_check");
    assert_ne!(integrity, [vec![Value::Text("ok".into())]]);
    b.write(&file);
    check("integrity", &file, corrupt);

    let mut b = Backup::synthetic();
    let junk = b"not a database at all, but hashed right";
    std::fs::write(&b.db, junk).unwrap();
    b.manifest["userDataBackup"]["hash"] = sha256_hex(junk).into();
    b.write(&file);
    check("not a database", &file, corrupt);

    let mut b = Backup::synthetic();
    b.alter("DROP TABLE Bookmark;");
    b.write(&file);
    check("missing a JW table", &file, corrupt);

    // Still usable, and a good backup still imports.
    good.write(&file);
    assert_eq!(ex.import(&file).unwrap(), SYNTHETIC_SUMMARY);
}

#[test]
fn undo_restores_the_data_before_the_import() {
    let ex = Existing::new();
    let ud = ex.ud();
    assert!(!ud.undo_import().unwrap());
    let before = ex.state();
    let file = ex.file("in.jwlibrary");
    Backup::synthetic().write(&file);
    ex.import(&file).unwrap();
    assert_ne!(ex.state(), before);

    assert!(ud.undo_import().unwrap());
    assert_eq!(ex.state(), before);
    assert_eq!(ud.tags().unwrap()[0].name, "Study");
    assert_eq!(ud.notes(&NoteFilter::default()).unwrap().len(), 2);
    // One undo only.
    assert!(!ud.undo_import().unwrap());
    assert_eq!(ex.state(), before);

    // Two imports: undo goes back to the first one's data.
    ex.import(&file).unwrap();
    let after_first = ex.state();
    let mut second = Backup::synthetic();
    second.alter("DELETE FROM ZzExtra;");
    second.media.clear();
    second.write(&file);
    ex.import(&file).unwrap();
    assert!(media_contents(&ex.env.data.join("userData.media")).is_empty());
    assert!(ud.undo_import().unwrap());
    // The first import's data and media; the undo used up its prev.
    assert_eq!(ex.state().0, after_first.0);
    assert_eq!(ex.state().1, after_first.1);
    assert!(!ex.env.data.join("userData.prev.db").exists());
    assert!(!ex.env.data.join("userData.prev.media").exists());
    assert!(!ud.undo_import().unwrap());
}

#[test]
fn import_progress_is_fixed_and_holds_no_lock() {
    let ex = Existing::new();
    let ud = ex.ud();
    let file = ex.file("in.jwlibrary");
    Backup::synthetic().write(&file);
    let seen = std::cell::RefCell::new(Vec::new());
    let progress = |done: u64, total: u64| {
        // Would deadlock if a lock were held while reporting.
        ud.tags().unwrap();
        seen.borrow_mut().push((done, total));
    };
    ud.import_backup(&file, &progress, &CancelToken::new())
        .unwrap();
    let seen = seen.into_inner();
    let total = seen[0].1;
    assert!(total > 2);
    assert!(seen.iter().all(|&(_, t)| t == total), "{seen:?}");
    assert!(seen.windows(2).all(|w| w[0].0 <= w[1].0), "{seen:?}");
    assert_eq!(seen.last(), Some(&(total, total)));
}

#[test]
fn cancelled_import_leaves_the_data() {
    let ex = Existing::new();
    let ud = ex.ud();
    let file = ex.file("in.jwlibrary");
    Backup::synthetic().write(&file);
    let before = ex.state();

    let cancel = CancelToken::new();
    cancel.cancel();
    let r = ud.import_backup(&file, &no_progress, &cancel);
    assert!(matches!(r, Err(CoreError::Cancelled)), "{r:?}");
    assert_eq!(ex.state(), before);

    // Cancelled from the progress callback after each step but the last:
    // nothing changes, and nothing is left behind.
    let total = std::cell::Cell::new(0);
    Existing::new()
        .ud()
        .import_backup(&file, &|_, t| total.set(t), &CancelToken::new())
        .unwrap();
    assert!(total.get() > 2);
    for at in 1..total.get() {
        let cancel = CancelToken::new();
        let progress = |done: u64, _: u64| {
            if done == at {
                cancel.cancel();
            }
        };
        let r = ud.import_backup(&file, &progress, &cancel);
        assert!(matches!(r, Err(CoreError::Cancelled)), "step {at}: {r:?}");
        assert_eq!(ex.state(), before, "step {at}");
    }
    // Once the swap has been made, cancelling no longer undoes it.
    let cancel = CancelToken::new();
    let progress = |done: u64, total: u64| {
        if done == total {
            cancel.cancel();
        }
    };
    assert_eq!(
        ud.import_backup(&file, &progress, &cancel).unwrap(),
        SYNTHETIC_SUMMARY
    );
}

/// What [`populate`] makes, as the typed reads count it.
const POPULATED_SUMMARY: ImportSummary = ImportSummary {
    highlights: 2,
    notes: 2,
    tags: 1,
    bookmarks: 1,
    favorites: 1,
};

impl Existing {
    fn preview(&self, path: &Path) -> Result<ImportPreview, CoreError> {
        self.ud()
            .import_preview(path, &no_progress, &CancelToken::new())
    }

    /// The bytes of `userData.db`, for checking a call left it alone.
    fn db_bytes(&self) -> Vec<u8> {
        std::fs::read(self.env.userdata_db()).unwrap()
    }
}

#[test]
fn import_preview_counts_the_backup_and_the_current_data() {
    let ex = Existing::new();
    let ud = ex.ud();
    let top = ud.create_folder("Gospel of John", None).unwrap();
    let sub = ud.create_folder("Signs", Some(top.id)).unwrap();
    ud.create_folder("Psalms", None).unwrap();
    let filed = ud.add_note("Cana", "", None, None, Some(sub.id)).unwrap();
    let notes = ud.notes(&NoteFilter::default()).unwrap();
    ud.set_note_folder(&notes[0].id, Some(top.id)).unwrap();
    let file = ex.file("in.jwlibrary");
    Backup::synthetic().write(&file);
    let before = ex.state();
    let bytes = ex.db_bytes();

    let preview = ex.preview(&file).unwrap();
    assert_eq!(
        preview,
        ImportPreview {
            backup: SYNTHETIC_SUMMARY,
            current: ImportSummary {
                notes: POPULATED_SUMMARY.notes + 1,
                ..POPULATED_SUMMARY
            },
            folders: 3,
            filed_notes: 2,
            device_name: "Synthetic".into(),
            created: "2026-10-28T06:54:00Z".into(),
        }
    );
    // Nothing changed: the database to the byte, the media, and the data
    // dir (no staging dir left, no undo copy).
    assert_eq!(ex.db_bytes(), bytes);
    assert_eq!(ex.state(), before);
    assert!(!dir_names(&ex.env.data).iter().any(|n| n.starts_with('.')));
    assert!(!ud.undo_import().unwrap());
    assert_eq!(ud.folders().unwrap().len(), 3);

    // The import that follows brings what the preview said.
    assert_eq!(ex.import(&file).unwrap(), preview.backup);
    // A preview after it sees the imported data as current, with no
    // folders; the undo copy is untouched by it.
    let again = ex.preview(&file).unwrap();
    assert_eq!(again.current, SYNTHETIC_SUMMARY);
    assert_eq!((again.folders, again.filed_notes), (0, 0));
    assert!(ud.undo_import().unwrap());
    let back = ud.notes(&NoteFilter::default()).unwrap();
    let back = back.iter().find(|n| n.id == filed.id).unwrap();
    assert_eq!(back.folder_id, Some(sub.id));

    // A v14 backup previews as its upgraded self, and a Berean export
    // carries Berean's device name and its own creation date.
    let mut v14 = Backup::synthetic();
    v14.alter(DOWNGRADE_V16);
    v14.write(&file);
    assert_eq!(ex.preview(&file).unwrap().backup, SYNTHETIC_SUMMARY);
    let out = ex.file("out.jwlibrary");
    ud.export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();
    let exported = ex.preview(&out).unwrap();
    assert_eq!(exported.device_name, "Berean");
    assert!(is_iso_utc(&exported.created), "{}", exported.created);
    assert_eq!(exported.backup, exported.current);
}

#[test]
fn import_preview_rejects_what_import_rejects() {
    let ex = Existing::new();
    let before = ex.state();
    let bytes = ex.db_bytes();
    let file = ex.file("bad.jwlibrary");
    let check = |what: &str, want: fn(&CoreError) -> bool| {
        let r = ex.preview(&file);
        assert!(r.as_ref().is_err_and(want), "{what}: {r:?}");
        // Import agrees.
        let r = ex.import(&file);
        assert!(r.as_ref().is_err_and(want), "{what} (import): {r:?}");
        assert_eq!(ex.state(), before, "{what}");
        assert_eq!(ex.db_bytes(), bytes, "{what}");
    };
    let corrupt = |e: &CoreError| matches!(e, CoreError::Corrupt);
    let invalid = |e: &CoreError| matches!(e, CoreError::Invalid(_));

    std::fs::write(&file, b"PK\x03\x04 not really a zip").unwrap();
    check("corrupt zip", corrupt);

    let mut b = Backup::synthetic();
    b.manifest["userDataBackup"]["hash"] = sha256_hex(b"something else").into();
    b.write(&file);
    check("wrong hash", corrupt);

    Backup::synthetic().write_with_manifest(&file, Some(b"{not json"));
    check("bad JSON", invalid);

    let mut b = Backup::synthetic();
    b.alter("PRAGMA user_version = 17;");
    b.write(&file);
    check("v17", invalid);

    let mut b = Backup::synthetic();
    b.alter("INSERT INTO BlockRange (BlockType, Identifier, UserMarkId) VALUES (1, 1, 999);");
    b.write(&file);
    check("foreign key", corrupt);

    let r = ex.preview(&ex.file("missing.jwlibrary"));
    assert!(matches!(r, Err(CoreError::Io(_))), "{r:?}");
    assert_eq!(ex.state(), before);
}

#[test]
fn import_preview_progress_holds_no_lock_and_honours_cancel() {
    let ex = Existing::new();
    let ud = ex.ud();
    ud.create_folder("Kept", None).unwrap();
    let file = ex.file("in.jwlibrary");
    Backup::synthetic().write(&file);
    let before = ex.state();

    let seen = std::cell::RefCell::new(Vec::new());
    let progress = |done: u64, total: u64| {
        // Would deadlock if a lock were held while reporting.
        assert_eq!(ud.folders().unwrap().len(), 1);
        ud.tags().unwrap();
        seen.borrow_mut().push((done, total));
    };
    ud.import_preview(&file, &progress, &CancelToken::new())
        .unwrap();
    let seen = seen.into_inner();
    let total = seen[0].1;
    // The import's steps but the swap.
    let import_total = std::cell::Cell::new(0);
    Existing::new()
        .ud()
        .import_backup(&file, &|_, t| import_total.set(t), &CancelToken::new())
        .unwrap();
    assert_eq!(total, import_total.get() - 1);
    assert_eq!(
        seen,
        (1..=total).map(|d| (d, total)).collect::<Vec<_>>(),
        "{seen:?}"
    );

    // Cancelled up front, or from the callback after each step but the
    // last: `Cancelled`, and nothing changes or is left behind.
    let cancel = CancelToken::new();
    cancel.cancel();
    let r = ud.import_preview(&file, &no_progress, &cancel);
    assert!(matches!(r, Err(CoreError::Cancelled)), "{r:?}");
    assert_eq!(ex.state(), before);
    for at in 1..total {
        let cancel = CancelToken::new();
        let progress = |done: u64, _: u64| {
            if done == at {
                cancel.cancel();
            }
        };
        let r = ud.import_preview(&file, &progress, &cancel);
        assert!(matches!(r, Err(CoreError::Cancelled)), "step {at}: {r:?}");
        assert_eq!(ex.state(), before, "step {at}");
    }
}

/// Every Berean table (folders, Studyspace), sorted.
const BEREAN_TABLES: [&str; 5] = [
    "BereanCanvasItem",
    "BereanFolder",
    "BereanNoteFolder",
    "BereanStudyspace",
    "BereanWorkspace",
];

/// The Berean tables in the database at `path`, by name.
fn berean_tables(path: &Path) -> Vec<String> {
    let mut names: Vec<String> = schema(path)
        .into_iter()
        .filter(|e| e.0 == "table" && e.1.starts_with("Berean"))
        .map(|e| e.1)
        .collect();
    names.sort();
    names
}

#[test]
fn folder_tables_are_added_to_an_existing_jw_db() {
    // A JW file with no Berean tables, as a JW device would have it.
    let env = Env::new();
    std::fs::create_dir_all(&env.data).unwrap();
    let (_blank_dir, blank) = blank_db();
    std::fs::copy(&blank, env.userdata_db()).unwrap();
    assert!(berean_tables(&env.userdata_db()).is_empty());

    let ud = env.core().userdata();
    assert_eq!(berean_tables(&env.userdata_db()), BEREAN_TABLES);
    // JW's schema version and tables are untouched.
    assert_eq!(user_version(&env.userdata_db()), 16);
    assert_eq!(jw_schema(&env.userdata_db()), schema(&blank));
    assert_eq!(jw_contents(&env.userdata_db()), contents(&blank));

    // Reopening with folders keeps them (`IF NOT EXISTS`).
    let f = ud.create_folder("Kept", None).unwrap();
    drop(ud);
    assert_eq!(env.core().userdata().folders().unwrap(), [f]);
    assert_eq!(user_version(&env.userdata_db()), 16);
}

#[test]
fn import_clears_folders_and_undo_brings_them_back() {
    let ex = Existing::new();
    let ud = ex.ud();
    let top = ud.create_folder("Gospel of John", None).unwrap();
    let sub = ud.create_folder("Signs", Some(top.id)).unwrap();
    let note = ud.add_note("Cana", "", None, None, Some(sub.id)).unwrap();
    let folders = ud.folders().unwrap();
    assert_eq!(folders.len(), 2);

    let file = ex.file("in.jwlibrary");
    Backup::synthetic().write(&file);
    ex.import(&file).unwrap();
    // The JW database has no folders: the tables are there again, empty.
    assert_eq!(berean_tables(&ex.env.userdata_db()), BEREAN_TABLES);
    assert!(ud.folders().unwrap().is_empty());
    assert!(ud
        .notes(&NoteFilter::default())
        .unwrap()
        .iter()
        .all(|n| n.folder_id.is_none()));
    assert_eq!(user_version(&ex.env.userdata_db()), 16);
    // And usable.
    let made = ud.create_folder("After import", None).unwrap();
    assert_eq!(made.position, 0);

    // Undo puts the old file back, folders and filings included.
    assert!(ud.undo_import().unwrap());
    assert_eq!(ud.folders().unwrap(), folders);
    let read = ud.notes(&NoteFilter::default()).unwrap();
    let back = read.iter().find(|n| n.id == note.id).unwrap();
    assert_eq!(back.folder_id, Some(sub.id));
}

#[test]
fn export_still_works_with_folders() {
    let env = Env::new();
    let ud = env.core().userdata();
    populate(&ud);
    let f = ud.create_folder("Folder", None).unwrap();
    ud.add_note("Filed", "", None, None, Some(f.id)).unwrap();
    let out_dir = tempfile::tempdir().unwrap();
    let out = out_dir.path().join("backup.jwlibrary");
    ud.export_backup(&out, &no_progress, &CancelToken::new())
        .unwrap();
    let members = zip_members(&out);
    assert_eq!(members[1].0, "userData.db");
    // It imports back elsewhere with every note.
    let other = Existing::new();
    let summary = other.import(&out).unwrap();
    assert_eq!(summary.notes, 3);
}
