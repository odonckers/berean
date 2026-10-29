//! JWPUB: opens JWPUB publication containers and decrypts their content.
//!
//! A `.jwpub` file is a zip holding `manifest.json` and `contents`; `contents`
//! is itself a zip holding the publication's SQLite database (named by the
//! manifest's `publication.fileName`) plus images. The manifest's top-level
//! `hash` is the SHA-256 of the `contents` entry. The database's `Publication`
//! row is authoritative for the publication's identity, from which the content
//! key is derived. Every encrypted content column (`Document.Content`,
//! `Footnote.Content`, `VerseCommentary.Content`, ...) uses the same scheme:
//! AES-128-CBC with PKCS#7 padding over zlib-compressed UTF-8 HTML, so a single
//! [`Publication::decrypt`] handles them all.
//!
//! Column sets vary between schema versions, so readers select only the
//! columns they need: a table's id and link columns are required (missing =>
//! `Corrupt`); every other column is read as `None` when absent. Readers for
//! optional tables return an empty `Vec` when the table does not exist.
//!
//! Error mapping:
//! - The `.jwpub` file can't be opened, or a temp file can't be written => `Io`.
//! - Not a zip, truncated, bad deflate/CRC, a missing `manifest.json`,
//!   `contents` or database entry, malformed manifest JSON, a `contents` hash
//!   mismatch, an unreadable/invalid database or `Publication` row, or a
//!   manifest/database identity (symbol or language) mismatch => `Corrupt`.
//!   All of these mean the file is not an intact JWPUB.
//! - Decryption failure (wrong key, bad padding), bad zlib data or non-UTF-8
//!   output => `Corrupt`.
//! - An unknown document id, or a document without content => `NotFound`.

use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags, OptionalExtension, Row};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::CoreError;

/// XOR mask applied to the SHA-256 of the publication identity string to
/// produce the AES key (first half) and IV (second half).
const KEY_MASK: [u8; 32] = [
    0x11, 0xcb, 0xb5, 0x58, 0x7e, 0x32, 0x84, 0x6d, 0x4c, 0x26, 0x79, 0x0c, 0x63, 0x3d, 0xa2, 0x89,
    0xf6, 0x6f, 0xe5, 0x84, 0x2a, 0x3a, 0x58, 0x5c, 0xe1, 0xbc, 0x3a, 0x29, 0x4a, 0xf5, 0xad, 0xa7,
];

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

/// Publication identity and display metadata, read from the database's
/// `Publication` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationMeta {
    /// Key symbol, e.g. `w26` or `ll`.
    pub symbol: String,
    /// MEPS language index (0 = English, 1 = Spanish, ...).
    pub meps_language: u32,
    pub year: u32,
    /// Issue tag, e.g. `20260800`; 0 for non-periodicals.
    pub issue_tag: u32,
    pub title: String,
    /// e.g. `Watchtower`, `Book`, `Brochure`, `Index`.
    pub publication_type: String,
    /// The numeric `Publication.Type`.
    pub pub_type: i64,
}

/// One row of the `Document` table, without its content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentSummary {
    pub document_id: i64,
    pub meps_document_id: i64,
    pub class: String,
    pub doc_type: i64,
    pub title: String,
    pub section_number: Option<i64>,
    pub chapter_number: Option<i64>,
    pub has_content: bool,
}

/// One row of `DocumentParagraph`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentParagraph {
    pub document_paragraph_id: i64,
    pub document_id: i64,
    pub paragraph_index: i64,
    pub paragraph_number_label: Option<i64>,
    pub begin_position: Option<i64>,
    pub end_position: Option<i64>,
}

/// One row of `BibleCitation`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BibleCitation {
    pub bible_citation_id: i64,
    pub document_id: i64,
    pub block_number: Option<i64>,
    pub element_number: Option<i64>,
    pub first_bible_verse_id: Option<i64>,
    pub last_bible_verse_id: Option<i64>,
    pub bible_verse_id: Option<i64>,
    pub paragraph_ordinal: Option<i64>,
}

/// One row of `VerseCommentary` or `ParagraphCommentary` (same shape).
/// `content` is the raw encrypted blob; pass it to [`Publication::decrypt`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commentary {
    pub commentary_id: i64,
    pub commentary_type: Option<i64>,
    pub label: Option<String>,
    pub content: Option<Vec<u8>>,
    pub commentary_meps_document_id: Option<i64>,
    pub begin_paragraph_ordinal: Option<i64>,
    pub end_paragraph_ordinal: Option<i64>,
}

