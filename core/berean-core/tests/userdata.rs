//! User data (`userData.db`) and `.jwlibrary` backups. There is no real user
//! export to test against: the backups here are synthetic, built in code
//! from the pinned jwlManager blank v16 database (`jwlmanager_blank_v16.zip`,
//! fetched by `core/scripts/fetch-fixtures.sh`).

mod common;

use std::io::Read;
use std::path::{Path, PathBuf};

use berean_core::reader::{Location, LocationSpan};
use berean_core::userdata::{
    Bookmark, Highlight, HighlightColor, NoteFilter, Tag, TextRange, UserData,
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
        .add_note("On it", "text", Some(&paragraph(W_E, 7, 1)), Some(&h.id))
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
    assert!(is_not_found(ud.add_note("x", "y", None, Some(&h.id))));
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
        .add_note("t", "c", Some(&document(W_E, 8)), None)
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
    let free = ud.add_note("Free", "standing", None, None).unwrap();
    assert_eq!(free.location, None);
    assert!(
        is_iso_utc(&free.created) && is_iso_utc(&free.modified),
        "{free:?}"
    );
    assert!(is_v4_uuid(&free.id));
    let in_doc = ud
        .add_note("Doc", "", Some(&document(W_E, 7)), None)
        .unwrap();
    let in_para = ud
        .add_note("Para", "p", Some(&paragraph(W_E, 7, 4)), None)
        .unwrap();
    let mut v = verse(NWT_E, 43, 3, 16);
    v.doc_id = Some(1001070143);
    let in_verse = ud.add_note("Verse", "v", Some(&v), None).unwrap();
    assert_eq!(in_verse.location, Some(verse(NWT_E, 43, 3, 16)));
    let in_es = ud
        .add_note("Versículo", "v", Some(&verse(NWT_S, 43, 3, 16)), None)
        .unwrap();
    let ids = |f: NoteFilter| -> Vec<String> {
        ud.notes(&f).unwrap().into_iter().map(|n| n.id).collect()
    };
    let at = |loc: Location| NoteFilter {
        location: Some(loc),
        tag_id: None,
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
        location: None,
        tag_id: Some(tag.id),
    };
    assert_eq!(
        ids(tagged.clone()),
        [in_para.id.as_str(), in_verse.id.as_str()]
    );
    assert_eq!(
        ids(NoteFilter {
            location: Some(document(W_E, 7)),
            ..tagged
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

    let n1 = ud.add_note("1", "", None, None).unwrap();
    let n2 = ud.add_note("2", "", None, None).unwrap();
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
        .add_note("On it", "text", Some(&paragraph(W_E, 7, 2)), Some(&h.id))
        .unwrap();
    let t = ud.add_tag("Study").unwrap();
    ud.tag_note(&n.id, t.id).unwrap();
    ud.add_note("Free", "", None, None).unwrap();
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

    // The database is the live one: same schema, user_version and rows.
    let copy_dir = tempfile::tempdir().unwrap();
    let copy = copy_dir.path().join("userData.db");
    std::fs::write(&copy, db).unwrap();
    assert_eq!(user_version(&copy), 16);
    assert_eq!(schema(&copy), schema(&env.userdata_db()));
    assert_eq!(contents(&copy), contents(&env.userdata_db()));
    let (_blank_dir, blank) = blank_db();
    assert_eq!(schema(&copy), schema(&blank));
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
