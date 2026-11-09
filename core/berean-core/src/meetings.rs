//! The dated reading JW Library puts in front of the reader: this week's
//! meeting publications (the Meeting Workbook week for the midweek meeting
//! and the Watchtower study article for the weekend meeting) and the day's
//! text from *Examining the Scriptures Daily*.
//!
//! Both read the dates a publication carries in its own `DatedText` table,
//! so an installed issue is used as JW Library uses it. When no installed
//! issue covers the day, the catalog's `DatedText` table names the issue
//! that does, for the app to download.
//!
//! Days are the device's local calendar date as `YYYYMMDD` (e.g. 20261109),
//! as for [`Reader::locate`]; a day that is not a real Gregorian date =>
//! `Invalid`.

use crate::doc_blocks::DocBlock;
use crate::instant;
use crate::jwpub::{DatedTextRow, Publication};
use crate::library::PublicationSummary;
use crate::reader::{document_link, find_document, Reader};
use crate::CoreError;

/// A catalog `DatedText.Class`: the daily text.
const DAILY_TEXT_CLASS: i64 = 4;
/// A catalog `DatedText.Class`: the Watchtower study edition.
const WATCHTOWER_CLASS: i64 = 68;
/// A catalog `DatedText.Class`: the Meeting Workbook.
const WORKBOOK_CLASS: i64 = 106;
/// `Document.Class` of a Watchtower study article.
const STUDY_ARTICLE_CLASS: &str = "40";

/// One day of *Examining the Scriptures Daily*.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyText {
    /// The installed yearbook, e.g. `es26_E`'s key.
    pub pub_key: String,
    /// The MEPS id of the month's document that holds the day.
    pub doc_id: i64,
    /// The day, `YYYYMMDD`.
    pub day: i32,
    /// The day's first and last `data-pid` in that document.
    pub first_paragraph: u32,
    pub last_paragraph: u32,
    /// The day's blocks, in reading order: its date heading, the theme
    /// scripture and the comment.
    pub blocks: Vec<DocBlock>,
}

/// The daily text for a day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DailyTextDay {
    /// An installed yearbook has the day.
    Ready { text: DailyText },
    /// The catalog's yearbook for the day is not installed: download it.
    NotInstalled { publication: PublicationSummary },
    /// Neither the library nor the catalog has the day.
    Unavailable,
}

/// The meeting publications for the week (Monday to Sunday) holding a day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeetingWeek {
    /// The week's Monday and Sunday, `YYYYMMDD`.
    pub first_day: i32,
    pub last_day: i32,
    /// The Meeting Workbook's week, for the midweek meeting.
    pub midweek: MeetingPart,
    /// The Watchtower study article, for the weekend meeting.
    pub weekend: MeetingPart,
}

/// One meeting's publication for a week.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MeetingPart {
    /// The installed issue's document for the week.
    Ready {
        publication: PublicationSummary,
        /// The MEPS id of the week's document (the workbook week or the
        /// study article).
        doc_id: i64,
        title: String,
    },
    /// The catalog's issue for the week is not installed: download it.
    NotInstalled { publication: PublicationSummary },
    /// Neither the library nor the catalog lists material for the week,
    /// e.g. a Memorial or convention week without a midweek meeting.
    Unavailable,
}

impl Reader {
    /// The daily text for `day` in `meps_language`: from an installed
    /// yearbook whose `DatedText` holds the day, else the catalog's yearbook
    /// for the day to download. Invalid day => `Invalid`.
    pub fn daily_text(&self, meps_language: u32, day: i32) -> Result<DailyTextDay, CoreError> {
        check_day(day)?;
        let installed = self.dated_installed(meps_language, "es", None)?;
        for summary in &installed {
            let found = self
                .library()
                .with_publication(&summary.pub_key, |publication| {
                    let Some(row) = row_holding(publication, day)? else {
                        return Ok(None);
                    };
                    let doc = meps_id(publication, row.document_id)?;
                    Ok(Some((doc, row.begin_paragraph, row.end_paragraph)))
                })?;
            let Some((doc_id, begin, end)) = found else {
                continue;
            };
            let document = self.document(&summary.pub_key, doc_id)?;
            let pid = |p: Option<i64>| p.and_then(|p| u32::try_from(p).ok());
            let (first, last) = match (pid(begin), pid(end)) {
                (Some(first), Some(last)) if first <= last => (first, last),
                // No range: the whole document is the day's.
                _ => {
                    let pids = || document.paragraphs.iter().map(|p| p.paragraph);
                    (pids().min().unwrap_or(0), pids().max().unwrap_or(0))
                }
            };
            return Ok(DailyTextDay::Ready {
                text: DailyText {
                    pub_key: summary.pub_key.clone(),
                    doc_id,
                    day,
                    first_paragraph: first,
                    last_paragraph: last,
                    blocks: within(document.blocks, first, last),
                },
            });
        }
        // The yearbook's catalog `KeySymbol` is dated (`es26`), so any
        // symbol goes.
        Ok(
            match self.not_installed(DAILY_TEXT_CLASS, meps_language, None, day, &installed)? {
                Some(publication) => DailyTextDay::NotInstalled { publication },
                None => DailyTextDay::Unavailable,
            },
        )
    }