/// One row of `VerseCommentaryMap`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerseCommentaryMap {
    pub verse_commentary_map_id: i64,
    pub bible_verse_id: i64,
    pub verse_commentary_id: i64,
}

/// One row of `ParagraphCommentaryMap`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParagraphCommentaryMap {
    pub paragraph_commentary_map_id: i64,
    pub meps_document_id: i64,
    pub begin_paragraph_ordinal: Option<i64>,
    pub end_paragraph_ordinal: Option<i64>,
    pub paragraph_commentary_id: i64,
}

/// An `Extract` row and the `RefPublication` it quotes from. The reference
/// columns are `None` when absent or when the `RefPublication` row is missing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExtractRef {
    pub ref_meps_document_id: Option<i64>,
    pub symbol: Option<String>,
    pub meps_language: Option<u32>,
    pub issue_tag: Option<u32>,
}

/// One row of `PublicationView`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationView {
    pub publication_view_id: i64,
    pub name: Option<String>,
    pub symbol: String,
}

/// One row of `PublicationViewItem`: a table-of-contents entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationViewItem {
    pub publication_view_item_id: i64,
    /// -1 for a top-level item.
    pub parent_publication_view_item_id: i64,
    pub title: String,
    /// The local `DocumentId` the item opens; -1 for a heading.
    pub default_document_id: i64,
}

/// One row of `BibleBook`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BibleBook {
    /// The book number, 1 (Genesis) to 66 (Revelation).
    pub bible_book_id: i64,
    /// The local `DocumentId` of the book's document.
    pub book_document_id: i64,
    /// e.g. `Psalm`, `According to John`.
    pub chapter_display_title: Option<String>,
}

/// One row of `BibleChapter`. `content` is the raw encrypted blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BibleChapterRow {
    pub bible_chapter_id: i64,
    pub content: Option<Vec<u8>>,
    pub first_verse_id: i64,
    pub last_verse_id: i64,
}

/// One row of `BibleVerse`. `content` is the raw encrypted blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BibleVerse {
    pub bible_verse_id: i64,
    /// HTML, e.g. `<span class="vl">16</span>`.
    pub label: String,
    pub content: Vec<u8>,
}

#[derive(Deserialize)]
struct Manifest {
    hash: String,
    publication: ManifestPublication,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestPublication {
    file_name: String,
    symbol: String,
    language: i64,
}

/// Name of the manifest inside a `.jwpub`, and of the copy kept beside an
/// unpacked publication.
pub(crate) const MANIFEST: &str = "manifest.json";

/// A `.jwpub` whose `contents` hash has been checked against its manifest
/// and whose `contents` zip holds the database the manifest names. The
/// `contents` zip is copied to a temp file that lives (and is deleted) with
/// this value.
pub(crate) struct Container {
    manifest_json: Vec<u8>,
    manifest: Manifest,
    // Declared before `_contents` so the archive's handle closes before the
    // file is deleted.
    inner: zip::ZipArchive<File>,
    _contents: NamedTempFile,
}

impl Container {
    /// Open and verify a `.jwpub`, copying its `contents` under `temp_dir`.
    pub(crate) fn open(path: impl AsRef<Path>, temp_dir: &Path) -> Result<Self, CoreError> {
        let mut outer = zip::ZipArchive::new(File::open(path)?).map_err(corrupt)?;

        let mut manifest_json = Vec::new();
        outer
            .by_name(MANIFEST)
            .map_err(corrupt)?
            .read_to_end(&mut manifest_json)
            .map_err(corrupt)?;
        let manifest: Manifest = serde_json::from_slice(&manifest_json).map_err(corrupt)?;
        check_file_name(&manifest.publication.file_name)?;

        // Copy `contents` out (it can be large) while hashing it.
        let mut contents = NamedTempFile::new_in(temp_dir)?;
        let mut hasher = Sha256::new();
        copy_entry(
            outer.by_name("contents").map_err(corrupt)?,
            contents.as_file_mut(),
            Some(&mut hasher),
        )?;
        if hex::encode(hasher.finalize()) != manifest.hash.to_ascii_lowercase() {
            return Err(CoreError::Corrupt);
        }

        let inner = zip::ZipArchive::new(contents.reopen()?).map_err(corrupt)?;
        if inner
            .index_for_name(&manifest.publication.file_name)
            .is_none()
        {
            return Err(CoreError::Corrupt);
        }
        Ok(Container {
            manifest_json,
            manifest,
            inner,
            _contents: contents,
        })
    }

