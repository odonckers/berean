//! `Document::blocks` against real JW Library publications: every content
//! document of w, ll, te, it and rsg, read once into one shared core. The
//! fixtures are not committed: run `core/scripts/fetch-fixtures.sh` to
//! download them into `core/fixtures/`.

mod common;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::OnceLock;

use berean_core::doc_blocks::{
    DocBlock, DocFootnote, DocImage, DocInline, DocLinkTarget, DocVerse, ParagraphRole,
};
use berean_core::jwpub::Publication;
use berean_core::notes::Inline;
use berean_core::reader::{Document, LocationSpan};
use berean_core::{CancelToken, Core, CoreError};
use common::fixture;

const W_E: &str = "w26:0:20260800";
const LL_E: &str = "ll:0:0";
const TE_E: &str = "te:0:0";
const IT_E: &str = "it:0:0";
const RSG_E: &str = "rsg:0:0";
const NWT_E: &str = "nwt:0:0";

const FIXTURES: [(&str, &str); 5] = [
    (W_E, "w_E_202608.jwpub"),
    (LL_E, "ll_E.jwpub"),
    (TE_E, "te_E.jwpub"),
    (IT_E, "it_E.jwpub"),
    (RSG_E, "rsg_E.jwpub"),
];

/// The study article "Resist Satan's Tactics".
const W_ARTICLE_DOC: i64 = 2026520;
/// it "Chronology", with tables.
const IT_CHRONOLOGY_DOC: i64 = 1200000970;
/// te chapter 28, with the publication's one footnote.
const TE_SHEPHERD_DOC: i64 = 1101971128;

struct Fixtures {
    /// The core they are installed in, with the Bible for their links.
    core: Core,
    data_dir: std::path::PathBuf,
    /// Every content document of each publication, by key.
    documents: HashMap<&'static str, Vec<Document>>,
}

/// The core with the fixtures installed and every content document read,
/// shared by all tests. Reading it's 4782 documents is the slow part, so it
/// happens once.
fn fixtures() -> &'static Fixtures {
    static FIXTURES_READ: OnceLock<Fixtures> = OnceLock::new();
    FIXTURES_READ.get_or_init(|| {
        let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("doc-blocks");
        if dir.exists() {
            std::fs::remove_dir_all(&dir).unwrap();
        }
        let data_dir = dir.join("data");
        let core = Core::open(&data_dir, dir.join("cache")).unwrap();
        let mut documents = HashMap::new();
        for (key, file) in FIXTURES {
            core.library()
                .install(key, fixture(file), &|_, _| {}, &CancelToken::new())
                .unwrap_or_else(|e| panic!("install {file}: {e:?}"));
            let ids: Vec<i64> = Publication::open(fixture(file))
                .unwrap()
                .documents()
                .unwrap()
                .into_iter()
                .filter(|d| d.has_content)
                .map(|d| d.meps_document_id)
                .collect();
            let read = ids
                .iter()
                .map(|&id| {
                    core.reader()
                        .document(key, id)
                        .unwrap_or_else(|e| panic!("{key} document {id}: {e:?}"))
                })
                .collect();
            documents.insert(key, read);
        }
        core.library()
            .install(
                NWT_E,
                fixture("nwt_E.jwpub"),
                &|_, _| {},
                &CancelToken::new(),
            )
            .unwrap_or_else(|e| panic!("install nwt_E.jwpub: {e:?}"));
        Fixtures {
            core,
            data_dir,
            documents,
        }
    })
}

fn documents(key: &str) -> &'static [Document] {
    &fixtures().documents[key]
}

fn document(key: &str, doc_id: i64) -> &'static Document {
    documents(key)
        .iter()
        .find(|d| d.doc_id == doc_id)
        .unwrap_or_else(|| panic!("{key} has no document {doc_id}"))
}

/// Every block of `blocks`, nested ones included, in order.
fn all_blocks(blocks: &[DocBlock]) -> Vec<&DocBlock> {
    let mut out = Vec::new();
    for block in blocks {
        out.push(block);
        match block {
            DocBlock::Figure { caption, .. } => out.extend(all_blocks(caption)),
            DocBlock::Aside { blocks, .. } => out.extend(all_blocks(blocks)),
            DocBlock::List { items, .. } => {
                for item in items {
                    out.extend(all_blocks(&item.blocks));
                }
            }
            DocBlock::Table { rows } => {
                for cell in rows.iter().flat_map(|r| &r.cells) {
                    out.extend(all_blocks(&cell.blocks));
                }
            }
            _ => {}
        }
    }
    out
}