    /// The meeting publications in `meps_language` for the week (Monday to
    /// Sunday) holding `day`: the Meeting Workbook week and the Watchtower
    /// study article that an installed issue's `DatedText` dates to the
    /// day, else the catalog's issue to download. Invalid day => `Invalid`.
    pub fn meeting_week(&self, meps_language: u32, day: i32) -> Result<MeetingWeek, CoreError> {
        check_day(day)?;
        let (first_day, last_day) = instant::week_of(day);
        let midweek = self.meeting_part(
            meps_language,
            day,
            "mwb",
            WORKBOOK_CLASS,
            |publication, _, row| meps_id(publication, row.document_id),
        )?;
        let weekend =
            self.meeting_part(meps_language, day, "w", WATCHTOWER_CLASS, study_article)?;
        Ok(MeetingWeek {
            first_day,
            last_day,
            midweek,
            weekend,
        })
    }

    /// One meeting's part: the first installed issue (newest first) with a
    /// `DatedText` row holding `day`, its document picked by `document`
    /// (the MEPS id), else the catalog's issue.
    fn meeting_part(
        &self,
        meps_language: u32,
        day: i32,
        key_symbol: &str,
        class: i64,
        document: impl Fn(&Publication, &[DatedTextRow], &DatedTextRow) -> Result<i64, CoreError>,
    ) -> Result<MeetingPart, CoreError> {
        // An issue is dated before the weeks it covers: a Watchtower study
        // edition by about two months, so a year back is plenty.
        let installed = self.dated_installed(meps_language, key_symbol, Some(day))?;
        for summary in &installed {
            let found = self
                .library()
                .with_publication(&summary.pub_key, |publication| {
                    let rows = publication.dated_texts()?;
                    let Some(row) = rows.iter().find(|r| holds(r, day)) else {
                        return Ok(None);
                    };
                    let doc_id = document(publication, &rows, row)?;
                    let title = find_document(publication, doc_id)?
                        .ok_or(CoreError::Corrupt)?
                        .title
                        .trim()
                        .to_string();
                    Ok(Some((doc_id, title)))
                })?;
            if let Some((doc_id, title)) = found {
                return Ok(MeetingPart::Ready {
                    publication: summary.clone(),
                    doc_id,
                    title,
                });
            }
        }
        Ok(
            match self.not_installed(class, meps_language, Some(key_symbol), day, &installed)? {
                Some(publication) => MeetingPart::NotInstalled { publication },
                None => MeetingPart::Unavailable,
            },
        )
    }

    /// Installed publications in `meps_language` whose undated symbol is
    /// `key_symbol` (`w26` is `w`), newest issue first. With `day`, only
    /// issues dated from a year before it through its month.
    fn dated_installed(
        &self,
        meps_language: u32,
        key_symbol: &str,
        day: Option<i32>,
    ) -> Result<Vec<PublicationSummary>, CoreError> {
        let mut found: Vec<PublicationSummary> = self
            .library()
            .installed()?
            .into_iter()
            .filter(|p| p.meps_language == meps_language && undated(&p.symbol) == key_symbol)
            .filter(|p| match day {
                None => true,
                Some(day) => {
                    let month = i64::from(day / 100) * 100;
                    let issue = i64::from(p.issue_tag);
                    issue != 0 && issue <= month && issue > month - 10_000
                }
            })
            .collect();
        found.sort_by(|a, b| b.issue_tag.cmp(&a.issue_tag).then(b.symbol.cmp(&a.symbol)));
        Ok(found)
    }