    /// The number of entries in `contents`.
    pub(crate) fn len(&self) -> usize {
        self.inner.len()
    }

    /// Write the manifest, byte for byte, to `dir/manifest.json`.
    pub(crate) fn write_manifest(&self, dir: &Path) -> Result<(), CoreError> {
        Ok(std::fs::write(dir.join(MANIFEST), &self.manifest_json)?)
    }

    /// Extract `contents` entry `index` under `dir`. A name that is absolute,
    /// climbs out with `..`, or collides with a file already there (a
    /// duplicate entry, or `manifest.json`) => `Corrupt`.
    pub(crate) fn unpack_entry(&mut self, index: usize, dir: &Path) -> Result<(), CoreError> {
        let entry = self.inner.by_index(index).map_err(corrupt)?;
        let dest = dir.join(entry.enclosed_name().ok_or(CoreError::Corrupt)?);
        if entry.is_dir() {
            std::fs::create_dir_all(dest)?;
            return Ok(());
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => CoreError::Corrupt,
                _ => e.into(),
            })?;
        copy_entry(entry, &mut file, None)
    }
}

/// An opened JWPUB: either a `.jwpub` file, whose database is extracted to a
/// temp file that lives (and is deleted) with this value, or an unpacked
/// publication directory.
pub struct Publication {
    // Declared before `_db_file` so the connection closes before the file is
    // deleted.
    conn: Connection,
    meta: PublicationMeta,
    key: [u8; 16],
    iv: [u8; 16],
    _db_file: Option<NamedTempFile>,
}