/// The paragraphs `blocks` holds, in order: blocks, aside titles and
/// footnotes.
fn paragraphs(blocks: &[DocBlock]) -> Vec<u32> {
    let mut out = Vec::new();
    for block in all_blocks(blocks) {
        match block {
            DocBlock::Heading { paragraph, .. } => out.extend(*paragraph),
            DocBlock::Paragraph { paragraph, .. }
            | DocBlock::Question { paragraph, .. }
            | DocBlock::AnswerField { paragraph, .. } => out.push(*paragraph),
            DocBlock::Aside { title, .. } => out.extend(title.as_ref().map(|t| t.paragraph)),
            DocBlock::Footnotes { items } => out.extend(items.iter().filter_map(|f| f.paragraph)),
            _ => {}
        }
    }
    out
}

/// Every inline in `inlines`, nested doc inlines included (not the
/// `Inline`s inside a `Common`).
fn all_inlines(inlines: &[DocInline]) -> Vec<&DocInline> {
    let mut out = Vec::new();
    for inline in inlines {
        out.push(inline);
        match inline {
            DocInline::Superscript { children }
            | DocInline::Subscript { children }
            | DocInline::SmallCaps { children }
            | DocInline::Link { children, .. } => out.extend(all_inlines(children)),
            _ => {}
        }
    }
    out
}

/// The inline runs of one block (a footnote, an aside title).
fn block_inlines(block: &DocBlock) -> Vec<&[DocInline]> {
    match block {
        DocBlock::Heading { inlines, .. }
        | DocBlock::Paragraph { inlines, .. }
        | DocBlock::Question { inlines, .. } => vec![inlines],
        DocBlock::Aside { title, .. } => title.iter().map(|t| &t.inlines[..]).collect(),
        DocBlock::Footnotes { items } => items.iter().map(|f| &f.inlines[..]).collect(),
        _ => Vec::new(),
    }
}

/// Every inline of every block of `blocks`.
fn document_inlines(blocks: &[DocBlock]) -> Vec<&DocInline> {
    all_blocks(blocks)
        .into_iter()
        .flat_map(block_inlines)
        .flat_map(all_inlines)
        .collect()
}

fn inline_text(inline: &Inline, out: &mut String) {
    match inline {
        Inline::Text { text } => out.push_str(text),
        Inline::Emphasis { children } | Inline::Strong { children } => {
            children.iter().for_each(|c| inline_text(c, out))
        }
        other => panic!("documents put only text, emphasis and strong in Common: {other:?}"),
    }
}

fn inlines_text(inlines: &[DocInline], out: &mut String) {
    for inline in inlines {
        match inline {
            DocInline::Common { inline } => inline_text(inline, out),
            DocInline::Superscript { children }
            | DocInline::Subscript { children }
            | DocInline::SmallCaps { children }
            | DocInline::Link { children, .. } => inlines_text(children, out),
            DocInline::FootnoteRef { marker, .. } => out.push_str(marker),
            DocInline::PageMarker { .. } => {}
        }
    }
}

fn plain(inlines: &[DocInline]) -> String {
    let mut out = String::new();
    inlines_text(inlines, &mut out);
    out
}

/// The text of `blocks`, as it reads: a question with its number, a
/// footnote with its marker, blocks separated by spaces.
fn blocks_text(blocks: &[DocBlock], out: &mut String) {
    for block in blocks {
        out.push(' ');
        match block {
            DocBlock::Heading { inlines, .. } | DocBlock::Paragraph { inlines, .. } => {
                inlines_text(inlines, out)
            }
            DocBlock::Question {
                number, inlines, ..
            } => {
                out.push_str(&format!("{number}. "));
                inlines_text(inlines, out);
            }
            DocBlock::AnswerField { .. } | DocBlock::Rule => {}
            DocBlock::Figure { caption, .. } => blocks_text(caption, out),
            DocBlock::Aside { title, blocks } => {
                if let Some(title) = title {
                    inlines_text(&title.inlines, out);
                }
                blocks_text(blocks, out);
            }
            DocBlock::List { items, .. } => {
                for item in items {
                    blocks_text(&item.blocks, out);
                }
            }
            DocBlock::Table { rows } => {
                for cell in rows.iter().flat_map(|r| &r.cells) {
                    blocks_text(&cell.blocks, out);
                }
            }
            DocBlock::Footnotes { items } => {
                for item in items {
                    out.push_str(&format!(" {} ", item.marker));
                    inlines_text(&item.inlines, out);
                }
            }
        }
    }
}

