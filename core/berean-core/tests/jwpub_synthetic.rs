//! JWPUB error paths and a minimal hand-built publication. No fixtures needed:
//! every container is built here.

use std::io::Write;
use std::path::{Path, PathBuf};

use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use berean_core::jwpub::Publication;
use berean_core::CoreError;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;

const MASK: &str = "11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7";
const HTML: &str = "<p>In the beginning</p>";

/// Encrypt `html` the way JWPUB content is stored, for the identity string
/// `ident` (e.g. `0_tst_2024`).
fn encrypt(ident: &str, html: &str) -> Vec<u8> {
    let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    z.write_all(html.as_bytes()).unwrap();
    let plain = z.finish().unwrap();

    let mask = hex::decode(MASK).unwrap();
    let d: Vec<u8> = Sha256::digest(ident.as_bytes())
        .iter()
        .zip(mask)
        .map(|(a, b)| a ^ b)
        .collect();
    let mut buf = plain.clone();
    buf.resize(plain.len() + 16, 0);
    let n = cbc::Encryptor::<aes::Aes128>::new(d[..16].into(), d[16..].into())
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plain.len())
        .unwrap()
        .len();
    buf.truncate(n);
    buf
}

/// A minimal publication DB (symbol `tst`, English, 2024, no issue) whose one
/// document and one verse commentary are encrypted under `ident`.
fn build_db(dir: &Path, ident: &str) -> Vec<u8> {
    let path = dir.join("tst_E.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE Publication (Title TEXT, Symbol TEXT, Year INTEGER,
             MepsLanguageIndex INTEGER, IssueTagNumber TEXT,
             PublicationType TEXT, Type INTEGER);
         INSERT INTO Publication VALUES ('Test', 'tst', 2024, 0, '0', 'Book', 2);
         CREATE TABLE Document (DocumentId INTEGER, MepsDocumentId INTEGER,
             Class TEXT, Type INTEGER, Title TEXT, Content BLOB);
         CREATE TABLE VerseCommentary (VerseCommentaryId INTEGER, Label TEXT,
             Content BLOB);",
    )
    .unwrap();
    let blob = encrypt(ident, HTML);
    conn.execute(
        "INSERT INTO Document VALUES (1, 100, '13', 0, 'Chapter', ?1),
                                     (2, 101, '13', 0, 'Empty', NULL)",
        [&blob],
    )
    .unwrap();
    conn.execute("INSERT INTO VerseCommentary VALUES (7, 'v', ?1)", [&blob])
        .unwrap();
    drop(conn);
    std::fs::read(path).unwrap()
}

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in entries {
        w.start_file(*name, SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn manifest(hash: &str) -> Vec<u8> {
    format!(
        r#"{{"hash":"{hash}","publication":{{"fileName":"tst_E.db","symbol":"tst",
            "language":0,"year":2024,"issueId":0,"title":"Test"}}}}"#
    )
    .into_bytes()
}

/// Build a full `.jwpub` in `dir` with content encrypted under `ident`.
fn build_jwpub(dir: &Path, ident: &str) -> PathBuf {
    let contents = zip_bytes(&[("tst_E.db", &build_db(dir, ident))]);
    let hash = hex::encode(Sha256::digest(&contents));
    write(
        dir,
        &zip_bytes(&[("manifest.json", &manifest(&hash)), ("contents", &contents)]),
    )
}

fn write(dir: &Path, bytes: &[u8]) -> PathBuf {
    let path = dir.join("test.jwpub");
    std::fs::write(&path, bytes).unwrap();
    path
}

fn open_err(path: &Path) -> CoreError {
    match Publication::open(path) {
        Ok(_) => panic!("expected an error"),
        Err(e) => e,
    }
}

