//! This week's meetings and the day's text against the real publications
//! and the pinned catalog. The fixtures are not committed: run
//! `core/scripts/fetch-fixtures.sh` to download them into `core/fixtures/`.

mod common;
#[path = "common/trimmed_catalog.rs"]
mod trimmed_catalog;

use std::sync::OnceLock;

use berean_core::doc_blocks::{DocBlock, DocInline, ParagraphRole};
use berean_core::library::PubKind;
use berean_core::meetings::{DailyTextDay, MeetingPart, MeetingWeek};
use berean_core::notes::Inline;
use berean_core::{CancelToken, Core, CoreError};
use common::fixture;

const W_E: &str = "w26:0:20260800";
const MWB_E: &str = "mwb26:0:20260900";
const ES_E: &str = "es26:0:0";
/// English.
const E: u32 = 0;

/// MEPS document ids.
const MWB_OCTOBER_5_DOC: i64 = 202026256;
const MWB_OCTOBER_26_DOC: i64 = 202026259;
const W_OCTOBER_5_DOC: i64 = 2026520;
const W_OCTOBER_26_DOC: i64 = 2026523;
const ES_JANUARY_DOC: i64 = 1102026200;
const ES_NOVEMBER_DOC: i64 = 1102026210;

/// A core with the dated fixtures installed, and with the trimmed catalog
/// when `with_catalog`. Each lives under Cargo's per-target temp dir and is
/// rebuilt on each run.
fn core(with_catalog: bool) -> &'static Core {
    static BARE: OnceLock<Core> = OnceLock::new();
    static CATALOGUED: OnceLock<Core> = OnceLock::new();
    let (cell, name) = if with_catalog {
        (&CATALOGUED, "meetings-catalog")
    } else {
        (&BARE, "meetings")
    };
    cell.get_or_init(|| {
        let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).unwrap();
        }
        let core = Core::open(dir.join("data"), dir.join("cache")).unwrap();
        for (key, file) in [
            (W_E, "w_E_202608.jwpub"),
            (MWB_E, "mwb_E_202609.jwpub"),
            (ES_E, "es26_E.jwpub"),
        ] {
            core.library()
                .install(key, fixture(file), &|_, _| {}, &CancelToken::new())
                .unwrap_or_else(|e| panic!("install {file}: {e:?}"));
        }
        if with_catalog {
            core.catalog()
                .ingest_file(trimmed_catalog::trimmed(), &|_, _| {}, &CancelToken::new())
                .unwrap();
        }
        core
    })
}

fn ready(part: &MeetingPart) -> (&str, i64, &str) {
    match part {
        MeetingPart::Ready {
            publication,
            doc_id,
            title,
        } => (publication.pub_key.as_str(), *doc_id, title.as_str()),
        other => panic!("expected Ready, got {other:?}"),
    }
}

fn not_installed(part: &MeetingPart) -> (&str, PubKind, Option<&str>) {
    match part {
        MeetingPart::NotInstalled { publication } => (
            publication.pub_key.as_str(),
            publication.kind,
            publication.issue_title.as_deref(),
        ),
        other => panic!("expected NotInstalled, got {other:?}"),
    }
}

/// The plain text of a block's inlines.
fn text(inlines: &[DocInline]) -> String {
    fn common(inline: &Inline, out: &mut String) {
        match inline {
            Inline::Text { text } => out.push_str(text),
            Inline::Emphasis { children } | Inline::Strong { children } => {
                children.iter().for_each(|c| common(c, out))
            }
            _ => {}
        }
    }
    fn walk(inlines: &[DocInline], out: &mut String) {
        for inline in inlines {
            match inline {
                DocInline::Common { inline } => common(inline, out),
                DocInline::Superscript { children }
                | DocInline::Subscript { children }
                | DocInline::SmallCaps { children }
                | DocInline::Link { children, .. } => walk(children, out),
                _ => {}
            }
        }
    }
    let mut out = String::new();
    walk(inlines, &mut out);
    out
}

#[test]
fn the_installed_issues_give_the_week() {
    for with_catalog in [false, true] {
        let reader = core(with_catalog).reader();
        // Mid-week, and both ends of the October 5-11 week.
        for day in [20261005, 20261007, 20261011] {
            let week = reader.meeting_week(E, day).unwrap();
            assert_eq!((week.first_day, week.last_day), (20261005, 20261011));
            assert_eq!(
                ready(&week.midweek),
                (MWB_E, MWB_OCTOBER_5_DOC, "October 5-11"),
                "{day}"
            );
            assert_eq!(
                ready(&week.weekend),
                (
                    W_E,
                    W_OCTOBER_5_DOC,
                    "Resist Satan’s Tactics—Trust In Jehovah and In Jesus"
                ),
                "{day}"
            );
        }
        // A week across two months: the last of both issues.
        let week = reader.meeting_week(E, 20261101).unwrap();
        assert_eq!((week.first_day, week.last_day), (20261026, 20261101));
        assert_eq!(ready(&week.midweek).1, MWB_OCTOBER_26_DOC);
        assert_eq!(ready(&week.weekend).1, W_OCTOBER_26_DOC);
    }
}