/// Runs of whitespace (any, no-break spaces included) as one space.
fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The visible text of a document's HTML, independently of the scanner:
/// tags dropped (block-level ones as a space), `label`, `textarea` and the
/// paragraph numbers in `span.parNum` dropped, character references decoded.
fn visible_text(html: &str) -> String {
    const BLOCK: [&str; 21] = [
        "p",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "header",
        "aside",
        "figure",
        "figcaption",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tr",
        "td",
        "th",
        "details",
        "summary",
        "br",
    ];
    let mut text = String::new();
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        text.push_str(&rest[..lt]);
        rest = &rest[lt..];
        let tag = &rest[..rest.find('>').unwrap() + 1];
        let name: String = tag
            .trim_start_matches(['<', '/'])
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect();
        let skip_to = match name.as_str() {
            "label" => Some("</label>"),
            "textarea" => Some("</textarea>"),
            "span" if tag.contains("class=\"parNum\"") => Some("</span>"),
            _ => None,
        };
        rest = match skip_to {
            Some(close) => &rest[rest.find(close).unwrap() + close.len()..],
            None => &rest[tag.len()..],
        };
        if BLOCK.contains(&name.as_str()) {
            text.push(' ');
        }
    }
    text.push_str(rest);
    normalize(&decode(&text))
}

fn decode(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let semi = rest.find(';').filter(|&s| s < 10);
        let decoded = semi.and_then(|s| match &rest[1..s] {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{a0}'),
            n => n
                .strip_prefix('#')
                .and_then(|n| n.parse().ok())
                .and_then(char::from_u32),
        });
        match (decoded, semi) {
            (Some(c), Some(s)) => {
                out.push(c);
                rest = &rest[s + 1..];
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn assert_common_only_text_and_formatting(inline: &Inline) {
    match inline {
        Inline::Text { .. } => {}
        Inline::Emphasis { children } | Inline::Strong { children } => children
            .iter()
            .for_each(assert_common_only_text_and_formatting),
        other => panic!("not text or formatting under Common: {other:?}"),
    }
}

#[test]
fn every_positioned_paragraph_is_in_exactly_one_block() {
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            let mut seen = paragraphs(&doc.blocks);
            seen.sort_unstable();
            let mut positioned: Vec<u32> = doc
                .paragraphs
                .iter()
                .filter(|p| p.begin.is_some())
                .map(|p| p.paragraph)
                .collect();
            positioned.sort_unstable();
            assert_eq!(seen, positioned, "{key} document {}", doc.doc_id);
        }
    }
}

#[test]
fn blocks_are_in_html_order() {
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            let begin: HashMap<u32, u32> = doc
                .paragraphs
                .iter()
                .filter_map(|p| Some((p.paragraph, p.begin?)))
                .collect();
            let order: Vec<u32> = paragraphs(&doc.blocks).iter().map(|p| begin[p]).collect();
            assert!(
                order.windows(2).all(|w| w[0] < w[1]),
                "{key} document {}",
                doc.doc_id
            );
        }
    }
}

#[test]
fn block_text_is_the_visible_text() {
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            let mut text = String::new();
            blocks_text(&doc.blocks, &mut text);
            assert_eq!(
                normalize(&text),
                visible_text(&doc.html),
                "{key} document {}",
                doc.doc_id
            );
        }
    }
}

#[test]
fn common_holds_only_text_emphasis_and_strong() {
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            for inline in document_inlines(&doc.blocks) {
                if let DocInline::Common { inline } = inline {
                    assert_common_only_text_and_formatting(inline);
                }
            }
        }
    }
}

#[test]
fn text_is_collapsed_and_trimmed() {
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            for runs in all_blocks(&doc.blocks).into_iter().flat_map(block_inlines) {
                let text = plain(runs);
                assert!(
                    !text.contains("  ") && !text.contains(['\n', '\t', '\r']),
                    "{key} document {}: {text:?}",
                    doc.doc_id
                );
                // A trailing space can only sit before a zero-width marker.
                if !matches!(runs.last(), Some(DocInline::PageMarker { .. })) {
                    assert_eq!(text.trim_matches(' '), text, "{key} {}", doc.doc_id);
                }
            }
        }
    }
}

