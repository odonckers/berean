//! User data: notes, highlights, tags, favorites and bookmarks keyed by
//! location, plus `.jwlibrary` backup export/import.
//!
//! # Storage
//!
//! The data lives in its own SQLite file, `<data_dir>/userData.db`, in JW
//! Library's own v16 schema (see docs/design/userdata.md, model A), so a
//! backup is close to a copy of the file and round-trips losslessly, tables
//! and columns Berean doesn't surface included. A missing file is created
//! from the vendored DDL in `userdata_v16.sql`. Its `PRAGMA user_version` is
//! JW's schema version (16), not our migration counter: this file is never
//! run through the core DB's migrations.
//!
//! # Locations
//!
//! A [`Location`] maps to a JW `Location` row plus, for a paragraph or verse,
//! a block (`BlockType`, `BlockIdentifier`/`Identifier`):
//!
//! - a document paragraph: `Location{Type 0, DocumentId}` + block (1,
//!   paragraph);
//! - a Bible verse: `Location{Type 0, BookNumber, ChapterNumber, DocumentId
//!   NULL}` + block (2, verse). Our Bible `doc_id` is dropped, so a Bible
//!   location reads back with `doc_id: None`;
//! - a document, Bible chapter or Bible book: the same row with no block;
//! - a whole publication (no document, book, chapter, verse or paragraph):
//!   `Location{Type 1}`.
//!
//! `KeySymbol`, `MepsLanguage` and `IssueTagNumber` are the parts of the
//! `pub_key`. Rows are found by those columns (and created when missing);
//! rows with no equivalent here (audio/video `Track`, `Specialty`, `Edition`)
//! are skipped by every read, but stay in the file.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};

use crate::library::{format_pub_key, parse_pub_key};
use crate::reader::{Location, LocationSpan};
use crate::{CoreError, Inner};

/// The file name of the user-data database in the data dir; also the
/// database name a backup manifest gives by default.
pub(crate) const DB_FILE: &str = "userData.db";

/// JW Library's v16 user-data schema, with its initial rows; see the file's
/// header for where it comes from.
const SCHEMA_V16: &str = include_str!("userdata_v16.sql");

/// The path of the user-data database under `data_dir`.
pub(crate) fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE)
}

/// Open the user-data database under `data_dir`, first creating it from the
/// vendored v16 DDL if it is missing. The new file is built under a
/// temporary name and renamed into place, so a failed creation leaves no
/// half-made database behind. Foreign keys are enforced on the connection.
/// A file that isn't a database => `Corrupt`.
pub(crate) fn open(data_dir: &Path) -> Result<Connection, CoreError> {
    let path = db_path(data_dir);
    if !path.exists() {
        let tmp = tempfile::Builder::new()
            .prefix(".userData.")
            .suffix(".db")
            .tempfile_in(data_dir)?;
        {
            let conn = Connection::open(tmp.path())?;
            conn.execute_batch(&format!("BEGIN;\n{SCHEMA_V16}\nCOMMIT;"))?;
        }
        tmp.persist(&path)
            .map_err(|e| CoreError::Io(e.to_string()))?;
    }
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    // SQLite opens lazily: read the schema so a damaged file fails here, as
    // `Corrupt`, rather than on the first call that uses it.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
    Ok(conn)
}

/// A highlight's color, in JW's `ColorIndex` order (1..=6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HighlightColor {
    Yellow,
    Green,
    Blue,
    Pink,
    Orange,
    Purple,
}

impl HighlightColor {
    const ALL: [HighlightColor; 6] = [
        HighlightColor::Yellow,
        HighlightColor::Green,
        HighlightColor::Blue,
        HighlightColor::Pink,
        HighlightColor::Orange,
        HighlightColor::Purple,
    ];

    fn index(self) -> i64 {
        self as i64 + 1
    }

    /// `None` for a `ColorIndex` outside 1..=6 (0 is JW's "no color").
    fn from_index(index: i64) -> Option<Self> {
        let i = usize::try_from(index.checked_sub(1)?).ok()?;
        Self::ALL.get(i).copied()
    }
}

/// A highlighted extent: `span` names whole paragraphs or verses of one
/// document or Bible chapter; `start_token` applies to `span.start`'s block
/// and `end_token` to `span.end`'s (JW's word-token indexes), `None` meaning
/// the whole block. Blocks in between are whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextRange {
    pub span: LocationSpan,
    pub start_token: Option<u32>,
    pub end_token: Option<u32>,
}

/// One highlight; `id` is JW's `UserMarkGuid`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Highlight {
    pub id: String,
    pub range: TextRange,
    pub color: HighlightColor,
}

/// One note; `id` is JW's `Guid`. `created` and `modified` are ISO-8601 UTC
/// (`2026-10-28T06:54:00Z`), as JW stores them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    /// `None` for a free-standing note.
    pub location: Option<Location>,
    /// The highlight the note is attached to, if any.
    pub highlight_id: Option<String>,
    /// The user tags on the note, by id.
    pub tag_ids: Vec<i64>,
    pub created: String,
    pub modified: String,
}

/// Which notes [`UserData::notes`] lists; every field set must match.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NoteFilter {
    /// Notes at this location or inside it: a document's include its
    /// paragraphs', a chapter's its verses', a publication's all of its own.
    pub location: Option<Location>,
    /// Notes with this tag.
    pub tag_id: Option<i64>,
}

