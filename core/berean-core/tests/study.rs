//! Research Guide study references and verse study (footnotes, cross
//! references, Study Edition notes) against real JW Library publications.
//! The fixtures are not committed: run `core/scripts/fetch-fixtures.sh` to
//! download them into `core/fixtures/`.

mod common;
#[path = "common/trimmed_catalog.rs"]
mod trimmed_catalog;

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use berean_core::reader::{
    BibleChapter, ChapterBlock, CrossRef, Footnote, Location, LocationSpan, ParagraphStyle,
    StudyAvailability, StudyNote, StudyReferences, VerseStudy, VerseStudyCounts,
};
use berean_core::{CancelToken, Core, CoreError};
use common::{fixture, raw_db, span_of};

const NWT_E: &str = "nwt:0:0";
const NWT_S: &str = "nwt:1:0";
const NWTSTY_E: &str = "nwtsty:0:0";
const RSG_E: &str = "rsg:0:0";
const W_E: &str = "w26:0:20260800";
const IT_E: &str = "it:0:0";

/// In the pinned `nwtsty_E.jwpub`: its study notes (16 of them without a
/// lemma) in its 3783 `VerseCommentary` entries. In the pinned
/// `nwt_E.jwpub`: the `Footnote` rows on a verse, and the `BibleCitation`
/// rows (marginal-reference targets) of a verse.
const STUDY_NOTES: u32 = 6262;
const VERSE_FOOTNOTES: u32 = 9237;
const CROSS_REF_TARGETS: u32 = 63474;

/// The commentary rows, references and `$`-separated multi-target links in
/// the pinned `rsg_E.jwpub`.
const ENTRIES: usize = 14899;
const REFERENCES: usize = 44546;
const MULTI_TARGET: usize = 3037;
/// The distinct Insight documents the guide's verse references target, and
/// how many references target Insight. The guide's `Extract`s quote 2424
/// Insight documents in all: the other 182 are quoted only by its own
/// documents, not by a verse entry.
const INSIGHT_DOCS: usize = 2242;
const INSIGHT_REFERENCES: usize = 12404;
const INSIGHT_EXTRACT_DOCS: usize = 2424;

fn new_core(name: &str, fixtures: &[(&str, &str)]) -> Core {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    let core = Core::open(dir.join("data"), dir.join("cache")).unwrap();
    for (key, file) in fixtures {
        core.library()
            .install(key, fixture(file), &|_, _| {}, &CancelToken::new())
            .unwrap_or_else(|e| panic!("install {file}: {e:?}"));
    }
    core
}

/// English and Spanish Bibles, the English Study Edition and guide, a
/// Watchtower, Insight and the (trimmed) catalog; shared by most tests.
fn core() -> &'static Core {
    static CORE: OnceLock<Core> = OnceLock::new();
    CORE.get_or_init(|| {
        let core = new_core(
            "study",
            &[
                (NWT_E, "nwt_E.jwpub"),
                (NWT_S, "nwt_S.jwpub"),
                (NWTSTY_E, "nwtsty_E.jwpub"),
                (RSG_E, "rsg_E.jwpub"),
                (W_E, "w_E_202608.jwpub"),
                (IT_E, "it_E.jwpub"),
            ],
        );
        core.catalog()
            .ingest_file(trimmed_catalog::trimmed(), &|_, _| {}, &CancelToken::new())
            .unwrap();
        core
    })
}

fn verse(pub_key: &str, book: u32, chapter: u32, verse: u32) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: None,
        book: Some(book),
        chapter: Some(chapter),
        verse: Some(verse),
        paragraph: None,
    }
}

fn document(pub_key: &str, doc_id: i64, paragraph: Option<u32>) -> Location {
    Location {
        pub_key: pub_key.into(),
        doc_id: Some(doc_id),
        book: None,
        chapter: None,
        verse: None,
        paragraph,
    }
}

fn study(location: &Location) -> Result<StudyReferences, CoreError> {
    core().reader().study_references(location)
}