impl Publication {
    /// Open a `.jwpub`, extracting its database under the system temp dir.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CoreError> {
        Self::open_in(path, std::env::temp_dir())
    }

    /// Open a `.jwpub`, extracting its database under `temp_dir`.
    pub fn open_in(path: impl AsRef<Path>, temp_dir: impl AsRef<Path>) -> Result<Self, CoreError> {
        let temp_dir = temp_dir.as_ref();
        let mut container = Container::open(path, temp_dir)?;
        let mut db_file = NamedTempFile::new_in(temp_dir)?;
        copy_entry(
            container
                .inner
                .by_name(&container.manifest.publication.file_name)
                .map_err(corrupt)?,
            db_file.as_file_mut(),
            None,
        )?;
        let Container { manifest, .. } = container;
        let db = db_file.path().to_path_buf();
        Self::from_db(&db, &manifest, Some(db_file))
    }

    /// Open a publication unpacked into `dir`: its `contents` entries plus
    /// `manifest.json`, as the library stores it. The `contents` hash is not
    /// re-checked; the manifest/database identity is. A missing manifest or
    /// database => `Io`; otherwise errors map as for [`Publication::open`].
    pub fn open_dir(dir: impl AsRef<Path>) -> Result<Self, CoreError> {
        let dir = dir.as_ref();
        let manifest: Manifest =
            serde_json::from_slice(&std::fs::read(dir.join(MANIFEST))?).map_err(corrupt)?;
        check_file_name(&manifest.publication.file_name)?;
        let db = dir.join(&manifest.publication.file_name);
        // SQLite would report a missing file as a generic open failure.
        std::fs::metadata(&db)?;
        Self::from_db(&db, &manifest, None)
    }

    fn from_db(
        db: &Path,
        manifest: &Manifest,
        db_file: Option<NamedTempFile>,
    ) -> Result<Self, CoreError> {
        let conn = Connection::open_with_flags(
            db,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let meta = read_meta(&conn)?;
        if meta.symbol != manifest.publication.symbol
            || i64::from(meta.meps_language) != manifest.publication.language
        {
            return Err(CoreError::Corrupt);
        }
        let (key, iv) = content_key(&meta);

        Ok(Publication {
            conn,
            meta,
            key,
            iv,
            _db_file: db_file,
        })
    }

    pub fn meta(&self) -> &PublicationMeta {
        &self.meta
    }

    /// Decrypt and inflate any encrypted content blob of this publication
    /// (`Document.Content`, `Footnote.Content`, `Extract.Content`, ...) to its
    /// HTML. Wrong key, bad padding, bad zlib or non-UTF-8 => `Corrupt`.
    pub fn decrypt(&self, blob: &[u8]) -> Result<String, CoreError> {
        let mut buf = blob.to_vec();
        let plain = Aes128CbcDec::new(&self.key.into(), &self.iv.into())
            .decrypt_padded_mut::<Pkcs7>(&mut buf)
            .map_err(corrupt)?;
        let mut html = String::new();
        flate2::read::ZlibDecoder::new(plain)
            .read_to_string(&mut html)
            .map_err(corrupt)?;
        Ok(html)
    }

    /// All documents, ordered by `DocumentId`.
    pub fn documents(&self) -> Result<Vec<DocumentSummary>, CoreError> {
        self.documents_where("", [])
    }

    /// The documents with MEPS id `meps_document_id`, ordered by
    /// `DocumentId`.
    pub(crate) fn documents_with_meps_id(
        &self,
        meps_document_id: i64,
    ) -> Result<Vec<DocumentSummary>, CoreError> {
        self.documents_where(" WHERE MepsDocumentId = ?1", [meps_document_id])
    }

    fn documents_where<P: rusqlite::Params>(
        &self,
        filter: &str,
        params: P,
    ) -> Result<Vec<DocumentSummary>, CoreError> {
        let sql = select_sql(
            &self.conn,
            "Document",
            &["DocumentId", "MepsDocumentId", "Class", "Type", "Title"],
            &["SectionNumber", "ChapterNumber"],
            // Avoid reading every content blob just to test for NULL.
            &format!(", Content IS NOT NULL FROM Document{filter} ORDER BY DocumentId"),
        )?
        .ok_or(CoreError::Corrupt)?;
        self.query(&sql, params, |r| {
            Ok(DocumentSummary {
                document_id: r.get(0)?,
                meps_document_id: r.get(1)?,
                class: r.get(2)?,
                doc_type: r.get(3)?,
                title: r.get(4)?,
                section_number: r.get(5)?,
                chapter_number: r.get(6)?,
                has_content: r.get(7)?,
            })
        })
    }

    /// The decrypted HTML of one document. Unknown id or no content =>
    /// `NotFound`.
    pub fn document_html(&self, document_id: i64) -> Result<String, CoreError> {
        let blob: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT Content FROM Document WHERE DocumentId = ?1",
                [document_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?
            .flatten();
        self.decrypt(&blob.ok_or(CoreError::NotFound)?)
    }

    /// `DocumentParagraph` rows for one document, by `ParagraphIndex`.
    pub fn document_paragraphs(
        &self,
        document_id: i64,
    ) -> Result<Vec<DocumentParagraph>, CoreError> {
        self.paragraphs_where(
            " WHERE DocumentId = ?1 ORDER BY ParagraphIndex",
            [document_id],
        )
    }

    /// Every `DocumentParagraph` row, by `DocumentId` then `ParagraphIndex`.
    /// The table has no index on `DocumentId`, so this one scan is much
    /// cheaper than [`document_paragraphs`](Self::document_paragraphs) for
    /// each document.
    pub(crate) fn all_document_paragraphs(&self) -> Result<Vec<DocumentParagraph>, CoreError> {
        self.paragraphs_where(" ORDER BY DocumentId, ParagraphIndex", [])
    }

    fn paragraphs_where<P: rusqlite::Params>(
        &self,
        tail: &str,
        params: P,
    ) -> Result<Vec<DocumentParagraph>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "DocumentParagraph",
            &["DocumentParagraphId", "DocumentId", "ParagraphIndex"],
            &["ParagraphNumberLabel", "BeginPosition", "EndPosition"],
            &format!(" FROM DocumentParagraph{tail}"),
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, params, |r| {
            Ok(DocumentParagraph {
                document_paragraph_id: r.get(0)?,
                document_id: r.get(1)?,
                paragraph_index: r.get(2)?,
                paragraph_number_label: r.get(3)?,
                begin_position: r.get(4)?,
                end_position: r.get(5)?,
            })
        })
    }

    /// `BibleCitation` rows for one document, by `BibleCitationId`.
    pub fn bible_citations(&self, document_id: i64) -> Result<Vec<BibleCitation>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "BibleCitation",
            &["BibleCitationId", "DocumentId"],
            &[
                "BlockNumber",
                "ElementNumber",
                "FirstBibleVerseId",
                "LastBibleVerseId",
                "BibleVerseId",
                "ParagraphOrdinal",
            ],
            " FROM BibleCitation WHERE DocumentId = ?1 ORDER BY BibleCitationId",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [document_id], |r| {
            Ok(BibleCitation {
                bible_citation_id: r.get(0)?,
                document_id: r.get(1)?,
                block_number: r.get(2)?,
                element_number: r.get(3)?,
                first_bible_verse_id: r.get(4)?,
                last_bible_verse_id: r.get(5)?,
                bible_verse_id: r.get(6)?,
                paragraph_ordinal: r.get(7)?,
            })
        })
    }

    /// All `VerseCommentary` rows.
    pub fn verse_commentaries(&self) -> Result<Vec<Commentary>, CoreError> {
        self.commentaries("VerseCommentary", "VerseCommentaryId")
    }

    /// All `ParagraphCommentary` rows.
    pub fn paragraph_commentaries(&self) -> Result<Vec<Commentary>, CoreError> {
        self.commentaries("ParagraphCommentary", "ParagraphCommentaryId")
    }

    /// All `VerseCommentaryMap` rows.
    pub fn verse_commentary_maps(&self) -> Result<Vec<VerseCommentaryMap>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "VerseCommentaryMap",
            &["VerseCommentaryMapId", "BibleVerseId", "VerseCommentaryId"],
            &[],
            " FROM VerseCommentaryMap ORDER BY VerseCommentaryMapId",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [], |r| {
            Ok(VerseCommentaryMap {
                verse_commentary_map_id: r.get(0)?,
                bible_verse_id: r.get(1)?,
                verse_commentary_id: r.get(2)?,
            })
        })
    }

    /// All `ParagraphCommentaryMap` rows.
    pub fn paragraph_commentary_maps(&self) -> Result<Vec<ParagraphCommentaryMap>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "ParagraphCommentaryMap",
            &[
                "ParagraphCommentaryMapId",
                "MepsDocumentId",
                "ParagraphCommentaryId",
            ],
            &["BeginParagraphOrdinal", "EndParagraphOrdinal"],
            " FROM ParagraphCommentaryMap ORDER BY ParagraphCommentaryMapId",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [], |r| {
            Ok(ParagraphCommentaryMap {
                paragraph_commentary_map_id: r.get(0)?,
                meps_document_id: r.get(1)?,
                paragraph_commentary_id: r.get(2)?,
                begin_paragraph_ordinal: r.get(3)?,
                end_paragraph_ordinal: r.get(4)?,
            })
        })
    }

    /// The `VerseCommentary` rows `VerseCommentaryMap` maps `bible_verse_id`
    /// to, by `VerseCommentaryMapId`; empty if there are none (or no such
    /// tables).
    pub(crate) fn verse_commentaries_for(
        &self,
        bible_verse_id: i64,
    ) -> Result<Vec<Commentary>, CoreError> {
        let map = ["VerseCommentaryMapId", "BibleVerseId", "VerseCommentaryId"];
        if select_sql(&self.conn, "VerseCommentaryMap", &map, &[], "")?.is_none() {
            return Ok(Vec::new());
        }
        self.commentaries_where(
            "VerseCommentary",
            "VerseCommentaryId",
            " JOIN VerseCommentaryMap m USING (VerseCommentaryId) \
             WHERE m.BibleVerseId = ?1 ORDER BY m.VerseCommentaryMapId",
            [bible_verse_id],
        )
    }

    /// The `Extract` row `extract_id` with its `RefPublication`; `None` if
    /// there is no such row (or no `Extract` table). A `RefPublication`
    /// language or issue tag that is not a `u32` reads as `None`.
    pub(crate) fn extract_ref(&self, extract_id: i64) -> Result<Option<ExtractRef>, CoreError> {
        let extract = ["ExtractId", "RefPublicationId", "RefMepsDocumentId"];
        let publication = [
            "RefPublicationId",
            "Symbol",
            "MepsLanguageIndex",
            "IssueTagNumber",
        ];
        if select_sql(&self.conn, "Extract", &extract, &[], "")?.is_none()
            || select_sql(&self.conn, "RefPublication", &publication, &[], "")?.is_none()
        {
            return Ok(None);
        }
        let mut rows = self.query(
            "SELECT e.RefMepsDocumentId, r.Symbol, r.MepsLanguageIndex, r.IssueTagNumber \
             FROM Extract e LEFT JOIN RefPublication r ON r.RefPublicationId = e.RefPublicationId \
             WHERE e.ExtractId = ?1",
            [extract_id],
            |r| {
                Ok(ExtractRef {
                    ref_meps_document_id: r.get(0)?,
                    symbol: r.get(1)?,
                    meps_language: r
                        .get::<_, Option<i64>>(2)?
                        .and_then(|n| u32::try_from(n).ok()),
                    issue_tag: issue_tag(r.get(3)?).ok(),
                })
            },
        )?;
        Ok(rows.pop())
    }

    /// All `PublicationView` rows, by `PublicationViewId`.
    pub fn publication_views(&self) -> Result<Vec<PublicationView>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "PublicationView",
            &["PublicationViewId", "Symbol"],
            &["Name"],
            " FROM PublicationView ORDER BY PublicationViewId",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [], |r| {
            Ok(PublicationView {
                publication_view_id: r.get(0)?,
                symbol: r.get(1)?,
                name: r.get(2)?,
            })
        })
    }

    /// The `PublicationViewItem` rows of one view, by `PublicationViewItemId`.
    pub fn publication_view_items(
        &self,
        publication_view_id: i64,
    ) -> Result<Vec<PublicationViewItem>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "PublicationViewItem",
            &[
                "PublicationViewItemId",
                "ParentPublicationViewItemId",
                "Title",
                "DefaultDocumentId",
            ],
            &[],
            " FROM PublicationViewItem WHERE PublicationViewId = ?1 \
             ORDER BY PublicationViewItemId",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [publication_view_id], |r| {
            Ok(PublicationViewItem {
                publication_view_item_id: r.get(0)?,
                parent_publication_view_item_id: r.get(1)?,
                title: r.get(2)?,
                default_document_id: r.get(3)?,
            })
        })
    }

    /// All `BibleBook` rows, by `BibleBookId`; empty if this is not a Bible.
    pub fn bible_books(&self) -> Result<Vec<BibleBook>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "BibleBook",
            &["BibleBookId", "BookDocumentId"],
            &["ChapterDisplayTitle"],
            " FROM BibleBook ORDER BY BibleBookId",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [], |r| {
            Ok(BibleBook {
                bible_book_id: r.get(0)?,
                book_document_id: r.get(1)?,
                chapter_display_title: r.get(2)?,
            })
        })
    }

    /// The `BibleChapter` row for `book` `chapter`; `None` if there is none
    /// (or this is not a Bible).
    pub fn bible_chapter(
        &self,
        book: u32,
        chapter: u32,
    ) -> Result<Option<BibleChapterRow>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "BibleChapter",
            &[
                "BibleChapterId",
                "Content",
                "FirstVerseId",
                "LastVerseId",
                "BookNumber",
                "ChapterNumber",
            ],
            &[],
            " FROM BibleChapter WHERE BookNumber = ?1 AND ChapterNumber = ?2",
        )?
        else {
            return Ok(None);
        };
        let mut rows = self.query(&sql, [book, chapter], |r| {
            Ok(BibleChapterRow {
                bible_chapter_id: r.get(0)?,
                content: r.get(1)?,
                first_verse_id: r.get(2)?,
                last_verse_id: r.get(3)?,
            })
        })?;
        match rows.len() {
            0 => Ok(None),
            1 => Ok(rows.pop()),
            _ => Err(CoreError::Corrupt),
        }
    }

    /// Every chapter as `(book, chapter)`, in Bible order; empty if this is
    /// not a Bible.
    pub(crate) fn bible_chapter_numbers(&self) -> Result<Vec<(u32, u32)>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "BibleChapter",
            &["BookNumber", "ChapterNumber"],
            &[],
            " FROM BibleChapter ORDER BY BookNumber, ChapterNumber",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [], |r| Ok((r.get(0)?, r.get(1)?)))
    }

    /// `BibleVerse` rows `first..=last`, by `BibleVerseId`. A verse without
    /// a label or content => `Corrupt`.
    pub fn bible_verses(&self, first: i64, last: i64) -> Result<Vec<BibleVerse>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            "BibleVerse",
            &["BibleVerseId", "Label", "Content"],
            &[],
            " FROM BibleVerse WHERE BibleVerseId BETWEEN ?1 AND ?2 ORDER BY BibleVerseId",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [first, last], |r| {
            Ok(BibleVerse {
                bible_verse_id: r.get(0)?,
                label: r.get(1)?,
                content: r.get(2)?,
            })
        })
    }

    fn commentaries(&self, table: &str, id_col: &str) -> Result<Vec<Commentary>, CoreError> {
        self.commentaries_where(table, id_col, &format!(" ORDER BY {id_col}"), [])
    }

    /// `table`'s commentary rows, selected by `tail` (joins, `WHERE`,
    /// `ORDER BY`) after `FROM {table}`.
    fn commentaries_where<P: rusqlite::Params>(
        &self,
        table: &str,
        id_col: &str,
        tail: &str,
        params: P,
    ) -> Result<Vec<Commentary>, CoreError> {
        let Some(sql) = select_sql(
            &self.conn,
            table,
            &[id_col],
            &[
                "CommentaryType",
                "Label",
                "Content",
                "CommentaryMepsDocumentId",
                "BeginParagraphOrdinal",
                "EndParagraphOrdinal",
            ],
            &format!(" FROM {table}{tail}"),
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, params, |r| {
            Ok(Commentary {
                commentary_id: r.get(0)?,
                commentary_type: r.get(1)?,
                label: r.get(2)?,
                content: r.get(3)?,
                commentary_meps_document_id: r.get(4)?,
                begin_paragraph_ordinal: r.get(5)?,
                end_paragraph_ordinal: r.get(6)?,
            })
        })
    }

    fn query<T, P: rusqlite::Params>(
        &self,
        sql: &str,
        params: P,
        map: impl FnMut(&Row<'_>) -> rusqlite::Result<T>,
    ) -> Result<Vec<T>, CoreError> {
        let mut stmt = self.conn.prepare(sql).map_err(db_err)?;
        let rows = stmt.query_map(params, map).map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }
}