#[test]
fn issues_carry_their_catalog_titles() {
    let week = core(true).reader().meeting_week(E, 20261007).unwrap();
    let MeetingPart::Ready { publication, .. } = &week.midweek else {
        panic!("{week:?}");
    };
    assert_eq!(publication.kind, PubKind::MeetingWorkbook);
    assert_eq!(
        publication.issue_title.as_deref(),
        Some("Life and Ministry Meeting Workbook, September-October 2026")
    );
}

#[test]
fn the_catalog_names_the_issues_to_download() {
    let reader = core(true).reader();
    // The week of November 9: neither issue is installed.
    let week = reader.meeting_week(E, 20261112).unwrap();
    assert_eq!((week.first_day, week.last_day), (20261109, 20261115));
    assert_eq!(
        not_installed(&week.midweek),
        (
            "mwb26:0:20261100",
            PubKind::MeetingWorkbook,
            Some("Life and Ministry Meeting Workbook, November-December 2026")
        )
    );
    assert_eq!(
        not_installed(&week.weekend),
        (
            "w26:0:20260900",
            PubKind::Watchtower,
            Some("The Watchtower, September 2026")
        )
    );
    // The Memorial week of 2027 has no midweek meeting: the workbook's
    // dates skip it.
    let week = reader.meeting_week(E, 20270324).unwrap();
    assert_eq!(week.midweek, MeetingPart::Unavailable);
    assert_eq!(not_installed(&week.weekend).0, "w27:0:20270100");
    // Long past every catalog row.
    let week = reader.meeting_week(E, 20400101).unwrap();
    assert_eq!(
        (week.midweek, week.weekend),
        (MeetingPart::Unavailable, MeetingPart::Unavailable)
    );
}

#[test]
fn without_a_catalog_uncovered_weeks_are_unavailable() {
    let week = core(false).reader().meeting_week(E, 20261112).unwrap();
    assert_eq!(
        week,
        MeetingWeek {
            first_day: 20261109,
            last_day: 20261115,
            midweek: MeetingPart::Unavailable,
            weekend: MeetingPart::Unavailable,
        }
    );
    // Another language has nothing installed.
    let week = core(false).reader().meeting_week(1, 20261007).unwrap();
    assert_eq!(week.midweek, MeetingPart::Unavailable);
}

#[test]
fn the_daily_text_is_the_days_blocks() {
    let reader = core(false).reader();
    let DailyTextDay::Ready { text: day } = reader.daily_text(E, 20260101).unwrap() else {
        panic!("not ready");
    };
    assert_eq!(
        (day.pub_key.as_str(), day.doc_id, day.day),
        (ES_E, ES_JANUARY_DOC, 20260101)
    );
    assert_eq!((day.first_paragraph, day.last_paragraph), (2, 4));
    assert_eq!(day.blocks.len(), 3, "{:#?}", day.blocks);
    match &day.blocks[0] {
        DocBlock::Heading {
            paragraph, inlines, ..
        } => {
            assert_eq!(*paragraph, Some(2));
            assert_eq!(text(inlines), "Thursday, January 1");
        }
        other => panic!("{other:?}"),
    }
    match &day.blocks[1] {
        DocBlock::Paragraph {
            paragraph,
            role,
            inlines,
            ..
        } => {
            assert_eq!((*paragraph, role), (3, &ParagraphRole::ThemeScripture));
            assert!(text(inlines).starts_with("Become full-grown in your understanding."));
            assert!(inlines.iter().any(|i| matches!(i, DocInline::Link { .. })));
        }
        other => panic!("{other:?}"),
    }
    match &day.blocks[2] {
        DocBlock::Paragraph {
            paragraph, inlines, ..
        } => {
            assert_eq!(*paragraph, 4);
            assert!(text(inlines).starts_with("Few events bring more joy"));
        }
        other => panic!("{other:?}"),
    }

    let DailyTextDay::Ready { text: day } = reader.daily_text(E, 20261109).unwrap() else {
        panic!("not ready");
    };
    assert_eq!(day.doc_id, ES_NOVEMBER_DOC);
    match &day.blocks[0] {
        DocBlock::Heading { inlines, .. } => assert_eq!(text(inlines), "Monday, November 9"),
        other => panic!("{other:?}"),
    }
    // Only the day: one date heading.
    let headings = day
        .blocks
        .iter()
        .filter(|b| matches!(b, DocBlock::Heading { .. }))
        .count();
    assert_eq!(headings, 1);
}

#[test]
fn the_next_years_text_comes_from_the_catalog() {
    let next = core(true).reader().daily_text(E, 20270101).unwrap();
    let DailyTextDay::NotInstalled { publication } = next else {
        panic!("{next:?}");
    };
    assert_eq!(publication.pub_key, "es27:0:0");
    assert_eq!(
        core(false).reader().daily_text(E, 20270101).unwrap(),
        DailyTextDay::Unavailable
    );
    assert_eq!(
        core(true).reader().daily_text(E, 20400101).unwrap(),
        DailyTextDay::Unavailable
    );
}

#[test]
fn days_must_be_real() {
    let reader = core(false).reader();
    for day in [0, 20261131, 2026119, -20261109] {
        assert!(
            matches!(reader.meeting_week(E, day), Err(CoreError::Invalid(_))),
            "{day}"
        );
        assert!(
            matches!(reader.daily_text(E, day), Err(CoreError::Invalid(_))),
            "{day}"
        );
    }
}