fn find_question<'a>(doc: &'a Document, number: &str) -> (&'a [u32], &'a [DocInline]) {
    all_blocks(&doc.blocks)
        .into_iter()
        .find_map(|b| match b {
            DocBlock::Question {
                number: n,
                for_paragraphs,
                inlines,
                ..
            } if n == number => Some((&for_paragraphs[..], &inlines[..])),
            _ => None,
        })
        .unwrap_or_else(|| panic!("no question {number}"))
}

fn find_paragraph(doc: &Document, pid: u32) -> &DocBlock {
    all_blocks(&doc.blocks)
        .into_iter()
        .find(|b| matches!(b, DocBlock::Paragraph { paragraph, .. } if *paragraph == pid))
        .unwrap_or_else(|| panic!("no paragraph {pid}"))
}

#[test]
fn watchtower_questions_cover_their_paragraphs() {
    let doc = document(W_E, W_ARTICLE_DOC);
    let (covers, inlines) = find_question(doc, "6-7");
    assert_eq!(covers, [13, 14]);
    assert_eq!(
        plain(inlines),
        "In what ways did Satan attack Jesus’ early disciples?"
    );
    let (covers, inlines) = find_question(doc, "1");
    assert_eq!(covers, [7]);
    assert_eq!(
        plain(inlines),
        "What tactic does Satan use to try to break the integrity of God’s servants?"
    );

    // Every study question of w has a number and covers a paragraph that
    // names it.
    let mut questions = 0;
    for doc in documents(W_E) {
        for block in all_blocks(&doc.blocks) {
            if let DocBlock::Question {
                number,
                for_paragraphs,
                ..
            } = block
            {
                questions += 1;
                assert!(
                    !number.is_empty() && !for_paragraphs.is_empty(),
                    "{block:?}"
                );
            }
        }
    }
    assert_eq!(questions, 66);
}

#[test]
fn watchtower_paragraph_numbers() {
    let doc = document(W_E, W_ARTICLE_DOC);
    // The first paragraph's number has no text (a drop cap) but its
    // `data-pnum` is 1.
    let DocBlock::Paragraph {
        number, inlines, ..
    } = find_paragraph(doc, 7)
    else {
        unreachable!()
    };
    assert_eq!(number.as_deref(), Some("1"));
    assert!(plain(inlines).starts_with("FROM the moment"));
    let DocBlock::Paragraph {
        number,
        role,
        inlines,
        ..
    } = find_paragraph(doc, 8)
    else {
        unreachable!()
    };
    assert_eq!(number.as_deref(), Some("2"));
    assert_eq!(role, &ParagraphRole::Body);
    assert!(plain(inlines).starts_with("In the midst of a battle"));
    assert!(!all_inlines(inlines)
        .iter()
        .any(|i| matches!(i, DocInline::Superscript { .. })));

    // Each number is the paragraph's `ParagraphNumberLabel`.
    let mut numbered = 0;
    for doc in documents(W_E) {
        for block in all_blocks(&doc.blocks) {
            if let DocBlock::Paragraph {
                paragraph,
                number: Some(number),
                ..
            } = block
            {
                numbered += 1;
                let anchor = doc.paragraphs.iter().find(|p| p.paragraph == *paragraph);
                assert_eq!(anchor.unwrap().label.as_ref(), Some(number));
            }
        }
    }
    assert_eq!(numbered, 69);
}