/// The AES key and IV for a publication: SHA-256 of
/// `{lang}_{symbol}_{year}[_{issue}]`, XORed with [`KEY_MASK`].
fn content_key(meta: &PublicationMeta) -> ([u8; 16], [u8; 16]) {
    let mut ident = format!("{}_{}_{}", meta.meps_language, meta.symbol, meta.year);
    if meta.issue_tag != 0 {
        ident.push_str(&format!("_{}", meta.issue_tag));
    }
    let digest = Sha256::digest(ident.as_bytes());
    let mut d = [0u8; 32];
    for (i, b) in d.iter_mut().enumerate() {
        *b = digest[i] ^ KEY_MASK[i];
    }
    let mut key = [0u8; 16];
    let mut iv = [0u8; 16];
    key.copy_from_slice(&d[..16]);
    iv.copy_from_slice(&d[16..]);
    (key, iv)
}

fn read_meta(conn: &Connection) -> Result<PublicationMeta, CoreError> {
    let row = conn
        .query_row(
            "SELECT Title, Symbol, Year, MepsLanguageIndex, IssueTagNumber, \
             PublicationType, Type FROM Publication",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Value>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            },
        )
        // A JWPUB database without a readable `Publication` row is not a
        // JWPUB database.
        .map_err(corrupt)?;
    let (title, symbol, year, lang, issue, publication_type, pub_type) = row;
    Ok(PublicationMeta {
        symbol,
        meps_language: u32::try_from(lang).map_err(corrupt)?,
        year: u32::try_from(year).map_err(corrupt)?,
        issue_tag: issue_tag(issue)?,
        title,
        publication_type,
        pub_type,
    })
}