/// A user tag. Favorites is JW's built-in tag and has its own calls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

/// One bookmark: a publication has ten slots, 0..=9.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bookmark {
    pub pub_key: String,
    pub slot: u8,
    pub location: Location,
    pub title: String,
    pub snippet: Option<String>,
}

/// What an import brought in, counted with the typed reads' rules.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ImportSummary {
    pub highlights: u64,
    pub notes: u64,
    pub tags: u64,
    pub bookmarks: u64,
    pub favorites: u64,
}

/// The highest bookmark slot: JW gives each publication ten.
const MAX_SLOT: u8 = 9;

/// A version 4 UUID from `randomblob(16)`, as an SQL expression.
const NEW_GUID: &str = "(SELECT substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' \
     || substr(h, 14, 3) || '-' \
     || substr('89ab', instr('0123456789abcdef', substr(h, 17, 1)) % 4 + 1, 1) \
     || substr(h, 18, 3) || '-' || substr(h, 21, 12) \
     FROM (SELECT lower(hex(randomblob(16))) AS h))";

/// The current time as JW stores it, as an SQL expression.
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

/// The `Location` columns [`read_place`] reads, for the alias `l`.
const LOC_COLS: &str = "l.Type, l.KeySymbol, l.MepsLanguage, l.IssueTagNumber, l.DocumentId, \
     l.BookNumber, l.ChapterNumber, l.Track, l.Specialty, l.Edition";

/// A `Location` row we can map: a publication, and what in it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Place {
    symbol: String,
    meps_language: u32,
    issue_tag: u32,
    kind: PlaceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlaceKind {
    Publication,
    Document(i64),
    Book(u32),
    Chapter(u32, u32),
}

/// A paragraph or verse within a [`Place`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Block {
    Paragraph(u32),
    Verse(u32),
}

impl Block {
    /// JW's (`BlockType`, identifier).
    fn columns(self) -> (i64, u32) {
        match self {
            Block::Paragraph(p) => (1, p),
            Block::Verse(v) => (2, v),
        }
    }
}

/// `(BlockType, BlockIdentifier)` for an optional block: (0, NULL) for none.
fn block_columns(block: Option<Block>) -> (i64, Option<u32>) {
    match block {
        Some(b) => {
            let (t, id) = b.columns();
            (t, Some(id))
        }
        None => (0, None),
    }
}

impl Place {
    fn publication(pub_key: &str) -> Result<Self, CoreError> {
        let (symbol, meps_language, issue_tag) = parse_pub_key(pub_key)?;
        Ok(Place {
            symbol: symbol.to_string(),
            meps_language,
            issue_tag,
            kind: PlaceKind::Publication,
        })
    }

    fn pub_key(&self) -> String {
        format_pub_key(&self.symbol, self.meps_language, self.issue_tag)
    }

    /// Our location for this place and an optional block in it.
    fn location(&self, block: Option<Block>) -> Location {
        let mut loc = Location {
            pub_key: self.pub_key(),
            doc_id: None,
            book: None,
            chapter: None,
            verse: None,
            paragraph: None,
        };
        match self.kind {
            PlaceKind::Publication => {}
            PlaceKind::Document(d) => loc.doc_id = Some(d),
            PlaceKind::Book(b) => loc.book = Some(b),
            PlaceKind::Chapter(b, c) => {
                loc.book = Some(b);
                loc.chapter = Some(c);
            }
        }
        match block {
            Some(Block::Paragraph(p)) => loc.paragraph = Some(p),
            Some(Block::Verse(v)) => loc.verse = Some(v),
            None => {}
        }
        loc
    }

    /// The values `?1..=?7` of [`place_match`].
    fn values(&self) -> Vec<Value> {
        let (ty, doc, book, chapter) = match self.kind {
            PlaceKind::Publication => (1, 0, 0, 0),
            PlaceKind::Document(d) => (0, d, 0, 0),
            PlaceKind::Book(b) => (0, 0, b, 0),
            PlaceKind::Chapter(b, c) => (0, 0, b, c),
        };
        vec![
            Value::Integer(ty),
            Value::Text(self.symbol.clone()),
            Value::Integer(self.meps_language.into()),
            Value::Integer(self.issue_tag.into()),
            Value::Integer(doc),
            Value::Integer(book.into()),
            Value::Integer(chapter.into()),
        ]
    }

    /// The place's own block kind, for a highlight in it.
    fn highlight_block_type(&self) -> Option<i64> {
        match self.kind {
            PlaceKind::Document(_) => Some(1),
            PlaceKind::Chapter(..) => Some(2),
            _ => None,
        }
    }
}

/// An SQL condition matching the `Location` rows (alias `a`) of the place
/// whose [`Place::values`] are bound to `?1..=?7`. A Bible row matches
/// whatever its `DocumentId`, since reads drop it.
fn place_match(a: &str) -> String {
    format!(
        "{a}.Type = ?1 AND {a}.KeySymbol = ?2 AND {a}.MepsLanguage = ?3 \
         AND {a}.IssueTagNumber = ?4 AND (?6 != 0 OR COALESCE({a}.DocumentId, 0) = ?5) \
         AND COALESCE({a}.BookNumber, 0) = ?6 AND COALESCE({a}.ChapterNumber, 0) = ?7 \
         AND {a}.Track IS NULL AND COALESCE({a}.Specialty, '') = '' \
         AND COALESCE({a}.Edition, '') = ''"
    )
}