#[test]
fn watchtower_roles_answer_fields_and_figures() {
    let doc = document(W_E, W_ARTICLE_DOC);
    let blocks = all_blocks(&doc.blocks);
    let role_of = |pid| match find_paragraph(doc, pid) {
        DocBlock::Paragraph { role, .. } => role.clone(),
        _ => unreachable!(),
    };
    assert_eq!(role_of(1), ParagraphRole::ContextTitle);
    assert_eq!(role_of(2), ParagraphRole::PublicationReference);
    assert_eq!(role_of(4), ParagraphRole::ThemeScripture);
    assert!(blocks.contains(&&DocBlock::AnswerField {
        paragraph: 41,
        tag: "textarea-4".into()
    }));
    assert!(blocks.contains(&&DocBlock::Rule));

    let figures: Vec<(&DocImage, &Vec<DocBlock>)> = blocks
        .iter()
        .filter_map(|b| match b {
            DocBlock::Figure { image, caption } => Some((image, caption)),
            _ => None,
        })
        .collect();
    assert_eq!(figures.len(), 2);
    let (image, caption) = figures[0];
    assert_eq!(image.file, "2026520_univ_cnt_1.jpg");
    assert_eq!((image.width, image.height), (Some(1200), Some(675)));
    assert!(image.alt.starts_with("A young sister in her bedroom"));
    let path = std::path::Path::new(&image.path);
    assert!(path.is_absolute() && path.is_file(), "{}", image.path);
    assert!(path.starts_with(&fixtures().data_dir), "{}", image.path);
    assert!(matches!(
        &caption[..],
        [DocBlock::Paragraph { paragraph: 75, .. }]
    ));

    // The "HOW WOULD YOU ANSWER?" box: a title and a list of questions,
    // each with its answer field.
    let (title, aside) = blocks
        .iter()
        .find_map(|b| match b {
            DocBlock::Aside { title, blocks } => Some((title, blocks)),
            _ => None,
        })
        .unwrap();
    let title = title.as_ref().unwrap();
    assert_eq!(title.paragraph, 28);
    assert_eq!(plain(&title.inlines), "HOW WOULD YOU ANSWER?");
    let [DocBlock::List {
        ordered: false,
        items,
    }] = &aside[..]
    else {
        panic!("{aside:?}")
    };
    assert_eq!(items.len(), 3);
    assert!(matches!(
        &items[0].blocks[..],
        [
            DocBlock::Paragraph { paragraph: 29, .. },
            DocBlock::AnswerField { paragraph: 30, .. }
        ]
    ));

    // The contents page: TOC entries; the cover's copyright line: body.
    let toc = document(W_E, 2026527);
    let toc_entries = all_blocks(&toc.blocks)
        .into_iter()
        .filter(|b| {
            matches!(
                b,
                DocBlock::Paragraph {
                    role: ParagraphRole::TocEntry,
                    ..
                }
            )
        })
        .count();
    assert_eq!(toc_entries, 7);
    let cover = document(W_E, 2026528);
    assert!(matches!(
        find_paragraph(cover, 4),
        DocBlock::Paragraph {
            role: ParagraphRole::Body,
            ..
        }
    ));
}

