# Markdown notes, folders and tags (core FFI shapes)

Status: Decided by Wren (Oct 29, 2026); implementation follows in echo/mdnotes-impl. Row: Core: Markdown notes with folders and tags.

UI reference: design guide §07.1 (Lumen, #29)

This doc covers the core side only: the render tree, the link URLs, the folder and tag calls, the storage, and
the import warning. It builds on the userdata design ([userdata.md](userdata.md), #20).

## 1. Decided (Wren, Oct 28)

These are settled and not up for review here.

- **Body.** The note body (`userData.db` `Note.Content`) stores raw Markdown. The core parses it into one
  shared block/inline tree that every app renders (SwiftUI, Expo). App links (Bible passages, publications)
  come back resolved. A link to a jwpub that isn't installed is flagged `missing`.
- **Parser.** `pulldown-cmark` with `default-features = false`. `ENABLE_STRIKETHROUGH` and `ENABLE_TASKLISTS`
  are on. Tables are off unless Lumen asks. No footnotes, no smart punctuation, no heading attributes.
- **Links.** App links are plain Markdown links whose visible text is the reference. Titles (`Note.Title`)
  stay plain text. Legacy JW notes render as Markdown (accepted).
- **Folders.** A Berean-only nested folder table in `userData.db`, and a folder per note. Create, rename, move
  (reparent, cycle-safe), delete.
- **Tags.** Reuse JW's `Tag` (Type 1) and `TagMap` tables.
- **Backup.** `.jwlibrary` export stays JW-compatible: the Markdown body is written as is, and folders are
  dropped. Import treats plain text as Markdown. It must warn first that it replaces data and clears folders:
  the core exposes the info, the UI shows the warning.
- **Berean-native backup.** One that keeps folders is a separate Holding row (Core: Berean-native backup that
  keeps note folders).

## 2. What the UI needs (guide §07.1)

| Need | Served by |
|---|---|
| Read view: headings, bold, italic, strikethrough, lists, checklists, quotes, inline code, code blocks, rules, links, inline #tags | `render_markdown` → `Block` / `Inline` |
| A passage link alone on its own line renders as a passage card (reference + verse text) | `Block::PassageCard`; verse text from `Reader::bible_chapter` |
| Links to missing content get a dashed underline | `missing` on `LinkTarget::Passage` / `Publication` and `PassageCard` |
| Tapping a missing publication opens the "Download this publication" row | UI, with the existing catalog/download calls and the link's `pub_key` |
| Plain tap opens a link; long press previews | UI, with `Reader` and the resolved `Location` / `LocationSpan` |
| Typing a full reference offers "Link John 1:14" | `Reader::resolve`, then `passage_url` |
| `[[` opens Omnisearch limited to verses, chapters and publications; the result is stored as a standard Markdown link with a `berean://` target | `passage_url`, `publication_url` (the core owns the URL format) |
| Sidebar: All Notes (count), Recents, nested folder tree with per-folder note counts, subfolder counts, Tags | `folders()` (`note_count` includes subfolders: Gospel of John 14 = Prologue 6 + Signs 5 + Witnesses 3), `notes`, `tags` |
| Folder menu: New Folder, New Note in folder, Rename, Move to…, Move Up / Move Down, Delete Folder… with confirm and an 8 s Undo | `create_folder`, `add_note(folder_id)`, `rename_folder`, `move_folder`, `delete_folder` + `restore_folder` |
| Notes: drag onto a folder, Move to folder | `set_note_folder` |
| Tags from inline #tags in the body and from the tag field in the note's info, in one Tags list; tag chips and search tokens combine | inline tag sync in `add_note` / `update_note`; `tag_note`; `NoteFilter.tag_ids` |
| Write view: live-styled source with dimmed syntax | `markdown_spans`, a follow-up Holding row (Core: markdown_spans for note editor syntax ranges, owner Echo) that lands before Expo 6 and Kiwi's notes editor; see Q7 |

## 3. URL format for app links

The core parses and builds these. The visible link text is free: it's the human reference, e.g. "John 1:9".

- **Passage:** `berean://bible/{pub_key}/{book}/{chapter}[/{verse}][-{end}]`
  - `pub_key` is the Bible's key as used everywhere in the core (`{symbol}:{meps_language}:{issue_tag}`, e.g.
    `nwtsty:0:0`). `book` is the number 1–66.
  - With a verse, `end` is `{verse}` (same chapter) or `{chapter}/{verse}` (cross-chapter). With no verse,
    `end` is a chapter.
  - Examples: `berean://bible/nwtsty:0:0/43/1/9`, `.../43/1/1-5`, `.../43/1/51-2/3`, `.../19/36` (a chapter),
    `.../43/3-4` (chapters).
  - Maps 1:1 to a `LocationSpan` within one book, the same rule `Reader::resolve` uses.
- **Publication:** `berean://pub/{pub_key}[/{doc_id}[/{paragraph}]]` → a `Location`.
- **Numbers, not book-name slugs**, so a link works in any UI language. The guide's
  `berean://bible/asv/john/1/9` was illustrative. See Q3.
- **`missing`** = the link's `pub_key` isn't in the installed publications list. Both `Passage` and
  `Publication` carry it: for a passage it means the linked Bible's jwpub isn't installed on the device; for a
  publication it means that publication's jwpub isn't installed, and it drives the "Download this
  publication" prompt. One query per render, not per link.
- `http`, `https` and `mailto` → `External`. Anything else, or a malformed `berean://` URL → `Invalid`
  (rendered as its visible text, not tappable).

## 4. Record shapes

```rust
/// One rendered note body: the shared tree every app draws.
pub enum Block {
    Heading { level: u8, inlines: Vec<Inline> },           // level 1..=6
    Paragraph { inlines: Vec<Inline> },
    /// A paragraph whose only content is one passage link: drawn as a passage card.
    PassageCard { text: String, span: LocationSpan, missing: bool },
    List { start: Option<u32>, items: Vec<ListItem> },      // Some(n) = ordered, from n
    Quote { blocks: Vec<Block> },
    CodeBlock { text: String },                            // fenced or indented; info string ignored
    Rule,
}

pub struct ListItem { pub task: Option<Task>, pub blocks: Vec<Block> }

/// A checklist item. `index` counts task items in document order, from 0.
pub struct Task { pub index: u32, pub checked: bool }

pub enum Inline {
    Text { text: String },
    Emphasis { children: Vec<Inline> },
    Strong { children: Vec<Inline> },
    Strikethrough { children: Vec<Inline> },
    Code { text: String },
    Link { children: Vec<Inline>, url: String, target: LinkTarget },
    /// An inline #tag (not inside code or a link). `name` is without the '#'.
    Tag { name: String },
    LineBreak,
}

pub enum LinkTarget {
    /// `missing`: the linked Bible's jwpub (the span's pub_key) isn't installed on the device.
    Passage { span: LocationSpan, missing: bool },
    /// `missing`: the linked publication's jwpub isn't installed on the device. The UI shows
    /// "Download this publication" for it.
    Publication { location: Location, missing: bool },
    External { url: String },
    Invalid,
}

pub struct Folder {
    pub id: i64,
    pub parent_id: Option<i64>,      // None = top level
    pub name: String,
    pub position: u32,               // order among siblings, 0-based, dense
    pub depth: u32,                  // 0 = top level
    pub note_count: u32,             // notes here and in all subfolders
    pub subfolder_count: u32,        // direct children
}

/// What delete_folder removed, so the UI's Undo can put it back exactly.
pub struct DeletedFolder { pub folders: Vec<Folder>, pub notes: Vec<NoteFolder> }
pub struct NoteFolder { pub note_id: String, pub folder_id: i64 }

pub enum FolderScope { Unfiled, Folder { id: i64, include_subfolders: bool } }

pub struct ImportPreview {
    pub backup: ImportSummary,       // what the file holds (same counting rules as ImportSummary)
    pub current: ImportSummary,      // what will be replaced
    pub folders: u32,                // Berean folders that will be cleared
    pub filed_notes: u32,            // current notes that are in a folder
    pub device_name: String,         // from the manifest
    pub created: String,             // manifest creationDate, ISO-8601 Z
}
```

Changes to existing records:
- `Note` gains one field: `pub folder_id: Option<i64>` (`None` = not in a folder).
- `NoteFilter` gains `folder: Option<FolderScope>`, and `tag_id: Option<i64>` becomes `tag_ids: Vec<i64>`: a
  note must have all of them, and empty means no tag filter. **This is a breaking change to an FFI record**
  (see Q5).

FFI facts:
- Recursion through `Vec` (`Block` in `Quote` and `ListItem`, `Inline` in `children`) generates and
  round-trips in UniFFI 0.31.2. I checked a scratch crate with exactly this shape:
  - Swift and Kotlin bindings generate.
  - The Python bindings round-trip a nested value at runtime.
  - ubrn 0.31.0-6 `generate jsi bindings` emits TS with lazily referenced `FfiConverterSequence` converters,
    so there's no ordering problem.
- Swift doesn't need `indirect`, because arrays already box.
- `i64` ids map to `bigint` in JS, as `Tag` ids do today. `Folder` counts and positions and
  `ImportPreview.folders` / `filed_notes` are `u32`, so they stay plain numbers. `ImportPreview` reuses the
  existing `ImportSummary`, whose counts are `u64`, so those arrive as `bigint` in JS, as `import_backup`'s
  do today.

## 5. `UserData` methods (sketch)

Errors use only existing `CoreError` variants: `NotFound` and `Invalid(String)` as listed, plus the usual
database errors.

### Rendering and links

| Call | Sync/async | Notes |
|---|---|---|
| `render_markdown(markdown: &str) -> Result<Vec<Block>, CoreError>` | sync | Pure parse plus one installed-pubs query. Never fails on bad Markdown (CommonMark has no syntax errors); errors come only from the database. Cheap: pulldown-cmark parses tens of KB in well under a millisecond, so it's fine on the JS thread. The UI calls it on note open and when switching to Read. |
| `markdown_spans(markdown: &str) -> Vec<SourceSpan>` | sync | Free function, no database, never fails. Flat, non-overlapping syntax ranges of the source for the Write view, from the same parser as `render_markdown`. Offsets are UTF-16 code units, half-open. Cheap enough to call on every keystroke. See Q7. |
| `passage_url(span: &LocationSpan) -> Result<String, CoreError>` | sync | Free function. `Invalid` if the span isn't a Bible passage within one book. |
| `publication_url(location: &Location) -> Result<String, CoreError>` | sync | Free function. `Invalid` if the location isn't a publication location. The UI builds the Markdown `[text](url)` itself; `text` is the reference shown to the user. |
| `set_task(note_id: &str, index: u32, checked: bool) -> Result<(), CoreError>` | sync | Rewrites the nth task marker (`[ ]` / `[x]`) in the stored Markdown, using pulldown-cmark source offsets. Everything else stays byte-identical. `NotFound` for an unknown note; `Invalid` if `index` is out of range. See Q8. |

### Folders

| Call | Sync/async | Notes |
|---|---|---|
| `folders() -> Vec<Folder>` | sync | All folders, flat, in tree order (depth-first, siblings by position). The UI builds the tree from `parent_id` and `depth`. |
| `create_folder(name: &str, parent_id: Option<i64>) -> Folder` | sync | Appended last among its siblings. `Invalid` for an empty or whitespace name, or a sibling with the same name (case-insensitive, Q10). `NotFound` for an unknown parent. |
| `rename_folder(id: i64, name: &str)` | sync | Same name rules. `NotFound` for an unknown folder. |
| `move_folder(id: i64, parent_id: Option<i64>, position: u32)` | sync | One call covers reparent, drag-reorder and Move Up / Move Down. `position` is clamped to the end. `Invalid` if the new parent is the folder itself or one of its descendants: the cycle check walks `parent_id` up from the new parent. Siblings are renumbered densely in one transaction. |
| `delete_folder(id: i64) -> DeletedFolder` | sync | Removes the folder and all its subfolders. Notes in them are **not** deleted: they become unfiled and stay in All Notes. Returns what was removed. See Q1. |
| `restore_folder(deleted: DeletedFolder)` | sync | The Undo. Re-inserts the folders with their original ids, parents and positions, and refiles the notes that still exist and are still unfiled. `Invalid` if a folder id is taken (it can't be, with `AUTOINCREMENT`) or the parent is gone. |
| `set_note_folder(note_id: &str, folder_id: Option<i64>)` | sync | `None` = unfile. `NotFound` for an unknown note or folder. |
| `add_note(…, folder_id: Option<i64>)` | sync | Gains one parameter, for New Note in "Signs". |

### Notes and tags

| Call | Sync/async | Notes |
|---|---|---|
| `notes(filter: NoteFilter)` | sync | Unchanged apart from the `NoteFilter` fields in §4. Order stays "as made"; the UI sorts by `modified` for Recents. |
| `add_note`, `update_note` | sync | Also sync inline tags (below), in the same transaction as the note write. No new tag calls are needed. |
| `rename_tag`, `remove_tag` | sync | Keep their current behavior. See Q6. |

Inline tag sync:
- The tokenizer is the one `render_markdown` uses: `#` at the start or after whitespace or punctuation, then
  letters, digits, `_` or `-`. Not in code spans, code blocks, or link text or URLs. A heading `# x` isn't a
  tag.
- Each inline tag is matched case-insensitively to an existing user tag, or created.
- Tags that were inline in the old body but aren't in the new one are removed from the note.
- Tags added through the info field (`tag_note`) that never appeared inline are left alone.

### Import and export

| Call | Sync/async | Notes |
|---|---|---|
| `import_preview(path, progress: ProgressSink, cancel: CancelToken) -> ImportPreview` | async (`run_on_thread`) | Runs the same checks as `import_backup` (zip, manifest hash, schema 14/16, integrity, foreign keys) in a temp dir, then discards it. A preview that passes means the import will pass, unless the file changes. Same errors as `import_backup`. |
| `export_backup` | async | Signature unchanged. Drops the Berean tables from the `VACUUM INTO` copy before hashing, so the file JW sees is pure v16. |
| `import_backup` | async | Unchanged. The swapped-in JW database has no Berean tables, so folders are cleared (they're recreated empty on open). |
| `undo_import` | sync | Unchanged. It brings the folders back, because `userData.prev.db` is the whole old file. |

With the preview the UI shows: "This replaces all your notes, highlights, tags, bookmarks and favorites
(N notes…) and clears your M folders", and only then calls `import_backup`.

## 6. Storage

```sql
CREATE TABLE IF NOT EXISTS BereanFolder (
    FolderId  INTEGER PRIMARY KEY AUTOINCREMENT,
    ParentId  INTEGER REFERENCES BereanFolder (FolderId) ON DELETE CASCADE,
    Name      TEXT    NOT NULL CHECK (length(trim(Name)) > 0),
    Position  INTEGER NOT NULL CHECK (Position >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS IX_BereanFolder_Sibling_Name
    ON BereanFolder (COALESCE(ParentId, 0), Name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS IX_BereanFolder_ParentId ON BereanFolder (ParentId, Position);

CREATE TABLE IF NOT EXISTS BereanNoteFolder (
    NoteId    INTEGER PRIMARY KEY REFERENCES Note (NoteId) ON DELETE CASCADE,
    FolderId  INTEGER NOT NULL REFERENCES BereanFolder (FolderId) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS IX_BereanNoteFolder_FolderId ON BereanNoteFolder (FolderId);
```

The same file also holds Studyspace's `BereanWorkspace` (its viewport is the camera centre and zoom) and
`BereanCanvasItem` (a workspace's cards: top-left frames, a cascading FK to `Note`, and each passage or excerpt
card's reader state, a verse or paragraph URL plus a UTF-16 `ReaderCharOffset`, and a `LastUsedAt` timestamp,
like `Note.LastModified`, bumped on add, read and touch, so link reuse picks the most recently used card); see
`userdata_berean.sql`.
Export drops them too.

- **Side table, not a `FolderId` column on JW's `Note`** (recommended, Q2):
  - JW's tables stay byte-for-byte JW v16.
  - Export is two `DROP TABLE`s on the copy.
  - No `ALTER` of a JW table, and nothing for a future JW schema bump to collide with.
  - `Note.folder_id` in the API reads the side table.
  - Removing a note or a folder drops its row by cascade, so deleted folders leave their notes unfiled with no
    extra code.
- **Migration.** `userData.db`'s `PRAGMA user_version` belongs to JW (16), so Berean can't use it.
  - The tables are created with `CREATE … IF NOT EXISTS` every time userdata is opened: a new database, an
    existing one, after import and after undo. It's idempotent, and it's the whole migration for now.
  - When a Berean table first needs a change, add a one-row `BereanSchema(Version)` table then, not now.
- **Foreign keys** are already on per connection. The import checks run on the JW file before these tables
  exist, so they don't change import validation.
- **LastModified.** Its triggers are JW's and don't cover Berean tables. Folder changes don't touch
  `LastModified`, since folders aren't exported.
- **AUTOINCREMENT** means a deleted folder's id is never reused. That's what makes `restore_folder` safe.

## 7. Rendering rules

- Soft line breaks render as `LineBreak` (recommended, Q4), so legacy JW plain-text notes keep their lines.
- Raw HTML, block and inline, renders as plain `Text`. It's never interpreted.
- Images `![alt](url)` render as their alt text. Nothing is fetched.
- Autolinks `<https://…>` are links. Bare URLs aren't linked (CommonMark); that's fine.
- A paragraph whose only child is one passage link (ignoring surrounding whitespace) becomes `PassageCard`. A
  publication link alone stays a normal paragraph link: the guide only shows passage cards.
- A link to a publication that isn't installed stays a `Publication` link with `missing = true`, not
  `Invalid`, so it stays tappable and can offer the download.
- `Note.Title` is never parsed.
- Heading vs tag: `# Light` is a heading; `#light` at the start of a line is a paragraph with a tag
  (CommonMark requires the space for a heading).

## 8. Decisions (Wren, Oct 29)

**Q1. Folder delete semantics.** **Decided:** in this row, delete removes the folder subtree and its notes
become unfiled (nothing is lost), with Undo through `restore_folder`. A Recently Deleted bin for notes (30
days) is a Holding board row (Core: Recently Deleted for notes): it needs a Berean-only trash table, because
JW's schema has no soft delete. Until that row lands, the guide's copy "Its notes move to Recently Deleted"
needs to say "Its notes move to All Notes"; the UI owners adjust the copy.

**Q2. Side table vs a `Note.FolderId` column.** **Decided:** side table, for the reasons in §6.

**Q3. URL format.** **Decided, with a condition:** numbers + `pub_key`. Book-name slugs are a display concern
only and never appear in the URL. Both `LinkTarget::Passage` and `LinkTarget::Publication` carry `missing`,
set when that jwpub (the linked Bible, or the linked publication) isn't installed on the device. For a
publication, `missing` drives the "Download this publication" prompt Owen asked for. The core reports
`missing` for the linked `pub_key` only; opening a passage in another installed Bible is a UI choice.

**Q4. Soft breaks as line breaks.** **Decided:** yes, for all notes. It keeps legacy JW notes readable and
matches what Obsidian and Apple Notes users expect. Strict CommonMark rendering is given up; the source is
untouched.

**Q5. `NoteFilter.tag_id` → `tag_ids` (breaking).** **Decided:** `tag_ids` now, as a breaking change; callers
(Kiwi, Moss, Otter) update. Exclusion (`-#sermons`) belongs to note search later, not this filter.

**Q6. Rename and remove vs inline tags.** **Decided:** `rename_tag` also rewrites `#old` to `#new` in the
bodies of notes that carry the tag, when the new name is a valid inline tag (same transaction). `remove_tag`
leaves bodies alone, so a remaining `#old` re-adds the tag on that note's next edit; the UI's remove confirm
says so. Stripping `#old` from bodies on remove is rejected: it edits user text silently.

**Q7. Write-view styling.** **Decided:** a sync call `markdown_spans(markdown) -> Vec<SourceSpan { start,
end, kind }>` with UTF-16 offsets (what `NSString` and JS strings use), from the same parser, so both apps dim
the same syntax. It's a follow-up Holding board row (Core: markdown_spans for note editor syntax ranges, owner
Echo), not in this row's first implementation PR. It must land before Expo 6 and Kiwi's notes editor.

*Q7 shape.*

Revised after Otter's Expo 6c Write view (`apps/mobile/src/notes/syntax-spans.ts`, whose `SyntaxKind` union
and `styledSegments` this matches): flat syntax ranges, not nested construct ranges.

```rust
/// One syntax range of a note's Markdown source, for the Write view.
/// `start..end` is half-open, in UTF-16 code units (what JS strings and
/// NSString/NSRange index by), never splitting a surrogate pair.
pub struct SourceSpan { pub start: u32, pub end: u32, pub kind: SpanKind }

pub enum SpanKind {
    HeadingMarker,  // ATX "#"s (opening and optional closing run), setext "==="/"---" underline
    EmphasisMarker, // "*" / "_" around emphasis
    StrongMarker,   // "**" / "__" around strong
    StrikeMarker,   // "~~" / "~"
    CodeMarker,     // inline code backticks; a code block's fence lines (fence + info string)
    Code,           // inline code content between the backticks; a code block's content lines (fenced or indented)
    LinkBracket,    // a link's/image's punctuation: "!" "[" "](" ")" "<" ">" of autolinks, "][ref]", a title and its quotes
    LinkUrl,        // an inline link's destination, when it appears verbatim in the source (so the UI can fold it)
    ListMarker,     // "-", "*", "+", "1." / "1)"
    TaskMarker,     // "[ ]", "[x]"
    QuoteMarker,    // each ">" of a block quote, on every line
    Rule,           // a thematic break line
    Tag,            // an inline #tag, exactly the token ranges inline tag sync uses
}
```

- **Flat, never overlapping**, sorted by `start`. No whole-construct ranges: the text between markers
  (a heading's, a link's, a quote's) is unstyled. Only `Code` and `Tag` cover content. Each span is one run
  without whitespace, so indentation and line ends stay unstyled.
- **Unstyled (no kind):** backslash escapes, entities, raw HTML, link reference definitions (`[ref]: /url`)
  and hard breaks. Open questions for Wren, not new kinds. A quote's `>`s are still marked on those lines,
  inside code blocks and in lists. A reference link has no `LinkUrl` (its URL is in the definition), and the
  parser leaves a collapsed reference's `[]` out of the link, so that stays unstyled too.
- **Offsets are UTF-16 code units**, half-open, never splitting a surrogate pair (emoji are two units, a ZWJ
  family is several). They're `u32`: a plain `number` in TS via ubrn (`u64` would become `bigint`). Notes are
  far below 4G units.

**Q8. Tappable checkboxes in the Read view (`set_task`).** **Decided:** include `set_task` in this row. The
shape (`Task.index`) is already in the tree.

**Q9. `import_preview` cost.** **Decided:** accept staging the whole backup once more (backups are MBs, and
the call is async). No stateful preview handle.

**Q10. Sibling folder names unique, case-insensitive.** **Decided:** yes. It matches Finder and avoids two
"Psalms".

## 9. Not in this row

- Note full-text search and `#tag -#tag` queries (search row).
- Recently Deleted (Q1).
- Berean-native backup that keeps folders (Holding row).
- Merge import.
- Write-view spans: `markdown_spans` is a follow-up Holding row (Core: markdown_spans for note editor syntax
  ranges, owner Echo), now specified in Q7 and implemented in its own PR. It must land before Expo 6 and
  Kiwi's notes editor.
- Tables.

## 10. Implementation PR plan (after Wren decides)

One small PR, in this order:
1. `pulldown-cmark` dependency (`default-features = false`), `render_markdown`, and the URL builders.
2. Folders: schema, CRUD, move, delete/restore, `set_note_folder`, and the `NoteFilter` changes.
3. Inline tag sync.
4. `import_preview` and the export drop.
5. FFI exports in `berean-ffi`.
6. Tests for each: the cycle check, dense positions, cascade unfiling, restore, tag diffing, export has no
   Berean tables, import clears folders, undo brings them back, a legacy plain-text note renders with its line
   breaks, and the `missing` flag.
7. Update the `docs/parity.md` rows.
