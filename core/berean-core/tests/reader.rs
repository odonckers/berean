//! The reader against real JW Library publications, installed into one shared
//! core. The fixtures are not committed: run `core/scripts/fetch-fixtures.sh`
//! to download them into `core/fixtures/`.

mod common;

use std::sync::OnceLock;

use berean_core::reader::{Location, LocationSpan, Reader, TocEntry};
use berean_core::{CancelToken, Core, CoreError};
use common::{fixture, raw_db};

const W_E: &str = "w26:0:20260800";
const W_S: &str = "w26:1:20260800";
const LL_E: &str = "ll:0:0";
const TE_E: &str = "te:0:0";
const NWT_E: &str = "nwt:0:0";
const NWT_S: &str = "nwt:1:0";

/// MEPS document ids, the same in every language.
const JOHN_DOC: i64 = 1001061147;
const WIN_THE_BATTLE_DOC: i64 = 2026521;
const W_CONTENTS_DOC: i64 = 2026527;
const LL_TITLE_PAGE_DOC: i64 = 1102011094;

/// A core with every reader fixture installed, shared by all tests (the
/// Bibles are large). It lives under Cargo's per-target temp dir and is
/// rebuilt on each run.
fn core() -> &'static Core {
    static CORE: OnceLock<Core> = OnceLock::new();
    CORE.get_or_init(|| {
        let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("reader");
        if dir.exists() {
            std::fs::remove_dir_all(&dir).unwrap();
        }
        let core = Core::open(dir.join("data"), dir.join("cache")).unwrap();
        for (key, file) in [
            (W_E, "w_E_202608.jwpub"),
            (W_S, "w_S_202608.jwpub"),
            (LL_E, "ll_E.jwpub"),
            (TE_E, "te_E.jwpub"),
            (NWT_E, "nwt_E.jwpub"),
            (NWT_S, "nwt_S.jwpub"),
        ] {
            core.library()
                .install(key, fixture(file), &|_, _| {}, &CancelToken::new())
                .unwrap_or_else(|e| panic!("install {file}: {e:?}"));
        }
        core
    })
}

fn reader() -> Reader {
    core().reader()
}

fn entry(title: &str, doc_id: Option<i64>, depth: u32) -> TocEntry {
    TocEntry {
        title: title.into(),
        doc_id,
        depth,
    }
}

/// The Bible books in a Bible's table of contents: the second top-level
/// heading holds the two Scripture headings, which hold the books.
fn toc_books(pub_key: &str) -> Vec<TocEntry> {
    let toc = reader().toc(pub_key).unwrap();
    let at = toc
        .iter()
        .enumerate()
        .filter(|(_, e)| e.depth == 0)
        .nth(1)
        .unwrap()
        .0;
    toc[at + 1..]
        .iter()
        .take_while(|e| e.depth > 0)
        .filter(|e| e.depth == 2)
        .cloned()
        .collect()
}

fn verse_location(pub_key: &str, book: u32, chapter: u32, verse: Option<u32>) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: toc_books(pub_key)[book as usize - 1].doc_id,
        book: Some(book),
        chapter: Some(chapter),
        verse,
        paragraph: None,
    }
}

fn document_location(pub_key: &str, doc_id: i64, paragraph: Option<u32>) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: Some(doc_id),
        book: None,
        chapter: None,
        verse: None,
        paragraph,
    }
}

/// A span of one location.
fn point(location: Location) -> LocationSpan {
    LocationSpan {
        start: location.clone(),
        end: location,
    }
}

fn span(start: Location, end: Location) -> LocationSpan {
    LocationSpan { start, end }
}

/// Resolve a reference that names a single location.
#[track_caller]
fn resolve_one(reference: &str) -> Location {
    let span = reader().resolve(reference).unwrap();
    assert_eq!(span.start, span.end, "{reference:?}");
    span.start
}

#[track_caller]
fn assert_not_found<T: std::fmt::Debug>(r: Result<T, CoreError>) {
    assert!(matches!(r, Err(CoreError::NotFound)), "{r:?}");
}

#[track_caller]
fn assert_invalid<T: std::fmt::Debug>(r: Result<T, CoreError>, msg: &str) {
    match r {
        Err(CoreError::Invalid(m)) => assert!(m.contains(msg), "{m:?} lacks {msg:?}"),
        other => panic!("expected Invalid({msg:?}), got {other:?}"),
    }
}