#[test]
fn watchtower_footnotes_match_their_refs() {
    let mut footnotes = 0;
    for doc in documents(W_E) {
        let blocks = all_blocks(&doc.blocks);
        let items: Vec<&DocFootnote> = blocks
            .iter()
            .filter_map(|b| match b {
                DocBlock::Footnotes { items } => Some(items),
                _ => None,
            })
            .flatten()
            .collect();
        let refs: Vec<(u32, &str)> = document_inlines(&doc.blocks)
            .into_iter()
            .filter_map(|i| match i {
                DocInline::FootnoteRef { id, marker } => Some((*id, marker.as_str())),
                _ => None,
            })
            .collect();
        let notes: Vec<(u32, &str)> = items.iter().map(|f| (f.id, f.marker.as_str())).collect();
        assert_eq!(refs, notes, "document {}", doc.doc_id);
        assert!(items.iter().all(|f| f.paragraph.is_some()));
        footnotes += items.len();
    }
    assert_eq!(footnotes, 5);

    let doc = document(W_E, W_ARTICLE_DOC);
    let note = all_blocks(&doc.blocks)
        .into_iter()
        .find_map(|b| match b {
            DocBlock::Footnotes { items } => Some(&items[0]),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        (note.id, note.marker.as_str(), note.paragraph),
        (1, "a", Some(37))
    );
    assert!(plain(&note.inlines).starts_with("Satan does not directly cause"));
}

/// te's one footnote ref has no `groupFootnote`: its text is already in
/// the HTML (a `[Footnotes]` line, then the note in `div.fcc`), so the ref
/// stays in the text with no `DocFootnote`, and the note is a paragraph.
#[test]
fn teacher_footnote_is_a_paragraph() {
    let doc = document(TE_E, TE_SHEPHERD_DOC);
    let refs: Vec<&DocInline> = document_inlines(&doc.blocks)
        .into_iter()
        .filter(|i| matches!(i, DocInline::FootnoteRef { .. }))
        .collect();
    assert_eq!(
        refs,
        [&DocInline::FootnoteRef {
            id: 1,
            marker: "a".into()
        }]
    );
    assert!(!all_blocks(&doc.blocks)
        .iter()
        .any(|b| matches!(b, DocBlock::Footnotes { .. })));
    let DocBlock::Paragraph { inlines, .. } = find_paragraph(doc, 26) else {
        unreachable!()
    };
    assert_eq!(plain(inlines), "Psalm 22, Douay Version.");
}

#[test]
fn teacher_titles_stay_paragraphs() {
    let doc = document(TE_E, TE_SHEPHERD_DOC);
    assert!(matches!(
        &doc.blocks[..2],
        [
            DocBlock::Paragraph {
                paragraph: 1,
                role: ParagraphRole::Title,
                ..
            },
            DocBlock::Paragraph {
                paragraph: 2,
                role: ParagraphRole::Title,
                ..
            },
        ]
    ));
    assert!(matches!(
        find_paragraph(doc, 24),
        DocBlock::Paragraph {
            role: ParagraphRole::Summary,
            ..
        }
    ));
    assert!(!documents(TE_E).iter().any(|d| all_blocks(&d.blocks)
        .iter()
        .any(|b| matches!(b, DocBlock::Heading { .. }))));
}

#[test]
fn insight_small_caps_and_split_formatting() {
    let mut lord = 0;
    let mut split = 0;
    for doc in documents(IT_E) {
        for runs in all_blocks(&doc.blocks).into_iter().flat_map(block_inlines) {
            for pair in all_inlines(runs).windows(2) {
                if let [DocInline::Common { inline }, DocInline::SmallCaps { children }] = pair {
                    let mut text = String::new();
                    inline_text(inline, &mut text);
                    if text.ends_with('L') && plain(children) == "ORD" {
                        lord += 1;
                    }
                }
            }
            // A `sup` inside `em` or `strong` has the formatting pushed down
            // onto all of its text (unlike an `em` inside a `sup`).
            for inline in all_inlines(runs) {
                if let DocInline::Superscript { children } = inline {
                    if children.iter().all(|c| {
                        matches!(
                            c,
                            DocInline::Common {
                                inline: Inline::Emphasis { .. } | Inline::Strong { .. }
                            }
                        )
                    }) {
                        split += 1;
                    }
                }
            }
        }
    }
    assert!(lord > 0);
    assert_eq!(split, 13);
}

/// "COVENANT": `<em>b<sup>e</sup>rithʹ</em>`.
#[test]
fn insight_split_example() {
    let emphasis = |t: &str| DocInline::Common {
        inline: Inline::Emphasis {
            children: vec![Inline::Text { text: t.into() }],
        },
    };
    let split = [
        emphasis("b"),
        DocInline::Superscript {
            children: vec![emphasis("e")],
        },
        emphasis("rithʹ"),
    ];
    let doc = document(IT_E, 1200001054);
    let found = all_blocks(&doc.blocks)
        .into_iter()
        .flat_map(block_inlines)
        .any(|runs| runs.windows(3).any(|w| w == split));
    assert!(found);
}

#[test]
fn insight_tables() {
    let mut colspans = 0;
    let mut tables = 0;
    for doc in documents(IT_E) {
        for block in all_blocks(&doc.blocks) {
            if let DocBlock::Table { rows } = block {
                tables += 1;
                colspans += rows
                    .iter()
                    .flat_map(|r| &r.cells)
                    .filter(|c| c.colspan > 1)
                    .count();
            }
        }
    }
    assert_eq!(tables, 35);
    assert_eq!(colspans, 27);

    let doc = document(IT_E, IT_CHRONOLOGY_DOC);
    let tables: Vec<_> = all_blocks(&doc.blocks)
        .into_iter()
        .filter_map(|b| match b {
            DocBlock::Table { rows } => Some(rows),
            _ => None,
        })
        .collect();
    // The second table has a header row of three cells.
    let header = &tables[1][0].cells;
    assert_eq!(header.len(), 3);
    assert!(header.iter().all(|c| c.header && c.colspan == 1));
    assert!(matches!(
        &header[0].blocks[..],
        [DocBlock::Paragraph { paragraph: 111, .. }]
    ));
    // An empty cell (a no-break space) has no blocks.
    let row = &tables[1][1].cells;
    assert!(row[2].blocks.is_empty() && !row[2].header);
}

#[test]
fn research_guide_section_titles_are_headings_of_no_paragraph() {
    let doc = document(RSG_E, 1200030165);
    let titles: Vec<String> = all_blocks(&doc.blocks)
        .into_iter()
        .filter_map(|b| match b {
            DocBlock::Heading {
                paragraph: None,
                level: 2,
                inlines,
            } => Some(plain(inlines)),
            _ => None,
        })
        .collect();
    assert_eq!(titles[0], "General Information");

    // Every heading of no paragraph is a section title: no words were
    // found outside a paragraph in any fixture.
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            for block in all_blocks(&doc.blocks) {
                if let DocBlock::Heading {
                    paragraph: None,
                    level,
                    ..
                } = block
                {
                    assert_eq!((key, *level), (RSG_E, 2), "document {}", doc.doc_id);
                }
            }
        }
    }
}