    /// The catalog's publication for `day`, unless it is one of `installed`
    /// (an installed issue without the day has nothing for it). A catalog
    /// that cannot be read counts as none: the library's answer stands.
    fn not_installed(
        &self,
        class: i64,
        meps_language: u32,
        key_symbol: Option<&str>,
        day: i32,
        installed: &[PublicationSummary],
    ) -> Result<Option<PublicationSummary>, CoreError> {
        let Ok(Some(publication)) = self.catalog().dated(class, meps_language, key_symbol, day)
        else {
            return Ok(None);
        };
        let is_installed = |key: &str| -> Result<bool, CoreError> {
            Ok(installed.iter().any(|p| p.pub_key == key)
                || self.library().installed()?.iter().any(|p| p.pub_key == key))
        };
        if is_installed(&publication.pub_key)? {
            return Ok(None);
        }
        Ok(Some(publication))
    }
}

fn check_day(day: i32) -> Result<(), CoreError> {
    if instant::valid_yyyymmdd(day) {
        Ok(())
    } else {
        Err(CoreError::Invalid(format!("not a YYYYMMDD day: {day}")))
    }
}

/// `symbol` without its trailing year digits: `w26` => `w`.
fn undated(symbol: &str) -> &str {
    symbol.trim_end_matches(|c: char| c.is_ascii_digit())
}

fn holds(row: &DatedTextRow, day: i32) -> bool {
    (row.first_date_offset..=row.last_date_offset).contains(&day)
}

fn row_holding(publication: &Publication, day: i32) -> Result<Option<DatedTextRow>, CoreError> {
    Ok(publication
        .dated_texts()?
        .into_iter()
        .find(|r| holds(r, day)))
}

/// The MEPS id of the local document `document_id`. Missing => `Corrupt`.
fn meps_id(publication: &Publication, document_id: i64) -> Result<i64, CoreError> {
    publication
        .documents()?
        .into_iter()
        .find(|d| d.document_id == document_id)
        .map(|d| d.meps_document_id)
        .ok_or(CoreError::Corrupt)
}

/// The study article a Watchtower study week's row dates: the document its
/// content (the contents entry for the week) links, else the study article
/// (`Document.Class` 40) at the row's position among the issue's rows,
/// else the row's own document.
fn study_article(
    publication: &Publication,
    rows: &[DatedTextRow],
    row: &DatedTextRow,
) -> Result<i64, CoreError> {
    if let Some(html) = publication.dated_text_content(row.dated_text_id)? {
        let linked = linked_documents(&html)
            .into_iter()
            .find_map(|doc| find_document(publication, doc).ok().flatten());
        if let Some(found) = linked {
            return Ok(found.meps_document_id);
        }
    }
    let position = rows.iter().position(|r| r == row);
    let articles: Vec<i64> = publication
        .documents()?
        .into_iter()
        .filter(|d| d.class == STUDY_ARTICLE_CLASS)
        .map(|d| d.meps_document_id)
        .collect();
    match position.and_then(|i| articles.get(i)) {
        Some(&doc) => Ok(doc),
        None => meps_id(publication, row.document_id),
    }
}

/// The MEPS ids of the `jwpub://p/` document links in `html`, in order.
fn linked_documents(html: &str) -> Vec<i64> {
    html.split("href=\"jwpub://p/")
        .skip(1)
        .filter_map(|rest| {
            let href = &rest[..rest.find('"')?];
            Some(document_link(href)?.1)
        })
        .collect()
}

/// The blocks of `blocks` on paragraphs `first..=last`: a block with its
/// own paragraph in the range, a container holding one, and a footnote
/// list's items in the range.
fn within(blocks: Vec<DocBlock>, first: u32, last: u32) -> Vec<DocBlock> {
    let range = first..=last;
    blocks
        .into_iter()
        .filter_map(|block| match block {
            DocBlock::Footnotes { items } => {
                let items: Vec<_> = items
                    .into_iter()
                    .filter(|f| f.paragraph.is_some_and(|p| range.contains(&p)))
                    .collect();
                (!items.is_empty()).then_some(DocBlock::Footnotes { items })
            }
            block => touches(&block, &range).then_some(block),
        })
        .collect()
}