/// Split one of our locations into a place and an optional block. A
/// malformed key, a verse without a chapter, a chapter without a book, or a
/// paragraph outside a document => `Invalid`.
fn split(loc: &Location) -> Result<(Place, Option<Block>), CoreError> {
    let mut place = Place::publication(&loc.pub_key)?;
    let invalid = |what: &str| Err(CoreError::Invalid(format!("{what}: {loc:?}")));
    let block = match (loc.book, loc.chapter, loc.verse, loc.paragraph) {
        (Some(b), chapter, verse, None) => {
            if b == 0 || chapter == Some(0) {
                return invalid("book and chapter numbers start at 1");
            }
            match (chapter, verse) {
                (Some(c), v) => {
                    place.kind = PlaceKind::Chapter(b, c);
                    v.map(Block::Verse)
                }
                (None, None) => {
                    place.kind = PlaceKind::Book(b);
                    None
                }
                (None, Some(_)) => return invalid("a verse needs a chapter"),
            }
        }
        (Some(_), _, _, Some(_)) => return invalid("a Bible location has verses, not paragraphs"),
        (None, None, None, paragraph) => match loc.doc_id {
            Some(d) => {
                place.kind = PlaceKind::Document(d);
                paragraph.map(Block::Paragraph)
            }
            None if paragraph.is_some() => return invalid("a paragraph needs a document"),
            None => None,
        },
        (None, _, _, _) => return invalid("a chapter or verse needs a book"),
    };
    Ok((place, block))
}

/// Read the [`LOC_COLS`] starting at column `at`; `None` for a row we can't
/// map (or a missing one, after a `LEFT JOIN`).
fn read_place(r: &Row, at: usize) -> rusqlite::Result<Option<Place>> {
    let ty: Option<i64> = r.get(at)?;
    let symbol: Option<String> = r.get(at + 1)?;
    let meps: Option<i64> = r.get(at + 2)?;
    let issue: Option<i64> = r.get(at + 3)?;
    let nonzero = |i: usize| -> rusqlite::Result<Option<i64>> {
        Ok(r.get::<_, Option<i64>>(at + i)?.filter(|&n| n != 0))
    };
    let (doc, book, chapter) = (nonzero(4)?, nonzero(5)?, nonzero(6)?);
    let track: Option<i64> = r.get(at + 7)?;
    let specialty: Option<String> = r.get(at + 8)?;
    let edition: Option<String> = r.get(at + 9)?;

    let (Some(ty), Some(symbol), Some(meps), Some(issue)) = (ty, symbol, meps, issue) else {
        return Ok(None);
    };
    let (Some(meps_language), Some(issue_tag)) = (to_u32(meps), to_u32(issue)) else {
        return Ok(None);
    };
    let extra = |s: &Option<String>| s.as_deref().is_some_and(|s| !s.is_empty());
    if symbol.is_empty() || track.is_some() || extra(&specialty) || extra(&edition) {
        return Ok(None);
    }
    let kind = match (ty, book, chapter, doc) {
        (1, _, _, _) => PlaceKind::Publication,
        (0, Some(b), Some(c), _) => match (to_u32(b), to_u32(c)) {
            (Some(b), Some(c)) => PlaceKind::Chapter(b, c),
            _ => return Ok(None),
        },
        (0, Some(b), None, _) => match to_u32(b) {
            Some(b) => PlaceKind::Book(b),
            None => return Ok(None),
        },
        (0, None, None, Some(d)) => PlaceKind::Document(d),
        _ => return Ok(None),
    };
    Ok(Some(Place {
        symbol,
        meps_language,
        issue_tag,
        kind,
    }))
}

/// The block a (`BlockType`, identifier) pair names in `place`: `Some(None)`
/// for none, `None` for a pair we can't map there.
fn read_block(place: &Place, block_type: i64, id: Option<i64>) -> Option<Option<Block>> {
    match (block_type, place.kind, id.and_then(to_u32)) {
        (0, _, _) => Some(None),
        (1, PlaceKind::Document(_), Some(p)) => Some(Some(Block::Paragraph(p))),
        (2, PlaceKind::Chapter(..), Some(v)) => Some(Some(Block::Verse(v))),
        _ => None,
    }
}

fn to_u32(n: i64) -> Option<u32> {
    u32::try_from(n).ok()
}

/// The first `Location` row of `place`, if there is one.
fn find_location(conn: &Connection, place: &Place) -> Result<Option<i64>, CoreError> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT l.LocationId FROM Location l WHERE {} ORDER BY l.LocationId LIMIT 1",
                place_match("l")
            ),
            params_from_iter(place.values()),
            |r| r.get(0),
        )
        .optional()?)
}

