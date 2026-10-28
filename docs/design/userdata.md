# Row 6 design: userdata + `.jwlibrary` backup (Phase 1, for Owen's decision)

Status: **design only, nothing built.** The data model and API boundary are architecture; Owen decides.

## 1. What JW Library writes (findings)

**Container.** A `.jwlibrary` file is a zip: `manifest.json`, `userData.db` (SQLite), and, when playlists hold
user media, those media files plus thumbnails (e.g. `default_thumbnail.png`) at the paths named in
`IndependentMedia.FilePath`. Nothing is encrypted.

**Manifest** (field names as read and written by JWLMerge, jwlManager and jwlFusion):

```json
{"name": "...", "creationDate": "2026-10-28T06:54:00Z", "version": 1, "type": 0,
 "userDataBackup": {"lastModifiedDate": "...", "deviceName": "...", "databaseName": "userData.db",
                    "hash": "<sha256 hex of userData.db>", "schemaVersion": 16}}
```

JW Library refuses a backup whose `hash` doesn't match the database.

**Schema version.** `PRAGMA user_version` = `schemaVersion`.
- **v16** is written by JW Library **15.8 and later**, so it's what 15.9.x writes. Sources: the jwlManager
  changelog for v12.2.0 (2026-05-11: "save as older schema v14 (for JW Library version < 15.8)", "Default to
  schema v16"), and jwlFusion's `--downgrade` option ("schema v14 for JW Library < v15.8").
- v14 came before it, and v8 before that.
- v16 = v14 plus `Location.Specialty TEXT` and `Location.Edition TEXT`. It also swaps v14's
  `UNIQUE(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type)` for the unique index
  `IX_Location_Media`, which adds `COALESCE(Specialty,'')` and `COALESCE(Edition,'')`, and loosens Location's
  CHECKs (Bible-book rows are now allowed).
- Not verified against a 15.9.x export: no public 15.9.x backup exists (see §5). The official DDL ships
  inside the macOS app (`Userdata_Userdata.bundle/Scripts/Schema.sql`), but it isn't redistributable.

**v16 tables** (read from the MIT-licensed jwlManager `res/blank`, `user_version` 16):

| Table | Holds | Key facts |
|---|---|---|
| `Location` | Every addressable place | `Type` 0 = document or Bible chapter/book, 1 = whole publication, 2/3 = audio/video (by `Track`). Columns: `KeySymbol`, `IssueTagNumber`, `MepsLanguage`, `DocumentId`, `BookNumber`, `ChapterNumber`, `Track`, `Title`, `Specialty`, `Edition`. |
| `UserMark` | One highlight | `ColorIndex` (0 = none, 1–6 = colors), `StyleIndex`, `UserMarkGuid` UNIQUE, `Version`, → `Location` |
| `BlockRange` | The highlight's extent, one row per block | `BlockType` 1 = paragraph (`Identifier` = `ParagraphIndex`/`data-pid`), 2 = verse (`Identifier` = verse number). `StartToken`/`EndToken` are word-token indexes within that block. |
| `Note` | A note | `Guid` UNIQUE, `Title`, `Content`, `Created`, `LastModified` (ISO-8601 Z). Optional `UserMarkId` (a note on a highlight) and `LocationId`. `BlockType` + `BlockIdentifier` are 0/NULL for a document note, or a paragraph/verse. Both NULL = a free-standing note. |
| `Tag` | A tag | `Type` 0 = Favorites (built in, one row), 1 = user tag, 2 = playlist. `UNIQUE(Type, Name)`. |
| `TagMap` | A tag's members, ordered | Exactly one of `NoteId`, `LocationId` (Favorites), `PlaylistItemId`, plus `Position` (`UNIQUE(TagId, Position)`). |
| `Bookmark` | Bookmarks | `PublicationLocationId` → a Type-1 `Location`. `Slot` 0–9 (`UNIQUE(PublicationLocationId, Slot)`, so 10 per publication). `LocationId` = document/chapter, optional block (`BlockType`/`BlockIdentifier`), `Title`, `Snippet`. |
| `InputField` | Answers typed into workbook fields | `(LocationId, TextTag) → Value` |
| `PlaylistItem`, `PlaylistItemAccuracy`, `PlaylistItemIndependentMediaMap`, `PlaylistItemLocationMap`, `PlaylistItemMarker`, `PlaylistItemMarkerBibleVerseMap`, `PlaylistItemMarkerParagraphMap`, `IndependentMedia` | Playlists and user media | Media files travel in the zip. |
| `LastModified` | One row | Kept current by triggers on every write. Insert and delete are blocked by triggers. |
| `android_metadata` | Android leftover | Present in the blank |

**How a Location maps to ours** (`pub_key` = `{symbol}:{meps_language}:{issue_tag}`):

| Ours | JW |
|---|---|
| `pub_key` | `KeySymbol`, `MepsLanguage`, `IssueTagNumber` (1:1; a Bible is e.g. `nwtsty:0:0`) |
| Publication paragraph `{pub_key, doc_id, paragraph}` | `Location{Type 0, DocumentId = doc_id}` + block (1, `paragraph`) |
| Bible verse `{pub_key, book, chapter, verse}` | `Location{Type 0, BookNumber, ChapterNumber, DocumentId NULL}` + block (2, `verse`). Our optional Bible `doc_id` is dropped. |
| Document (no paragraph) | `Location{Type 0, DocumentId}`, block 0 |
| Whole publication | `Location{Type 1}`, used by bookmarks and Favorites |
| Audio/video `Track`, `Specialty`, `Edition` | **No equivalent in our `Location`.** |

**Gap: highlights are token-precise and ours aren't.** `LocationSpan` resolves to whole verses or paragraphs. JW
highlights carry `StartToken`/`EndToken` in every block. To round-trip exactly, and to draw highlights where JW
drew them, the core must keep token offsets and know JW's tokenizer, which isn't documented. Phase 2 has to
confirm it against a real export (§5).

## 2. Data model: options

- **(A) Mirror JW's v16 tables, in a separate `userData.db` in the core's data dir. The core owns the file and
  exposes a typed API over it. Recommended.**
  - Export is close to a copy (`VACUUM INTO` + manifest + zip), and the round trip is lossless. That includes
    the playlists, `InputField`, `Specialty`/`Edition` and media we don't surface yet.
  - A separate file keeps JW's `user_version` (16) apart from our own migration counter in the core DB.
  - It's created from a vendored v16 DDL and moves forward only, following JW's versions.
  - Cost: JW's quirks are ours (Slot, Type codes, triggers, CHECKs), and Swift still never sees SQL.
- **(B) Our own normalized tables in the core DB, mapped to and from JW at import/export.** This gives a cleaner
  model, but every column we don't model is lost on round trip, unless we carry the unknown parts as blobs,
  which is model (A) by another route. It also needs more mapping code and more tests.
- **(C) Mirror JW's tables inside the core DB, under our migrations.** This makes `user_version` ambiguous,
  and an export would need to copy table by table.

## 3. Record shapes and CRUD (proposed; Swift sees UniFFI records)

```rust
pub enum HighlightColor { Yellow, Green, Blue, Pink, Orange, Purple }    // ColorIndex 1..=6
pub struct TextRange { pub span: LocationSpan, pub start_token: Option<u32>, pub end_token: Option<u32> }
//   start_token applies to span.start's block, end_token to span.end's block; None = whole block.
//   Blocks in between are whole. A whole-document range has no paragraph or verse.
pub struct Highlight { pub id: String /*UserMarkGuid*/, pub range: TextRange, pub color: HighlightColor }
pub struct Note {
    pub id: String /*Guid*/, pub title: String, pub content: String,
    pub location: Option<Location>,      // None = free-standing note
    pub highlight_id: Option<String>,    // a note attached to a highlight
    pub tag_ids: Vec<i64>, pub created: String, pub modified: String,  // ISO-8601 Z, as JW stores them
}
pub struct Tag { pub id: i64, pub name: String }        // user tags only; Favorites has its own calls
pub struct Bookmark { pub pub_key: String, pub slot: u8 /*0..=9*/, pub location: Location, pub title: String, pub snippet: Option<String> }
```

`UserData` methods (`Location` is the key everywhere):
- **Highlights:** `highlights(pub_key, doc_or_chapter: Location) -> [Highlight]`,
  `add_highlight(range, color) -> Highlight`, `set_highlight_color(id, color)`, `remove_highlight(id)`.
- **Notes:** `notes(filter: NoteFilter{location?, tag_id?}) -> [Note]`,
  `add_note(title, content, location?, highlight_id?) -> Note`, `update_note(id, title, content)`,
  `remove_note(id)`.
- **Tags:** `tags() -> [Tag]`, `add_tag(name) -> Tag`, `rename_tag(id, name)`, `remove_tag(id)` (untags its
  items), `tag_note(note_id, tag_id)`, `untag_note(note_id, tag_id)`.
- **Favorites:** `favorites() -> [Location]`, `add_favorite(location)`, `remove_favorite(location)`,
  `move_favorite(location, to_position)`.
- **Bookmarks:** `bookmarks(pub_key) -> [Bookmark]`, `set_bookmark(pub_key, slot, location, title, snippet)`
  (replaces whatever is in the slot), `remove_bookmark(pub_key, slot)`.
- **Backup:** `export_backup(path, progress, cancel)`, `import_backup(path, progress, cancel) -> ImportSummary{counts}`.

Changes from the proposal's text, flagged for approval:
1. The highlight carries token offsets (`TextRange`), not just a `LocationSpan`.
2. Favorites gets its own calls. The proposal didn't list them, but JW backs them up.
3. The backup calls take `(progress, cancel)`, matching the house rule for long calls.

Errors: an unknown id is `NotFound`, an out-of-range slot or an empty tag name is `Invalid`, and a duplicate tag
name is `Invalid`.

**Not exposed** but preserved on round trip: playlists, independent media, `InputField`, and audio/video
locations. Each can get a row later.

## 4. Import and export

- **Export:** `VACUUM INTO` a temporary file (`user_version` 16). Write the manifest: `hash` = SHA-256 of the
  file, `schemaVersion` = 16, `lastModifiedDate` from `LastModified`, and `name` /
  `deviceName` = "Berean". Zip it together with the media files, then rename into place atomically.
- **Import: replace (recommended)** or merge.
  - **Replace** is what JW Library's restore does. To verify on a device: it warns that current data will be
    replaced. The import checks the zip, the manifest hash and the schema version, then copies the database to
    a temp file. It upgrades v14 → v16 there (the jwlManager recipe: add two columns, rebuild `Location`, add the
    new indexes), then runs `PRAGMA integrity_check` and `foreign_key_check`. Only then does it swap the file in
    atomically, and it keeps the previous `userData.db` as `userData.prev.db`, so one undo is possible. Any
    failure leaves the current data untouched.
  - **Merge**, as JWLMerge and jwlFusion do it, means remapping every id and deduplicating by Location, Guid,
    tag name and media hash, plus handling Slot collisions. It's a separate later row if Owen wants it.
- **Accepted versions:** 14 and 16. Older versions (8 and below) and newer ones (17 and up) are rejected as
  `Invalid` with a clear message: "re-export from JW Library" for old ones, "update Berean" for new ones. A
  future version is refused rather than guessed at.
- **Unknown tables and columns:**
  - In v14/v16 there are none beyond `android_metadata`, which is kept as is.
  - If a 16 file ever carries an extra table, it's kept and exported unchanged, which mirroring allows.
  - An extra column on a known table: same.
  - Nothing is dropped silently.
- **Bad input:** a corrupt zip, a missing member, a hash mismatch or a failed integrity check is `Corrupt`;
  wrong JSON or an unsupported version is `Invalid`. Existing data is never touched.

## 5. Fixtures

- **Public, verifiable, and enough for the schema:** `res/blank` from
  [erykjj/jwlManager](https://github.com/erykjj/jwlManager) (MIT, © 2026 Eryk J.).
  - It's an empty v16 `userData.db`: 18 tables, 23 triggers, 14 indexes, and one Favorites tag (`Tag{1, Type 0, "Favorite"}`).
  - Pin: `3e415f1ef8831965c942bff327d00172179f02bbd41e9cf65cc66505e9459360  jwlmanager_blank_v16.zip
    https://raw.githubusercontent.com/erykjj/jwlManager/188977c59dabe78fa8a5466c7e3c4af57aee6077/res/blank`
  - It's fetched and never committed. Its provenance is the jwlManager author's empty database, apparently
    from Android JW Library (it has `android_metadata`). It isn't a JW-signed artifact.
  - It's used to check our vendored DDL against it, for the v16 → v14 → v16 upgrade path, and as the base for
    synthetic test backups.
- **No public populated backup exists.** I searched GitHub code for `*.jwlibrary` and `userData.db`: no
    JW backup came up. JWLMerge's tests build their databases in code, and jwlFusion's license is
    noncommercial. **I did not fabricate one.**
- **Plan:**
  1. CI behavior tests use backups built in the test from the pinned blank, with known notes, highlights,
     tags, bookmarks, favorites and an `InputField` row. They're labeled synthetic.
  2. To confirm token semantics and real-world shape, **Owen exports one small `.jwlibrary`** from JW
     Library 15.9.x. It should have a few highlights (one spanning paragraphs and one spanning verses), a
     note, a tag, a bookmark and a favorite, in English and Spanish. It's stored privately: a release asset on
     the private repo, fetched in CI with `GITHUB_TOKEN`, pinned by SHA-256, never committed.
  3. Manual acceptance: a Berean export restores in JW Library on Owen's device.

## 6. Crates

**None new.**
- GUIDs come from SQLite `randomblob(16)`, formatted as a v4 UUID in SQL.
- Timestamps come from SQLite `strftime`.
- Zip writing uses the existing `zip` 2.6 with deflate.
- The SHA-256 is `sha2` and the manifest is `serde_json`.

## 7. Decisions for Owen

1. Data model: **(A) mirror v16 in a separate `userData.db`** (vs B, C).
2. Record shapes and CRUD as in §3, including **`TextRange` with token offsets** and **Favorites calls**.
3. Import = **replace**, keeping one `userData.prev.db`. Merge is a later row.
4. Accept **v14 and v16**, refuse others, and preserve unknown tables and columns.
5. Fixtures: the pinned public blank, synthetic CI backups, and **one private real export from Owen**.
6. No new crates.
