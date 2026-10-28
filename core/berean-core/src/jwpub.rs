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
use std::io::{Read, Seek, SeekFrom, Write};
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

/// An opened JWPUB. The database is extracted to a temp file that lives (and
/// is deleted) with this value.
pub struct Publication {
    // Declared before `_db_file` so the connection closes before the file is
    // deleted.
    conn: Connection,
    meta: PublicationMeta,
    key: [u8; 16],
    iv: [u8; 16],
    _db_file: NamedTempFile,
}

impl Publication {
    /// Open a `.jwpub`, extracting its database under the system temp dir.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CoreError> {
        Self::open_in(path, std::env::temp_dir())
    }

    /// Open a `.jwpub`, extracting its database under `temp_dir`.
    pub fn open_in(path: impl AsRef<Path>, temp_dir: impl AsRef<Path>) -> Result<Self, CoreError> {
        let temp_dir = temp_dir.as_ref();
        let mut outer = zip::ZipArchive::new(File::open(path)?).map_err(corrupt)?;

        let manifest: Manifest = {
            let mut text = String::new();
            outer
                .by_name("manifest.json")
                .map_err(corrupt)?
                .read_to_string(&mut text)
                .map_err(corrupt)?;
            serde_json::from_str(&text).map_err(corrupt)?
        };

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

        contents.as_file_mut().seek(SeekFrom::Start(0))?;
        let mut inner = zip::ZipArchive::new(contents.as_file()).map_err(corrupt)?;
        let mut db_file = NamedTempFile::new_in(temp_dir)?;
        copy_entry(
            inner
                .by_name(&manifest.publication.file_name)
                .map_err(corrupt)?,
            db_file.as_file_mut(),
            None,
        )?;
        drop(inner);
        drop(contents);

        let conn = Connection::open_with_flags(
            db_file.path(),
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
        let sql = select_sql(
            &self.conn,
            "Document",
            &["DocumentId", "MepsDocumentId", "Class", "Type", "Title"],
            &["SectionNumber", "ChapterNumber"],
            // Avoid reading every content blob just to test for NULL.
            ", Content IS NOT NULL FROM Document ORDER BY DocumentId",
        )?
        .ok_or(CoreError::Corrupt)?;
        self.query(&sql, [], |r| {
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
        let Some(sql) = select_sql(
            &self.conn,
            "DocumentParagraph",
            &["DocumentParagraphId", "DocumentId", "ParagraphIndex"],
            &["ParagraphNumberLabel", "BeginPosition", "EndPosition"],
            " FROM DocumentParagraph WHERE DocumentId = ?1 ORDER BY ParagraphIndex",
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [document_id], |r| {
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

    fn commentaries(&self, table: &str, id_col: &str) -> Result<Vec<Commentary>, CoreError> {
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
            &format!(" FROM {table} ORDER BY {id_col}"),
        )?
        else {
            return Ok(Vec::new());
        };
        self.query(&sql, [], |r| {
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
    // IssueTagNumber is declared TEXT and stored as e.g. '20260800' or '0',
    // but may also be an integer.
    let issue_tag = match issue {
        Value::Integer(n) => n,
        Value::Text(s) => s.parse().map_err(corrupt)?,
        _ => return Err(CoreError::Corrupt),
    };
    Ok(PublicationMeta {
        symbol,
        meps_language: u32::try_from(lang).map_err(corrupt)?,
        year: u32::try_from(year).map_err(corrupt)?,
        issue_tag: u32::try_from(issue_tag).map_err(corrupt)?,
        title,
        publication_type,
        pub_type,
    })
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

fn corrupt<E>(_: E) -> CoreError {
    CoreError::Corrupt
}