/// The `Location` row of `place`, created if missing.
fn location_id(conn: &Connection, place: &Place) -> Result<i64, CoreError> {
    if let Some(id) = find_location(conn, place)? {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO Location (Type, KeySymbol, MepsLanguage, IssueTagNumber, DocumentId, \
         BookNumber, ChapterNumber) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, 0), NULLIF(?6, 0), \
         NULLIF(?7, 0))",
        params_from_iter(place.values()),
    )?;
    Ok(conn.last_insert_rowid())
}

/// The trimmed tag name; empty => `Invalid`.
fn tag_name(name: &str) -> Result<&str, CoreError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("a tag name can't be empty".into()));
    }
    Ok(name)
}

/// `Invalid` if a user tag other than `except` is already called `name`.
fn check_tag_free(conn: &Connection, name: &str, except: Option<i64>) -> Result<(), CoreError> {
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM Tag WHERE Type = 1 AND Name = ?1 AND TagId IS NOT ?2)",
        params![name, except],
        |r| r.get(0),
    )?;
    if taken {
        return Err(CoreError::Invalid(format!("a tag called {name:?} exists")));
    }
    Ok(())
}

/// `NotFound` unless `id` is a user tag.
fn check_user_tag(conn: &Connection, id: i64) -> Result<(), CoreError> {
    conn.query_row(
        "SELECT 1 FROM Tag WHERE TagId = ?1 AND Type = 1",
        [id],
        |_| Ok(()),
    )?;
    Ok(())
}

/// The `NoteId` of the note `guid`; `NotFound` if there is none.
fn note_row(conn: &Connection, guid: &str) -> Result<i64, CoreError> {
    Ok(
        conn.query_row("SELECT NoteId FROM Note WHERE Guid = ?1", [guid], |r| {
            r.get(0)
        })?,
    )
}

/// The built-in Favorites tag (`Type` 0), if the database has one.
fn favorites_tag(conn: &Connection) -> Result<Option<i64>, CoreError> {
    Ok(conn
        .query_row(
            "SELECT TagId FROM Tag WHERE Type = 0 ORDER BY TagId LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?)
}

/// The next free `Position` at the end of `tag`'s members.
fn next_position(conn: &Connection, tag: i64) -> Result<i64, CoreError> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(Position) + 1, 0) FROM TagMap WHERE TagId = ?1",
        [tag],
        |r| r.get(0),
    )?)
}

/// The place a favorite is, which can't be a paragraph or verse.
fn favorite_place(location: &Location) -> Result<Place, CoreError> {
    match split(location)? {
        (place, None) => Ok(place),
        (_, Some(_)) => Err(CoreError::Invalid(
            "a favorite is a publication, document, Bible book or chapter".into(),
        )),
    }
}

fn check_slot(slot: u8) -> Result<(), CoreError> {
    if slot > MAX_SLOT {
        return Err(CoreError::Invalid(format!(
            "bookmark slots are 0..={MAX_SLOT}, not {slot}"
        )));
    }
    Ok(())
}

/// The highlight `UserMarkId` names, or `None` if the typed reads skip it
/// (a color outside 1..=6, a location or blocks we can't map).
fn read_highlight(conn: &Connection, mark: i64) -> Result<Option<Highlight>, CoreError> {
    let Some((guid, color, place)) = conn
        .query_row(
            &format!(
                "SELECT m.UserMarkGuid, m.ColorIndex, {LOC_COLS} FROM UserMark m \
                 JOIN Location l ON l.LocationId = m.LocationId WHERE m.UserMarkId = ?1"
            ),
            [mark],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    read_place(r, 2)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(None);
    };
    let (Some(color), Some(place)) = (HighlightColor::from_index(color), place) else {
        return Ok(None);
    };
    let Some(block_type) = place.highlight_block_type() else {
        return Ok(None);
    };
    let blocks: Vec<(i64, i64, Option<i64>, Option<i64>)> = conn
        .prepare(
            "SELECT BlockType, Identifier, StartToken, EndToken FROM BlockRange \
             WHERE UserMarkId = ?1 ORDER BY Identifier, BlockRangeId",
        )?
        .query_map([mark], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    let (Some(first), Some(last)) = (blocks.first(), blocks.last()) else {
        return Ok(None);
    };
    if blocks.iter().any(|b| b.0 != block_type) {
        return Ok(None);
    }
    let token = |t: Option<i64>| match t {
        None => Some(None),
        Some(t) => to_u32(t).map(Some),
    };
    let (Some(start), Some(end), Some(start_token), Some(end_token)) = (
        read_block(&place, block_type, Some(first.1)).flatten(),
        read_block(&place, block_type, Some(last.1)).flatten(),
        token(first.2),
        token(last.3),
    ) else {
        return Ok(None);
    };
    Ok(Some(Highlight {
        id: guid,
        range: TextRange {
            span: LocationSpan {
                start: place.location(Some(start)),
                end: place.location(Some(end)),
            },
            start_token,
            end_token,
        },
        color,
    }))
}

/// The notes the typed reads see, in `NoteId` order: all of them, or the
/// one `NoteId` names, or those with `tag`.
fn read_notes(
    conn: &Connection,
    note: Option<i64>,
    tag: Option<i64>,
) -> Result<Vec<Note>, CoreError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT n.NoteId, n.Guid, n.Title, n.Content, n.Created, n.LastModified, \
         n.BlockType, n.BlockIdentifier, m.UserMarkGuid, n.LocationId, {LOC_COLS} \
         FROM Note n LEFT JOIN UserMark m ON m.UserMarkId = n.UserMarkId \
         LEFT JOIN Location l ON l.LocationId = n.LocationId \
         WHERE (?1 IS NULL OR n.NoteId = ?1) AND (?2 IS NULL OR EXISTS \
         (SELECT 1 FROM TagMap t WHERE t.NoteId = n.NoteId AND t.TagId = ?2)) \
         ORDER BY n.NoteId"
    ))?;
    let rows = stmt.query_map(params![note, tag], |r| {
        let id: i64 = r.get(0)?;
        let location = match r.get::<_, Option<i64>>(9)? {
            None => Some(None),
            Some(_) => match read_place(r, 10)? {
                Some(place) => {
                    read_block(&place, r.get(6)?, r.get(7)?).map(|b| Some(place.location(b)))
                }
                None => None,
            },
        };
        let Some(location) = location else {
            return Ok((id, None));
        };
        Ok((
            id,
            Some(Note {
                id: r.get(1)?,
                title: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                content: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                location,
                highlight_id: r.get(8)?,
                tag_ids: Vec::new(),
                created: r.get(4)?,
                modified: r.get(5)?,
            }),
        ))
    })?;
    let mut tags = conn.prepare(
        "SELECT m.TagId FROM TagMap m JOIN Tag t ON t.TagId = m.TagId \
         WHERE m.NoteId = ?1 AND t.Type = 1 ORDER BY m.TagId",
    )?;
    let mut notes = Vec::new();
    for row in rows {
        let (id, Some(mut note)) = row? else { continue };
        note.tag_ids = tags
            .query_map([id], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        notes.push(note);
    }
    Ok(notes)
}

