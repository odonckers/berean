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
//!
//! # Backups
//!
//! A `.jwlibrary` file is a zip of `manifest.json`, the database and any
//! media files (playlist media and thumbnails), which the core keeps under
//! `<data_dir>/userData.media/` by their names in the zip.
//! [`UserData::export_backup`] writes one. [`UserData::import_backup`]
//! replaces all the user data with one, as JW Library's restore does,
//! keeping the previous database as `userData.prev.db` (and its media as
//! `userData.prev.media/`) so that [`UserData::undo_import`] can put it back.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::{NamedTempFile, TempDir};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::library::{format_pub_key, parse_pub_key};
use crate::notes;
use crate::reader::{Location, LocationSpan};
use crate::{CancelToken, CoreError, Inner, ProgressSink};

/// The file name of the user-data database in the data dir; also the
/// database name a backup manifest gives by default.
pub(crate) const DB_FILE: &str = "userData.db";

/// The directory under the data dir that holds a backup's media files.
pub(crate) const MEDIA_DIR: &str = "userData.media";

/// The previous database and media an import keeps, for one undo.
const PREV_DB: &str = "userData.prev.db";
const PREV_MEDIA: &str = "userData.prev.media";

/// The member of a backup that describes it.
const MANIFEST: &str = "manifest.json";

/// The schema version Berean writes, and the newest it reads.
const SCHEMA_VERSION: u32 = 16;

/// The oldest schema version an import reads (and upgrades).
const OLDEST_SCHEMA_VERSION: u32 = 14;

/// jwlManager's v14 → v16 upgrade; see the file's header.
const UPGRADE_V14: &str = include_str!("userdata_v14_to_v16.sql");

/// The `name` and `deviceName` Berean writes into a backup's manifest.
const DEVICE_NAME: &str = "Berean";

/// The steps [`UserData::export_backup`] reports: copy the database, read
/// its `LastModified`, hash it, write the zip, move it into place.
const EXPORT_STEPS: u64 = 5;

/// The steps [`UserData::import_backup`] reports: open the zip and extract
/// the database, check its hash, check its version, upgrade and check it
/// (and count what it holds), extract the media, swap it in.
const IMPORT_STEPS: u64 = 6;

/// The steps [`UserData::import_preview`] reports: an import's first five,
/// the ones that stage and check the backup, with no swap.
const STAGE_STEPS: u64 = 5;

/// JW Library's v16 user-data schema, with its initial rows; see the file's
/// header for where it comes from.
const SCHEMA_V16: &str = include_str!("userdata_v16.sql");

/// Berean's own tables (note folders, Studyspace), beside JW's; see the file's header.
const BEREAN_TABLES: &str = include_str!("userdata_berean.sql");

/// The path of the user-data database under `data_dir`.
pub(crate) fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE)
}

/// Open the user-data database under `data_dir`, first creating it from the
/// vendored v16 DDL if it is missing. The new file is built under a
/// temporary name and renamed into place, so a failed creation leaves no
/// half-made database behind. Foreign keys are enforced on the connection,
/// and Berean's own tables are created if missing (every open, so also after
/// an import or undo swaps the file). A file that isn't a database =>
/// `Corrupt`.
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
        tmp.persist(&path).map_err(|e| CoreError::from(e.error))?;
    }
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    // SQLite opens lazily: read the schema so a damaged file fails here, as
    // `Corrupt`, rather than on the first call that uses it.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
    conn.execute_batch(BEREAN_TABLES)?;
    Ok(conn)
}

/// A backup's `manifest.json`, with the field names JW Library uses.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    name: String,
    creation_date: String,
    version: u32,
    #[serde(rename = "type")]
    kind: u32,
    user_data_backup: BackupInfo,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupInfo {
    last_modified_date: String,
    device_name: String,
    #[serde(default = "default_database_name")]
    database_name: String,
    hash: String,
    schema_version: u32,
}

fn default_database_name() -> String {
    DB_FILE.to_string()
}

/// The SHA-256 of the file at `path`, as lowercase hex.
fn sha256_file(path: &Path) -> Result<String, CoreError> {
    let mut hasher = Sha256::new();
    std::io::copy(&mut File::open(path)?, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

/// Every regular file under `dir` (none if it doesn't exist), as its path
/// relative to `dir` with `/` separators, sorted.
fn media_files(dir: &Path) -> Result<Vec<String>, CoreError> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) -> Result<(), CoreError> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|n| CoreError::Io(format!("media file name not UTF-8: {n:?}")))?;
            let rel = format!("{prefix}{name}");
            let kind = entry.file_type()?;
            if kind.is_dir() {
                walk(&entry.path(), &format!("{rel}/"), out)?;
            } else if kind.is_file() {
                out.push(rel);
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    if dir.is_dir() {
        walk(dir, "", &mut out)?;
    }
    out.sort();
    Ok(out)
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
    /// The Berean folder the note is filed in; `None` = not in a folder.
    pub folder_id: Option<i64>,
}

/// Which notes [`UserData::notes`] lists; every field set must match.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NoteFilter {
    /// Notes at this location or inside it: a document's include its
    /// paragraphs', a chapter's its verses', a publication's all of its own.
    pub location: Option<Location>,
    /// Notes with every one of these tags; empty = any.
    pub tag_ids: Vec<i64>,
    /// Notes in this folder (or none).
    pub folder: Option<FolderScope>,
}

/// Which folder [`NoteFilter::folder`] picks notes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderScope {
    /// Notes in no folder.
    Unfiled,
    /// Notes in folder `id`, and in its subfolders if `include_subfolders`.
    Folder { id: i64, include_subfolders: bool },
}

/// A Berean note folder, as [`UserData::folders`] lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folder {
    pub id: i64,
    /// `None` = top level.
    pub parent_id: Option<i64>,
    pub name: String,
    /// Order among its siblings: 0-based and dense.
    pub position: u32,
    /// 0 = top level.
    pub depth: u32,
    /// Notes in the folder and all its subfolders.
    pub note_count: u32,
    /// Direct children.
    pub subfolder_count: u32,
}

/// What [`UserData::delete_folder`] removed, so
/// [`UserData::restore_folder`] can put it back exactly: the folders in
/// tree order (the deleted one first), and the notes that were filed in them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeletedFolder {
    pub folders: Vec<Folder>,
    pub notes: Vec<NoteFolder>,
}

/// A note (by `Guid`) filed in a folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteFolder {
    pub note_id: String,
    pub folder_id: i64,
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

/// What an import of a backup would bring in and replace, for the warning
/// the UI shows first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportPreview {
    /// What the backup holds, counted as [`UserData::import_backup`] does.
    pub backup: ImportSummary,
    /// What the current data holds, counted the same way: what the import
    /// replaces.
    pub current: ImportSummary,
    /// The Berean folders the import clears.
    pub folders: u32,
    /// The current notes that are in a folder.
    pub filed_notes: u32,
    /// The device the backup was made on, from its manifest.
    pub device_name: String,
    /// When the backup was made: the manifest's `creationDate`, as given
    /// (ISO-8601, as JW Library and Berean write it).
    pub created: String,
}

/// A Studyspace workspace, as [`UserData::workspaces`] lists it.
#[derive(Debug, Clone, PartialEq)]
pub struct Workspace {
    pub id: i64,
    pub name: String,
    /// `None` until the first [`UserData::set_viewport`]: the app opens at
    /// fit-all.
    pub viewport: Option<Viewport>,
    /// The cards on its canvas.
    pub item_count: u32,
}

/// Where a workspace's view is: the camera centre, the canvas point `x`,
/// `y` at the middle of the view, and its zoom (1.0 = 100%). `|x|` and `|y|`
/// are at most [`MAX_CANVAS_COORD`]; the zoom is finite and over 0, with no
/// other limit (the app picks its own range).
#[derive(Debug, Clone, PartialEq)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// A card's place and size, in canvas points at zoom 1.0: `x`, `y` is its
/// top-left corner, `|x|` and `|y|` at most [`MAX_CANVAS_COORD`]; `width` and
/// `height` are [`MIN_CARD_SIZE`] to [`MAX_CARD_SIZE`].
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What a card shows. `missing`: the card's `pub_key` isn't installed (set
/// by reads, ignored on input).
#[derive(Debug, Clone, PartialEq)]
pub enum CardRef {
    /// A note, by `Guid`.
    Note { note_id: String },
    /// A Bible passage within one book, as `notes::passage_url` takes it.
    Passage { span: LocationSpan, missing: bool },
    /// An excerpt: a publication, document or paragraph, as
    /// `notes::publication_url` takes it.
    Publication { location: Location, missing: bool },
}

/// Where a passage or excerpt card has been read to, for
/// [`UserData::set_reader_state`]. The card's own [`CardRef`] stays its
/// origin (what was opened, and the passage highlight).
///
/// - `at` is the same kind as the card and in the same publication: for a
///   Bible card, one verse (`start == end`, verse set) of the same Bible,
///   any book or chapter; for a publication card, a paragraph (so a
///   document too) of the same `pub_key`. `missing` is set as for cards.
/// - `char_offset` counts UTF-16 code units into the core's plain text of
///   that verse or paragraph, the unit `markdown_spans` uses: where the
///   card's top edge is.
///
/// The core stores both as given. Clamping `char_offset` to the block's
/// length on restore, and falling back to the nearest earlier block when
/// `at` no longer exists (a different edition, say), are up to the reader.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderState {
    pub at: CardRef,
    pub char_offset: u32,
}