/// An `IssueTagNumber`. It is declared TEXT and stored as e.g. `'20260800'`
/// or `'0'`, but may also be an integer. Anything else => `Corrupt`.
fn issue_tag(value: Value) -> Result<u32, CoreError> {
    let n = match value {
        Value::Integer(n) => n,
        Value::Text(s) => s.parse().map_err(corrupt)?,
        _ => return Err(CoreError::Corrupt),
    };
    u32::try_from(n).map_err(corrupt)
}

/// Build `SELECT <required>, <optional> <tail>` for `table`, substituting
/// `NULL` for optional columns this schema version lacks. `None` if the table
/// doesn't exist; `Corrupt` if a required column is missing.
fn select_sql(
    conn: &Connection,
    table: &str,
    required: &[&str],
    optional: &[&str],
    tail: &str,
) -> Result<Option<String>, CoreError> {
    let cols: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info(?1)")
            .map_err(db_err)?;
        let rows = stmt.query_map([table], |r| r.get(0)).map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)?
    };
    if cols.is_empty() {
        return Ok(None);
    }
    let has = |c: &str| cols.iter().any(|x| x == c);
    if !required.iter().all(|c| has(c)) {
        return Err(CoreError::Corrupt);
    }
    let select: Vec<String> = required
        .iter()
        .map(|c| c.to_string())
        .chain(optional.iter().map(|c| {
            if has(c) {
                c.to_string()
            } else {
                format!("NULL AS {c}")
            }
        }))
        .collect();
    Ok(Some(format!("SELECT {}{tail}", select.join(", "))))
}