/// Whether `block`, or a block inside it, is on a paragraph in `range`.
fn touches(block: &DocBlock, range: &std::ops::RangeInclusive<u32>) -> bool {
    let any = |blocks: &[DocBlock]| blocks.iter().any(|b| touches(b, range));
    match block {
        DocBlock::Heading { paragraph, .. } => paragraph.is_some_and(|p| range.contains(&p)),
        DocBlock::Paragraph { paragraph, .. }
        | DocBlock::Question { paragraph, .. }
        | DocBlock::AnswerField { paragraph, .. } => range.contains(paragraph),
        DocBlock::Figure { caption, .. } => any(caption),
        DocBlock::Aside { title, blocks } => {
            title.as_ref().is_some_and(|t| range.contains(&t.paragraph)) || any(blocks)
        }
        DocBlock::List { items, .. } => items.iter().any(|i| any(&i.blocks)),
        DocBlock::Table { rows } => rows.iter().flat_map(|r| &r.cells).any(|c| any(&c.blocks)),
        DocBlock::Footnotes { items } => items
            .iter()
            .any(|f| f.paragraph.is_some_and(|p| range.contains(&p))),
        DocBlock::Rule => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc_blocks::ParagraphRole;
    use crate::doc_blocks::{DocFootnote, DocListItem};
    use crate::notes::Inline;

    fn para(paragraph: u32) -> DocBlock {
        DocBlock::Paragraph {
            paragraph,
            number: None,
            role: ParagraphRole::Body,
            inlines: vec![crate::doc_blocks::DocInline::Common {
                inline: Inline::Text {
                    text: format!("p{paragraph}"),
                },
            }],
        }
    }

    #[test]
    fn undated_symbols() {
        assert_eq!(undated("w26"), "w");
        assert_eq!(undated("mwb27"), "mwb");
        assert_eq!(undated("es26"), "es");
        assert_eq!(undated("wp26"), "wp");
        assert_eq!(undated("nwt"), "nwt");
    }

    #[test]
    fn a_day_keeps_only_its_blocks() {
        let heading = |paragraph| DocBlock::Heading {
            level: 2,
            paragraph,
            inlines: vec![],
        };
        let blocks = vec![
            heading(Some(2)),
            para(3),
            para(4),
            heading(Some(5)),
            para(6),
            DocBlock::List {
                ordered: false,
                items: vec![DocListItem {
                    blocks: vec![para(7)],
                }],
            },
            DocBlock::Rule,
            heading(None),
            DocBlock::Footnotes {
                items: vec![
                    DocFootnote {
                        id: 1,
                        marker: "a".into(),
                        paragraph: Some(3),
                        inlines: vec![],
                    },
                    DocFootnote {
                        id: 2,
                        marker: "b".into(),
                        paragraph: Some(6),
                        inlines: vec![],
                    },
                ],
            },
        ];
        let day = within(blocks.clone(), 2, 4);
        assert_eq!(day.len(), 4);
        assert_eq!(day[..3], blocks[..3]);
        match &day[3] {
            DocBlock::Footnotes { items } => assert_eq!(items.len(), 1),
            other => panic!("{other:?}"),
        }
        // A container is kept whole when it holds the day's paragraph.
        let day = within(blocks.clone(), 5, 7);
        assert_eq!(day[..3], blocks[3..6]);
        assert!(within(blocks, 50, 60).is_empty());
    }

    #[test]
    fn study_week_links() {
        let html = "<div class=\"groupTOC\"><h3 id=\"p3\" data-pid=\"3\">Study article for October 5-11, 2026</h3>\n\
            <p id=\"p4\" data-pid=\"4\" class=\"se\"> 2  <a class=\"it\" href=\"jwpub://p/E:2026520/\"><strong>Resist</strong></a></p></div>";
        assert_eq!(linked_documents(html), vec![2026520]);
        assert_eq!(
            linked_documents("<a href=\"jwpub://p/S:1/2-3\">x</a><a href=\"jwpub://b/NWTR/1:1:1-1:1:1\">y</a><a href=\"jwpub://p/bad\">z</a>"),
            vec![1]
        );
        assert!(linked_documents("<p>no links</p>").is_empty());
    }
}