/// A card on a workspace's canvas. A higher `z` draws on top. `reader` is
/// `None` for a note card, and for a passage or excerpt card never
/// scrolled (it is at its origin, offset 0). `last_used_at` is when the
/// card was added, read in ([`UserData::set_reader_state`]) or touched
/// ([`UserData::touch_item`]), ISO 8601 in UTC like [`Note::modified`].
#[derive(Debug, Clone, PartialEq)]
pub struct CanvasItem {
    pub id: i64,
    pub workspace_id: i64,
    pub card: CardRef,
    pub frame: Frame,
    pub z: i64,
    pub reader: Option<ReaderState>,
    pub last_used_at: String,
}

/// A new frame for the item `id`, for [`UserData::set_frames`].
#[derive(Debug, Clone, PartialEq)]
pub struct ItemFrame {
    pub id: i64,
    pub frame: Frame,
}

/// The order [`UserData::items`] lists a workspace's cards in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemOrder {
    /// Back to front, for drawing: by `z`, then id.
    Z,
    /// Top to bottom, then left to right, for the List view and screen
    /// readers: by `y`, then `x`, then id.
    Reading,
}

// Studyspace bounds, in canvas points. `add_item`, `set_frames` and
// `set_viewport` reject anything outside them, or not finite, as `Invalid`.

/// The smallest card width or height.
pub const MIN_CARD_SIZE: f64 = 24.0;
/// The largest card width or height.
pub const MAX_CARD_SIZE: f64 = 8192.0;
/// The largest `|x|` or `|y|` of a card's corner or a viewport's centre.
pub const MAX_CANVAS_COORD: f64 = 1e6;

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

/// [`LOC_COLS`] for the alias `p`.
const PUB_COLS: &str = "p.Type, p.KeySymbol, p.MepsLanguage, p.IssueTagNumber, p.DocumentId, \
     p.BookNumber, p.ChapterNumber, p.Track, p.Specialty, p.Edition";

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

/// The trimmed folder name; empty => `Invalid`.
fn folder_name(name: &str) -> Result<&str, CoreError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("a folder name can't be empty".into()));
    }
    Ok(name)
}

/// `Invalid` if a folder under `parent` other than `except` is already
/// called `name`, ignoring ASCII case as the unique index does.
fn check_folder_name_free(
    conn: &Connection,
    parent: Option<i64>,
    name: &str,
    except: Option<i64>,
) -> Result<(), CoreError> {
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM BereanFolder WHERE ParentId IS ?1 \
         AND Name = ?2 COLLATE NOCASE AND FolderId IS NOT ?3)",
        params![parent, name, except],
        |r| r.get(0),
    )?;
    if taken {
        return Err(CoreError::Invalid(format!(
            "a folder called {name:?} is already there"
        )));
    }
    Ok(())
}

/// The parent of folder `id`; `NotFound` if there is no such folder.
fn folder_parent(conn: &Connection, id: i64) -> Result<Option<i64>, CoreError> {
    Ok(conn.query_row(
        "SELECT ParentId FROM BereanFolder WHERE FolderId = ?1",
        [id],
        |r| r.get(0),
    )?)
}

/// Whether folder `id` exists.
fn folder_exists(conn: &Connection, id: i64) -> Result<bool, CoreError> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM BereanFolder WHERE FolderId = ?1)",
        [id],
        |r| r.get(0),
    )?)
}

/// The folders under `parent`, in position order.
fn sibling_ids(conn: &Connection, parent: Option<i64>) -> Result<Vec<i64>, CoreError> {
    let ids = conn
        .prepare(
            "SELECT FolderId FROM BereanFolder WHERE ParentId IS ?1 ORDER BY Position, FolderId",
        )?
        .query_map([parent], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(ids)
}

/// Give the folders `ids` the positions 0..n in that order.
fn set_positions(conn: &Connection, ids: &[i64]) -> Result<(), CoreError> {
    let mut update = conn.prepare("UPDATE BereanFolder SET Position = ?2 WHERE FolderId = ?1")?;
    for (position, id) in ids.iter().enumerate() {
        update.execute(params![id, position as i64])?;
    }
    Ok(())
}

/// Folder `id` and every folder under it.
fn subtree_ids(conn: &Connection, id: i64) -> Result<HashSet<i64>, CoreError> {
    let ids = conn
        .prepare(
            // `UNION`, not `UNION ALL`: ends even on a cycle in a damaged file.
            "WITH RECURSIVE sub (id) AS (SELECT ?1 UNION \
             SELECT f.FolderId FROM BereanFolder f JOIN sub ON f.ParentId = sub.id) \
             SELECT id FROM sub",
        )?
        .query_map([id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(ids)
}

/// Every folder in tree order: depth-first, siblings by position, with
/// depths and counts filled in.
fn read_folders(conn: &Connection) -> Result<Vec<Folder>, CoreError> {
    let rows: Vec<(i64, Option<i64>, String, i64)> = conn
        .prepare(
            "SELECT FolderId, ParentId, Name, Position FROM BereanFolder \
             ORDER BY Position, FolderId",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    let direct: HashMap<i64, u32> = conn
        .prepare("SELECT FolderId, COUNT(*) FROM BereanNoteFolder GROUP BY FolderId")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let mut children: HashMap<Option<i64>, Vec<usize>> = HashMap::new();
    for (i, row) in rows.iter().enumerate() {
        children.entry(row.1).or_default().push(i);
    }

    struct Tree<'a> {
        rows: &'a [(i64, Option<i64>, String, i64)],
        direct: &'a HashMap<i64, u32>,
        children: &'a HashMap<Option<i64>, Vec<usize>>,
    }
    impl Tree<'_> {
        /// Push `parent`'s subfolders (pre-order) and return how many notes
        /// they hold, all levels down.
        fn walk(&self, parent: Option<i64>, depth: u32, out: &mut Vec<Folder>) -> u32 {
            let mut total = 0;
            for &i in self.children.get(&parent).map_or(&[][..], Vec::as_slice) {
                let (id, parent_id, name, position) = &self.rows[i];
                let at = out.len();
                out.push(Folder {
                    id: *id,
                    parent_id: *parent_id,
                    name: name.clone(),
                    position: u32::try_from(*position).unwrap_or(u32::MAX),
                    depth,
                    note_count: 0,
                    subfolder_count: self.children.get(&Some(*id)).map_or(0, |c| c.len() as u32),
                });
                let count = self.direct.get(id).copied().unwrap_or(0)
                    + self.walk(Some(*id), depth + 1, out);
                out[at].note_count = count;
                total += count;
            }
            total
        }
    }
    let mut out = Vec::with_capacity(rows.len());
    Tree {
        rows: &rows,
        direct: &direct,
        children: &children,
    }
    .walk(None, 0, &mut out);
    Ok(out)
}

/// The trimmed workspace name; empty => `Invalid`.
fn workspace_name(name: &str) -> Result<&str, CoreError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("a workspace name can't be empty".into()));
    }
    Ok(name)
}

/// `Invalid` if a workspace other than `except` is already called `name`,
/// ignoring ASCII case as the unique index does.
fn check_workspace_name_free(
    conn: &Connection,
    name: &str,
    except: Option<i64>,
) -> Result<(), CoreError> {
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM BereanWorkspace \
         WHERE Name = ?1 COLLATE NOCASE AND WorkspaceId IS NOT ?2)",
        params![name, except],
        |r| r.get(0),
    )?;
    if taken {
        return Err(CoreError::Invalid(format!(
            "a workspace called {name:?} exists"
        )));
    }
    Ok(())
}

/// `NotFound` unless workspace `id` exists.
fn check_workspace(conn: &Connection, id: i64) -> Result<(), CoreError> {
    conn.query_row(
        "SELECT 1 FROM BereanWorkspace WHERE WorkspaceId = ?1",
        [id],
        |_| Ok(()),
    )?;
    Ok(())
}

/// Whether `v` is a canvas coordinate in bounds (so finite).
fn canvas_coord(v: f64) -> bool {
    v.abs() <= MAX_CANVAS_COORD
}

/// Whether `v` is a card width or height in bounds (so finite).
fn card_size(v: f64) -> bool {
    (MIN_CARD_SIZE..=MAX_CARD_SIZE).contains(&v)
}

/// `Invalid` unless `frame`'s corner and size are in bounds.
fn check_frame(frame: &Frame) -> Result<(), CoreError> {
    let Frame {
        x,
        y,
        width,
        height,
    } = *frame;
    if !(canvas_coord(x) && canvas_coord(y) && card_size(width) && card_size(height)) {
        return Err(CoreError::Invalid(format!(
            "a frame needs |x|, |y| <= {MAX_CANVAS_COORD} and a size of \
             {MIN_CARD_SIZE} to {MAX_CARD_SIZE}: {frame:?}"
        )));
    }
    Ok(())
}