/// Copy a zip entry to `dst`, optionally hashing it. Read failures (bad
/// deflate data, CRC mismatch, truncation) are `Corrupt`; write failures are
/// `Io`.
fn copy_entry(
    mut src: impl Read,
    dst: &mut File,
    mut hasher: Option<&mut Sha256>,
) -> Result<(), CoreError> {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = match src.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(CoreError::Corrupt),
        };
        if let Some(h) = hasher.as_deref_mut() {
            h.update(&buf[..n]);
        }
        dst.write_all(&buf[..n])?;
    }
    dst.flush()?;
    Ok(())
}

/// Map a database error from a typed reader: values of the wrong type or out
/// of range mean the publication data is bad (`Corrupt`); anything else goes
/// through the crate-wide `rusqlite` mapping.
fn db_err(e: rusqlite::Error) -> CoreError {
    match e {
        rusqlite::Error::InvalidColumnType(..)
        | rusqlite::Error::FromSqlConversionFailure(..)
        | rusqlite::Error::IntegralValueOutOfRange(..) => CoreError::Corrupt,
        other => other.into(),
    }
}

/// The manifest's database name must be a plain file name, so it can only
/// ever name a file directly inside an unpacked publication's directory.
fn check_file_name(name: &str) -> Result<(), CoreError> {
    let mut parts = Path::new(name).components();
    match (parts.next(), parts.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(()),
        _ => Err(CoreError::Corrupt),
    }
}

