//! The reader against real JW Library publications, installed into one shared
//! core. The fixtures are not committed: run `core/scripts/fetch-fixtures.sh`
//! to download them into `core/fixtures/`.

mod common;

use std::sync::OnceLock;

use berean_core::reader::{
    BibleBook, BibleChapter, ChapterBlock, Located, Location, LocationSpan, ParagraphStyle, Reader,
    Resolved, TocEntry, VerseRun,
};
use berean_core::tokens::tokenize;
use berean_core::{CancelToken, Core, CoreError};
use common::{fixture, raw_db, span_of};

const W_E: &str = "w26:0:20260800";
const W_S: &str = "w26:1:20260800";
const LL_E: &str = "ll:0:0";
const TE_E: &str = "te:0:0";
const G_E: &str = "g25:0:20251100";
const MWB_E: &str = "mwb26:0:20260900";
const NWT_E: &str = "nwt:0:0";
const NWT_S: &str = "nwt:1:0";

/// MEPS document ids, the same in every language.
const JOHN_DOC: i64 = 1001061147;
const WIN_THE_BATTLE_DOC: i64 = 2026521;
const W_CONTENTS_DOC: i64 = 2026527;
const W_COVER_DOC: i64 = 2026528;
const W_FIRST_STUDY_DOC: i64 = 2026520;
const G_FIRST_ARTICLE_DOC: i64 = 102025003;
const LL_TITLE_PAGE_DOC: i64 = 1102011094;
const MWB_FIRST_WEEK_DOC: i64 = 202026252;
const MWB_OCTOBER_5_DOC: i64 = 202026256;

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
            (G_E, "g_E_202511.jwpub"),
            (MWB_E, "mwb_E_202609.jwpub"),
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
    let span = span_of(reader().resolve(reference));
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
            span_of(r.resolve(s)),
            span(john(3, 16), john(3, 18)),
            "{s:?}"
        );
    }
    // Across chapters: John 3 ends at verse 36.
    assert_eq!(
        span_of(r.resolve("John 3:36-4:2")),
        span(john(3, 36), john(4, 2))
    );
    assert_eq!(
        span_of(r.resolve("Juan 3:16-18")),
        span(
            verse_location(NWT_S, 43, 3, Some(16)),
            verse_location(NWT_S, 43, 3, Some(18))
        )
    );
    assert_eq!(
        span_of(r.resolve("Salmos 23:1-6")),
        span(
            verse_location(NWT_S, 19, 23, Some(1)),
            verse_location(NWT_S, 19, 23, Some(6))
        )
    );
    // A chapter alone: start and end are the chapter, without a verse.
    assert_eq!(
        span_of(r.resolve("Psalm 23")),
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
    assert_invalid(
        r.resolve("John 3-4:2"),
        "a chapter range cannot end at a verse",
    );
}

#[test]
fn resolve_single_chapter_books() {
    let r = reader();
    // A lone number is a verse in a book of one chapter.
    for (name, book) in [
        ("Obadiah", 31),
        ("Philemon", 57),
        ("2 John", 63),
        ("3 John", 64),
        ("Jude", 65),
    ] {
        let verse = |v| verse_location(NWT_E, book, 1, Some(v));
        assert_eq!(resolve_one(&format!("{name} 3")), verse(3), "{name}");
        assert_eq!(resolve_one(&format!("{name} 1")), verse(1), "{name}");
        assert_eq!(resolve_one(&format!("{name} 1:3")), verse(3), "{name}");
        assert_eq!(
            span_of(r.resolve(&format!("{name} 3-5"))),
            span(verse(3), verse(5)),
            "{name}"
        );
        assert_not_found(r.resolve(&format!("{name} 30")));
    }
    let jude = |v| verse_location(NWT_E, 65, 1, Some(v));
    assert_eq!(span_of(r.resolve("Jude 3")), point(jude(3)));
    assert_eq!(span_of(r.resolve("Jude 3–5")), span(jude(3), jude(5)));
    // Jude has 25 verses.
    assert_eq!(span_of(r.resolve("Jude 24-25")), span(jude(24), jude(25)));
    assert_not_found(r.resolve("Jude 25-26"));
    assert_invalid(r.resolve("Jude 5-3"), "range ends before it starts");
    for (name, book) in [
        ("Abdías", 31),
        ("Filemón", 57),
        ("2 Juan", 63),
        ("3 Juan", 64),
        ("Judas", 65),
    ] {
        assert_eq!(
            resolve_one(&format!("{name} 3")),
            verse_location(NWT_S, book, 1, Some(3)),
            "{name}"
        );
    }
    assert_eq!(
        span_of(r.resolve("Judas 3-5")),
        span(
            verse_location(NWT_S, 65, 1, Some(3)),
            verse_location(NWT_S, 65, 1, Some(5))
        )
    );
    assert_not_found(r.resolve("Judas 30"));
}