/// `Invalid` unless `viewport`'s centre is in bounds and its zoom is finite
/// and over 0.
fn check_viewport(viewport: &Viewport) -> Result<(), CoreError> {
    let Viewport { x, y, zoom } = *viewport;
    if !(canvas_coord(x) && canvas_coord(y) && zoom.is_finite() && zoom > 0.0) {
        return Err(CoreError::Invalid(format!(
            "a viewport needs |x|, |y| <= {MAX_CANVAS_COORD} and a finite zoom over 0: \
             {viewport:?}"
        )));
    }
    Ok(())
}

/// The card a stored `Target` or `ReaderAt` URL names; `None` if the link
/// parser can't read it as a passage or publication.
fn url_card(url: &str, installed: &HashSet<String>) -> Option<CardRef> {
    match notes::link_target(url, &|key| installed.contains(key)) {
        notes::LinkTarget::Passage { span, missing } => Some(CardRef::Passage { span, missing }),
        notes::LinkTarget::Publication { location, missing } => {
            Some(CardRef::Publication { location, missing })
        }
        _ => None,
    }
}

/// The workspaces, or the one `id` names, in creation order.
fn read_workspaces(conn: &Connection, id: Option<i64>) -> Result<Vec<Workspace>, CoreError> {
    let workspaces = conn
        .prepare(
            "SELECT w.WorkspaceId, w.Name, w.ViewX, w.ViewY, w.Zoom, \
             (SELECT COUNT(*) FROM BereanCanvasItem i WHERE i.WorkspaceId = w.WorkspaceId) \
             FROM BereanWorkspace w WHERE (?1 IS NULL OR w.WorkspaceId = ?1) \
             ORDER BY w.WorkspaceId",
        )?
        .query_map([id], |r| {
            let viewport = match (r.get(2)?, r.get(3)?, r.get(4)?) {
                (Some(x), Some(y), Some(zoom)) => Some(Viewport { x, y, zoom }),
                _ => None,
            };
            Ok(Workspace {
                id: r.get(0)?,
                name: r.get(1)?,
                viewport,
                item_count: to_u32(r.get(5)?).unwrap_or(u32::MAX),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(workspaces)
}

/// The cards of workspace `workspace` in `order`, or the one item `item`
/// names (with `workspace` `None`); `installed` says whether a `pub_key` is
/// installed. A stored target the link parser can't read is skipped, as
/// rows with no equivalent here are (see the module docs); a reader state
/// it can't read is `None`.
fn read_items(
    conn: &Connection,
    workspace: Option<i64>,
    item: Option<i64>,
    order: ItemOrder,
    installed: &HashSet<String>,
) -> Result<Vec<CanvasItem>, CoreError> {
    let order = match order {
        ItemOrder::Z => "i.Z, i.ItemId",
        ItemOrder::Reading => "i.Y, i.X, i.ItemId",
    };
    let rows: Vec<Option<CanvasItem>> = conn
        .prepare(&format!(
            "SELECT i.ItemId, i.WorkspaceId, n.Guid, i.Target, i.X, i.Y, i.Width, i.Height, i.Z, \
             i.ReaderAt, i.ReaderCharOffset, i.LastUsedAt \
             FROM BereanCanvasItem i LEFT JOIN Note n ON n.NoteId = i.NoteId \
             WHERE (?1 IS NULL OR i.WorkspaceId = ?1) AND (?2 IS NULL OR i.ItemId = ?2) \
             ORDER BY {order}"
        ))?
        .query_map(params![workspace, item], |r| {
            let note: Option<String> = r.get(2)?;
            let target: Option<String> = r.get(3)?;
            let card = match (note, target) {
                (Some(note_id), _) => Some(CardRef::Note { note_id }),
                (None, Some(url)) => url_card(&url, installed),
                (None, None) => None,
            };
            let reader_at: Option<String> = r.get(9)?;
            let reader_offset: Option<i64> = r.get(10)?;
            let reader = match (reader_at, reader_offset.and_then(to_u32)) {
                (Some(url), Some(char_offset)) => {
                    url_card(&url, installed).map(|at| ReaderState { at, char_offset })
                }
                _ => None,
            };
            Ok(match card {
                Some(card) => Some(CanvasItem {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    card,
                    frame: Frame {
                        x: r.get(4)?,
                        y: r.get(5)?,
                        width: r.get(6)?,
                        height: r.get(7)?,
                    },
                    z: r.get(8)?,
                    reader,
                    last_used_at: r.get(11)?,
                }),
                None => None,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows.into_iter().flatten().collect())
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

/// Tag the note row `note` with `tag`, last among the tag's members;
/// already tagged is a no-op.
fn tag_note_row(conn: &Connection, note: i64, tag: i64) -> Result<(), CoreError> {
    let tagged: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM TagMap WHERE TagId = ?1 AND NoteId = ?2)",
        [tag, note],
        |r| r.get(0),
    )?;
    if !tagged {
        let position = next_position(conn, tag)?;
        conn.execute(
            "INSERT INTO TagMap (NoteId, TagId, Position) VALUES (?1, ?2, ?3)",
            [note, tag, position],
        )?;
    }
    Ok(())
}

/// Take `tag` off the note row `note`; not tagged is a no-op.
fn untag_note_row(conn: &Connection, note: i64, tag: i64) -> Result<(), CoreError> {
    conn.execute(
        "DELETE FROM TagMap WHERE TagId = ?1 AND NoteId = ?2",
        [tag, note],
    )?;
    Ok(())
}

/// The user tags as `(id, lowercased name)`, oldest first.
fn user_tags_lower(conn: &Connection) -> Result<Vec<(i64, String)>, CoreError> {
    let tags = conn
        .prepare("SELECT TagId, Name FROM Tag WHERE Type = 1 ORDER BY TagId")?
        .query_map([], |r| {
            Ok((r.get(0)?, r.get::<_, String>(1)?.to_lowercase()))
        })?
        .collect::<Result<_, _>>()?;
    Ok(tags)
}

/// Sync the note row `note`'s user tags with the inline #tags of its body,
/// going from `old` (`None` for a new note) to `new`. Names match user
/// tags ignoring case, Unicode-aware (oldest tag first); an unmatched one
/// becomes a new user tag spelled as typed. Tags inline in `old` but not in
/// `new` come off the note; tags that weren't inline in `old` (from
/// `tag_note`) stay.
fn sync_inline_tags(
    conn: &Connection,
    note: i64,
    old: Option<&str>,
    new: &str,
) -> Result<(), CoreError> {
    let new_names = notes::inline_tags(new);
    let new_lower: HashSet<String> = new_names.iter().map(|n| n.to_lowercase()).collect();
    let mut tags = user_tags_lower(conn)?;
    let find = |tags: &[(i64, String)], lower: &str| {
        tags.iter()
            .find(|(_, name)| name == lower)
            .map(|(id, _)| *id)
    };
    for name in &new_names {
        let lower = name.to_lowercase();
        let tag = match find(&tags, &lower) {
            Some(tag) => tag,
            None => {
                conn.execute("INSERT INTO Tag (Type, Name) VALUES (1, ?1)", [name])?;
                let tag = conn.last_insert_rowid();
                tags.push((tag, lower));
                tag
            }
        };
        tag_note_row(conn, note, tag)?;
    }
    for name in old.map(notes::inline_tags).unwrap_or_default() {
        let lower = name.to_lowercase();
        if new_lower.contains(&lower) {
            continue;
        }
        if let Some(tag) = find(&tags, &lower) {
            untag_note_row(conn, note, tag)?;
        }
    }
    Ok(())
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
/// one `NoteId` names.
fn read_notes(conn: &Connection, note: Option<i64>) -> Result<Vec<Note>, CoreError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT n.NoteId, n.Guid, n.Title, n.Content, n.Created, n.LastModified, \
         n.BlockType, n.BlockIdentifier, m.UserMarkGuid, n.LocationId, {LOC_COLS}, nf.FolderId \
         FROM Note n LEFT JOIN UserMark m ON m.UserMarkId = n.UserMarkId \
         LEFT JOIN Location l ON l.LocationId = n.LocationId \
         LEFT JOIN BereanNoteFolder nf ON nf.NoteId = n.NoteId \
         WHERE (?1 IS NULL OR n.NoteId = ?1) ORDER BY n.NoteId"
    ))?;
    let rows = stmt.query_map(params![note], |r| {
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
                folder_id: r.get(20)?,
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

/// The favorites the reads see, in order.
fn read_favorites(conn: &Connection) -> Result<Vec<Location>, CoreError> {
    let Some(tag) = favorites_tag(conn)? else {
        return Ok(Vec::new());
    };
    Ok(favorite_rows(conn, tag)?
        .into_iter()
        .filter_map(|(_, loc)| loc)
        .collect())
}

/// The bookmarks the reads see, of `publication` or of every publication,
/// by slot.
fn read_bookmarks(
    conn: &Connection,
    publication: Option<&Place>,
) -> Result<Vec<Bookmark>, CoreError> {
    let (filter, values) = match publication {
        Some(p) => (format!("WHERE {}", place_match("p")), p.values()),
        None => (String::new(), Vec::new()),
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT b.Slot, b.Title, b.Snippet, b.BlockType, b.BlockIdentifier, {LOC_COLS}, \
         {PUB_COLS} FROM Bookmark b JOIN Location p ON p.LocationId = b.PublicationLocationId \
         JOIN Location l ON l.LocationId = b.LocationId {filter} \
         ORDER BY b.Slot, b.BookmarkId"
    ))?;
    let rows = stmt.query_map(params_from_iter(values), |r| {
        let slot = u8::try_from(r.get::<_, i64>(0)?)
            .ok()
            .filter(|&s| s <= MAX_SLOT);
        let location = match read_place(r, 5)? {
            Some(place) => read_block(&place, r.get(3)?, r.get(4)?).map(|b| place.location(b)),
            None => None,
        };
        let publication = read_place(r, 15)?.filter(|p| p.kind == PlaceKind::Publication);
        Ok(match (slot, location, publication) {
            (Some(slot), Some(location), Some(publication)) => Some(Bookmark {
                pub_key: publication.pub_key(),
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

/// What the typed reads see in the database on `conn`.
fn summary(conn: &Connection) -> Result<ImportSummary, CoreError> {
    let marks: Vec<i64> = conn
        .prepare("SELECT UserMarkId FROM UserMark")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut highlights = 0;
    for mark in marks {
        if read_highlight(conn, mark)?.is_some() {
            highlights += 1;
        }
    }
    let tags: i64 = conn.query_row("SELECT COUNT(*) FROM Tag WHERE Type = 1", [], |r| r.get(0))?;
    Ok(ImportSummary {
        highlights,
        notes: read_notes(conn, None)?.len() as u64,
        tags: tags as u64,
        bookmarks: read_bookmarks(conn, None)?.len() as u64,
        favorites: read_favorites(conn)?.len() as u64,
    })
}

/// A read error from a zip member: damaged data is `Corrupt`, a full disk
/// `StorageFull`, anything else `Io`.
fn zip_read_error(e: std::io::Error) -> CoreError {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::InvalidData | ErrorKind::InvalidInput | ErrorKind::UnexpectedEof => {
            CoreError::Corrupt
        }
        _ => e.into(),
    }
}

/// A write error from the export zip: an io failure keeps its kind (so a full
/// disk is `StorageFull`), anything else is `Io`.
pub(crate) fn zip_write_error(e: zip::result::ZipError) -> CoreError {
    match e {
        zip::result::ZipError::Io(io) => io.into(),
        other => CoreError::Io(other.to_string()),
    }
}

/// Extract the zip member `name` to `dest`, creating its directory.
fn extract(zip: &mut zip::ZipArchive<File>, name: &str, dest: &Path) -> Result<(), CoreError> {
    let mut member = zip.by_name(name).map_err(|_| CoreError::Corrupt)?;
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut out = File::create(dest)?;
    std::io::copy(&mut member, &mut out).map_err(zip_read_error)?;
    out.sync_all()?;
    Ok(())
}

/// What [`stage_backup`] found in a backup.
struct Staged {
    /// What the staged database holds.
    summary: ImportSummary,
    /// The manifest's `userDataBackup.deviceName`.
    device_name: String,
    /// The manifest's `creationDate`.
    created: String,
}

/// Steps 1–5 of an import (see [`IMPORT_STEPS`]): validate the backup at
/// `file` and stage it under `staging` as `userData.db` (upgraded to v16)
/// and `media/`, reporting progress out of `total` steps and checking
/// `cancel` between steps. Touches nothing outside `staging` and takes no
/// lock.
fn stage_backup(
    file: &Path,
    staging: &Path,
    total: u64,
    progress: &dyn ProgressSink,
    cancel: &CancelToken,
) -> Result<Staged, CoreError> {
    let db = staging.join(DB_FILE);
    let media = staging.join("media");

    let mut zip = zip::ZipArchive::new(File::open(file)?).map_err(|_| CoreError::Corrupt)?;
    // Every member's name must stay inside the directory it's extracted to.
    let mut members = Vec::new();
    for i in 0..zip.len() {
        let member = zip.by_index_raw(i).map_err(|_| CoreError::Corrupt)?;
        let path = member.enclosed_name().ok_or(CoreError::Corrupt)?;
        if !member.is_dir() {
            members.push((member.name().to_string(), path));
        }
    }
    let manifest: Manifest = {
        let mut bytes = Vec::new();
        zip.by_name(MANIFEST)
            .map_err(|_| CoreError::Corrupt)?
            .read_to_end(&mut bytes)
            .map_err(zip_read_error)?;
        serde_json::from_slice(&bytes)
            .map_err(|e| CoreError::Invalid(format!("backup manifest: {e}")))?
    };
    let created = manifest.creation_date;
    let info = manifest.user_data_backup;
    let db_name = info.database_name;
    if db_name == MANIFEST || !members.iter().any(|(name, _)| *name == db_name) {
        return Err(CoreError::Corrupt);
    }
    extract(&mut zip, &db_name, &db)?;
    progress.on_progress(1, total);

    cancel.check()?;
    if !sha256_file(&db)?.eq_ignore_ascii_case(&info.hash) {
        return Err(CoreError::Corrupt);
    }
    progress.on_progress(2, total);

    cancel.check()?;
    // Foreign keys off (the bundled SQLite turns them on by default): the
    // upgrade rebuilds a table others refer to, and `foreign_key_check`
    // vets the result.
    let conn = Connection::open(&db)?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let version: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version != info.schema_version {
        return Err(CoreError::Corrupt);
    }
    match version {
        v if v < OLDEST_SCHEMA_VERSION => {
            return Err(CoreError::Invalid(format!(
                "backup schema v{v} is too old: re-export from JW Library"
            )))
        }
        v if v > SCHEMA_VERSION => {
            return Err(CoreError::Invalid(format!(
                "backup schema v{v} is newer than this version reads: update Berean"
            )))
        }
        OLDEST_SCHEMA_VERSION | SCHEMA_VERSION => {}
        v => {
            return Err(CoreError::Invalid(format!(
                "backup schema v{v} is not one JW Library writes"
            )))
        }
    }
    progress.on_progress(3, total);

    cancel.check()?;
    if version == OLDEST_SCHEMA_VERSION {
        conn.execute_batch(&format!("BEGIN;\n{UPGRADE_V14}\nCOMMIT;"))
            .map_err(|_| CoreError::Corrupt)?;
    }
    let integrity: Vec<String> = conn
        .prepare("PRAGMA integrity_check")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    if integrity != ["ok"] {
        return Err(CoreError::Corrupt);
    }
    if conn
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err(CoreError::Corrupt);
    }
    // The checks above ran on the file as JW wrote it. The reads below join
    // Berean's tables, which `open` would create on the swapped-in file
    // anyway (empty: a JW backup has no folders).
    conn.execute_batch(BEREAN_TABLES)
        .map_err(|_| CoreError::Corrupt)?;
    // A database without JW's tables can't be read: corrupt as a backup.
    let summary = summary(&conn).map_err(|_| CoreError::Corrupt)?;
    drop(conn);
    progress.on_progress(4, total);

    cancel.check()?;
    std::fs::create_dir(&media)?;
    for (name, path) in &members {
        if *name != MANIFEST && *name != db_name {
            extract(&mut zip, name, &media.join(path))?;
        }
    }
    progress.on_progress(STAGE_STEPS, total);
    Ok(Staged {
        summary,
        device_name: info.device_name,
        created,
    })
}

/// Close the user-data connection behind `conn`, make the renames `moves`
/// lists (`from`, `to`, whether `from` must exist; a missing optional one
/// is skipped), and reopen it. If a rename or the reopen fails, the renames
/// made are reversed and the old database reopened.
fn swap_files(
    data_dir: &Path,
    conn: &mut Connection,
    moves: &[(PathBuf, PathBuf, bool)],
) -> Result<(), CoreError> {
    // Dropping the old connection closes it, so its file can move.
    drop(std::mem::replace(conn, Connection::open_in_memory()?));
    let mut done: Vec<(&Path, &Path)> = Vec::new();
    let result = (|| {
        for (from, to, required) in moves {
            if !required && !from.exists() {
                continue;
            }
            std::fs::rename(from, to)?;
            done.push((from, to));
        }
        open(data_dir)
    })();
    match result {
        Ok(new) => {
            *conn = new;
            Ok(())
        }
        Err(e) => {
            for (from, to) in done.into_iter().rev() {
                let _ = std::fs::rename(to, from);
            }
            *conn = open(data_dir)?;
            Err(e)
        }
    }
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
    /// filter location => `Invalid`; an unknown filter folder => `NotFound`.
    pub fn notes(&self, filter: &NoteFilter) -> Result<Vec<Note>, CoreError> {
        let location = match &filter.location {
            Some(loc) => {
                let (place, block) = split(loc)?;
                Some(place.location(block))
            }
            None => None,
        };
        let conn = self.inner.userdata();
        // The folders a `FolderScope::Folder` filter takes notes from.
        let scope = match filter.folder {
            Some(FolderScope::Folder {
                id,
                include_subfolders,
            }) => {
                folder_parent(&conn, id)?;
                if include_subfolders {
                    subtree_ids(&conn, id)?
                } else {
                    HashSet::from([id])
                }
            }
            _ => HashSet::new(),
        };
        let in_folder = |folder_id: Option<i64>| match (filter.folder, folder_id) {
            (None, _) => true,
            (Some(FolderScope::Unfiled), f) => f.is_none(),
            (Some(FolderScope::Folder { .. }), f) => f.is_some_and(|f| scope.contains(&f)),
        };
        let mut notes = read_notes(&conn, None)?;
        notes.retain(|n| {
            filter.tag_ids.iter().all(|t| n.tag_ids.contains(t))
                && in_folder(n.folder_id)
                && location
                    .as_ref()
                    .is_none_or(|f| n.location.as_ref().is_some_and(|l| within(l, f)))
        });
        Ok(notes)
    }

    /// The note `id` (its Guid), or `None` if there's no such note: the
    /// same `Note` that `notes` returns. A note `notes` skips (a location
    /// the reads can't map) is `None` here too.
    pub fn note(&self, id: &str) -> Result<Option<Note>, CoreError> {
        let conn = self.inner.userdata();
        let note = match note_row(&conn, id) {
            Ok(note) => note,
            Err(CoreError::NotFound) => return Ok(None),
            Err(e) => return Err(e),
        };
        Ok(read_notes(&conn, Some(note))?.pop())
    }

    /// Add a note at `location` (`None` for a free-standing one), on the
    /// highlight `highlight_id` if given, filed in `folder_id` if given, and
    /// tagged with its body's inline #tags: each matches a user tag ignoring
    /// case, or becomes a new one. An unknown highlight or folder =>
    /// `NotFound`; a malformed location => `Invalid`.
    pub fn add_note(
        &self,
        title: &str,
        content: &str,
        location: Option<&Location>,
        highlight_id: Option<&str>,
        folder_id: Option<i64>,
    ) -> Result<Note, CoreError> {
        let place = location.map(split).transpose()?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        if let Some(folder) = folder_id {
            folder_parent(&tx, folder)?;
        }
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
        if let Some(folder) = folder_id {
            tx.execute(
                "INSERT INTO BereanNoteFolder (NoteId, FolderId) VALUES (?1, ?2)",
                [id, folder],
            )?;
        }
        sync_inline_tags(&tx, id, None, content)?;
        tx.commit()?;
        read_notes(&conn, Some(id))?
            .pop()
            .ok_or_else(|| CoreError::Invalid("note not readable".into()))
    }

    /// Replace the note `id`'s title and content, stamping it modified now,
    /// and sync its tags with the body's inline #tags (see `add_note`).
    /// Unknown => `NotFound`.
    pub fn update_note(&self, id: &str, title: &str, content: &str) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let (note, old): (i64, Option<String>) = tx.query_row(
            "SELECT NoteId, Content FROM Note WHERE Guid = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        tx.execute(
            &format!(
                "UPDATE Note SET Title = ?2, Content = ?3, LastModified = {NOW} WHERE NoteId = ?1"
            ),
            params![note, title, content],
        )?;
        sync_inline_tags(&tx, note, old.as_deref(), content)?;
        tx.commit()?;
        Ok(())
    }

    /// Check or uncheck the note `id`'s task `index` (`NoteTask::index` in
    /// its rendered body), stamping it modified now. Only the marker's
    /// character changes in the stored Markdown. Unknown => `NotFound`;
    /// `index` past the last task => `Invalid`.
    pub fn set_task(&self, id: &str, index: u32, checked: bool) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let (note, content): (i64, Option<String>) = tx.query_row(
            "SELECT NoteId, Content FROM Note WHERE Guid = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let content = notes::set_task(content.as_deref().unwrap_or_default(), index, checked)
            .ok_or_else(|| CoreError::Invalid(format!("the note has no task {index}")))?;
        tx.execute(
            &format!("UPDATE Note SET Content = ?2, LastModified = {NOW} WHERE NoteId = ?1"),
            params![note, content],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Remove the note `id` and its tagging (its filing goes by cascade).
    /// Unknown => `NotFound`.
    pub fn remove_note(&self, id: &str) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let note = note_row(&tx, id)?;
        tx.execute("DELETE FROM TagMap WHERE NoteId = ?1", [note])?;
        tx.execute("DELETE FROM Note WHERE NoteId = ?1", [note])?;
        tx.commit()?;
        Ok(())
    }

    /// A note body parsed into the tree the apps draw (see `notes`), with
    /// app links flagged `missing` when their publication isn't installed.
    /// Fails only on reading the installed list.
    pub fn render_markdown(&self, markdown: &str) -> Result<Vec<notes::Block>, CoreError> {
        // One query per render; the core lock is released before parsing.
        let installed = self.installed()?;
        Ok(notes::render(markdown, &|key| installed.contains(key)))
    }

    /// The `pub_key`s installed, for `missing` flags: one query, under the
    /// core lock only while it runs.
    fn installed(&self) -> Result<HashSet<String>, CoreError> {
        let installed = self
            .inner
            .conn()
            .prepare("SELECT pub_key FROM installed_publication")?
            .query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(installed)
    }

    // Folders. Berean-only: they live in their own tables beside JW's (see
    // `userdata_berean.sql`). Names are trimmed and must be non-empty and
    // unique among siblings, ignoring ASCII case.

    /// Every folder, flat, in tree order: depth-first, siblings by position.
    pub fn folders(&self) -> Result<Vec<Folder>, CoreError> {
        read_folders(&self.inner.userdata())
    }

    /// Add a folder called `name` under `parent_id` (`None` = top level),
    /// last among its siblings. A bad or taken name => `Invalid`; an
    /// unknown parent => `NotFound`.
    pub fn create_folder(&self, name: &str, parent_id: Option<i64>) -> Result<Folder, CoreError> {
        let name = folder_name(name)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        if let Some(parent) = parent_id {
            folder_parent(&tx, parent)?;
        }
        check_folder_name_free(&tx, parent_id, name, None)?;
        let position = sibling_ids(&tx, parent_id)?.len() as i64;
        tx.execute(
            "INSERT INTO BereanFolder (ParentId, Name, Position) VALUES (?1, ?2, ?3)",
            params![parent_id, name, position],
        )?;
        let id = tx.last_insert_rowid();
        let folder = read_folders(&tx)?
            .into_iter()
            .find(|f| f.id == id)
            .ok_or(CoreError::NotFound)?;
        tx.commit()?;
        Ok(folder)
    }

    /// Rename folder `id` to `name`. Unknown => `NotFound`; a bad or taken
    /// name => `Invalid`.
    pub fn rename_folder(&self, id: i64, name: &str) -> Result<(), CoreError> {
        let name = folder_name(name)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let parent = folder_parent(&tx, id)?;
        check_folder_name_free(&tx, parent, name, Some(id))?;
        tx.execute(
            "UPDATE BereanFolder SET Name = ?2 WHERE FolderId = ?1",
            params![id, name],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Move folder `id` under `parent_id` (`None` = top level) at
    /// `position` among its new siblings, clamped to the end; within the
    /// same parent this reorders. Siblings in the old and new parent are
    /// renumbered densely. Unknown folder or parent => `NotFound`; a parent
    /// that is the folder or under it, or a name taken there => `Invalid`.
    pub fn move_folder(
        &self,
        id: i64,
        parent_id: Option<i64>,
        position: u32,
    ) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let old_parent = folder_parent(&tx, id)?;
        // Cycle check: walk up from the new parent; meeting `id` means the
        // new parent is the folder itself or one of its descendants.
        let mut up = parent_id;
        while let Some(at) = up {
            if at == id {
                return Err(CoreError::Invalid(
                    "a folder can't move into itself or one of its subfolders".into(),
                ));
            }
            up = folder_parent(&tx, at)?;
        }
        let name: String = tx.query_row(
            "SELECT Name FROM BereanFolder WHERE FolderId = ?1",
            [id],
            |r| r.get(0),
        )?;
        check_folder_name_free(&tx, parent_id, &name, Some(id))?;

        let mut old: Vec<i64> = sibling_ids(&tx, old_parent)?;
        old.retain(|&f| f != id);
        set_positions(&tx, &old)?;
        tx.execute(
            "UPDATE BereanFolder SET ParentId = ?2 WHERE FolderId = ?1",
            params![id, parent_id],
        )?;
        let mut new: Vec<i64> = sibling_ids(&tx, parent_id)?;
        new.retain(|&f| f != id);
        new.insert((position as usize).min(new.len()), id);
        set_positions(&tx, &new)?;
        tx.commit()?;
        Ok(())
    }

    /// Delete folder `id` and all its subfolders. Their notes are kept and
    /// become unfiled. Returns what was removed, for
    /// [`restore_folder`](Self::restore_folder). Unknown => `NotFound`.
    pub fn delete_folder(&self, id: i64) -> Result<DeletedFolder, CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let all = read_folders(&tx)?;
        let at = all
            .iter()
            .position(|f| f.id == id)
            .ok_or(CoreError::NotFound)?;
        // In pre-order the subtree is the run after `id` that is deeper.
        let depth = all[at].depth;
        let folders: Vec<Folder> = std::iter::once(&all[at])
            .chain(all[at + 1..].iter().take_while(|f| f.depth > depth))
            .cloned()
            .collect();
        let ids: HashSet<i64> = folders.iter().map(|f| f.id).collect();
        let mut notes: Vec<NoteFolder> = tx
            .prepare(
                "SELECT n.Guid, nf.FolderId FROM BereanNoteFolder nf \
                 JOIN Note n ON n.NoteId = nf.NoteId ORDER BY nf.NoteId",
            )?
            .query_map([], |r| {
                Ok(NoteFolder {
                    note_id: r.get(0)?,
                    folder_id: r.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        notes.retain(|n| ids.contains(&n.folder_id));
        // The cascade removes the subfolders and the notes' filings.
        tx.execute("DELETE FROM BereanFolder WHERE FolderId = ?1", [id])?;
        set_positions(&tx, &sibling_ids(&tx, all[at].parent_id)?)?;
        tx.commit()?;
        Ok(DeletedFolder { folders, notes })
    }

    /// Undo [`delete_folder`](Self::delete_folder): put the folders back
    /// with their ids, parents, names and positions (the top one at its old
    /// position among the current siblings), and refile the notes that
    /// still exist and are still unfiled. A folder id that is taken, a
    /// parent that is gone, a name a sibling has taken since, or a snapshot
    /// that isn't one subtree => `Invalid`, changing nothing.
    pub fn restore_folder(&self, deleted: &DeletedFolder) -> Result<(), CoreError> {
        let invalid = |what: &str| Err(CoreError::Invalid(format!("can't restore folder: {what}")));
        let Some(top) = deleted.folders.first() else {
            return invalid("nothing to restore");
        };
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        if let Some(parent) = top.parent_id {
            if !folder_exists(&tx, parent)? {
                return invalid("its parent is gone");
            }
        }
        check_folder_name_free(&tx, top.parent_id, &top.name, None)?;
        let mut restored = HashSet::new();
        let mut insert = tx.prepare(
            "INSERT INTO BereanFolder (FolderId, ParentId, Name, Position) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for (i, f) in deleted.folders.iter().enumerate() {
            // Parents before children: the snapshot is in tree order.
            if i > 0 && !f.parent_id.is_some_and(|p| restored.contains(&p)) {
                return invalid("the snapshot isn't one subtree");
            }
            if folder_exists(&tx, f.id)? {
                return invalid("a folder id is taken");
            }
            insert.execute(params![f.id, f.parent_id, f.name, f.position])?;
            restored.insert(f.id);
        }
        drop(insert);
        // Put the top folder back at its old place among today's siblings.
        let mut siblings = sibling_ids(&tx, top.parent_id)?;
        siblings.retain(|&f| f != top.id);
        siblings.insert((top.position as usize).min(siblings.len()), top.id);
        set_positions(&tx, &siblings)?;
        // Refile only notes still here and not filed elsewhere meanwhile.
        let mut refile = tx.prepare(
            "INSERT INTO BereanNoteFolder (NoteId, FolderId) SELECT n.NoteId, ?2 FROM Note n \
             WHERE n.Guid = ?1 AND NOT EXISTS \
             (SELECT 1 FROM BereanNoteFolder f WHERE f.NoteId = n.NoteId)",
        )?;
        for n in &deleted.notes {
            if !restored.contains(&n.folder_id) {
                return invalid("a note's folder isn't in the snapshot");
            }
            refile.execute(params![n.note_id, n.folder_id])?;
        }
        drop(refile);
        tx.commit()?;
        Ok(())
    }

    /// File the note `note_id` in `folder_id`, or unfile it for `None`.
    /// Unknown note or folder => `NotFound`.
    pub fn set_note_folder(&self, note_id: &str, folder_id: Option<i64>) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let note = note_row(&tx, note_id)?;
        match folder_id {
            Some(folder) => {
                folder_parent(&tx, folder)?;
                tx.execute(
                    "INSERT INTO BereanNoteFolder (NoteId, FolderId) VALUES (?1, ?2) \
                     ON CONFLICT (NoteId) DO UPDATE SET FolderId = excluded.FolderId",
                    [note, folder],
                )?;
            }
            None => {
                tx.execute("DELETE FROM BereanNoteFolder WHERE NoteId = ?1", [note])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    // Studyspace. Berean-only, like folders: one canvas per workspace, its
    // cards in `BereanCanvasItem`. Workspace names are trimmed and must be
    // non-empty and unique, ignoring ASCII case. Frames and viewports are
    // in canvas points at zoom 1.0.

    /// Every workspace, in the order they were made.
    pub fn workspaces(&self) -> Result<Vec<Workspace>, CoreError> {
        read_workspaces(&self.inner.userdata(), None)
    }

    /// Add an empty workspace called `name`, with no viewport saved. A bad
    /// or taken name => `Invalid`.
    pub fn create_workspace(&self, name: &str) -> Result<Workspace, CoreError> {
        let name = workspace_name(name)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        check_workspace_name_free(&tx, name, None)?;
        tx.execute("INSERT INTO BereanWorkspace (Name) VALUES (?1)", [name])?;
        let workspace = read_workspaces(&tx, Some(tx.last_insert_rowid()))?
            .pop()
            .ok_or(CoreError::NotFound)?;
        tx.commit()?;
        Ok(workspace)
    }

    /// Rename workspace `id` to `name`. Unknown => `NotFound`; a bad or
    /// taken name => `Invalid`.
    pub fn rename_workspace(&self, id: i64, name: &str) -> Result<(), CoreError> {
        let name = workspace_name(name)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        check_workspace(&tx, id)?;
        check_workspace_name_free(&tx, name, Some(id))?;
        tx.execute(
            "UPDATE BereanWorkspace SET Name = ?2 WHERE WorkspaceId = ?1",
            params![id, name],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Delete workspace `id` and its cards; the notes on it are kept. There
    /// is no undo. Unknown => `NotFound`.
    pub fn delete_workspace(&self, id: i64) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        // The cascade removes its items.
        let n = tx.execute("DELETE FROM BereanWorkspace WHERE WorkspaceId = ?1", [id])?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
        tx.commit()?;
        Ok(())
    }

    /// The workspace open last, if any: `None` before the first
    /// `set_last_workspace`, after it's cleared, after that workspace is
    /// deleted, and after an import.
    pub fn last_workspace(&self) -> Result<Option<i64>, CoreError> {
        let conn = self.inner.userdata();
        Ok(conn
            .query_row(
                "SELECT LastWorkspaceId FROM BereanStudyspace WHERE Id = 1",
                [],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }

    /// Remember `id` as the workspace open last (`None` clears it). An
    /// unknown id => `NotFound`.
    pub fn set_last_workspace(&self, id: Option<i64>) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        if let Some(id) = id {
            check_workspace(&tx, id)?;
        }
        tx.execute(
            "INSERT INTO BereanStudyspace (Id, LastWorkspaceId) VALUES (1, ?1) \
             ON CONFLICT (Id) DO UPDATE SET LastWorkspaceId = excluded.LastWorkspaceId",
            [id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Save where workspace `workspace_id`'s view is (its centre and zoom).
    /// Unknown => `NotFound`; a centre out of bounds, or a zoom that isn't
    /// finite and over 0 => `Invalid`.
    pub fn set_viewport(&self, workspace_id: i64, viewport: &Viewport) -> Result<(), CoreError> {
        check_viewport(viewport)?;
        let Viewport { x, y, zoom } = *viewport;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let n = tx.execute(
            "UPDATE BereanWorkspace SET ViewX = ?2, ViewY = ?3, Zoom = ?4 WHERE WorkspaceId = ?1",
            params![workspace_id, x, y, zoom],
        )?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
        tx.commit()?;
        Ok(())
    }

    /// The cards on workspace `workspace_id`, in `order`, with `missing`
    /// set for passages and excerpts whose publication isn't installed.
    /// Unknown => `NotFound`.
    pub fn items(&self, workspace_id: i64, order: ItemOrder) -> Result<Vec<CanvasItem>, CoreError> {
        let installed = self.installed()?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        check_workspace(&tx, workspace_id)?;
        let items = read_items(&tx, Some(workspace_id), None, order, &installed)?;
        tx.commit()?;
        Ok(items)
    }

    /// Put `card` on workspace `workspace_id` at `frame`, on top of the
    /// others (`z` one past the highest; 1 on an empty canvas). `missing`
    /// is ignored. An unknown workspace or note => `NotFound`; a bad frame,
    /// a span `passage_url` rejects, a location `publication_url` rejects,
    /// or a note already on the workspace => `Invalid`.
    pub fn add_item(
        &self,
        workspace_id: i64,
        card: &CardRef,
        frame: &Frame,
    ) -> Result<CanvasItem, CoreError> {
        check_frame(frame)?;
        let target = match card {
            CardRef::Note { .. } => None,
            CardRef::Passage { span, .. } => Some(notes::passage_url(span)?),
            CardRef::Publication { location, .. } => Some(notes::publication_url(location)?),
        };
        let installed = self.installed()?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        check_workspace(&tx, workspace_id)?;
        let note = match card {
            CardRef::Note { note_id } => {
                let note = note_row(&tx, note_id)?;
                let there: bool = tx.query_row(
                    "SELECT EXISTS (SELECT 1 FROM BereanCanvasItem \
                     WHERE WorkspaceId = ?1 AND NoteId = ?2)",
                    [workspace_id, note],
                    |r| r.get(0),
                )?;
                if there {
                    return Err(CoreError::Invalid(format!(
                        "the note {note_id} is already on workspace {workspace_id}"
                    )));
                }
                Some(note)
            }
            _ => None,
        };
        tx.execute(
            &format!(
                "INSERT INTO BereanCanvasItem \
                 (WorkspaceId, NoteId, Target, X, Y, Width, Height, Z, LastUsedAt) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, \
                 (SELECT COALESCE(MAX(Z), 0) + 1 FROM BereanCanvasItem WHERE WorkspaceId = ?1), \
                 {NOW})"
            ),
            params![
                workspace_id,
                note,
                target,
                frame.x,
                frame.y,
                frame.width,
                frame.height
            ],
        )?;
        let item = read_items(
            &tx,
            None,
            Some(tx.last_insert_rowid()),
            ItemOrder::Z,
            &installed,
        )?
        .pop()
        .ok_or_else(|| CoreError::Invalid(format!("card not readable: {card:?}")))?;
        tx.commit()?;
        Ok(item)
    }

    /// Move or resize items: each gets its new frame, all or nothing. Empty
    /// is a no-op. Any frame bad => `Invalid`, any id unknown => `NotFound`,
    /// changing nothing.
    pub fn set_frames(&self, frames: &[ItemFrame]) -> Result<(), CoreError> {
        for f in frames {
            check_frame(&f.frame)?;
        }
        if frames.is_empty() {
            return Ok(());
        }
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let mut update = tx.prepare(
            "UPDATE BereanCanvasItem SET X = ?2, Y = ?3, Width = ?4, Height = ?5 \
             WHERE ItemId = ?1",
        )?;
        for ItemFrame { id, frame } in frames {
            let n = update.execute(params![id, frame.x, frame.y, frame.width, frame.height])?;
            if n == 0 {
                return Err(CoreError::NotFound);
            }
        }
        drop(update);
        tx.commit()?;
        Ok(())
    }

    /// Put item `item_id` on top of its workspace (`z` one past the
    /// highest) and return its new `z`. Unknown => `NotFound`.
    pub fn bring_to_front(&self, item_id: i64) -> Result<i64, CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let z: i64 = tx.query_row(
            "SELECT MAX(o.Z) + 1 FROM BereanCanvasItem i \
             JOIN BereanCanvasItem o ON o.WorkspaceId = i.WorkspaceId WHERE i.ItemId = ?1 \
             GROUP BY i.ItemId",
            [item_id],
            |r| r.get(0),
        )?;
        tx.execute(
            "UPDATE BereanCanvasItem SET Z = ?2 WHERE ItemId = ?1",
            [item_id, z],
        )?;
        tx.commit()?;
        Ok(z)
    }

    /// Save where passage or excerpt card `item_id` has been read to (see
    /// [`ReaderState`]), for a reader that calls this while scrolling: one
    /// `UPDATE` by primary key that also bumps `last_used_at` and touches
    /// nothing else (not `z`, not the frame). `missing` is ignored. Each card has its own state, so two
    /// cards on one publication stay independent.
    ///
    /// Unknown item => `NotFound`. A note card; an `at` of the other kind or
    /// another publication (a Bible card stays in its Bible, a publication
    /// card in its `pub_key`); a passage that isn't one verse; a location
    /// without a paragraph; or a span or location the URL builders reject
    /// => `Invalid`.
    pub fn set_reader_state(&self, item_id: i64, state: &ReaderState) -> Result<(), CoreError> {
        let (url, prefix, pub_key) = match &state.at {
            CardRef::Note { .. } => {
                return Err(CoreError::Invalid(
                    "a reader is at a verse or paragraph".into(),
                ))
            }
            CardRef::Passage { span, .. } => {
                if span.start != span.end || span.start.verse.is_none() {
                    return Err(CoreError::Invalid(format!(
                        "a Bible reader is at one verse: {span:?}"
                    )));
                }
                (
                    notes::passage_url(span)?,
                    "berean://bible/",
                    &span.start.pub_key,
                )
            }
            CardRef::Publication { location, .. } => {
                if location.paragraph.is_none() {
                    return Err(CoreError::Invalid(format!(
                        "a publication reader is at a paragraph: {location:?}"
                    )));
                }
                (
                    notes::publication_url(location)?,
                    "berean://pub/",
                    &location.pub_key,
                )
            }
        };
        // The card's `Target` must be this kind and publication: its URL is
        // `{prefix}{pub_key}` (a publication) or starts `{prefix}{pub_key}/`,
        // and the '/' keeps `nwt` from matching `nwtsty`. `substr`, not
        // LIKE, so no character in the key is a wildcard.
        let base = format!("{prefix}{pub_key}");
        let conn = self.inner.userdata();
        let n = conn.execute(
            &format!(
                "UPDATE BereanCanvasItem \
                 SET ReaderAt = ?2, ReaderCharOffset = ?3, LastUsedAt = {NOW} \
                 WHERE ItemId = ?1 \
                 AND (Target = ?4 OR substr(Target, 1, length(?4) + 1) = ?4 || '/')"
            ),
            params![item_id, url, state.char_offset, base],
        )?;
        if n == 0 {
            let exists: bool = conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM BereanCanvasItem WHERE ItemId = ?1)",
                [item_id],
                |r| r.get(0),
            )?;
            return Err(if exists {
                CoreError::Invalid(format!(
                    "item {item_id} isn't a reader on {base}: {:?}",
                    state.at
                ))
            } else {
                CoreError::NotFound
            });
        }
        Ok(())
    }

    /// Mark item `item_id` as just used: bump its `last_used_at` to now,
    /// leaving `z`, the frame and everything else as they are. For focusing
    /// a card, and for link reuse: following a link to something already on
    /// the canvas, the app picks the most recently used card. Unknown =>
    /// `NotFound`.
    pub fn touch_item(&self, item_id: i64) -> Result<(), CoreError> {
        let conn = self.inner.userdata();
        let n = conn.execute(
            &format!("UPDATE BereanCanvasItem SET LastUsedAt = {NOW} WHERE ItemId = ?1"),
            [item_id],
        )?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
        Ok(())
    }

    /// Take item `item_id` off its workspace ("Remove from workspace"); a
    /// note card's note is kept. Unknown => `NotFound`.
    pub fn remove_item(&self, item_id: i64) -> Result<(), CoreError> {
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let n = tx.execute("DELETE FROM BereanCanvasItem WHERE ItemId = ?1", [item_id])?;
        if n == 0 {
            return Err(CoreError::NotFound);
        }
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

    /// Rename the user tag `id` to `name` (trimmed). When both names are
    /// inline tag names, the notes with the tag also have each inline
    /// `#old` (ignoring case) in their body rewritten to `#name`, and are
    /// stamped modified now. Unknown => `NotFound`; an empty name, or one
    /// another tag has => `Invalid`.
    pub fn rename_tag(&self, id: i64, name: &str) -> Result<(), CoreError> {
        let name = tag_name(name)?;
        let mut conn = self.inner.userdata();
        let tx = conn.transaction()?;
        let old: String = tx.query_row(
            "SELECT Name FROM Tag WHERE TagId = ?1 AND Type = 1",
            [id],
            |r| r.get(0),
        )?;
        check_tag_free(&tx, name, Some(id))?;
        tx.execute(
            "UPDATE Tag SET Name = ?2 WHERE TagId = ?1",
            params![id, name],
        )?;
        if notes::is_tag_name(&old) && notes::is_tag_name(name) {
            let bodies: Vec<(i64, String)> = tx
                .prepare(
                    "SELECT n.NoteId, n.Content FROM Note n JOIN TagMap m ON m.NoteId = n.NoteId \
                     WHERE m.TagId = ?1 AND n.Content IS NOT NULL",
                )?
                .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            for (note, body) in bodies {
                let renamed = notes::rename_inline_tag(&body, &old, name);
                if renamed != body {
                    tx.execute(
                        &format!(
                            "UPDATE Note SET Content = ?2, LastModified = {NOW} WHERE NoteId = ?1"
                        ),
                        params![note, renamed],
                    )?;
                }
            }
        }
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
        tag_note_row(&tx, note, tag_id)?;
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
        untag_note_row(&tx, note, tag_id)?;
        tx.commit()?;
        Ok(())
    }

    // Favorites.

    /// The favorites, in their order.
    pub fn favorites(&self) -> Result<Vec<Location>, CoreError> {
        read_favorites(&self.inner.userdata())
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
        read_bookmarks(&self.inner.userdata(), Some(&publication))
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

    // Backups.

    /// Write a `.jwlibrary` backup of all the user data to `path`, replacing
    /// any file there: the database as stored (every JW table, those Berean
    /// doesn't surface included, and note bodies as written, in Markdown),
    /// its manifest, and the media files. Berean's own tables (note folders,
    /// Studyspace) are left out, so the file is the JW schema alone.
    /// The file appears at `path` whole or not at all: it is written beside
    /// it and renamed into place. Progress counts [`EXPORT_STEPS`] steps.
    ///
    /// Cancelled => `Cancelled`; a destination that can't be written =>
    /// `Io`. On any error nothing is left at `path` but what was there.
    pub fn export_backup(
        &self,
        path: impl AsRef<Path>,
        progress: &dyn ProgressSink,
        cancel: &CancelToken,
    ) -> Result<(), CoreError> {
        let path = path.as_ref();
        cancel.check()?;
        let dest_dir = match path.parent() {
            Some(p) if !p.as_os_str().is_empty() => p,
            _ => Path::new("."),
        };
        // Dropping `staging` deletes whatever is left in it, on every path.
        let staging = TempDir::with_prefix_in(".userData-export.", dest_dir)?;
        let copy = staging.path().join(DB_FILE);
        let copy_str = copy
            .to_str()
            .ok_or_else(|| CoreError::Io(format!("path not UTF-8: {}", copy.display())))?;
        {
            let conn = self.inner.userdata();
            conn.execute("VACUUM INTO ?1", [copy_str])?;
        }
        {
            // The file JW sees is pure v16: Berean's tables (and their
            // indexes) go, and the VACUUM rebuilds the schema without the
            // `sqlite_sequence` their `AUTOINCREMENT` added, which can't be
            // dropped and isn't in JW's schema.
            let conn = Connection::open(&copy)?;
            conn.execute_batch(
                "DROP TABLE IF EXISTS BereanStudyspace;
                 DROP TABLE IF EXISTS BereanCanvasItem;
                 DROP TABLE IF EXISTS BereanWorkspace;
                 DROP TABLE IF EXISTS BereanNoteFolder;
                 DROP TABLE IF EXISTS BereanFolder;
                 VACUUM;",
            )?;
        }
        progress.on_progress(1, EXPORT_STEPS);

        cancel.check()?;
        let (last_modified, creation_date) = {
            let conn = Connection::open(&copy)?;
            let last_modified: String = conn
                .query_row("SELECT LastModified FROM LastModified", [], |r| r.get(0))
                .map_err(|_| CoreError::Corrupt)?;
            let now: String = conn.query_row(&format!("SELECT {NOW}"), [], |r| r.get(0))?;
            (last_modified, now)
        };
        progress.on_progress(2, EXPORT_STEPS);

        cancel.check()?;
        let hash = sha256_file(&copy)?;
        progress.on_progress(3, EXPORT_STEPS);

        cancel.check()?;
        let manifest = Manifest {
            name: DEVICE_NAME.into(),
            creation_date,
            version: 1,
            kind: 0,
            user_data_backup: BackupInfo {
                last_modified_date: last_modified,
                device_name: DEVICE_NAME.into(),
                database_name: DB_FILE.into(),
                hash,
                schema_version: SCHEMA_VERSION,
            },
        };
        let manifest = serde_json::to_vec(&manifest)
            .map_err(|e| CoreError::Invalid(format!("manifest: {e}")))?;
        let media = self.inner.data_dir.join(MEDIA_DIR);
        let out = NamedTempFile::with_prefix_in(".userData-export.", dest_dir)?;
        let mut zip = zip::ZipWriter::new(out);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file(MANIFEST, options).map_err(zip_write_error)?;
        zip.write_all(&manifest)?;
        zip.start_file(DB_FILE, options).map_err(zip_write_error)?;
        std::io::copy(&mut File::open(&copy)?, &mut zip)?;
        for name in media_files(&media)? {
            // A media file can't stand in for the manifest or the database.
            if name == MANIFEST || name == DB_FILE {
                continue;
            }
            zip.start_file(name.as_str(), options)
                .map_err(zip_write_error)?;
            std::io::copy(&mut File::open(media.join(&name))?, &mut zip)?;
        }
        let out = zip.finish().map_err(zip_write_error)?;
        out.as_file().sync_all()?;
        progress.on_progress(4, EXPORT_STEPS);

        cancel.check()?;
        out.persist(path).map_err(|e| CoreError::from(e.error))?;
        progress.on_progress(EXPORT_STEPS, EXPORT_STEPS);
        Ok(())
    }

    /// Replace all the user data with the `.jwlibrary` backup at `path`, as
    /// JW Library's restore does, and say what it holds. Schema v14 is
    /// upgraded to v16; tables and columns Berean doesn't know are kept.
    /// The previous data is kept for one [`undo_import`](Self::undo_import).
    /// Progress counts [`IMPORT_STEPS`] steps; cancel is honoured until the
    /// new data is swapped in, the last step.
    ///
    /// A damaged zip, a missing member, a member whose name leaves the
    /// directory, a hash or schema version that doesn't match the manifest,
    /// or a database that fails its integrity or foreign-key check =>
    /// `Corrupt`. A malformed manifest or a schema version other than 14 or
    /// 16 => `Invalid`. Cancelled => `Cancelled`. On any error the current
    /// data is untouched.
    pub fn import_backup(
        &self,
        path: impl AsRef<Path>,
        progress: &dyn ProgressSink,
        cancel: &CancelToken,
    ) -> Result<ImportSummary, CoreError> {
        cancel.check()?;
        let dir = &self.inner.data_dir;
        // Dropping `staging` deletes whatever is left in it, on every path.
        let staging = TempDir::with_prefix_in(".userData-import.", dir)?;
        let staged = stage_backup(
            path.as_ref(),
            staging.path(),
            IMPORT_STEPS,
            progress,
            cancel,
        )?;

        cancel.check()?;
        let trash = staging.path();
        swap_files(
            dir,
            &mut self.inner.userdata(),
            &[
                (dir.join(PREV_DB), trash.join("old.prev.db"), false),
                (dir.join(PREV_MEDIA), trash.join("old.prev.media"), false),
                (dir.join(DB_FILE), dir.join(PREV_DB), true),
                (dir.join(MEDIA_DIR), dir.join(PREV_MEDIA), false),
                (trash.join(DB_FILE), dir.join(DB_FILE), true),
                (trash.join("media"), dir.join(MEDIA_DIR), true),
            ],
        )?;
        progress.on_progress(IMPORT_STEPS, IMPORT_STEPS);
        Ok(staged.summary)
    }

    /// Check the `.jwlibrary` backup at `path` exactly as
    /// [`import_backup`](Self::import_backup) does, without importing it,
    /// and say what an import would bring in and what it would replace and
    /// clear, for the warning the UI shows first. The backup is staged in a
    /// temporary dir in the data dir and discarded; nothing else changes.
    /// Progress counts [`STAGE_STEPS`] steps, the import's own but the swap;
    /// cancel is honoured between them.
    ///
    /// The same errors as `import_backup`. A preview that passes means the
    /// import passes too, unless the file changes in between.
    pub fn import_preview(
        &self,
        path: impl AsRef<Path>,
        progress: &dyn ProgressSink,
        cancel: &CancelToken,
    ) -> Result<ImportPreview, CoreError> {
        cancel.check()?;
        // Counted first, under the lock only while counting: progress is
        // never reported with it held.
        let (current, folders, filed_notes) = {
            let conn = self.inner.userdata();
            let count = |table: &str| -> Result<u32, CoreError> {
                let n: i64 =
                    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?;
                Ok(to_u32(n).unwrap_or(u32::MAX))
            };
            (
                summary(&conn)?,
                count("BereanFolder")?,
                count("BereanNoteFolder")?,
            )
        };
        // Dropping `staging` deletes it, on every path.
        let staging = TempDir::with_prefix_in(".userData-preview.", &self.inner.data_dir)?;
        let staged = stage_backup(path.as_ref(), staging.path(), STAGE_STEPS, progress, cancel)?;
        staging.close()?;
        Ok(ImportPreview {
            backup: staged.summary,
            current,
            folders,
            filed_notes,
            device_name: staged.device_name,
            created: staged.created,
        })
    }

    /// Put back the data the last [`import_backup`](Self::import_backup)
    /// replaced, dropping what it brought in, and say whether it did. There
    /// is one undo: after it, or before any import, there is no undo copy
    /// and this returns `false`, changing nothing.
    pub fn undo_import(&self) -> Result<bool, CoreError> {
        let dir = &self.inner.data_dir;
        // Checked under the lock, so an import can't land in between.
        let mut conn = self.inner.userdata();
        if !dir.join(PREV_DB).is_file() {
            return Ok(false);
        }
        let staging = TempDir::with_prefix_in(".userData-undo.", dir)?;
        let trash = staging.path();
        swap_files(
            dir,
            &mut conn,
            &[
                (dir.join(DB_FILE), trash.join(DB_FILE), true),
                (dir.join(MEDIA_DIR), trash.join("media"), false),
                (dir.join(PREV_DB), dir.join(DB_FILE), true),
                (dir.join(PREV_MEDIA), dir.join(MEDIA_DIR), false),
            ],
        )?;
        Ok(true)
    }
}