#[test]
fn link_targets_of_each_href_shape() {
    let document = |language: &str, doc_id, range: Option<(u32, u32)>| DocLinkTarget::Document {
        language: language.into(),
        doc_id,
        first: range.map(|r| r.0),
        last: range.map(|r| r.1),
    };
    let verse = |book, chapter, verse| DocVerse {
        book,
        chapter,
        verse,
    };
    for (href, target) in [
        (
            "jwpub://b/NWTR/59:4:7-59:4:7",
            DocLinkTarget::Bible {
                symbol: "NWTR".into(),
                start: verse(59, 4, 7),
                end: verse(59, 4, 7),
            },
        ),
        (
            "jwpub://b/NWTR/44:7:57-44:8:1",
            DocLinkTarget::Bible {
                symbol: "NWTR".into(),
                start: verse(44, 7, 57),
                end: verse(44, 8, 1),
            },
        ),
        ("jwpub://p/E:1102016855/", document("E", 1102016855, None)),
        ("jwpub://p/E:1102016855", document("E", 1102016855, None)),
        (
            "jwpub://p/E:1200000369/19-19",
            document("E", 1200000369, Some((19, 19))),
        ),
        (
            "jwpub://p/E:1200000369/19",
            document("E", 1200000369, Some((19, 19))),
        ),
        (
            "jwpub://p/E:1200004129/360-360:4",
            document("E", 1200004129, Some((360, 360))),
        ),
        (
            "jwpub://p/E:1200002904/14:1-32:8",
            document("E", 1200002904, Some((14, 32))),
        ),
        (
            "jwpub://p/E:1102021206/4-5$p/E:1102021206/22-30",
            document("E", 1102021206, Some((4, 5))),
        ),
        (
            "jwpub://c/E:1001070161/1:18",
            DocLinkTarget::StudyNote {
                language: "E".into(),
                doc_id: 1001070161,
                chapter: 1,
                verse: 18,
            },
        ),
        (
            "https://www.jw.org/finder?wtlocale=E&docid=1011750",
            DocLinkTarget::External {
                url: "https://www.jw.org/finder?wtlocale=E&docid=1011750".into(),
            },
        ),
        (
            "http://example.org/",
            DocLinkTarget::External {
                url: "http://example.org/".into(),
            },
        ),
        (
            "mailto:someone@example.org",
            DocLinkTarget::External {
                url: "mailto:someone@example.org".into(),
            },
        ),
        ("#footnotesource1", DocLinkTarget::Invalid),
        ("#top", DocLinkTarget::Invalid),
        ("jwpub://b/NWTR/59:4", DocLinkTarget::Invalid),
        ("jwpub://b//59:4:7-59:4:7", DocLinkTarget::Invalid),
        ("jwpub://p/E:abc/", DocLinkTarget::Invalid),
        ("jwpub://p/E:1/1-2-3", DocLinkTarget::Invalid),
        ("jwpub://c/E:1001070161/1", DocLinkTarget::Invalid),
        ("jwpub://x/E:1/", DocLinkTarget::Invalid),
        ("webpubvid://?pub=ivfe&track=1", DocLinkTarget::Invalid),
        ("", DocLinkTarget::Invalid),
    ] {
        assert_eq!(DocLinkTarget::from_href(href), target, "{href}");
    }
}

#[test]
fn every_fixture_link_parses() {
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            for inline in document_inlines(&doc.blocks) {
                if let DocInline::Link { url, target, .. } = inline {
                    assert_eq!(target, &DocLinkTarget::from_href(url));
                    // Only `#` hrefs are not understood.
                    assert_eq!(
                        target == &DocLinkTarget::Invalid,
                        url.starts_with('#'),
                        "{key} document {}: {url}",
                        doc.doc_id
                    );
                }
            }
        }
    }
}

/// The shape of `href`, for counting resolve outcomes.
fn href_shape(href: &str) -> &'static str {
    if href.starts_with("jwpub://b/") {
        "bible"
    } else if let Some(rest) = href.strip_prefix("jwpub://p/") {
        let paragraphs = rest.split_once('/').map_or("", |(_, p)| p);
        if rest.contains('$') {
            "document $ list"
        } else if paragraphs.contains(':') {
            "document paragraph:token"
        } else if paragraphs.is_empty() {
            "document"
        } else {
            "document paragraphs"
        }
    } else if href.starts_with("jwpub://c/") {
        "study note"
    } else if href.starts_with('#') {
        "#"
    } else if matches!(
        DocLinkTarget::from_href(href),
        DocLinkTarget::External { .. }
    ) {
        "external"
    } else {
        "other"
    }
}

