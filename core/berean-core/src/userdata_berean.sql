-- Berean-only tables in userData.db (docs/design/markdown-notes.md §6).
-- Run on every open: `IF NOT EXISTS` makes it idempotent, and it is the
-- whole migration, since `PRAGMA user_version` is JW's. JW's own tables are
-- never altered.

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