#[test]
fn book_toc_has_headings_and_nested_chapters() {
    let toc = reader().toc(TE_E).unwrap();
    let doc = |i: usize| toc[i].doc_id;
    // The CHAPTERS heading is itself nested under CONTENTS.
    assert_eq!(
        toc[..6],
        [
            entry("CONTENTS", None, 0),
            entry("Title Page/Publishers’ Page", doc(1), 1),
            entry("Contents", doc(2), 1),
            entry("A Word to You Parents", doc(3), 1),
            entry("CHAPTERS", None, 1),
            entry("1. Jesus, the Great Teacher", doc(5), 2),
        ]
    );
    let chapters: Vec<&TocEntry> = toc.iter().filter(|e| e.depth == 2).collect();
    assert_eq!(chapters.len(), 46);
    for (i, e) in chapters.iter().enumerate() {
        assert!(e.title.starts_with(&format!("{}. ", i + 1)), "{e:?}");
    }
    assert_eq!(chapters[45].title, "46. The Way to Live Forever");
    assert_eq!(
        toc.last().unwrap(),
        &entry("Other Aids for Your Family", toc.last().unwrap().doc_id, 1)
    );
    assert_eq!(toc.iter().filter(|e| e.doc_id.is_none()).count(), 2);
    // Every entry with a document opens.
    for e in &toc {
        match e.doc_id {
            Some(id) => assert!(!reader().document(TE_E, id).unwrap().html.is_empty()),
            None => assert!(e.title.chars().all(|c| !c.is_lowercase()), "{e:?}"),
        }
    }
}

#[test]
fn watchtower_toc_lists_the_articles_in_order() {
    assert_eq!(
        reader().toc(W_E).unwrap(),
        [
            entry("The Watchtower (Study)—2026", None, 0),
            entry("Study Edition", Some(2026528), 1),
            entry("Table of Contents", Some(W_CONTENTS_DOC), 1),
            entry(
                "Resist Satan’s Tactics—Trust In Jehovah and In Jesus",
                Some(2026520),
                1
            ),
            entry("You Can Win the Battle!", Some(WIN_THE_BATTLE_DOC), 1),
            entry("An Appeal on the Basis of Love", Some(2026522), 1),
            entry(
                "Cherish “the Privilege of Fearlessly Rendering Sacred Service”",
                Some(2026523),
                1
            ),
            entry("My Grand Creator Noticed Me", Some(2026524), 1),
            entry("Did You Know?", Some(2026525), 1),
            entry("The Tree That Wakes Up Early", Some(2026526), 1),
        ]
    );
}

#[test]
fn brochure_toc_titles_are_trimmed() {
    let toc = reader().toc(LL_E).unwrap();
    let titles: Vec<&str> = toc.iter().take(7).map(|e| e.title.as_str()).collect();
    assert_eq!(
        titles,
        [
            "Listen and Live  (ll)",
            "Listen to God and Live Forever",
            "Title Page/Publishers’ Page",
            "Table of Contents",
            "Introduction",
            "1 How Do We Listen to God?",
            "2 Who Is the True God?",
        ]
    );
    assert!(toc.iter().any(|e| e.title.starts_with("10 What Blessings")));
    assert!(toc.iter().all(|e| e.title.trim() == e.title));
    assert_eq!((toc[0].doc_id, toc[0].depth), (None, 0));
    assert!(toc[1..].iter().all(|e| e.depth == 1 && e.doc_id.is_some()));
}

#[test]
fn bible_toc_lists_the_books_in_order() {
    let toc = reader().toc(NWT_E).unwrap();
    let top: Vec<&str> = toc
        .iter()
        .filter(|e| e.depth == 0)
        .map(|e| e.title.as_str())
        .collect();
    assert_eq!(
        top,
        ["INTRODUCTION", "BOOKS", "INDEX", "APPENDIX A", "APPENDIX B"]
    );
    let books_at = toc.iter().position(|e| e.title == "BOOKS").unwrap();
    let books: Vec<&TocEntry> = toc[books_at + 1..]
        .iter()
        .take_while(|e| e.depth > 0)
        .collect();
    assert_eq!(
        books
            .iter()
            .filter(|e| e.depth == 1)
            .map(|e| (e.title.as_str(), e.doc_id))
            .collect::<Vec<_>>(),
        [
            ("HEBREW-ARAMAIC SCRIPTURES", None),
            ("CHRISTIAN GREEK SCRIPTURES", None)
        ]
    );
    let books = toc_books(NWT_E);
    let names: Vec<&str> = books.iter().map(|e| e.title.as_str()).collect();
    assert_eq!(names.len(), 66);
    assert_eq!(
        (names[0], names[18], names[42], names[65]),
        ("Genesis", "Psalms", "John", "Revelation")
    );
    assert!(books.iter().all(|e| e.doc_id.is_some()));
    assert_eq!(books[42].doc_id, Some(JOHN_DOC));
    let spanish = toc_books(NWT_S);
    assert_eq!(
        (spanish[0].title.as_str(), spanish[65].title.as_str()),
        ("Génesis", "Apocalipsis")
    );
}