#[test]
fn john_3_16() {
    let location = span_of(core().reader().resolve("John 3:16")).start;
    let refs = study(&location).unwrap();
    assert_eq!(refs.availability, StudyAvailability::Installed);
    assert_eq!(refs.items.len(), 32);

    let first = &refs.items[0];
    assert_eq!(first.label, "What Jehovah Has Done to Rescue Sinful Humans");
    assert!(
        first
            .html
            .starts_with(r#"<div id="tt468" class="du-margin-children-bottom--0">"#),
        "{}",
        first.html
    );
    assert!(first.html.contains("<em>w24.08 pp. 2-6</em>"));
    assert!(first.html.ends_with("</div>"));
    assert_eq!(first.source, "w24.08 pp. 2-6");
    assert_eq!(
        first.target,
        Some(document("w24:0:20240800", 2024530, Some(1)))
    );

    // Linked to `p/E:1102002048/6-12$p/E:1102002048/16-16`: the first target.
    let second = &refs.items[1];
    assert_eq!(second.label, "“He First Loved Us”");
    assert!(second.html.contains('$'));
    assert!(second.html.contains("<em>cl chap. 23</em>"));
    assert_eq!(second.source, "cl chap. 23");
    assert_eq!(second.target, Some(document("cl:0:0", 1102002048, Some(6))));
}

/// The study references of every verse the guide has an entry for, read
/// once: `(book:chapter:verse, references)`.
fn every_entry() -> &'static [(String, StudyReferences)] {
    static ENTRIES: OnceLock<Vec<(String, StudyReferences)>> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        let (_dir, db) = raw_db("rsg_E.jwpub");
        let mut stmt = db.prepare("SELECT Label FROM VerseCommentary").unwrap();
        let headers: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let reader = core().reader();
        headers
            .iter()
            .map(|header| {
                // `... href="jwpub://b/NWTR/43:3:16-43:3:16" ...`
                let at = header.find("jwpub://b/NWTR/").unwrap() + "jwpub://b/NWTR/".len();
                let (start, _) = header[at..].split_once('-').unwrap();
                let n: Vec<u32> = start.split(':').map(|n| n.parse().unwrap()).collect();
                let refs = reader
                    .study_references(&verse(NWT_E, n[0], n[1], n[2]))
                    .unwrap_or_else(|e| panic!("{start}: {e:?}"));
                (start.to_string(), refs)
            })
            .collect()
    })
}

#[test]
fn every_entry_parses() {
    let entries = every_entry();
    assert_eq!(entries.len(), ENTRIES);
    let (mut references, mut multi_target) = (0, 0);
    for (start, refs) in entries {
        assert_eq!(refs.availability, StudyAvailability::Installed);
        assert!(!refs.items.is_empty(), "{start}");
        for item in &refs.items {
            assert!(!item.label.is_empty(), "{start}");
            assert!(!item.source.is_empty(), "{start}: {}", item.label);
            for text in [&item.label, &item.source] {
                assert!(!text.contains(['<', '>']), "{start}: {text}");
            }
            assert!(item.target.is_some(), "{start}: {}", item.label);
            multi_target += usize::from(item.html.contains('$'));
        }
        references += refs.items.len();
    }
    assert_eq!(references, REFERENCES);
    assert_eq!(multi_target, MULTI_TARGET);
}

