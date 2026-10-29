-- Upgrade a JW Library user-data database from schema v14 to v16: add
-- `Location.Specialty` and `Location.Edition`, rebuild `Location` with v16's
-- constraints, create its three indexes (incl. the unique `IX_Location_Media`)
-- and stamp `user_version` 16. Used by `UserData::import_backup` on a staged
-- copy, inside a transaction, with foreign keys off (the rebuild drops the
-- table others refer to; `foreign_key_check` runs afterwards).
--
-- Provenance: the statements of `upgrade_schema` in jwlManager's JWLManager.py,
-- verbatim, at
--   https://github.com/erykjj/jwlManager/blob/188977c59dabe78fa8a5466c7e3c4af57aee6077/JWLManager.py
--
-- © 2026 Eryk J., jwlManager, MIT:
--
-- MIT License
--
-- Copyright (c) 2026 Eryk J.
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in all
-- copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.

ALTER TABLE Location ADD COLUMN Specialty TEXT;
ALTER TABLE Location ADD COLUMN Edition TEXT;
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
    Specialty      TEXT,
    Edition        TEXT,
    UNIQUE (BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type),
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
INSERT INTO Location_new SELECT LocationId, BookNumber, ChapterNumber, DocumentId, Track, IssueTagNumber, KeySymbol, MepsLanguage, Type, Title, NULL, NULL
FROM Location;
DROP TABLE Location;
ALTER TABLE Location_new RENAME TO Location;
CREATE INDEX IF NOT EXISTS IX_Location_KeySymbol_MepsLanguage_BookNumber_ChapterNumber ON Location(KeySymbol, MepsLanguage, BookNumber, ChapterNumber);
CREATE INDEX IF NOT EXISTS IX_Location_MepsLanguage_DocumentId ON Location(MepsLanguage, DocumentId);
CREATE UNIQUE INDEX IF NOT EXISTS IX_Location_Media ON Location(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type, COALESCE(Specialty, ''), COALESCE(Edition, ''));
PRAGMA user_version = 16;
