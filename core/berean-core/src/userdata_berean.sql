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

-- Studyspace: one canvas per workspace. The viewport (ViewX, ViewY: the
-- canvas point at the centre of the view) is all NULL until the first save.
-- The core checks frame and viewport bounds; the CHECKs here are only the
-- shape.
CREATE TABLE IF NOT EXISTS BereanWorkspace (
    WorkspaceId  INTEGER PRIMARY KEY AUTOINCREMENT,
    Name         TEXT    NOT NULL CHECK (length(trim(Name)) > 0),
    ViewX        REAL,
    ViewY        REAL,
    Zoom         REAL    CHECK (Zoom > 0),
    CHECK ((ViewX IS NULL) = (ViewY IS NULL) AND (ViewX IS NULL) = (Zoom IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS IX_BereanWorkspace_Name
    ON BereanWorkspace (Name COLLATE NOCASE);

-- Studyspace state that isn't per workspace: the one open last. One row at
-- most (Id = 1); no row, or a NULL, means none.
CREATE TABLE IF NOT EXISTS BereanStudyspace (
    Id               INTEGER PRIMARY KEY CHECK (Id = 1),
    LastWorkspaceId  INTEGER REFERENCES BereanWorkspace (WorkspaceId) ON DELETE SET NULL
);

-- A card on a workspace: a note (`NoteId`), or a passage or excerpt
-- (`Target`, its `berean://bible/...` or `berean://pub/...` URL). X, Y is
-- the card's top-left corner. A passage or excerpt card is a reader: once
-- scrolled, `ReaderAt` (a URL like `Target`: a verse or paragraph of the
-- same publication) and `ReaderCharOffset` (UTF-16 code units into that
-- block's plain text) say where it is.
CREATE TABLE IF NOT EXISTS BereanCanvasItem (
    ItemId       INTEGER PRIMARY KEY AUTOINCREMENT,
    WorkspaceId  INTEGER NOT NULL REFERENCES BereanWorkspace (WorkspaceId) ON DELETE CASCADE,
    NoteId       INTEGER REFERENCES Note (NoteId) ON DELETE CASCADE,
    Target       TEXT,
    X            REAL    NOT NULL,
    Y            REAL    NOT NULL,
    Width        REAL    NOT NULL CHECK (Width > 0),
    Height       REAL    NOT NULL CHECK (Height > 0),
    Z            INTEGER NOT NULL,
    ReaderAt          TEXT,
    ReaderCharOffset  INTEGER CHECK (ReaderCharOffset >= 0),
    LastUsedAt   TEXT    NOT NULL,
    CHECK ((NoteId IS NULL) <> (Target IS NULL)),
    CHECK ((ReaderAt IS NULL) = (ReaderCharOffset IS NULL)),
    CHECK (NoteId IS NULL OR ReaderAt IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS IX_BereanCanvasItem_Note
    ON BereanCanvasItem (WorkspaceId, NoteId) WHERE NoteId IS NOT NULL;
CREATE INDEX IF NOT EXISTS IX_BereanCanvasItem_Workspace ON BereanCanvasItem (WorkspaceId, Z);