#[test]
fn insight_targets_resolve() {
    let mut targets: HashMap<i64, Vec<u32>> = HashMap::new();
    let mut references = 0;
    for (_, refs) in every_entry() {
        for target in refs.items.iter().filter_map(|i| i.target.as_ref()) {
            if target.pub_key == IT_E {
                let paragraph = target.paragraph.expect("a paragraph");
                targets
                    .entry(target.doc_id.unwrap())
                    .or_default()
                    .push(paragraph);
                references += 1;
            }
        }
    }
    assert_eq!(targets.len(), INSIGHT_DOCS);
    assert_eq!(references, INSIGHT_REFERENCES);

    let reader = core().reader();
    // Every Insight document any `Extract` of the guide quotes is there.
    let (_dir, db) = raw_db("rsg_E.jwpub");
    let mut stmt = db
        .prepare(
            "SELECT DISTINCT e.RefMepsDocumentId FROM Extract e \
             JOIN RefPublication p ON p.RefPublicationId = e.RefPublicationId \
             WHERE p.Symbol = 'it'",
        )
        .unwrap();
    let quoted: Vec<i64> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(quoted.len(), INSIGHT_EXTRACT_DOCS);
    assert!(targets.keys().all(|d| quoted.contains(d)));
    for doc_id in &quoted {
        let document = reader
            .document(IT_E, *doc_id)
            .unwrap_or_else(|e| panic!("{doc_id}: {e:?}"));
        for paragraph in targets.get(doc_id).into_iter().flatten() {
            assert!(
                document
                    .paragraphs
                    .iter()
                    .any(|p| p.paragraph == *paragraph),
                "{doc_id}/{paragraph}"
            );
        }
    }
}

#[test]
fn verse_without_an_entry_is_empty() {
    // Genesis 1:10 has no entry; 1:9 and 1:11 do.
    let refs = study(&verse(NWT_E, 1, 1, 10)).unwrap();
    assert_eq!(refs.availability, StudyAvailability::Installed);
    assert!(refs.items.is_empty());
    assert!(!study(&verse(NWT_E, 1, 1, 9)).unwrap().items.is_empty());
}

#[test]
fn guide_not_installed_is_listed_from_the_catalog() {
    let refs = study(&verse(NWT_S, 43, 3, 16)).unwrap();
    assert_eq!(
        refs,
        StudyReferences {
            availability: StudyAvailability::NotInstalled {
                pub_key: "rsg:1:0".into()
            },
            items: Vec::new(),
        }
    );
}

#[test]
fn no_guide_and_no_catalog_is_unavailable() {
    let core = new_core("study-bare", &[(NWT_S, "nwt_S.jwpub")]);
    let refs = core
        .reader()
        .study_references(&verse(NWT_S, 43, 3, 16))
        .unwrap();
    assert_eq!(
        refs,
        StudyReferences {
            availability: StudyAvailability::Unavailable,
            items: vec![],
        }
    );
}

#[test]
fn non_verses_are_invalid() {
    let chapter = Location {
        verse: None,
        ..verse(NWT_E, 43, 3, 16)
    };
    let paragraph = Location {
        paragraph: Some(1),
        ..verse(NWT_E, 43, 3, 16)
    };
    for location in [
        chapter,
        paragraph,
        document(NWT_E, 1001061147, None),
        document(W_E, 2026521, Some(1)),
        // A verse, but not of a Bible.
        verse(W_E, 43, 3, 16),
        verse(RSG_E, 43, 3, 16),
        verse("nwt", 43, 3, 16),
    ] {
        match study(&location) {
            Err(CoreError::Invalid(_)) => {}
            other => panic!("{location:?}: {other:?}"),
        }
    }
}

#[test]
fn unknown_verses_are_not_found() {
    for location in [
        verse(NWT_E, 43, 3, 99),
        verse(NWT_E, 43, 99, 1),
        verse(NWT_E, 67, 1, 1),
        // Not installed.
        verse("nwt:2:0", 43, 3, 16),
    ] {
        match study(&location) {
            Err(CoreError::NotFound) => {}
            other => panic!("{location:?}: {other:?}"),
        }
    }
}

fn verse_study(location: &Location) -> Result<VerseStudy, CoreError> {
    core().reader().verse_study(location)
}

/// The footnote and cross-reference letters of a verse's runs, in order.
fn run_letters(ch: &BibleChapter, verse: u32) -> (Vec<String>, Vec<String>) {
    let (mut footnotes, mut cross_refs) = (Vec::new(), Vec::new());
    for block in &ch.blocks {
        let ChapterBlock::Paragraph { style, runs, .. } = block else {
            continue;
        };
        if *style == ParagraphStyle::Note {
            continue;
        }
        for run in runs.iter().filter(|r| r.verse == verse) {
            footnotes.extend(run.footnotes.iter().cloned());
            cross_refs.extend(run.cross_refs.iter().cloned());
        }
    }
    (footnotes, cross_refs)
}