/// The name of `resolve`'s outcome: `Ok` or the error's variant.
fn outcome(result: &Result<LocationSpan, CoreError>) -> &'static str {
    match result {
        Ok(_) => "Ok",
        Err(CoreError::Invalid(_)) => "Invalid",
        Err(CoreError::NotFound) => "NotFound",
        Err(CoreError::Corrupt) => "Corrupt",
        Err(CoreError::Io(_)) => "Io",
        Err(CoreError::Cancelled) => "Cancelled",
        Err(CoreError::Migration(_)) => "Migration",
    }
}

/// `Reader::resolve` on every href in the fixtures gives the outcome the
/// design states for its shape (§3 Link targets): `Ok` for a Bible link with
/// the Bible installed, `Ok` or `NotFound` for a document link, `Invalid`
/// for the shapes it does not support yet. Counts are visible with
/// `--nocapture`.
#[test]
fn every_fixture_href_resolves_to_its_shape_outcome() {
    let mut total = 0;
    let mut hrefs = BTreeSet::new();
    for (key, _) in FIXTURES {
        for doc in documents(key) {
            for inline in document_inlines(&doc.blocks) {
                if let DocInline::Link { url, .. } = inline {
                    total += 1;
                    hrefs.insert(url.as_str());
                }
            }
        }
    }
    let reader = fixtures().core.reader();
    let mut counts: BTreeMap<&str, BTreeMap<&str, usize>> = BTreeMap::new();
    for href in &hrefs {
        let result = reader.resolve(href);
        let (shape, outcome) = (href_shape(href), outcome(&result));
        *counts.entry(shape).or_default().entry(outcome).or_default() += 1;
        let expected: &[&str] = match shape {
            "bible" => &["Ok"],
            "document" | "document paragraphs" => &["Ok", "NotFound"],
            _ => &["Invalid"],
        };
        assert!(expected.contains(&outcome), "{href}: {result:?}");
    }
    eprintln!("{total} hrefs, {} distinct; resolve outcomes:", hrefs.len());
    for (shape, outcomes) in &counts {
        eprintln!("  {shape}: {outcomes:?}");
    }

    for href in [
        "jwpub://p/E:1200004129/360-360:4",
        "jwpub://p/E:1200002904/14:1-32:8",
        "jwpub://p/E:1102021206/4-5$p/E:1102021206/22-30",
        "jwpub://c/E:1001070161/1:18",
    ] {
        let result = reader.resolve(href);
        assert!(matches!(result, Err(CoreError::Invalid(_))), "{result:?}");
    }
    let result = reader.resolve("jwpub://p/E:999999999/");
    assert!(matches!(result, Err(CoreError::NotFound)), "{result:?}");
    let span = reader.resolve("jwpub://b/NWTR/43:3:16-43:3:16").unwrap();
    assert_eq!(
        (span.start.pub_key.as_str(), span.start.verse),
        (NWT_E, Some(16))
    );
}

/// The kind of a value, as its debug name up to the first `{`, `(` or space.
fn kind(debug: String) -> String {
    debug.split([' ', '{', '(']).next().unwrap().to_string()
}

/// Parse statistics for the PR, visible with `--nocapture`.
#[test]
fn parse_stats() {
    for (key, _) in FIXTURES {
        let docs = documents(key);
        let mut blocks: BTreeMap<String, usize> = BTreeMap::new();
        let mut inlines: BTreeMap<String, usize> = BTreeMap::new();
        let mut links: BTreeMap<String, usize> = BTreeMap::new();
        for doc in docs {
            for block in all_blocks(&doc.blocks) {
                *blocks.entry(kind(format!("{block:?}"))).or_default() += 1;
            }
            for inline in document_inlines(&doc.blocks) {
                let name = match inline {
                    DocInline::Common { inline } => {
                        format!("Common.{}", kind(format!("{inline:?}")))
                    }
                    other => kind(format!("{other:?}")),
                };
                *inlines.entry(name).or_default() += 1;
                if let DocInline::Link { target, .. } = inline {
                    *links.entry(kind(format!("{target:?}"))).or_default() += 1;
                }
            }
        }
        eprintln!("{key}: {} docs", docs.len());
        eprintln!("  blocks:  {blocks:?}");
        eprintln!("  inlines: {inlines:?}");
        eprintln!("  links:   {links:?}");
    }
}