#[test]
fn resolve_chapter_ranges() {
    let r = reader();
    // From the first verse of the first chapter through the last verse of
    // the last, as the Bible has them.
    assert_eq!(
        span_of(r.resolve("John 3-4")),
        span(
            verse_location(NWT_E, 43, 3, Some(1)),
            verse_location(NWT_E, 43, 4, Some(54))
        )
    );
    assert_eq!(
        span_of(r.resolve("John 3–4")),
        span_of(r.resolve("John 3-4"))
    );
    assert_eq!(
        span_of(r.resolve("Juan 3-4")),
        span(
            verse_location(NWT_S, 43, 3, Some(1)),
            verse_location(NWT_S, 43, 4, Some(54))
        )
    );
    // Psalms 3 and 4 open with a superscription, verse 0.
    assert_eq!(
        span_of(r.resolve("Psalm 3-4")),
        span(
            verse_location(NWT_E, 19, 3, Some(0)),
            verse_location(NWT_E, 19, 4, Some(8))
        )
    );
    assert_eq!(
        span_of(r.resolve("John 20-21")),
        span(
            verse_location(NWT_E, 43, 20, Some(1)),
            verse_location(NWT_E, 43, 21, Some(25))
        )
    );
    // A range of one chapter is the chapter.
    assert_eq!(
        span_of(r.resolve("John 3-3")),
        point(verse_location(NWT_E, 43, 3, None))
    );
    assert_invalid(r.resolve("John 4-3"), "range ends before it starts");
    for s in ["John 21-22", "John 0-1", "John 22-23"] {
        assert_not_found(r.resolve(s));
    }
    assert_invalid(
        r.resolve("John 3-4:2"),
        "a chapter range cannot end at a verse",
    );
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
        assert_eq!(span_of(r.resolve(link)), span(start, end), "{link}");
    }
    // A psalm from its superscription.
    assert_eq!(
        span_of(r.resolve("jwpub://b/NWTR/19:72:0-19:72:20")),
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
    // A span stays within one book.
    for link in [
        "jwpub://b/NWTR/40:28:20-41:1:1",
        "jwpub://b/NWTR/43:21:25-44:1:1",
    ] {
        assert_invalid(r.resolve(link), "a span must stay within one book");
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
        span_of(r.resolve(&format!("jwpub://p/E:{WIN_THE_BATTLE_DOC}/2-3"))),
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

#[test]
fn resolve_external_links() {
    let r = reader();
    for url in [
        "http://example.com/x",
        "https://www.jw.org/en/",
        "mailto:someone@example.com",
        "HTTPS://WWW.JW.ORG/",
        "Mailto:someone@example.com",
    ] {
        assert_eq!(
            r.resolve(&format!("  {url} ")).unwrap(),
            Resolved::External {
                url: url.to_string()
            },
            "{url:?}"
        );
    }
    for s in [
        "javascript:alert(1)",
        "ftp://example.com/x",
        "data:text/plain,hi",
        "file:///etc/passwd",
        "http://",
        "HTTPS://",
        "mailto:",
        "http:example.com",
        "www.jw.org",
    ] {
        assert!(matches!(r.resolve(s), Err(CoreError::Invalid(_))), "{s:?}");
    }
}

fn bible_book(pub_key: &str, book: u32) -> BibleBook {
    reader()
        .bible_books(pub_key)
        .unwrap()
        .into_iter()
        .find(|b| b.book == book)
        .unwrap()
}

#[test]
fn bible_books_lists_every_book_in_order() {
    let books = reader().bible_books(NWT_E).unwrap();
    assert_eq!(
        books.iter().map(|b| b.book).collect::<Vec<_>>(),
        (1..=66).collect::<Vec<_>>()
    );
    assert_eq!(books.iter().map(|b| b.chapter_count).sum::<u32>(), 1189);
    assert_eq!(bible_book(NWT_E, 1).chapter_count, 50);
    assert_eq!(bible_book(NWT_E, 31).chapter_count, 1);
}

#[test]
fn bible_books_names_and_titles() {
    assert_eq!(
        bible_book(NWT_E, 43),
        BibleBook {
            book: 43,
            name: "John".into(),
            long_title: "The Good News According to John".into(),
            chapter_name: None,
            chapter_count: 21,
        }
    );
    assert_eq!(
        bible_book(NWT_E, 19),
        BibleBook {
            book: 19,
            name: "Psalms".into(),
            long_title: "The Book of Psalms".into(),
            chapter_name: Some("Psalm".into()),
            chapter_count: 150,
        }
    );
    let first_john = bible_book(NWT_S, 62);
    assert_eq!(first_john.name, "1 Juan");
    assert_eq!(first_john.long_title, "Primera Carta de Juan");
    assert_eq!(first_john.chapter_name, None);
    assert_eq!(
        bible_book(NWT_S, 19).chapter_name.as_deref(),
        Some("Salmos")
    );
}

#[test]
fn bible_books_of_a_missing_or_non_bible_are_not_found() {
    let r = reader();
    assert_not_found(r.bible_books("nwt:2:0"));
    assert_not_found(r.bible_books(W_E));
    assert_invalid(r.bible_books("nwt"), "malformed publication key");
}

fn heading(text: &str) -> ChapterBlock {
    ChapterBlock::Heading { text: text.into() }
}

/// A run as the reader reads it; `first_token` counts its verse's tokens in
/// the parts before it.
fn run(
    verse: u32,
    label: Option<&str>,
    text: &str,
    cross_refs: &[&str],
    first_token: u32,
) -> VerseRun {
    VerseRun {
        verse,
        label: label.map(Into::into),
        text: text.into(),
        footnotes: Vec::new(),
        cross_refs: cross_refs.iter().map(|&m| m.into()).collect(),
        first_token,
        tokens: tokenize(text),
    }
}

/// Each paragraph's style and runs, in order.
fn paragraphs(ch: &BibleChapter) -> Vec<(&ParagraphStyle, &[VerseRun])> {
    ch.blocks
        .iter()
        .filter_map(|b| match b {
            ChapterBlock::Paragraph { style, runs, .. } => Some((style, runs.as_slice())),
            ChapterBlock::Heading { .. } => None,
        })
        .collect()
}

/// The runs of a chapter's verses, in order (not its notes).
fn verse_runs(ch: &BibleChapter) -> Vec<&VerseRun> {
    paragraphs(ch)
        .into_iter()
        .filter(|(style, _)| **style != ParagraphStyle::Note)
        .flat_map(|(_, runs)| runs)
        .collect()
}

/// Every verse run's tokens lie in its text, in order, and a verse's later
/// parts count on from the parts before them.
#[test]
fn verse_runs_number_their_word_tokens() {
    let r = reader();
    for (book, chapter) in [(19, 23), (43, 3), (19, 119), (66, 22)] {
        let ch = r.bible_chapter(NWT_E, book, chapter).unwrap();
        let mut counted = std::collections::HashMap::new();
        for run in verse_runs(&ch) {
            let before: &mut u32 = counted.entry(run.verse).or_default();
            assert_eq!(run.first_token, *before, "{book}:{chapter} {run:?}");
            *before += run.tokens.len() as u32;
            let units = run.text.encode_utf16().count() as u32;
            let mut end = 0;
            for t in &run.tokens {
                assert!(
                    t.start >= end && t.start < t.end && t.end <= units,
                    "{run:?}"
                );
                end = t.end;
            }
            assert_eq!(run.tokens, tokenize(&run.text));
        }
        for (style, runs) in paragraphs(&ch) {
            if *style == ParagraphStyle::Note {
                assert!(runs.iter().all(|r| r.tokens.is_empty()));
            }
        }
    }
    // John 3:16 opens Jesus' words: “For God loved the world. The opening
    // quote mark is token 0, so "world" is token 5.
    let ch = r.bible_chapter(NWT_E, 43, 3).unwrap();
    let v16 = verse_runs(&ch).into_iter().find(|r| r.verse == 16).unwrap();
    let units: Vec<u16> = v16.text.encode_utf16().collect();
    let word = |i: usize| {
        let t = v16.tokens[i];
        String::from_utf16(&units[t.start as usize..t.end as usize]).unwrap()
    };
    assert_eq!([word(0), word(1), word(5)], ["“", "For", "world"]);
}

#[test]
fn john_3_blocks() {
    let ch = reader().bible_chapter(NWT_E, 43, 3).unwrap();
    assert!(matches!(
        ch.blocks[0],
        ChapterBlock::Paragraph {
            style: ParagraphStyle::Prose,
            ..
        }
    ));
    let runs = verse_runs(&ch);
    let first = |verse| *runs.iter().find(|r| r.verse == verse).unwrap();
    assert_eq!(first(1).label.as_deref(), Some("3"));
    assert_eq!(first(2).label.as_deref(), Some("2"));
    assert_eq!(
        first(3),
        &VerseRun {
            verse: 3,
            label: Some("3".into()),
            text: "In response Jesus said to him: “Most truly I say to you, unless anyone is \
                   born again, he cannot see the Kingdom of God.”"
                .into(),
            footnotes: vec!["a".into()],
            cross_refs: vec!["f".into(), "g".into()],
            first_token: 0,
            tokens: tokenize(
                "In response Jesus said to him: “Most truly I say to you, unless anyone is \
                 born again, he cannot see the Kingdom of God.”"
            ),
        }
    );
    for r in &runs {
        assert!(!r.text.contains('<'), "{r:?}");
        // No marker letter is left glued to punctuation (`again,a`).
        for marker in r.footnotes.iter().chain(&r.cross_refs) {
            for p in [",", ".", ";", ":", "!", "?", "”", "’"] {
                let glued = format!("{p}{marker}");
                assert!(
                    !r.text.contains(&format!("{glued} ")) && !r.text.ends_with(&glued),
                    "{r:?}"
                );
            }
        }
    }
}

#[test]
fn psalm_23_blocks() {
    let ch = reader().bible_chapter(NWT_E, 19, 23).unwrap();
    assert_eq!(
        paragraphs(&ch)[..3],
        [
            (
                &ParagraphStyle::Superscription,
                &[run(0, None, "A melody of David.", &[], 0)][..]
            ),
            (
                &ParagraphStyle::PoetryLine,
                &[run(1, Some("23"), "Jehovah is my Shepherd.", &["a"], 0)][..]
            ),
            (
                &ParagraphStyle::PoetryContinuation,
                &[run(1, None, "I will lack nothing.", &["b"], 5)][..]
            ),
        ]
    );
}

#[test]
fn chapter_headings() {
    let blocks = |book, chapter| reader().bible_chapter(NWT_E, book, chapter).unwrap().blocks;
    let psalm_119 = blocks(19, 119);
    let aleph = psalm_119
        .iter()
        .position(|b| *b == heading("א [Aleph]"))
        .unwrap();
    let verse_1 = psalm_119
        .iter()
        .position(|b| match b {
            ChapterBlock::Paragraph { runs, .. } => runs.iter().any(|r| r.verse == 1),
            ChapterBlock::Heading { .. } => false,
        })
        .unwrap();
    assert!(aleph < verse_1);
    assert_eq!(blocks(1, 1)[0], heading("GENESIS"));
    assert_eq!(
        blocks(19, 1)[..3],
        [
            heading("PSALMS"),
            heading("BOOK ONE"),
            heading("(Psalms 1-41)")
        ]
    );
    // The heading's footnote marker is dropped.
    assert!(blocks(25, 1).contains(&heading("א [Aleph]")));
}

/// The text of a chapter's last block, which must be a note.
#[track_caller]
fn last_note(book: u32, chapter: u32) -> String {
    let ch = reader().bible_chapter(NWT_E, book, chapter).unwrap();
    match ch.blocks.last().unwrap() {
        ChapterBlock::Paragraph {
            style: ParagraphStyle::Note,
            runs,
            ..
        } => {
            assert_eq!(runs.len(), 1);
            assert_eq!((runs[0].verse, &runs[0].label), (0, &None));
            runs[0].text.clone()
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn notes_after_the_verses() {
    assert_eq!(
        last_note(35, 3),
        "To the director; with my stringed instruments."
    );
    assert!(
        last_note(39, 4).starts_with("(End of the translation of the Hebrew-Aramaic Scriptures")
    );
}

#[test]
fn split_verse_has_a_run_in_each_paragraph() {
    // John 1:3 is split across two paragraphs.
    let ch = reader().bible_chapter(NWT_E, 43, 1).unwrap();
    let with_verse_3 = paragraphs(&ch)
        .into_iter()
        .filter(|(_, runs)| runs.iter().any(|r| r.verse == 3))
        .count();
    assert_eq!(with_verse_3, 2);
}

/// In every chapter of both Bibles, each verse's text is exactly its runs
/// joined with a single space.
#[test]
fn blocks_hold_every_verse() {
    for bible in [NWT_E, NWT_S] {
        for book in reader().bible_books(bible).unwrap() {
            for chapter in 1..=book.chapter_count {
                let at = format!("{bible} {}:{chapter}", book.book);
                let ch = reader()
                    .bible_chapter(bible, book.book, chapter)
                    .unwrap_or_else(|e| panic!("{at}: {e:?}"));
                let runs = verse_runs(&ch);
                for v in &ch.verses {
                    let texts: Vec<&str> = runs
                        .iter()
                        .filter(|r| r.verse == v.verse)
                        .map(|r| r.text.as_str())
                        .collect();
                    assert!(!texts.is_empty(), "{at}:{} has no run", v.verse);
                    assert_eq!(texts.join(" "), v.text, "{at}:{}", v.verse);
                }
                for r in &runs {
                    assert!(ch.verses.iter().any(|v| v.verse == r.verse), "{at}: {r:?}");
                }
            }
        }
    }
}

fn located(location: Location, exact: bool) -> Located {
    Located { location, exact }
}

fn locate(location: &Location) -> Located {
    locate_on(location, None)
}

fn locate_on(location: &Location, today: Option<i32>) -> Located {
    reader()
        .locate(location, today)
        .unwrap_or_else(|e| panic!("{location:?} on {today:?}: {e:?}"))
}

fn publication(pub_key: &str) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: None,
        book: None,
        chapter: None,
        verse: None,
        paragraph: None,
    }
}

#[test]
fn locate_a_paragraph_or_document_that_exists() {
    for at in [
        document_location(W_E, WIN_THE_BATTLE_DOC, Some(7)),
        document_location(W_E, WIN_THE_BATTLE_DOC, None),
    ] {
        assert_eq!(locate(&at), located(at, true));
    }
}

#[test]
fn locate_a_missing_paragraph_falls_back_to_the_largest_earlier_one() {
    let at = |paragraph| document_location(W_E, WIN_THE_BATTLE_DOC, Some(paragraph));
    // 75 is the document's largest positioned pid.
    assert_eq!(locate(&at(999)), located(at(75), false));
    // 35 has no position (it is not in the HTML).
    let doc = reader().document(W_E, WIN_THE_BATTLE_DOC).unwrap();
    let unpositioned = doc.paragraphs.iter().find(|p| p.paragraph == 35).unwrap();
    assert_eq!(unpositioned.begin, None);
    assert_eq!(locate(&at(35)), located(at(34), false));
}

#[test]
fn locate_a_paragraph_before_any_falls_back_to_the_first_in_reading_order() {
    let doc = reader().document(W_E, WIN_THE_BATTLE_DOC).unwrap();
    let first = doc
        .paragraphs
        .iter()
        .filter(|p| p.begin.is_some())
        .min_by_key(|p| p.begin)
        .unwrap()
        .paragraph;
    assert_eq!(first, 1);
    let at = |paragraph| document_location(W_E, WIN_THE_BATTLE_DOC, Some(paragraph));
    assert_eq!(locate(&at(0)), located(at(first), false));
}

#[test]
fn locate_a_missing_document_falls_back_to_the_starting_document() {
    let start = document_location(W_E, W_FIRST_STUDY_DOC, None);
    for paragraph in [None, Some(7)] {
        assert_eq!(
            locate(&document_location(W_E, 1, paragraph)),
            located(start.clone(), false)
        );
    }
}

#[test]
fn locate_a_publication_opens_its_starting_document() {
    // A study edition opens at its first study article, not at the cover
    // that comes first in its table of contents.
    assert_eq!(
        reader().toc(W_E).unwrap().iter().find_map(|e| e.doc_id),
        Some(W_COVER_DOC)
    );
    assert_eq!(
        locate(&publication(W_E)),
        located(document_location(W_E, W_FIRST_STUDY_DOC, None), true)
    );
    // Another issue opens at the first article after its cover,
    // introduction and contents.
    assert_eq!(
        locate(&publication(G_E)),
        located(document_location(G_E, G_FIRST_ARTICLE_DOC, None), true)
    );
    // A non-periodical opens at its first table-of-contents document.
    for pub_key in [LL_E, TE_E] {
        let first = reader()
            .toc(pub_key)
            .unwrap()
            .into_iter()
            .find_map(|e| e.doc_id);
        assert_eq!(
            locate(&publication(pub_key)),
            located(document_location(pub_key, first.unwrap(), None), true),
            "{pub_key}"
        );
    }
}

#[test]
fn locate_a_bible_verse_chapter_or_book_that_exists() {
    let john = verse_location(NWT_E, 43, 3, Some(16));
    let chapter = verse_location(NWT_E, 43, 3, None);
    let book = Location {
        chapter: None,
        ..chapter.clone()
    };
    for at in [john, chapter, book] {
        assert_eq!(locate(&at), located(at, true));
    }
}

#[test]
fn locate_a_missing_verse_falls_back_to_the_largest_earlier_one() {
    // John 3 has 36 verses.
    assert_eq!(
        locate(&verse_location(NWT_E, 43, 3, Some(99))),
        located(verse_location(NWT_E, 43, 3, Some(36)), false)
    );
    // Nothing comes before verse 0 but the chapter's first verse.
    assert_eq!(
        locate(&verse_location(NWT_E, 43, 3, Some(0))),
        located(verse_location(NWT_E, 43, 3, Some(1)), false)
    );
}

#[test]
fn locate_a_missing_chapter_falls_back_to_the_books_first() {
    for verse in [None, Some(16)] {
        assert_eq!(
            locate(&verse_location(NWT_E, 43, 99, verse)),
            located(verse_location(NWT_E, 43, 1, None), false)
        );
    }
}

/// Both Bible fixtures are complete, so a book number past Revelation
/// stands in for a book a partial Bible lacks.
#[test]
fn locate_a_missing_book_falls_back_to_the_publication() {
    let at = Location {
        pub_key: NWT_E.into(),
        doc_id: None,
        book: Some(67),
        chapter: Some(1),
        verse: Some(1),
        paragraph: None,
    };
    assert_eq!(locate(&at), located(publication(NWT_E), false));
    // A Bible location in a publication that is not a Bible.
    let at = Location {
        pub_key: W_E.into(),
        ..at
    };
    assert_eq!(locate(&at), located(publication(W_E), false));
}

#[test]
fn locate_rejects_malformed_locations_and_missing_publications() {
    assert_invalid(
        reader().locate(&document_location("w26", WIN_THE_BATTLE_DOC, Some(7)), None),
        "",
    );
    let paragraph_alone = Location {
        paragraph: Some(7),
        ..publication(W_E)
    };
    assert_invalid(
        reader().locate(&paragraph_alone, None),
        "a paragraph needs a document",
    );
    let book_0 = Location {
        book: Some(0),
        ..verse_location(NWT_E, 43, 1, Some(1))
    };
    assert_invalid(reader().locate(&book_0, None), "start at 1");
    assert_not_found(reader().locate(&document_location("it:0:0", 1200000005, None), None));
    assert_not_found(reader().locate(&publication("it:0:0"), None));
    // A date that is not a real day, even where the date is not used.
    for (pub_key, today) in [
        (MWB_E, 20261032),
        (MWB_E, 20260229),
        (MWB_E, 20261300),
        (MWB_E, 0),
        (MWB_E, -20261007),
        (W_E, 20261000),
        (LL_E, 2026107),
    ] {
        assert_invalid(
            reader().locate(&publication(pub_key), Some(today)),
            "not a YYYYMMDD day",
        );
    }
}

#[test]
fn locate_mwb_on_date_opens_that_week() {
    let week = |doc| located(document_location(MWB_E, doc, None), true);
    // Mid-week and both ends of the October 5-11 week.
    for today in [20261005, 20261007, 20261011] {
        assert_eq!(
            locate_on(&publication(MWB_E), Some(today)),
            week(MWB_OCTOBER_5_DOC),
            "{today}"
        );
    }
    // The first day of the first week, days before and after the issue, and
    // no date: the first week.
    for today in [Some(20260907), Some(20260101), Some(20261201), None] {
        assert_eq!(
            locate_on(&publication(MWB_E), today),
            week(MWB_FIRST_WEEK_DOC),
            "{today:?}"
        );
    }
    // A missing document falls back to the publication start (first week);
    // `today` applies only when opening the workbook alone.
    assert_eq!(
        locate_on(&document_location(MWB_E, 1, None), Some(20261007)),
        located(document_location(MWB_E, MWB_FIRST_WEEK_DOC, None), false)
    );
}

#[test]
fn locate_ignores_the_date_outside_meeting_workbooks() {
    let today = Some(20261007);
    // The Watchtower has DatedText rows too, but they point at its
    // contents, not at its study articles.
    assert_eq!(
        locate_on(&publication(W_E), today),
        located(document_location(W_E, W_FIRST_STUDY_DOC, None), true)
    );
    assert_eq!(
        locate_on(&publication(G_E), today),
        located(document_location(G_E, G_FIRST_ARTICLE_DOC, None), true)
    );
    for pub_key in [LL_E, TE_E] {
        assert_eq!(
            locate_on(&publication(pub_key), today),
            locate(&publication(pub_key)),
            "{pub_key}"
        );
    }
    // A saved document is as saved, workbook or not.
    let at = document_location(MWB_E, MWB_FIRST_WEEK_DOC, None);
    assert_eq!(locate_on(&at, today), located(at, true));
}