fn footnote_markers(study: &VerseStudy) -> Vec<String> {
    study.footnotes.iter().map(|f| f.marker.clone()).collect()
}

/// One letter per cross-reference marker: a marker's targets are adjacent
/// and share its letter.
fn cross_ref_markers(study: &VerseStudy) -> Vec<String> {
    let mut letters: Vec<String> = study.cross_refs.iter().map(|c| c.label.clone()).collect();
    letters.dedup();
    letters
}

/// The text `bible_chapter` gives verses `first..=last` of a chapter,
/// separated by spaces.
fn verse_texts(book: u32, chapter: u32, first: u32, last: u32) -> String {
    let ch = core().reader().bible_chapter(NWT_E, book, chapter).unwrap();
    ch.verses
        .iter()
        .filter(|v| (first..=last).contains(&v.verse))
        .map(|v| v.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn john_3_16_study() {
    let reader = core().reader();
    let location = span_of(reader.resolve("John 3:16")).start;
    assert_eq!(location.pub_key, NWT_E);
    let study = verse_study(&location).unwrap();
    assert_eq!(study.availability, StudyAvailability::Installed);

    let lemmas: Vec<&str> = study.study_notes.iter().map(|n| n.label.as_str()).collect();
    assert_eq!(
        lemmas,
        [
            "loved",
            "the world",
            "only-begotten Son",
            "exercising faith in him"
        ]
    );
    assert!(
        study.study_notes[0].text.starts_with(
            "This is the first occurrence of the Greek verb a·ga·paʹo (“to love”) in the \
             Gospel of John."
        ),
        "{}",
        study.study_notes[0].text
    );

    let ch = reader.bible_chapter(NWT_E, 43, 3).unwrap();
    let (footnotes, cross_refs) = run_letters(&ch, 16);
    assert!(footnotes.is_empty());
    assert_eq!(footnote_markers(&study), footnotes);
    assert_eq!(cross_refs, ["p", "q"]);
    assert_eq!(cross_ref_markers(&study), cross_refs);
    let labels: Vec<&str> = study.cross_refs.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["p", "p", "p", "p", "q", "q", "q", "q", "q"]);

    // Marker p's targets, then q's, in `ElementNumber` order.
    let targets: Vec<&LocationSpan> = study.cross_refs.iter().map(|c| &c.target).collect();
    let span = |citation: &str| span_of(reader.resolve(citation));
    assert_eq!(
        targets,
        [
            &span("Romans 5:8"),
            &span("Romans 8:32"),
            &span("1 John 4:9-10"),
            &span("1 John 4:19"),
            &span("John 6:40"),
            &span("John 20:31"),
            &span("Romans 6:23"),
            &span("2 Timothy 3:15"),
            &span("1 John 5:13"),
        ]
    );
    assert_eq!(
        study.cross_refs[0].snippet.as_deref(),
        Some(
            "But God recommends his own love to us in that, while we were yet sinners, Christ \
             died for us."
        )
    );
    // A range's snippet is its verses' text.
    assert_eq!(study.cross_refs[2].snippet, Some(verse_texts(62, 4, 9, 10)));
    assert!(study.cross_refs.iter().all(|c| c.snippet.is_some()));
}

#[test]
fn john_3_3_footnote() {
    let study = verse_study(&verse(NWT_E, 43, 3, 3)).unwrap();
    assert_eq!(
        study.footnotes,
        [Footnote {
            marker: "a".into(),
            text: "Or possibly, “born from above.”".into(),
        }]
    );
    let ch = core().reader().bible_chapter(NWT_E, 43, 3).unwrap();
    assert_eq!(
        run_letters(&ch, 3),
        (vec!["a".into()], vec!["f".into(), "g".into()])
    );
    assert_eq!(cross_ref_markers(&study), ["f", "g"]);
    assert_eq!(
        study
            .study_notes
            .iter()
            .map(|n| &n.label[..])
            .collect::<Vec<_>>(),
        ["born again", "the Kingdom of God"]
    );
}

#[test]
fn reading_the_study_edition_itself() {
    // Its own markers (John 3:16 has t and u there), and its own notes.
    let study = verse_study(&verse(NWTSTY_E, 43, 3, 16)).unwrap();
    assert_eq!(study.availability, StudyAvailability::Installed);
    assert_eq!(
        study.study_notes,
        verse_study(&verse(NWT_E, 43, 3, 16)).unwrap().study_notes
    );
    assert_eq!(cross_ref_markers(&study), ["t", "u"]);
    assert!(study
        .cross_refs
        .iter()
        .all(|c| c.target.start.pub_key == NWTSTY_E));
}

fn notes(book: u32, chapter: u32, v: u32) -> Vec<StudyNote> {
    verse_study(&verse(NWT_E, book, chapter, v))
        .unwrap()
        .study_notes
}

fn lemmas(notes: &[StudyNote]) -> Vec<&str> {
    notes.iter().map(|n| n.label.as_str()).collect()
}

#[test]
fn notes_of_several_paragraphs() {
    // Mark 16:8's one note runs on over the long and short conclusions,
    // whose quoted verses open with bold verse numbers (not lemmas).
    let notes = notes(41, 16, 8);
    assert_eq!(lemmas(&notes), ["for they were in fear"]);
    let text = &notes[0].text;
    assert!(
        text.contains("\nThere are a number of Greek manuscripts"),
        "{text}"
    );
    assert!(text.contains("\nSHORT CONCLUSION\n"), "{text}");
    assert!(text.contains("\nLONG CONCLUSION\n"), "{text}");
    assert!(text.contains("\n19 So, then, the Lord Jesus"), "{text}");
}

#[test]
fn split_lemmas_headings_and_notes_without_a_lemma() {
    // A lemma in two bold runs.
    assert_eq!(
        lemmas(&notes(41, 1, 5))[0],
        "all the territory .\u{a0}.\u{a0}. all the inhabitants"
    );
    // John 7:52's entry also holds the note on 7:53-8:11, under a heading.
    let john_7_52 = notes(43, 7, 52);
    let heading = john_7_52.last().unwrap();
    assert_eq!(heading.label, "7:53");
    assert!(
        heading
            .text
            .starts_with("The earliest authoritative manuscripts do not have the passage"),
        "{heading:?}"
    );
    // Matthew 17:21 is omitted; its note on the manuscripts has no lemma.
    let matthew_17_21 = notes(40, 17, 21);
    assert_eq!(lemmas(&matthew_17_21), [""]);
    assert!(matthew_17_21[0]
        .text
        .starts_with("Some ancient manuscripts here read:"));
}

/// A core with the English Bible and the catalog, but no Study Edition.
fn core_without_study_edition() -> &'static Core {
    static CORE: OnceLock<Core> = OnceLock::new();
    CORE.get_or_init(|| {
        let core = new_core("study-no-nwtsty", &[(NWT_E, "nwt_E.jwpub")]);
        core.catalog()
            .ingest_file(trimmed_catalog::trimmed(), &|_, _| {}, &CancelToken::new())
            .unwrap();
        core
    })
}