#[test]
fn valid_publication_opens_and_decrypts() {
    let dir = tempfile::tempdir().unwrap();
    let p = Publication::open_in(build_jwpub(dir.path(), "0_tst_2024"), dir.path()).unwrap();
    assert_eq!(p.meta().symbol, "tst");
    assert_eq!(p.meta().issue_tag, 0);
    let docs = p.documents().unwrap();
    assert_eq!(docs.len(), 2);
    assert!(docs[0].has_content && !docs[1].has_content);
    // Optional columns absent from this schema read as None.
    assert_eq!(docs[0].chapter_number, None);
    assert_eq!(p.document_html(1).unwrap(), HTML);
    assert!(matches!(p.document_html(2), Err(CoreError::NotFound)));
    assert!(matches!(p.document_html(3), Err(CoreError::NotFound)));

    // Readers tolerate missing tables and missing optional columns, and every
    // encrypted column decrypts with the same key.
    assert!(p.document_paragraphs(1).unwrap().is_empty());
    assert!(p.bible_citations(1).unwrap().is_empty());
    assert!(p.verse_commentary_maps().unwrap().is_empty());
    let vc = p.verse_commentaries().unwrap();
    assert_eq!(vc.len(), 1);
    assert_eq!(vc[0].commentary_id, 7);
    assert_eq!(vc[0].commentary_type, None);
    assert_eq!(p.decrypt(vc[0].content.as_ref().unwrap()).unwrap(), HTML);
}

#[test]
fn wrong_key_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    // Content encrypted for a different identity than the Publication row.
    let p = Publication::open(build_jwpub(dir.path(), "1_tst_2024")).unwrap();
    assert!(matches!(p.document_html(1), Err(CoreError::Corrupt)));
    assert!(matches!(
        p.decrypt(b"not encrypted"),
        Err(CoreError::Corrupt)
    ));
}

#[test]
fn not_a_zip_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(dir.path(), b"definitely not a zip file");
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn truncated_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = std::fs::read(build_jwpub(dir.path(), "0_tst_2024")).unwrap();
    let path = write(dir.path(), &bytes[..bytes.len() / 2]);
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn missing_file_is_io() {
    let dir = tempfile::tempdir().unwrap();
    let err = open_err(&dir.path().join("absent.jwpub"));
    assert!(matches!(err, CoreError::Io(_)), "{err:?}");
}

#[test]
fn missing_manifest_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(dir.path(), &zip_bytes(&[("contents", b"x")]));
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn malformed_manifest_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(
        dir.path(),
        &zip_bytes(&[("manifest.json", b"{not json"), ("contents", b"x")]),
    );
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn missing_contents_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let hash = hex::encode(Sha256::digest(b""));
    let path = write(
        dir.path(),
        &zip_bytes(&[("manifest.json", &manifest(&hash))]),
    );
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn hash_mismatch_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let contents = zip_bytes(&[("tst_E.db", &build_db(dir.path(), "0_tst_2024"))]);
    let wrong = hex::encode(Sha256::digest(b"something else"));
    let path = write(
        dir.path(),
        &zip_bytes(&[
            ("manifest.json", &manifest(&wrong)),
            ("contents", &contents),
        ]),
    );
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn missing_db_entry_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let contents = zip_bytes(&[("other.db", b"x")]);
    let hash = hex::encode(Sha256::digest(&contents));
    let path = write(
        dir.path(),
        &zip_bytes(&[("manifest.json", &manifest(&hash)), ("contents", &contents)]),
    );
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn db_not_sqlite_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let contents = zip_bytes(&[("tst_E.db", b"definitely not a sqlite database")]);
    let hash = hex::encode(Sha256::digest(&contents));
    let path = write(
        dir.path(),
        &zip_bytes(&[("manifest.json", &manifest(&hash)), ("contents", &contents)]),
    );
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}

#[test]
fn identity_mismatch_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let contents = zip_bytes(&[("tst_E.db", &build_db(dir.path(), "0_tst_2024"))]);
    let hash = hex::encode(Sha256::digest(&contents));
    let other = String::from_utf8(manifest(&hash))
        .unwrap()
        .replace(r#""symbol":"tst""#, r#""symbol":"xyz""#);
    let path = write(
        dir.path(),
        &zip_bytes(&[("manifest.json", other.as_bytes()), ("contents", &contents)]),
    );
    assert!(matches!(open_err(&path), CoreError::Corrupt));
}
