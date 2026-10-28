//! Tests against real JW Library publications. The fixtures are not committed:
//! run `core/scripts/fetch-fixtures.sh` to download them into `core/fixtures/`.

mod common;

use std::io::Read;

use berean_core::jwpub::{Publication, PublicationMeta};
use common::fixture;
use rusqlite::Connection;

const ALL: [&str; 3] = ["w_E_202608.jwpub", "w_S_202608.jwpub", "ll_E.jwpub"];

fn open(name: &str) -> Publication {
    Publication::open(fixture(name)).unwrap_or_else(|e| panic!("open {name}: {e:?}"))
}

/// Extract the fixture's database independently of `jwpub`, for cross-checks.
fn raw_db(name: &str) -> (tempfile::TempDir, Connection) {
    let mut outer = zip::ZipArchive::new(std::fs::File::open(fixture(name)).unwrap()).unwrap();
    let mut contents = Vec::new();
    outer
        .by_name("contents")
        .unwrap()
        .read_to_end(&mut contents)
        .unwrap();
    let mut inner = zip::ZipArchive::new(std::io::Cursor::new(contents)).unwrap();
    let db_name = name.replace(".jwpub", ".db");
    let mut db = Vec::new();
    inner
        .by_name(&db_name)
        .unwrap()
        .read_to_end(&mut db)
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db_name);
    std::fs::write(&path, db).unwrap();
    let conn = Connection::open(&path).unwrap();
    (dir, conn)
}

fn count(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> usize {
    let n: i64 = conn.query_row(sql, params, |r| r.get(0)).unwrap();
    n as usize
}

#[test]
fn metadata() {
    assert_eq!(
        open("w_E_202608.jwpub").meta(),
        &PublicationMeta {
            symbol: "w26".into(),
            meps_language: 0,
            year: 2026,
            issue_tag: 20260800,
            title: "The Watchtower Announcing Jehovah’s Kingdom (Study)—2026".into(),
            publication_type: "Watchtower".into(),
            pub_type: 3,
        }
    );
    assert_eq!(
        open("w_S_202608.jwpub").meta(),
        &PublicationMeta {
            symbol: "w26".into(),
            meps_language: 1,
            year: 2026,
            issue_tag: 20260800,
            title: "La Atalaya. Anunciando el Reino de Jehová (estudio) 2026".into(),
            publication_type: "Watchtower".into(),
            pub_type: 3,
        }
    );
    assert_eq!(
        open("ll_E.jwpub").meta(),
        &PublicationMeta {
            symbol: "ll".into(),
            meps_language: 0,
            year: 2011,
            issue_tag: 0,
            title: "Listen to God and Live Forever".into(),
            publication_type: "Brochure".into(),
            pub_type: 1,
        }
    );
}

#[test]
fn document_counts_match_db() {
    for (name, expected) in [
        ("w_E_202608.jwpub", 9),
        ("w_S_202608.jwpub", 9),
        ("ll_E.jwpub", 18),
    ] {
        let (_dir, conn) = raw_db(name);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM Document", []),
            expected,
            "{name}"
        );
        assert_eq!(open(name).documents().unwrap().len(), expected, "{name}");
    }
}

#[test]
fn known_documents() {
    let w_e = open("w_E_202608.jwpub");
    let doc = w_e
        .documents()
        .unwrap()
        .into_iter()
        .find(|d| d.document_id == 2)
        .unwrap();
    assert_eq!(
        doc.title,
        "Resist Satan’s Tactics—Trust In Jehovah and In Jesus"
    );
    assert_eq!(doc.meps_document_id, 2026520);
    assert_eq!(doc.class, "40");
    assert!(doc.has_content);
    assert!(w_e.document_html(2).unwrap().contains("SONG 55"));

    let w_s = open("w_S_202608.jwpub");
    let doc = w_s
        .documents()
        .unwrap()
        .into_iter()
        .find(|d| d.document_id == 2)
        .unwrap();
    assert_eq!(
        doc.title,
        "No creamos las mentiras de Satanás y confiemos en Jehová y Jesús"
    );
    assert!(w_s.document_html(2).unwrap().contains("CANCIÓN 55"));

    let ll = open("ll_E.jwpub");
    let docs = ll.documents().unwrap();
    assert_eq!(docs[2].document_id, 2);
    assert_eq!(docs[2].title, "Table of Contents");
    assert_eq!(docs[4].chapter_number, Some(1));
    assert!(ll
        .document_html(2)
        .unwrap()
        .contains("How Do We Listen to God?"));
}

#[test]
fn unknown_document_is_not_found() {
    let err = open("ll_E.jwpub").document_html(9999).unwrap_err();
    assert!(matches!(err, berean_core::CoreError::NotFound), "{err:?}");
}

#[test]
fn every_document_decrypts() {
    for name in ALL {
        let p = open(name);
        let docs = p.documents().unwrap();
        assert!(docs.iter().all(|d| d.has_content), "{name}");
        for d in docs {
            let html = p
                .document_html(d.document_id)
                .unwrap_or_else(|e| panic!("{name} doc {}: {e:?}", d.document_id));
            assert!(html.contains('<'), "{name} doc {}", d.document_id);
        }
    }
}

#[test]
fn paragraphs_match_paragraph_count() {
    // Verified on all three fixtures: every document's DocumentParagraph rows
    // number exactly its Document.ParagraphCount.
    for name in ALL {
        let (_dir, conn) = raw_db(name);
        let p = open(name);
        for d in p.documents().unwrap() {
            let expected = count(
                &conn,
                "SELECT ParagraphCount FROM Document WHERE DocumentId = ?1",
                [d.document_id],
            );
            let paras = p.document_paragraphs(d.document_id).unwrap();
            assert_eq!(paras.len(), expected, "{name} doc {}", d.document_id);
            assert!(paras.iter().all(|x| x.document_id == d.document_id));
        }
    }
}

#[test]
fn generic_readers_ok() {
    for name in ALL {
        let p = open(name);
        let citations: usize = p
            .documents()
            .unwrap()
            .iter()
            .map(|d| p.bible_citations(d.document_id).unwrap().len())
            .sum();
        let (_dir, conn) = raw_db(name);
        let total = count(&conn, "SELECT COUNT(*) FROM BibleCitation", []);
        assert_eq!(citations, total, "{name}");
        assert!(total > 0, "{name}");

        // Empty in these fixtures (and VerseCommentary* is absent from ll_E),
        // but the readers must still succeed.
        assert!(p.verse_commentaries().unwrap().is_empty(), "{name}");
        assert!(p.verse_commentary_maps().unwrap().is_empty(), "{name}");
        assert!(p.paragraph_commentaries().unwrap().is_empty(), "{name}");
        assert!(p.paragraph_commentary_maps().unwrap().is_empty(), "{name}");
    }
}

#[test]
fn other_content_columns_decrypt() {
    // w_E_202608 has Footnote, Extract and Question rows; all use the same
    // encryption as Document.Content.
    let p = open("w_E_202608.jwpub");
    let (_dir, conn) = raw_db("w_E_202608.jwpub");
    for (table, min_rows) in [("Footnote", 5), ("Extract", 12), ("Question", 69)] {
        let blobs: Vec<Vec<u8>> = conn
            .prepare(&format!(
                "SELECT Content FROM {table} WHERE Content IS NOT NULL"
            ))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(blobs.len(), min_rows, "{table}");
        for b in blobs {
            let html = p.decrypt(&b).unwrap_or_else(|e| panic!("{table}: {e:?}"));
            assert!(!html.is_empty(), "{table}");
        }
    }
}