#[test]
fn study_edition_not_installed_is_listed_from_the_catalog() {
    let location = verse(NWT_E, 43, 3, 16);
    let study = core_without_study_edition()
        .reader()
        .verse_study(&location)
        .unwrap();
    let full = verse_study(&location).unwrap();
    assert_eq!(
        study,
        VerseStudy {
            study_notes: Vec::new(),
            availability: StudyAvailability::NotInstalled {
                pub_key: NWTSTY_E.into()
            },
            ..full
        }
    );
    assert_eq!(study.cross_refs.len(), 9);

    // The margin markers count no notes; the rest is unchanged.
    let without = core_without_study_edition()
        .reader()
        .chapter_study_markers(NWT_E, 43, 3)
        .unwrap();
    let with = core().reader().chapter_study_markers(NWT_E, 43, 3).unwrap();
    let no_notes: Vec<VerseStudyCounts> = with
        .into_iter()
        .map(|c| VerseStudyCounts {
            study_notes: 0,
            ..c
        })
        .filter(|c| c.cross_refs + c.footnotes > 0)
        .collect();
    assert_eq!(without, no_notes);
}

#[test]
fn no_study_edition_and_no_catalog_is_unavailable() {
    let core = new_core("study-bare-nwt-e", &[(NWT_E, "nwt_E.jwpub")]);
    let location = verse(NWT_E, 43, 3, 3);
    let study = core.reader().verse_study(&location).unwrap();
    let full = verse_study(&location).unwrap();
    assert_eq!(study.availability, StudyAvailability::Unavailable);
    assert!(study.study_notes.is_empty());
    assert!(!study.footnotes.is_empty());
    assert!(!study.cross_refs.is_empty());
    assert_eq!(study.footnotes, full.footnotes);
    assert_eq!(study.cross_refs, full.cross_refs);
    // The margin markers do not need the catalog.
    let counts = core.reader().chapter_study_markers(NWT_E, 43, 3).unwrap();
    assert!(!counts.is_empty());
    assert!(counts.iter().all(|c| c.study_notes == 0));
}