fn corrupt<E>(_: E) -> CoreError {
    CoreError::Corrupt
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data) in entries {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    /// A container whose `contents` holds `t.db` plus `extra`.
    fn container(dir: &Path, extra: &str) -> Container {
        let contents = zip_bytes(&[("t.db", b"db"), (extra, b"x")]);
        let manifest = format!(
            r#"{{"hash":"{}","publication":{{"fileName":"t.db","symbol":"t","language":0}}}}"#,
            hex::encode(Sha256::digest(&contents))
        );
        let path = dir.join("t.jwpub");
        std::fs::write(
            &path,
            zip_bytes(&[
                ("manifest.json", manifest.as_bytes()),
                ("contents", &contents),
            ]),
        )
        .unwrap();
        Container::open(&path, dir).unwrap()
    }

    #[test]
    fn unpack_rejects_escaping_and_colliding_names() {
        for name in ["../evil", "a/../../evil", "/abs", "manifest.json"] {
            let tmp = tempfile::tempdir().unwrap();
            let out = tmp.path().join("out");
            std::fs::create_dir(&out).unwrap();
            let mut c = container(tmp.path(), name);
            c.write_manifest(&out).unwrap();
            c.unpack_entry(0, &out).unwrap();
            let err = c.unpack_entry(1, &out).unwrap_err();
            assert!(matches!(err, CoreError::Corrupt), "{name}: {err:?}");
            assert!(!tmp.path().join("evil").exists(), "{name}");
        }
    }

    #[test]
    fn unpack_keeps_subdirectories() {
        let tmp = tempfile::tempdir().unwrap();
        let out = tmp.path().join("out");
        std::fs::create_dir(&out).unwrap();
        let mut c = container(tmp.path(), "img/a.jpg");
        for i in 0..c.len() {
            c.unpack_entry(i, &out).unwrap();
        }
        assert_eq!(std::fs::read(out.join("img/a.jpg")).unwrap(), b"x");
        assert_eq!(std::fs::read(out.join("t.db")).unwrap(), b"db");
    }

    #[test]
    fn manifest_file_name_must_be_plain() {
        for name in ["../t.db", "a/t.db", "/t.db", ""] {
            assert!(
                matches!(check_file_name(name), Err(CoreError::Corrupt)),
                "{name:?}"
            );
        }
        check_file_name("t.db").unwrap();
    }
}