/// Whether `loc` is `filter` or inside it (both as reads give them).
fn within(loc: &Location, filter: &Location) -> bool {
    let inside = |ours: Option<u32>, theirs: Option<u32>| theirs.is_none() || ours == theirs;
    loc.pub_key == filter.pub_key
        && (filter.doc_id.is_none() || loc.doc_id == filter.doc_id)
        && inside(loc.book, filter.book)
        && inside(loc.chapter, filter.chapter)
        && inside(loc.verse, filter.verse)
        && inside(loc.paragraph, filter.paragraph)
}

/// The rows behind [`UserData::favorites`], in `Position` order: each
/// `TagMapId` and its location, `None` where the reads can't map it.
fn favorite_rows(conn: &Connection, tag: i64) -> Result<Vec<(i64, Option<Location>)>, CoreError> {
    let rows = conn
        .prepare(&format!(
            "SELECT m.TagMapId, {LOC_COLS} FROM TagMap m \
             JOIN Location l ON l.LocationId = m.LocationId \
             WHERE m.TagId = ?1 ORDER BY m.Position"
        ))?
        .query_map([tag], |r| {
            Ok((r.get(0)?, read_place(r, 1)?.map(|p| p.location(None))))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Handle to the user's notes, highlights, tags, favorites and bookmarks.
/// Cheap to clone; shares the core's state.
#[derive(Clone)]
pub struct UserData {
    inner: Arc<Inner>,
}

impl UserData {
    pub(crate) fn new(inner: Arc<Inner>) -> Self {
        UserData { inner }
    }

    // Highlights.

    /// The highlights in a document or Bible chapter of `pub_key`, in the
    /// order they were made. `doc_or_chapter` must be in `pub_key` and name
    /// a document or chapter (no paragraph or verse), else `Invalid`.
    pub fn highlights(
        &self,
        pub_key: &str,
        doc_or_chapter: &Location,
    ) -> Result<Vec<Highlight>, CoreError> {
        let (place, block) = split(doc_or_chapter)?;
        if doc_or_chapter.pub_key != pub_key
            || block.is_some()
            || place.highlight_block_type().is_none()
        {
            return Err(CoreError::Invalid(format!(
                "highlights are listed per document or Bible chapter of {pub_key}, \
                 not {doc_or_chapter:?}"
            )));
        }
        let conn = self.inner.userdata();
        let marks: Vec<i64> = conn
            .prepare(&format!(
                "SELECT m.UserMarkId FROM UserMark m JOIN Location l \
                 ON l.LocationId = m.LocationId WHERE {} ORDER BY m.UserMarkId",
                place_match("l")
            ))?
            .query_map(params_from_iter(place.values()), |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        let mut out = Vec::new();
        for mark in marks {
            out.extend(read_highlight(&conn, mark)?);
        }
        Ok(out)
    }

    /// Highlight `range` in `color`: one block range per paragraph or verse
    /// from `range.span.start` to `range.span.end`. The span must run
    /// forward from a paragraph to one in the same document, or from a verse
    /// to one in the same chapter, else `Invalid`; so must the tokens of a
    /// one-block range.
    pub fn add_highlight(
        &self,
        range: &TextRange,
        color: HighlightColor,
    ) -> Result<Highlight, CoreError> {
        let (start_place, start) = split(&range.span.start)?;
        let (end_place, end) = split(&range.span.end)?;
        let invalid = |what: &str| CoreError::Invalid(format!("{what}: {range:?}"));
        if start_place != end_place {
            return Err(invalid(
                "a highlight can't cross documents, chapters or books",
            ));
        }
        let (block_type, first, last) = match (start, end) {
            (Some(Block::Paragraph(a)), Some(Block::Paragraph(b))) => (1, a, b),
            (Some(Block::Verse(a)), Some(Block::Verse(b))) => (2, a, b),
            _ => {
                return Err(invalid(
                    "a highlight runs between paragraphs of a document or verses of a chapter",
                ))
            }
        };
        if first > last {
            return Err(invalid("a highlight must run forward"));
        }
        if let (true, Some(s), Some(e)) = (first == last, range.start_token, range.end_token) {
            if s > e {
                return Err(invalid("a highlight's tokens must run forward"));
            }
        }

        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let location = location_id(&tx, &start_place)?;
        tx.execute(
            &format!(
                "INSERT INTO UserMark (ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version) \
                 VALUES (?1, ?2, 0, {NEW_GUID}, 1)"
            ),
            params![color.index(), location],
        )?;
        let mark = tx.last_insert_rowid();
        let mut insert = tx.prepare(
            "INSERT INTO BlockRange (BlockType, Identifier, StartToken, EndToken, UserMarkId) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for id in first..=last {
            let start_token = range.start_token.filter(|_| id == first);
            let end_token = range.end_token.filter(|_| id == last);
            insert.execute(params![block_type, id, start_token, end_token, mark])?;
        }
        drop(insert);
        tx.commit()?;
        read_highlight(&conn, mark)?
            .ok_or_else(|| CoreError::Invalid(format!("highlight not readable: {range:?}")))
    }

    /// Recolor the highlight `id`; unknown => `NotFound`.
    pub fn set_highlight_color(&self, id: &str, color: HighlightColor) -> Result<(), CoreError> {
        let conn = self.inner.userdata();
        let n = conn.execute(
            "UPDATE UserMark SET ColorIndex = ?2 WHERE UserMarkGuid = ?1",
            params![id, color.index()],
        )?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
        Ok(())
    }

    /// Remove the highlight `id`. Notes on it are kept, detached from it.
    /// Unknown => `NotFound`.
    pub fn remove_highlight(&self, id: &str) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let mark: i64 = tx.query_row(
            "SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?1",
            [id],
            |r| r.get(0),
        )?;
        tx.execute(
            "UPDATE Note SET UserMarkId = NULL WHERE UserMarkId = ?1",
            [mark],
        )?;
        tx.execute("DELETE FROM BlockRange WHERE UserMarkId = ?1", [mark])?;
        tx.execute("DELETE FROM UserMark WHERE UserMarkId = ?1", [mark])?;
        tx.commit()?;
        Ok(())
    }

    // Notes.

    /// The notes `filter` selects, in the order they were made. A malformed
    /// filter location => `Invalid`.
    pub fn notes(&self, filter: &NoteFilter) -> Result<Vec<Note>, CoreError> {
        let location = match &filter.location {
            Some(loc) => {
                let (place, block) = split(loc)?;
                Some(place.location(block))
            }
            None => None,
        };
        let conn = self.inner.userdata();
        let mut notes = read_notes(&conn, None, filter.tag_id)?;
        if let Some(filter) = location {
            notes.retain(|n| n.location.as_ref().is_some_and(|l| within(l, &filter)));
        }
        Ok(notes)
    }

    /// Add a note at `location` (`None` for a free-standing one), on the
    /// highlight `highlight_id` if given. An unknown highlight =>
    /// `NotFound`; a malformed location => `Invalid`.
    pub fn add_note(
        &self,
        title: &str,
        content: &str,
        location: Option<&Location>,
        highlight_id: Option<&str>,
    ) -> Result<Note, CoreError> {
        let place = location.map(split).transpose()?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let mark: Option<i64> = highlight_id
            .map(|id| {
                tx.query_row(
                    "SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?1",
                    [id],
                    |r| r.get(0),
                )
            })
            .transpose()?;
        let (location, block) = match &place {
            Some((place, block)) => (Some(location_id(&tx, place)?), *block),
            None => (None, None),
        };
        let (block_type, block_id) = block_columns(block);
        tx.execute(
            &format!(
                "INSERT INTO Note (Guid, UserMarkId, LocationId, Title, Content, LastModified, \
                 Created, BlockType, BlockIdentifier) \
                 VALUES ({NEW_GUID}, ?1, ?2, ?3, ?4, {NOW}, {NOW}, ?5, ?6)"
            ),
            params![mark, location, title, content, block_type, block_id],
        )?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        read_notes(&conn, Some(id), None)?
            .pop()
            .ok_or_else(|| CoreError::Invalid("note not readable".into()))
    }

    /// Replace the note `id`'s title and content, stamping it modified now.
    /// Unknown => `NotFound`.
    pub fn update_note(&self, id: &str, title: &str, content: &str) -> Result<(), CoreError> {
        let conn = self.inner.userdata();
        let n = conn.execute(
            &format!(
                "UPDATE Note SET Title = ?2, Content = ?3, LastModified = {NOW} WHERE Guid = ?1"
            ),
            params![id, title, content],
        )?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
        Ok(())
    }

    /// Remove the note `id` and its tagging. Unknown => `NotFound`.
    pub fn remove_note(&self, id: &str) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let note = note_row(&tx, id)?;
        tx.execute("DELETE FROM TagMap WHERE NoteId = ?1", [note])?;
        tx.execute("DELETE FROM Note WHERE NoteId = ?1", [note])?;
        tx.commit()?;
        Ok(())
    }

    // Tags.

    /// The user tags, in the order they were made.
    pub fn tags(&self) -> Result<Vec<Tag>, CoreError> {
        let conn = self.inner.userdata();
        let tags = conn
            .prepare("SELECT TagId, Name FROM Tag WHERE Type = 1 ORDER BY TagId")?
            .query_map([], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(tags)
    }

    /// Add a user tag called `name` (trimmed). An empty name, or one another
    /// tag has => `Invalid`.
    pub fn add_tag(&self, name: &str) -> Result<Tag, CoreError> {
        let name = tag_name(name)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        check_tag_free(&tx, name, None)?;
        tx.execute("INSERT INTO Tag (Type, Name) VALUES (1, ?1)", [name])?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(Tag {
            id,
            name: name.to_string(),
        })
    }

    /// Rename the user tag `id` to `name` (trimmed). Unknown => `NotFound`;
    /// an empty name, or one another tag has => `Invalid`.
    pub fn rename_tag(&self, id: i64, name: &str) -> Result<(), CoreError> {
        let name = tag_name(name)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        check_user_tag(&tx, id)?;
        check_tag_free(&tx, name, Some(id))?;
        tx.execute(
            "UPDATE Tag SET Name = ?2 WHERE TagId = ?1",
            params![id, name],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Remove the user tag `id`, untagging whatever had it. Unknown =>
    /// `NotFound`.
    pub fn remove_tag(&self, id: i64) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        check_user_tag(&tx, id)?;
        tx.execute("DELETE FROM TagMap WHERE TagId = ?1", [id])?;
        tx.execute("DELETE FROM Tag WHERE TagId = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    /// Tag the note `note_id` with `tag_id`, last among the tag's members;
    /// already tagged is a no-op. Unknown note or tag => `NotFound`.
    pub fn tag_note(&self, note_id: &str, tag_id: i64) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let note = note_row(&tx, note_id)?;
        check_user_tag(&tx, tag_id)?;
        let tagged: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM TagMap WHERE TagId = ?1 AND NoteId = ?2)",
            [tag_id, note],
            |r| r.get(0),
        )?;
        if !tagged {
            let position = next_position(&tx, tag_id)?;
            tx.execute(
                "INSERT INTO TagMap (NoteId, TagId, Position) VALUES (?1, ?2, ?3)",
                [note, tag_id, position],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Take the tag `tag_id` off the note `note_id`; not tagged is a no-op.
    /// Unknown note or tag => `NotFound`.
    pub fn untag_note(&self, note_id: &str, tag_id: i64) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let note = note_row(&tx, note_id)?;
        check_user_tag(&tx, tag_id)?;
        tx.execute(
            "DELETE FROM TagMap WHERE TagId = ?1 AND NoteId = ?2",
            [tag_id, note],
        )?;
        tx.commit()?;
        Ok(())
    }

    // Favorites.

    /// The favorites, in their order.
    pub fn favorites(&self) -> Result<Vec<Location>, CoreError> {
        let conn = self.inner.userdata();
        let Some(tag) = favorites_tag(&conn)? else {
            return Ok(Vec::new());
        };
        Ok(favorite_rows(&conn, tag)?
            .into_iter()
            .filter_map(|(_, loc)| loc)
            .collect())
    }

    /// Add `location` (a publication, document, Bible book or chapter) last
    /// among the favorites; already there is a no-op. A paragraph, verse or
    /// malformed location => `Invalid`.
    pub fn add_favorite(&self, location: &Location) -> Result<(), CoreError> {
        let place = favorite_place(location)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let tag = match favorites_tag(&tx)? {
            Some(tag) => tag,
            None => {
                tx.execute("INSERT INTO Tag (Type, Name) VALUES (0, 'Favorite')", [])?;
                tx.last_insert_rowid()
            }
        };
        let location = location_id(&tx, &place)?;
        let there: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM TagMap WHERE TagId = ?1 AND LocationId = ?2)",
            [tag, location],
            |r| r.get(0),
        )?;
        if !there {
            let position = next_position(&tx, tag)?;
            tx.execute(
                "INSERT INTO TagMap (LocationId, TagId, Position) VALUES (?1, ?2, ?3)",
                [location, tag, position],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Remove `location` from the favorites. Not a favorite => `NotFound`.
    pub fn remove_favorite(&self, location: &Location) -> Result<(), CoreError> {
        let place = favorite_place(location)?;
        let conn = self.inner.userdata();
        let tag = favorites_tag(&conn)?.ok_or(CoreError::NotFound)?;
        let mut values = place.values();
        values.push(Value::Integer(tag));
        let n = conn.execute(
            &format!(
                "DELETE FROM TagMap WHERE TagId = ?8 AND LocationId IN \
                 (SELECT l.LocationId FROM Location l WHERE {})",
                place_match("l")
            ),
            params_from_iter(values),
        )?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
        Ok(())
    }

    /// Move the favorite `location` to index `to_position` of
    /// [`favorites`](Self::favorites), shifting the others. Not a favorite
    /// => `NotFound`; an index past the end => `Invalid`.
    pub fn move_favorite(&self, location: &Location, to_position: u32) -> Result<(), CoreError> {
        let target = favorite_place(location)?.location(None);
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let tag = favorites_tag(&tx)?.ok_or(CoreError::NotFound)?;
        let mut rows = favorite_rows(&tx, tag)?;
        let from = rows
            .iter()
            .position(|(_, loc)| loc.as_ref() == Some(&target))
            .ok_or(CoreError::NotFound)?;
        let moved = rows.remove(from);
        // Indexes into `rows` of the favorites the reads see, so rows they
        // skip keep their place.
        let visible: Vec<usize> = (0..rows.len()).filter(|&i| rows[i].1.is_some()).collect();
        let to = to_position as usize;
        if to > visible.len() {
            return Err(CoreError::Invalid(format!(
                "favorite position {to_position} is past the end ({})",
                visible.len()
            )));
        }
        let at = visible.get(to).copied().unwrap_or(rows.len());
        rows.insert(at, moved);
        // Two passes keep `UNIQUE(TagId, Position)`: first to distinct
        // negative positions, then to 0..n.
        tx.execute(
            "UPDATE TagMap SET Position = -TagMapId WHERE TagId = ?1",
            [tag],
        )?;
        let mut update = tx.prepare("UPDATE TagMap SET Position = ?2 WHERE TagMapId = ?1")?;
        for (position, (id, _)) in rows.iter().enumerate() {
            update.execute(params![id, position as i64])?;
        }
        drop(update);
        tx.commit()?;
        Ok(())
    }

    // Bookmarks.

    /// The bookmarks of `pub_key`, by slot. A malformed key => `Invalid`.
    pub fn bookmarks(&self, pub_key: &str) -> Result<Vec<Bookmark>, CoreError> {
        let publication = Place::publication(pub_key)?;
        let conn = self.inner.userdata();
        let mut stmt = conn.prepare(&format!(
            "SELECT b.Slot, b.Title, b.Snippet, b.BlockType, b.BlockIdentifier, {LOC_COLS} \
             FROM Bookmark b JOIN Location p ON p.LocationId = b.PublicationLocationId \
             JOIN Location l ON l.LocationId = b.LocationId WHERE {} \
             ORDER BY b.Slot, b.BookmarkId",
            place_match("p")
        ))?;
        let rows = stmt.query_map(params_from_iter(publication.values()), |r| {
            let slot = u8::try_from(r.get::<_, i64>(0)?)
                .ok()
                .filter(|&s| s <= MAX_SLOT);
            let location = match read_place(r, 5)? {
                Some(place) => read_block(&place, r.get(3)?, r.get(4)?).map(|b| place.location(b)),
                None => None,
            };
            Ok(match (slot, location) {
                (Some(slot), Some(location)) => Some(Bookmark {
                    pub_key: pub_key.to_string(),
                    slot,
                    location,
                    title: r.get(1)?,
                    snippet: r.get(2)?,
                }),
                _ => None,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.extend(row?);
        }
        Ok(out)
    }

    /// Bookmark `location` (in `pub_key`) in `slot`, replacing whatever was
    /// there. A slot past 9, a location in another publication or a
    /// malformed one => `Invalid`.
    pub fn set_bookmark(
        &self,
        pub_key: &str,
        slot: u8,
        location: &Location,
        title: &str,
        snippet: Option<&str>,
    ) -> Result<(), CoreError> {
        check_slot(slot)?;
        let publication = Place::publication(pub_key)?;
        let (place, block) = split(location)?;
        if location.pub_key != pub_key {
            return Err(CoreError::Invalid(format!(
                "bookmark for {pub_key} at {location:?}"
            )));
        }
        let (block_type, block_id) = block_columns(block);
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let publication = location_id(&tx, &publication)?;
        let location = location_id(&tx, &place)?;
        tx.execute(
            "INSERT INTO Bookmark (LocationId, PublicationLocationId, Slot, Title, Snippet, \
             BlockType, BlockIdentifier) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT (PublicationLocationId, Slot) DO UPDATE SET \
             LocationId = excluded.LocationId, Title = excluded.Title, \
             Snippet = excluded.Snippet, BlockType = excluded.BlockType, \
             BlockIdentifier = excluded.BlockIdentifier",
            params![
                location,
                publication,
                slot,
                title,
                snippet,
                block_type,
                block_id
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Clear `slot` of `pub_key`'s bookmarks. An empty slot => `NotFound`; a
    /// slot past 9 or a malformed key => `Invalid`.
    pub fn remove_bookmark(&self, pub_key: &str, slot: u8) -> Result<(), CoreError> {
        check_slot(slot)?;
        let publication = Place::publication(pub_key)?;
        let mut values = publication.values();
        values.push(Value::Integer(slot.into()));
        let conn = self.inner.userdata();
        let n = conn.execute(
            &format!(
                "DELETE FROM Bookmark WHERE Slot = ?8 AND PublicationLocationId IN \
                 (SELECT p.LocationId FROM Location p WHERE {})",
                place_match("p")
            ),
            params_from_iter(values),
        )?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
        Ok(())
    }
}