#[test]
fn verse_without_study_content_is_empty() {
    // John 3:4 has no footnote, cross reference or study note.
    let study = verse_study(&verse(NWT_E, 43, 3, 4)).unwrap();
    assert_eq!(
        study,
        VerseStudy {
            study_notes: Vec::<StudyNote>::new(),
            cross_refs: Vec::<CrossRef>::new(),
            footnotes: Vec::<Footnote>::new(),
            availability: StudyAvailability::Installed,
        }
    );
    let ch = core().reader().bible_chapter(NWT_E, 43, 3).unwrap();
    assert_eq!(run_letters(&ch, 4), (Vec::new(), Vec::new()));
}

#[test]
fn john_3_markers() {
    let counts = core().reader().chapter_study_markers(NWT_E, 43, 3).unwrap();
    assert_eq!(
        counts[..3],
        [
            VerseStudyCounts {
                verse: 1,
                study_notes: 1,
                cross_refs: 2,
                footnotes: 0
            },
            VerseStudyCounts {
                verse: 2,
                study_notes: 0,
                cross_refs: 6,
                footnotes: 0
            },
            VerseStudyCounts {
                verse: 3,
                study_notes: 2,
                cross_refs: 5,
                footnotes: 1
            },
        ]
    );
    let v16 = counts.iter().find(|c| c.verse == 16).unwrap();
    assert_eq!((v16.study_notes, v16.cross_refs, v16.footnotes), (4, 9, 0));
    assert!(!counts.iter().any(|c| c.verse == 4));
}

/// For every chapter of John, Psalms and Genesis: the margin markers agree
/// with `verse_study` for every verse, and `verse_study`'s markers with the
/// chapter's runs.
#[test]
fn markers_agree_with_verse_study() {
    let reader = core().reader();
    for book in [43, 19, 1] {
        let chapters = reader
            .bible_books(NWT_E)
            .unwrap()
            .into_iter()
            .find(|b| b.book == book)
            .unwrap()
            .chapter_count;
        for chapter in 1..=chapters {
            let at = format!("{book}:{chapter}");
            let counts = reader
                .chapter_study_markers(NWT_E, book, chapter)
                .unwrap_or_else(|e| panic!("{at}: {e:?}"));
            assert!(
                counts.windows(2).all(|w| w[0].verse < w[1].verse),
                "{at}: {counts:?}"
            );
            let ch = reader.bible_chapter(NWT_E, book, chapter).unwrap();
            for v in &ch.verses {
                let at = format!("{at}:{}", v.verse);
                let study = verse_study(&verse(NWT_E, book, chapter, v.verse))
                    .unwrap_or_else(|e| panic!("{at}: {e:?}"));
                let expected = VerseStudyCounts {
                    verse: v.verse,
                    study_notes: study.study_notes.len() as u32,
                    cross_refs: study.cross_refs.len() as u32,
                    footnotes: study.footnotes.len() as u32,
                };
                let listed = counts.iter().find(|c| c.verse == v.verse);
                if expected.study_notes + expected.cross_refs + expected.footnotes == 0 {
                    assert_eq!(listed, None, "{at}");
                } else {
                    assert_eq!(listed, Some(&expected), "{at}");
                }
                let (footnotes, cross_refs) = run_letters(&ch, v.verse);
                assert_eq!(footnote_markers(&study), footnotes, "{at}");
                assert_eq!(cross_ref_markers(&study), cross_refs, "{at}");
                for c in &study.cross_refs {
                    assert!(c.snippet.is_some(), "{at}: {c:?}");
                    assert_eq!(c.target.start.pub_key, NWT_E, "{at}");
                    assert_eq!(c.target.start.book, c.target.end.book, "{at}");
                }
                assert!(study.footnotes.iter().all(|f| !f.text.is_empty()), "{at}");
            }
            assert!(counts
                .iter()
                .all(|c| ch.verses.iter().any(|v| v.verse == c.verse)));
        }
    }
}