#[test]
fn article_html_and_paragraph_anchors() {
    let doc = reader().document(W_E, WIN_THE_BATTLE_DOC).unwrap();
    assert_eq!(doc.doc_id, WIN_THE_BATTLE_DOC);
    assert_eq!(doc.title, "You Can Win the Battle!");
    assert!(doc.html.contains("You Can Win the Battle!"));
    // Five of the article's 76 paragraphs have no position in the HTML.
    assert_eq!(doc.paragraphs.len(), 76);
    assert_eq!(
        doc.paragraphs.iter().filter(|p| p.begin.is_none()).count(),
        5
    );
    let numbered: Vec<_> = doc
        .paragraphs
        .iter()
        .filter_map(|p| Some((p.paragraph, p.label.as_deref()?)))
        .take(2)
        .collect();
    assert_eq!(numbered, [(7, "1"), (8, "2")]);
}

#[test]
fn paragraph_anchors_match_the_database_and_the_html() {
    for (pub_key, file) in [
        (W_E, "w_E_202608.jwpub"),
        (LL_E, "ll_E.jwpub"),
        (TE_E, "te_E.jwpub"),
    ] {
        let (_dir, conn) = raw_db(file);
        let mut stmt = conn
            .prepare(
                "SELECT d.MepsDocumentId, COUNT(p.DocumentParagraphId) FROM Document d \
                 LEFT JOIN DocumentParagraph p USING (DocumentId) \
                 WHERE d.Content IS NOT NULL GROUP BY d.DocumentId",
            )
            .unwrap();
        let docs: Vec<(i64, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(!docs.is_empty());
        for (doc_id, count) in docs {
            let doc = reader().document(pub_key, doc_id).unwrap();
            assert_eq!(doc.paragraphs.len() as i64, count, "{pub_key} {doc_id}");
            for p in &doc.paragraphs {
                let pid = format!("data-pid=\"{}\"", p.paragraph);
                match (p.begin, p.end) {
                    (Some(b), Some(e)) => {
                        // The range is the paragraph's whole element.
                        let slice = &doc.html[b as usize..e as usize];
                        let open = &slice[..slice.find('>').unwrap() + 1];
                        let name: String = open[1..]
                            .chars()
                            .take_while(|c| c.is_ascii_alphanumeric())
                            .collect();
                        assert!(!name.is_empty(), "{pub_key} {doc_id} {p:?}");
                        assert!(open.contains(&pid), "{pub_key} {doc_id} {p:?}");
                        assert!(
                            slice.ends_with(&format!("</{name}>")),
                            "{pub_key} {doc_id} {p:?}"
                        );
                    }
                    (None, None) => {
                        assert!(!doc.html.contains(&pid), "{pub_key} {doc_id} {p:?}")
                    }
                    _ => panic!("{pub_key} {doc_id} {p:?}"),
                }
            }
        }
    }
}

#[track_caller]
fn assert_paragraph(pub_key: &str, doc_id: i64, paragraph: u32, html: &str) {
    let doc = reader().document(pub_key, doc_id).unwrap();
    let p = doc
        .paragraphs
        .iter()
        .find(|p| p.paragraph == paragraph)
        .unwrap();
    assert_eq!(
        &doc.html[p.begin.unwrap() as usize..p.end.unwrap() as usize],
        html
    );
}

#[test]
fn brochure_paragraphs_include_their_tags() {
    // ll records only the element's content; the anchor covers the element.
    assert_paragraph(
        LL_E,
        LL_TITLE_PAGE_DOC,
        2,
        "<h1 id=\"p2\" data-pid=\"2\"><strong>Listen to God and Live Forever</strong></h1>",
    );
    assert_paragraph(
        LL_E,
        LL_TITLE_PAGE_DOC,
        6,
        "<p id=\"p6\" data-pid=\"6\" class=\"si\">January 2016 Printing</p>",
    );
}

#[test]
fn watchtower_paragraphs_include_their_tags() {
    assert_paragraph(
        W_E,
        W_CONTENTS_DOC,
        3,
        "<h3 id=\"p3\" data-pid=\"3\">Study article for October\u{a0}5-11, 2026</h3>",
    );
}

#[test]
fn john_3() {
    let ch = reader().bible_chapter(NWT_E, 43, 3).unwrap();
    assert_eq!((ch.pub_key.as_str(), ch.book, ch.chapter), (NWT_E, 43, 3));
    let numbers: Vec<u32> = ch.verses.iter().map(|v| v.verse).collect();
    assert_eq!(numbers, (1..=36).collect::<Vec<_>>());
    for v in &ch.verses {
        let at = &ch.html[v.begin as usize..v.end as usize];
        assert!(
            at.starts_with(&format!("<span id=\"v43-3-{}-1\"", v.verse)),
            "{v:?}"
        );
        assert!(at.ends_with("</span>"), "{v:?}");
        assert!(!v.text.contains('<'), "{v:?}");
    }
    let v16 = &ch.verses[15];
    assert_eq!(v16.label, "16");
    assert!(v16
        .text
        .starts_with("“For God loved the world so much that he gave his only-begotten Son"));
    // A chapter's first verse is labeled with the chapter number.
    assert_eq!(ch.verses[0].label, "3");
}

#[test]
fn spanish_john_3_16() {
    let ch = reader().bible_chapter(NWT_S, 43, 3).unwrap();
    assert_eq!(ch.verses.len(), 36);
    assert!(ch.verses[15]
        .text
        .contains("Porque Dios amó tanto al mundo que entregó a su Hijo unigénito"));
}

#[test]
fn split_verse_covers_all_its_parts() {
    // John 1:3 is split across two paragraphs.
    let ch = reader().bible_chapter(NWT_E, 43, 1).unwrap();
    let v3 = ch.verses.iter().find(|v| v.verse == 3).unwrap();
    let begin = ch.html.find("<span id=\"v43-1-3-1\"").unwrap();
    let part2 = ch.html.find("<span id=\"v43-1-3-2\"").unwrap();
    let v4 = ch.html.find("<span id=\"v43-1-4-1\"").unwrap();
    assert_eq!(v3.begin as usize, begin);
    assert!(part2 < v3.end as usize && v3.end as usize <= v4);
    assert!(ch.html[begin..v3.end as usize].contains("</p>"));
    assert!(v3
        .text
        .contains("All things came into existence through him"));
}

#[test]
fn psalm_superscription_is_verse_0() {
    let ch = reader().bible_chapter(NWT_E, 19, 3).unwrap();
    let numbers: Vec<u32> = ch.verses.iter().map(|v| v.verse).collect();
    assert_eq!(numbers, (0..=8).collect::<Vec<_>>());
    assert_eq!(ch.verses[0].label, "");
    assert!(ch.verses[0].text.starts_with("A melody of David"));
}

#[test]
fn missing_chapters_are_not_found() {
    let r = reader();
    assert_not_found(r.bible_chapter(NWT_E, 43, 22));
    assert_not_found(r.bible_chapter(NWT_E, 67, 1));
    assert_not_found(r.bible_chapter(W_E, 43, 3));
    assert_not_found(r.bible_chapter("nwt:2:0", 43, 3));
    assert_invalid(r.bible_chapter("nwt", 43, 3), "malformed publication key");
}

#[test]
fn unknown_publications_and_documents_are_not_found() {
    let r = reader();
    assert_not_found(r.toc("zz:0:0"));
    assert_not_found(r.document("zz:0:0", WIN_THE_BATTLE_DOC));
    assert_not_found(r.document(W_E, 1));
    assert_not_found(r.document(LL_E, WIN_THE_BATTLE_DOC));
    assert_invalid(r.toc("bad"), "malformed publication key");
}

#[test]
fn resolve_citations() {
    let john_3_16 = verse_location(NWT_E, 43, 3, Some(16));
    assert_eq!(john_3_16.doc_id, Some(JOHN_DOC));
    assert_eq!(resolve_one("John 3:16"), john_3_16);
    for s in ["john 3:16", " JOHN\u{a0}3:16. ", "John 3:16;"] {
        assert_eq!(resolve_one(s), john_3_16, "{s:?}");
    }
    assert_eq!(
        resolve_one("Juan 3:16"),
        verse_location(NWT_S, 43, 3, Some(16))
    );
    assert_eq!(resolve_one("Psalm 23"), verse_location(NWT_E, 19, 23, None));
    assert_eq!(
        resolve_one("psalms 23:1"),
        verse_location(NWT_E, 19, 23, Some(1))
    );
    assert_eq!(
        resolve_one("Salmos 23:1"),
        verse_location(NWT_S, 19, 23, Some(1))
    );
    assert_eq!(
        resolve_one("1 John 4:8"),
        verse_location(NWT_E, 62, 4, Some(8))
    );
    assert_eq!(
        resolve_one("1\u{a0}Juan 4:8"),
        verse_location(NWT_S, 62, 4, Some(8))
    );
    for s in ["Éxodo 20:3", "exodo 20:3", "ÉXODO 20:3"] {
        assert_eq!(
            resolve_one(s),
            verse_location(NWT_S, 2, 20, Some(3)),
            "{s:?}"
        );
    }
    // A name both Bibles use resolves in the first, by key.
    assert_eq!(
        resolve_one("Daniel 2:44"),
        verse_location(NWT_E, 27, 2, Some(44))
    );
    assert_eq!(
        resolve_one("Song of Solomon 2:1"),
        verse_location(NWT_E, 22, 2, Some(1))
    );
}

#[test]
fn resolve_verse_ranges() {
    let r = reader();
    let john = |c, v| verse_location(NWT_E, 43, c, Some(v));
    for s in ["John 3:16-18", "john 3:16–18."] {
        assert_eq!(
            r.resolve(s).unwrap(),
            span(john(3, 16), john(3, 18)),
            "{s:?}"
        );
    }
    // Across chapters: John 3 ends at verse 36.
    assert_eq!(
        r.resolve("John 3:36-4:2").unwrap(),
        span(john(3, 36), john(4, 2))
    );
    assert_eq!(
        r.resolve("Juan 3:16-18").unwrap(),
        span(
            verse_location(NWT_S, 43, 3, Some(16)),
            verse_location(NWT_S, 43, 3, Some(18))
        )
    );
    assert_eq!(
        r.resolve("Salmos 23:1-6").unwrap(),
        span(
            verse_location(NWT_S, 19, 23, Some(1)),
            verse_location(NWT_S, 19, 23, Some(6))
        )
    );
    // A chapter alone: start and end are the chapter, without a verse.
    assert_eq!(
        r.resolve("Psalm 23").unwrap(),
        point(verse_location(NWT_E, 19, 23, None))
    );
    // Both ends must exist.
    for s in ["John 3:16-37", "John 3:36-22:1", "John 21:25-22:1"] {
        assert_not_found(r.resolve(s));
    }
    for s in ["John 3:18-16", "John 4:2-3:36"] {
        assert_invalid(r.resolve(s), "range ends before it starts");
    }
    for s in ["John 3:16, 17", "Juan 3:16,17"] {
        assert_invalid(r.resolve(s), "a list of references is not a single span");
    }
    assert_invalid(r.resolve("John 3-4"), "chapter ranges are not supported");
}

#[test]
fn resolve_rejects_malformed_citations() {
    let r = reader();
    for s in ["3:16", "", "John", "John 3:x", "John 3:16:1"] {
        assert_invalid(r.resolve(s), "not a citation");
    }
    for s in ["John 99:1", "John 3:37", "Nobook 1:1", "John 0"] {
        assert_not_found(r.resolve(s));
    }
}

#[test]
fn resolve_bible_links() {
    let r = reader();
    assert_eq!(
        resolve_one("jwpub://b/NWTR/43:3:16-43:3:16"),
        resolve_one("John 3:16")
    );
    assert_eq!(
        resolve_one("jwpub://b/NWTR/19:72:0-19:72:0"),
        verse_location(NWT_E, 19, 72, Some(0))
    );
    // Links from the watchtower: a range in a chapter, and one across
    // chapters (Acts 7:57-8:1).
    let w_links: String = (2026520..=2026526)
        .map(|id| r.document(W_E, id).unwrap().html)
        .collect();
    for (link, start, end) in [
        (
            "jwpub://b/NWTR/49:6:11-49:6:12",
            verse_location(NWT_E, 49, 6, Some(11)),
            verse_location(NWT_E, 49, 6, Some(12)),
        ),
        (
            "jwpub://b/NWTR/44:7:57-44:8:1",
            verse_location(NWT_E, 44, 7, Some(57)),
            verse_location(NWT_E, 44, 8, Some(1)),
        ),
    ] {
        assert!(w_links.contains(&format!("href=\"{link}\"")), "{link}");
        assert_eq!(r.resolve(link).unwrap(), span(start, end), "{link}");
    }
    // A psalm from its superscription.
    assert_eq!(
        r.resolve("jwpub://b/NWTR/19:72:0-19:72:20").unwrap(),
        span(
            verse_location(NWT_E, 19, 72, Some(0)),
            verse_location(NWT_E, 19, 72, Some(20))
        )
    );
    for link in [
        "jwpub://b/NWTR/43:3:18-43:3:16",
        "jwpub://b/NWTR/43:4:1-43:3:36",
        "jwpub://b/NWTR/44:1:1-43:1:1",
    ] {
        assert_invalid(r.resolve(link), "range ends before it starts");
    }
    assert_not_found(r.resolve("jwpub://b/NWTR/43:3:16-43:3:37"));
    for link in [
        "jwpub://b/NWTR/67:1:1-67:1:1",
        "jwpub://b/NWTR/43:22:1-43:22:1",
        "jwpub://b/NWTR/43:3:37-43:3:37",
        "jwpub://b/XYZ/43:3:16-43:3:16",
    ] {
        assert_not_found(r.resolve(link));
    }
    for link in [
        "jwpub://b/NWTR/43:3",
        "jwpub://b/43:3:16",
        "jwpub://b/NWTR/a:3:16",
    ] {
        assert_invalid(r.resolve(link), "malformed Bible link");
    }
}

#[test]
fn resolve_document_links() {
    let r = reader();
    // A link from the issue's table of contents to one of its articles.
    let contents = r.document(W_E, W_CONTENTS_DOC).unwrap();
    let link = format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/");
    assert!(contents.html.contains(&format!("href=\"{link}\"")));
    let location = resolve_one(&link);
    assert_eq!(location, document_location(W_E, WIN_THE_BATTLE_DOC, None));
    let doc = r
        .document(&location.pub_key, location.doc_id.unwrap())
        .unwrap();
    assert_eq!(doc.title, "You Can Win the Battle!");

    // MEPS ids are shared across languages; the code picks the edition.
    assert_eq!(
        resolve_one(&format!("jwpub://p/S:{WIN_THE_BATTLE_DOC}/")),
        document_location(W_S, WIN_THE_BATTLE_DOC, None)
    );
    assert_eq!(
        resolve_one(&format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/8")),
        document_location(W_E, WIN_THE_BATTLE_DOC, Some(8))
    );
    assert_eq!(
        resolve_one(&format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/8-8")),
        document_location(W_E, WIN_THE_BATTLE_DOC, Some(8))
    );
    assert_not_found(r.resolve(&format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/999")));
    // A paragraph range.
    assert_eq!(
        r.resolve(&format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/2-3"))
            .unwrap(),
        span(
            document_location(W_E, WIN_THE_BATTLE_DOC, Some(2)),
            document_location(W_E, WIN_THE_BATTLE_DOC, Some(3))
        )
    );
    assert_not_found(r.resolve(&format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/8-999")));
    assert_invalid(
        r.resolve(&format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/3-2")),
        "range ends before it starts",
    );

    // An article links to this publication, which is not installed.
    let article = r.document(W_E, 2026520).unwrap();
    assert!(article.html.contains("href=\"jwpub://p/E:1102016855/\""));
    assert_not_found(r.resolve("jwpub://p/E:1102016855/"));
    assert_not_found(r.resolve(&format!("jwpub://p/XX:{WIN_THE_BATTLE_DOC}/")));

    for link in ["jwpub://p/E/", "jwpub://p/E:abc/", "jwpub://p/E:1/x"] {
        assert_invalid(r.resolve(link), "malformed document link");
    }
    assert_invalid(r.resolve("jwpub://c/E:1/2:3"), "unsupported link");
}