/// Over every chapter of the Bible, the margin markers reach every footnote
/// on a verse and every marginal-reference target in the Bible's tables,
/// and every study note of the Study Edition.
#[test]
fn every_chapter_counts_every_row() {
    let reader = core().reader();
    let (mut notes, mut cross_refs, mut footnotes) = (0, 0, 0);
    for book in reader.bible_books(NWT_E).unwrap() {
        for chapter in 1..=book.chapter_count {
            let counts = reader
                .chapter_study_markers(NWT_E, book.book, chapter)
                .unwrap_or_else(|e| panic!("{}:{chapter}: {e:?}", book.book));
            for c in counts {
                assert!(c.study_notes + c.cross_refs + c.footnotes > 0, "{c:?}");
                notes += c.study_notes;
                cross_refs += c.cross_refs;
                footnotes += c.footnotes;
            }
        }
    }
    assert_eq!(
        (notes, cross_refs, footnotes),
        (STUDY_NOTES, CROSS_REF_TARGETS, VERSE_FOOTNOTES)
    );
}

#[test]
fn verse_study_of_non_verses_is_invalid() {
    let chapter = Location {
        verse: None,
        ..verse(NWT_E, 43, 3, 16)
    };
    let paragraph = Location {
        paragraph: Some(1),
        ..verse(NWT_E, 43, 3, 16)
    };
    for location in [
        chapter,
        paragraph,
        document(NWT_E, 1001061147, None),
        document(W_E, 2026521, Some(1)),
        verse(W_E, 43, 3, 16),
        verse(RSG_E, 43, 3, 16),
        verse("nwt", 43, 3, 16),
    ] {
        match verse_study(&location) {
            Err(CoreError::Invalid(_)) => {}
            other => panic!("{location:?}: {other:?}"),
        }
    }
    let reader = core().reader();
    for (bible, why) in [(W_E, "not a Bible"), ("nwt", "malformed publication key")] {
        match reader.chapter_study_markers(bible, 43, 3) {
            Err(CoreError::Invalid(m)) => assert!(m.contains(why), "{m}"),
            other => panic!("{bible}: {other:?}"),
        }
    }
}

#[test]
fn verse_study_of_unknown_verses_is_not_found() {
    for location in [
        verse(NWT_E, 43, 3, 99),
        verse(NWT_E, 43, 99, 1),
        verse(NWT_E, 67, 1, 1),
        verse("nwt:2:0", 43, 3, 16),
    ] {
        match verse_study(&location) {
            Err(CoreError::NotFound) => {}
            other => panic!("{location:?}: {other:?}"),
        }
    }
    let reader = core().reader();
    for (bible, book, chapter) in [(NWT_E, 43, 22), (NWT_E, 67, 1), ("nwt:2:0", 43, 3)] {
        match reader.chapter_study_markers(bible, book, chapter) {
            Err(CoreError::NotFound) => {}
            other => panic!("{bible} {book}:{chapter}: {other:?}"),
        }
    }
}
