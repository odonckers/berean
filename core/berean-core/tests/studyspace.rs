//! Studyspace in `userData.db`: workspaces, their viewports and the cards on
//! their canvases (note, passage and excerpt), z and reading order, frame
//! and viewport bounds, reader state, and what export and reopening do with
//! the tables. Everything is
//! synthetic: no publication needs installing, and `missing` is driven by a
//! planted `installed_publication` row.

use std::io::Read;

use berean_core::reader::{Location, LocationSpan};
use berean_core::userdata::{
    CanvasItem, CardRef, Frame, ItemFrame, ItemOrder, NoteFilter, ReaderState, UserData, Viewport,
    Workspace,
};
use berean_core::{CancelToken, Core, CoreError};
use rusqlite::Connection;

struct Env {
    dir: tempfile::TempDir,
    core: Core,
}

impl Env {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let core = open(&dir);
        Env { dir, core }
    }

    fn ud(&self) -> UserData {
        self.core.userdata()
    }

    /// A second, raw connection to `userData.db`, to check rows.
    fn raw(&self) -> Connection {
        Connection::open(self.dir.path().join("data/userData.db")).unwrap()
    }

    /// Set item `item_id`'s last use to [`LONG_AGO`], straight in the file:
    /// the core stamps whole seconds, so a bump only shows from further
    /// back than that, without sleeping.
    fn backdate(&self, item_id: i64) {
        let n = self
            .raw()
            .execute(
                "UPDATE BereanCanvasItem SET LastUsedAt = ?2 WHERE ItemId = ?1",
                rusqlite::params![item_id, LONG_AGO],
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    /// Mark `pub_key` installed, as an install would, without a file.
    fn plant_installed(&self, pub_key: &str) {
        Connection::open(self.dir.path().join("data/user.sqlite"))
            .unwrap()
            .execute(
                "INSERT INTO installed_publication (pub_key, symbol, meps_language, issue_tag, \
                 year, title, publication_type, dir, installed_at) \
                 VALUES (?1, 'x', 0, 0, 2026, 'x', 'x', ?1, 0)",
                [pub_key],
            )
            .unwrap();
    }
}

fn open(dir: &tempfile::TempDir) -> Core {
    Core::open(dir.path().join("data"), dir.path().join("cache"))
        .unwrap_or_else(|e| panic!("open core: {e:?}"))
}

fn is_invalid<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::Invalid(_)))
}

fn is_not_found<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::NotFound))
}

const NWT_E: &str = "nwtsty:0:0";

/// A last use long past, for [`Env::backdate`].
const LONG_AGO: &str = "2000-01-01T00:00:00Z";
const LL_E: &str = "ll:0:0";

fn frame(x: f64, y: f64) -> Frame {
    Frame {
        x,
        y,
        width: 240.0,
        height: 160.0,
    }
}

fn verse(book: u32, chapter: u32, verse: u32) -> Location {
    Location {
        pub_key: NWT_E.into(),
        doc_id: None,
        book: Some(book),
        chapter: Some(chapter),
        verse: Some(verse),
        paragraph: None,
    }
}

fn passage(start: Location, end: Location) -> CardRef {
    CardRef::Passage {
        span: LocationSpan { start, end },
        missing: true,
    }
}

fn excerpt(doc_id: Option<i64>, paragraph: Option<u32>) -> CardRef {
    CardRef::Publication {
        location: Location {
            pub_key: LL_E.into(),
            doc_id,
            book: None,
            chapter: None,
            verse: None,
            paragraph,
        },
        missing: true,
    }
}

fn note_card(ud: &UserData, title: &str) -> CardRef {
    CardRef::Note {
        note_id: ud.add_note(title, "", None, None, None).unwrap().id,
    }
}

fn ids(items: &[CanvasItem]) -> Vec<i64> {
    items.iter().map(|i| i.id).collect()
}

fn workspace(ud: &UserData, id: i64) -> Workspace {
    ud.workspaces()
        .unwrap()
        .into_iter()
        .find(|w| w.id == id)
        .unwrap()
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

/// Whether `s` is `YYYY-MM-DDTHH:MM:SSZ`, as `Note::modified` is.
fn is_utc_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 20
        && b.iter().enumerate().all(|(i, &c)| match i {
            4 | 7 => c == b'-',
            10 => c == b'T',
            13 | 16 => c == b':',
            19 => c == b'Z',
            _ => c.is_ascii_digit(),
        })
}

fn item(ud: &UserData, ws: i64, id: i64) -> CanvasItem {
    ud.items(ws, ItemOrder::Z)
        .unwrap()
        .into_iter()
        .find(|i| i.id == id)
        .unwrap()
}

#[test]
fn workspace_crud() {
    let env = Env::new();
    let ud = env.ud();
    assert!(ud.workspaces().unwrap().is_empty());

    let a = ud.create_workspace("  Prologue study ").unwrap();
    assert_eq!(
        a,
        Workspace {
            id: a.id,
            name: "Prologue study".into(),
            viewport: None,
            item_count: 0,
        }
    );
    let b = ud.create_workspace("Acts").unwrap();
    // Creation order, not name order.
    let names: Vec<String> = ud
        .workspaces()
        .unwrap()
        .into_iter()
        .map(|w| w.name)
        .collect();
    assert_eq!(names, ["Prologue study", "Acts"]);

    // Names are trimmed, non-empty and unique ignoring case.
    assert!(is_invalid(ud.create_workspace("")));
    assert!(is_invalid(ud.create_workspace(" \t ")));
    assert!(is_invalid(ud.create_workspace("PROLOGUE study")));
    assert!(is_invalid(ud.rename_workspace(b.id, "prologue STUDY")));
    assert!(is_invalid(ud.rename_workspace(b.id, "  ")));

    // Renaming to itself, or only its case, is fine.
    ud.rename_workspace(a.id, "prologue study").unwrap();
    ud.rename_workspace(b.id, " Acts 2 ").unwrap();
    assert_eq!(workspace(&ud, a.id).name, "prologue study");
    assert_eq!(workspace(&ud, b.id).name, "Acts 2");

    ud.delete_workspace(a.id).unwrap();
    assert_eq!(ud.workspaces().unwrap(), [workspace(&ud, b.id)]);
    // The name is free again.
    ud.create_workspace("Prologue study").unwrap();
}

#[test]
fn delete_cascades_items_but_keeps_notes() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let other = ud.create_workspace("Other").unwrap();
    let card = note_card(&ud, "Word");
    ud.add_item(ws.id, &card, &frame(0.0, 0.0)).unwrap();
    ud.add_item(
        ws.id,
        &passage(verse(43, 1, 1), verse(43, 1, 5)),
        &frame(1.0, 1.0),
    )
    .unwrap();
    let kept = ud.add_item(other.id, &card, &frame(0.0, 0.0)).unwrap();
    assert_eq!(workspace(&ud, ws.id).item_count, 2);

    ud.delete_workspace(ws.id).unwrap();
    assert_eq!(count(&env.raw(), "BereanCanvasItem"), 1);
    assert_eq!(ud.items(other.id, ItemOrder::Z).unwrap(), [kept]);
    assert_eq!(ud.notes(&NoteFilter::default()).unwrap().len(), 1);
}

#[test]
fn viewport_round_trips() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    assert_eq!(workspace(&ud, ws.id).viewport, None);

    let v = Viewport {
        x: -1234.5,
        y: 0.25,
        zoom: 8.0,
    };
    ud.set_viewport(ws.id, &v).unwrap();
    assert_eq!(workspace(&ud, ws.id).viewport, Some(v));
    // No clamping: any finite zoom over 0. The centre goes to ±1e6.
    for good in [
        Viewport {
            x: 1e6,
            y: -1e6,
            zoom: 1e12,
        },
        Viewport {
            x: -1e6,
            y: 1e6,
            zoom: 64.0,
        },
    ] {
        ud.set_viewport(ws.id, &good).unwrap();
        assert_eq!(workspace(&ud, ws.id).viewport, Some(good));
    }
    let tiny = Viewport {
        x: 0.0,
        y: 0.0,
        zoom: 1e-6,
    };
    ud.set_viewport(ws.id, &tiny).unwrap();
    assert_eq!(workspace(&ud, ws.id).viewport, Some(tiny.clone()));

    for bad in [
        Viewport {
            x: 1e6 + 1.0,
            ..tiny.clone()
        },
        Viewport {
            x: -1e6 - 1.0,
            ..tiny.clone()
        },
        Viewport {
            y: 1e6 + 1.0,
            ..tiny.clone()
        },
        Viewport {
            y: -1e6 - 1.0,
            ..tiny.clone()
        },
        Viewport {
            x: f64::INFINITY,
            ..tiny.clone()
        },
        Viewport {
            y: f64::NAN,
            ..tiny.clone()
        },
        Viewport {
            zoom: f64::NEG_INFINITY,
            ..tiny.clone()
        },
        Viewport {
            zoom: 0.0,
            ..tiny.clone()
        },
        Viewport {
            zoom: -1.0,
            ..tiny.clone()
        },
        Viewport {
            zoom: f64::NAN,
            ..tiny.clone()
        },
        Viewport {
            zoom: f64::INFINITY,
            ..tiny.clone()
        },
        Viewport {
            x: f64::NAN,
            ..tiny.clone()
        },
        Viewport {
            y: f64::NEG_INFINITY,
            ..tiny.clone()
        },
    ] {
        assert!(is_invalid(ud.set_viewport(ws.id, &bad)), "{bad:?}");
    }
    assert_eq!(workspace(&ud, ws.id).viewport, Some(tiny.clone()));
    assert!(is_not_found(ud.set_viewport(ws.id + 1, &tiny)));
}

#[test]
fn each_card_kind_round_trips() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let cards = [
        note_card(&ud, "In the beginning"),
        // A verse, a verse range, a range across chapters, a chapter, and
        // a chapter range.
        passage(verse(43, 1, 1), verse(43, 1, 1)),
        passage(verse(43, 1, 1), verse(43, 1, 18)),
        passage(verse(43, 1, 51), verse(43, 2, 11)),
        passage(
            Location {
                verse: None,
                ..verse(43, 3, 1)
            },
            Location {
                verse: None,
                ..verse(43, 3, 1)
            },
        ),
        passage(
            Location {
                verse: None,
                ..verse(43, 3, 1)
            },
            Location {
                verse: None,
                ..verse(43, 4, 1)
            },
        ),
        // A publication, a document, and a paragraph.
        excerpt(None, None),
        excerpt(Some(2), None),
        excerpt(Some(2), Some(7)),
    ];
    let mut added = Vec::new();
    for (i, card) in cards.iter().enumerate() {
        let f = Frame {
            x: i as f64 * 10.5,
            y: -(i as f64),
            width: 100.0 + i as f64,
            height: 24.5,
        };
        let item = ud.add_item(ws.id, card, &f).unwrap();
        assert_eq!(
            item,
            CanvasItem {
                id: item.id,
                workspace_id: ws.id,
                card: card.clone(),
                frame: f,
                z: i as i64 + 1,
                reader: None,
                last_used_at: item.last_used_at.clone(),
            }
        );
        assert!(is_utc_timestamp(&item.last_used_at), "{item:?}");
        added.push(item);
    }
    assert_eq!(ud.items(ws.id, ItemOrder::Z).unwrap(), added);
    assert_eq!(workspace(&ud, ws.id).item_count, cards.len() as u32);

    // Passages and excerpts are stored as the URLs notes link with.
    let targets: Vec<Option<String>> = env
        .raw()
        .prepare("SELECT Target FROM BereanCanvasItem ORDER BY ItemId")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(targets[0], None);
    assert_eq!(
        targets[3].as_deref(),
        Some("berean://bible/nwtsty:0:0/43/1/51-2/11")
    );
    assert_eq!(targets[8].as_deref(), Some("berean://pub/ll:0:0/2/7"));
}

#[test]
fn bad_cards_are_invalid() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let ok = frame(0.0, 0.0);

    let bad_cards = [
        // Across books, backwards, no chapter, a paragraph, another key at
        // the end, a malformed key.
        passage(verse(43, 1, 1), verse(44, 1, 1)),
        passage(verse(43, 1, 5), verse(43, 1, 1)),
        passage(
            Location {
                chapter: None,
                verse: None,
                ..verse(43, 1, 1)
            },
            Location {
                chapter: None,
                verse: None,
                ..verse(43, 1, 1)
            },
        ),
        passage(
            Location {
                paragraph: Some(1),
                ..verse(43, 1, 1)
            },
            verse(43, 1, 1),
        ),
        passage(
            verse(43, 1, 1),
            Location {
                pub_key: "nwt:0:0".into(),
                ..verse(43, 1, 1)
            },
        ),
        passage(
            Location {
                pub_key: "nope".into(),
                ..verse(43, 1, 1)
            },
            Location {
                pub_key: "nope".into(),
                ..verse(43, 1, 1)
            },
        ),
        // A Bible location, a paragraph without a document, a bad key.
        CardRef::Publication {
            location: verse(43, 1, 1),
            missing: false,
        },
        excerpt(None, Some(3)),
        CardRef::Publication {
            location: Location {
                pub_key: "a/b:0:0".into(),
                doc_id: Some(1),
                book: None,
                chapter: None,
                verse: None,
                paragraph: None,
            },
            missing: false,
        },
    ];
    for card in &bad_cards {
        assert!(is_invalid(ud.add_item(ws.id, card, &ok)), "{card:?}");
    }

    assert!(ud.items(ws.id, ItemOrder::Z).unwrap().is_empty());
}

/// Frames just inside and just outside the bounds, each changing one field
/// of an ordinary frame.
fn frame_cases() -> (Vec<Frame>, Vec<Frame>) {
    let ok = frame(0.0, 0.0);
    let with = |f: &dyn Fn(&mut Frame)| {
        let mut frame = ok.clone();
        f(&mut frame);
        frame
    };
    let good = vec![
        with(&|f| f.width = 24.0),
        with(&|f| f.height = 24.0),
        with(&|f| f.width = 8192.0),
        with(&|f| f.height = 8192.0),
        with(&|f| f.x = 1e6),
        with(&|f| f.x = -1e6),
        with(&|f| f.y = 1e6),
        with(&|f| f.y = -1e6),
    ];
    let mut bad = vec![
        with(&|f| f.width = 23.9),
        with(&|f| f.height = 23.9),
        with(&|f| f.width = 8192.1),
        with(&|f| f.height = 8192.1),
        with(&|f| f.width = 0.0),
        with(&|f| f.height = -100.0),
        with(&|f| f.x = 1e6 + 1.0),
        with(&|f| f.x = -1e6 - 1.0),
        with(&|f| f.y = 1e6 + 1.0),
        with(&|f| f.y = -1e6 - 1.0),
    ];
    for v in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        bad.push(with(&|f| f.x = v));
        bad.push(with(&|f| f.y = v));
        bad.push(with(&|f| f.width = v));
        bad.push(with(&|f| f.height = v));
    }
    (good, bad)
}

#[test]
fn add_item_checks_frame_bounds() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let card = excerpt(Some(1), None);
    let (good, bad) = frame_cases();
    for f in &bad {
        assert!(is_invalid(ud.add_item(ws.id, &card, f)), "{f:?}");
    }
    assert!(ud.items(ws.id, ItemOrder::Z).unwrap().is_empty());
    for f in &good {
        assert_eq!(&ud.add_item(ws.id, &card, f).unwrap().frame, f);
    }
}

#[test]
fn set_frames_checks_frame_bounds() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let item = ud
        .add_item(ws.id, &excerpt(Some(1), None), &frame(5.0, 5.0))
        .unwrap();
    let (good, bad) = frame_cases();
    for f in bad {
        let r = ud.set_frames(&[ItemFrame {
            id: item.id,
            frame: f.clone(),
        }]);
        assert!(is_invalid(r), "{f:?}");
    }
    assert_eq!(
        ud.items(ws.id, ItemOrder::Z).unwrap(),
        std::slice::from_ref(&item)
    );
    for f in good {
        ud.set_frames(&[ItemFrame {
            id: item.id,
            frame: f.clone(),
        }])
        .unwrap();
        assert_eq!(ud.items(ws.id, ItemOrder::Z).unwrap()[0].frame, f);
    }
}

#[test]
fn not_found_cases() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let item = ud
        .add_item(ws.id, &excerpt(Some(1), None), &frame(0.0, 0.0))
        .unwrap();
    let gone = ws.id + 100;
    let no_item = item.id + 100;

    assert!(is_not_found(ud.rename_workspace(gone, "x")));
    assert!(is_not_found(ud.delete_workspace(gone)));
    assert!(is_not_found(ud.items(gone, ItemOrder::Reading)));
    assert!(is_not_found(ud.add_item(
        gone,
        &excerpt(Some(1), None),
        &frame(0.0, 0.0)
    )));
    let unknown_note = CardRef::Note {
        note_id: "00000000-0000-4000-8000-000000000000".into(),
    };
    assert!(is_not_found(ud.add_item(
        ws.id,
        &unknown_note,
        &frame(0.0, 0.0)
    )));
    assert!(is_not_found(ud.bring_to_front(no_item)));
    assert!(is_not_found(ud.touch_item(no_item)));
    assert!(is_not_found(ud.remove_item(no_item)));
    assert!(is_not_found(ud.set_frames(&[ItemFrame {
        id: no_item,
        frame: frame(0.0, 0.0),
    }])));

    ud.remove_item(item.id).unwrap();
    assert!(is_not_found(ud.remove_item(item.id)));
}

#[test]
fn add_item_lands_on_top_and_bring_to_front() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let other = ud.create_workspace("Other").unwrap();
    let add = |ws: i64, doc| {
        ud.add_item(ws, &excerpt(Some(doc), None), &frame(0.0, 0.0))
            .unwrap()
    };
    let a = add(ws.id, 1);
    let b = add(ws.id, 2);
    let c = add(ws.id, 3);
    assert_eq!((a.z, b.z, c.z), (1, 2, 3));
    // Z is per workspace.
    assert_eq!(add(other.id, 1).z, 1);

    assert_eq!(ud.bring_to_front(a.id).unwrap(), 4);
    assert_eq!(
        ids(&ud.items(ws.id, ItemOrder::Z).unwrap()),
        [b.id, c.id, a.id]
    );
    // Gaps are kept, not renumbered.
    ud.remove_item(c.id).unwrap();
    assert_eq!(ud.bring_to_front(b.id).unwrap(), 5);
    let zs: Vec<i64> = ud
        .items(ws.id, ItemOrder::Z)
        .unwrap()
        .iter()
        .map(|i| i.z)
        .collect();
    assert_eq!(zs, [4, 5]);
    assert_eq!(add(ws.id, 4).z, 6);
    assert_eq!(ud.items(other.id, ItemOrder::Z).unwrap()[0].z, 1);
}

#[test]
fn reading_order_versus_z_order() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let add = |doc, x, y| {
        ud.add_item(ws.id, &excerpt(Some(doc), None), &frame(x, y))
            .unwrap()
    };
    // Added bottom-right first; read top to bottom, then left to right.
    let a = add(1, 300.0, 500.0);
    let b = add(2, 0.0, 500.0);
    let c = add(3, 50.0, -20.0);
    let d = add(4, 50.0, -20.0);
    assert_eq!(
        ids(&ud.items(ws.id, ItemOrder::Z).unwrap()),
        [a.id, b.id, c.id, d.id]
    );
    assert_eq!(
        ids(&ud.items(ws.id, ItemOrder::Reading).unwrap()),
        [c.id, d.id, b.id, a.id]
    );
}

#[test]
fn set_frames_is_all_or_nothing() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let a = ud
        .add_item(ws.id, &excerpt(Some(1), None), &frame(0.0, 0.0))
        .unwrap();
    let b = ud
        .add_item(ws.id, &excerpt(Some(2), None), &frame(10.0, 10.0))
        .unwrap();
    let before = ud.items(ws.id, ItemOrder::Z).unwrap();

    // Empty is a no-op.
    ud.set_frames(&[]).unwrap();
    assert_eq!(ud.items(ws.id, ItemOrder::Z).unwrap(), before);

    let moved = |id, x| ItemFrame {
        id,
        frame: frame(x, x),
    };
    // One unknown id, last: nothing moves.
    assert!(is_not_found(ud.set_frames(&[
        moved(a.id, 100.0),
        moved(b.id, 200.0),
        moved(b.id + 50, 300.0),
    ])));
    assert_eq!(ud.items(ws.id, ItemOrder::Z).unwrap(), before);
    // One bad frame: nothing moves.
    assert!(is_invalid(ud.set_frames(&[
        moved(a.id, 100.0),
        ItemFrame {
            id: b.id,
            frame: Frame {
                height: 0.0,
                ..frame(0.0, 0.0)
            },
        },
    ])));
    assert!(is_invalid(ud.set_frames(&[ItemFrame {
        id: a.id,
        frame: frame(f64::NAN, 0.0),
    }])));
    assert_eq!(ud.items(ws.id, ItemOrder::Z).unwrap(), before);

    // A selection drag moves them all; z is unchanged.
    let resized = Frame {
        x: -5.5,
        y: 7.25,
        width: 400.0,
        height: 90.0,
    };
    ud.set_frames(&[
        ItemFrame {
            id: a.id,
            frame: resized.clone(),
        },
        moved(b.id, 200.0),
    ])
    .unwrap();
    let after = ud.items(ws.id, ItemOrder::Z).unwrap();
    assert_eq!(after[0].frame, resized);
    assert_eq!(after[1].frame, frame(200.0, 200.0));
    assert_eq!((after[0].z, after[1].z), (a.z, b.z));
}

#[test]
fn remove_note_drops_its_cards() {
    let env = Env::new();
    let ud = env.ud();
    let a = ud.create_workspace("A").unwrap();
    let b = ud.create_workspace("B").unwrap();
    let card = note_card(&ud, "Word");
    let CardRef::Note { note_id } = &card else {
        unreachable!()
    };
    // The same note on two workspaces is fine; twice on one isn't.
    ud.add_item(a.id, &card, &frame(0.0, 0.0)).unwrap();
    ud.add_item(b.id, &card, &frame(0.0, 0.0)).unwrap();
    assert!(is_invalid(ud.add_item(a.id, &card, &frame(5.0, 5.0))));
    let stays = ud
        .add_item(a.id, &excerpt(Some(1), None), &frame(0.0, 0.0))
        .unwrap();

    // Removing the card keeps the note, and it can go back on.
    let on_b = ud.items(b.id, ItemOrder::Z).unwrap()[0].id;
    ud.remove_item(on_b).unwrap();
    assert_eq!(ud.notes(&NoteFilter::default()).unwrap().len(), 1);
    ud.add_item(b.id, &card, &frame(0.0, 0.0)).unwrap();

    ud.remove_note(note_id).unwrap();
    assert_eq!(ud.items(a.id, ItemOrder::Z).unwrap(), [stays]);
    assert!(ud.items(b.id, ItemOrder::Z).unwrap().is_empty());
    assert_eq!(workspace(&ud, b.id).item_count, 0);
}

#[test]
fn missing_follows_what_is_installed() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let p = passage(verse(43, 1, 1), verse(43, 1, 3));
    let x = excerpt(Some(2), Some(1));
    let note = note_card(&ud, "Word");
    for card in [&p, &x, &note] {
        ud.add_item(ws.id, card, &frame(0.0, 0.0)).unwrap();
    }
    let missing = |ud: &UserData| -> Vec<Option<bool>> {
        ud.items(ws.id, ItemOrder::Z)
            .unwrap()
            .into_iter()
            .map(|i| match i.card {
                CardRef::Note { .. } => None,
                CardRef::Passage { missing, .. } | CardRef::Publication { missing, .. } => {
                    Some(missing)
                }
            })
            .collect()
    };
    assert_eq!(missing(&ud), [Some(true), Some(true), None]);

    env.plant_installed(LL_E);
    assert_eq!(missing(&ud), [Some(true), Some(false), None]);
    // `missing` on input is ignored; the returned card says what's true.
    let item = ud
        .add_item(
            ws.id,
            &CardRef::Publication {
                location: Location {
                    pub_key: NWT_E.into(),
                    doc_id: Some(1),
                    book: None,
                    chapter: None,
                    verse: None,
                    paragraph: None,
                },
                missing: false,
            },
            &frame(0.0, 0.0),
        )
        .unwrap();
    assert!(matches!(
        item.card,
        CardRef::Publication { missing: true, .. }
    ));

    env.plant_installed(NWT_E);
    assert_eq!(missing(&ud), [Some(false), Some(false), None, Some(false)]);
}

fn read_at(at: CardRef, char_offset: u32) -> ReaderState {
    ReaderState { at, char_offset }
}

/// The reader state of item `id` on workspace `ws`.
fn reader_of(ud: &UserData, ws: i64, id: i64) -> Option<ReaderState> {
    ud.items(ws, ItemOrder::Z)
        .unwrap()
        .into_iter()
        .find(|i| i.id == id)
        .unwrap()
        .reader
}

fn one_verse(book: u32, chapter: u32, v: u32) -> CardRef {
    passage(verse(book, chapter, v), verse(book, chapter, v))
}

#[test]
fn reader_state_round_trips_for_each_kind() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let bible = ud
        .add_item(
            ws.id,
            &passage(verse(43, 1, 1), verse(43, 1, 18)),
            &frame(0.0, 0.0),
        )
        .unwrap();
    let publication = ud
        .add_item(ws.id, &excerpt(Some(2), Some(7)), &frame(300.0, 0.0))
        .unwrap();
    // Never scrolled: no state.
    assert_eq!(bible.reader, None);
    assert_eq!(reader_of(&ud, ws.id, publication.id), None);

    // Another book and chapter of the same Bible; another document of the
    // same publication. `missing` on input is ignored.
    let at_bible = read_at(
        CardRef::Passage {
            span: LocationSpan {
                start: verse(45, 8, 28),
                end: verse(45, 8, 28),
            },
            missing: false,
        },
        u32::MAX,
    );
    let at_pub = read_at(excerpt(Some(9), Some(0)), 0);
    ud.set_reader_state(bible.id, &at_bible).unwrap();
    ud.set_reader_state(publication.id, &at_pub).unwrap();
    assert_eq!(
        reader_of(&ud, ws.id, bible.id),
        Some(read_at(one_verse(45, 8, 28), u32::MAX))
    );
    assert_eq!(reader_of(&ud, ws.id, publication.id), Some(at_pub));
    // The origin is kept.
    let items = ud.items(ws.id, ItemOrder::Z).unwrap();
    assert_eq!(items[0].card, bible.card);
    assert_eq!(items[1].card, publication.card);

    // Stored as the URLs cards use; `missing` follows what is installed.
    let raw: (String, i64) = env
        .raw()
        .query_row(
            "SELECT ReaderAt, ReaderCharOffset FROM BereanCanvasItem WHERE ItemId = ?1",
            [publication.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(raw, ("berean://pub/ll:0:0/9/0".into(), 0));
    env.plant_installed(NWT_E);
    assert!(matches!(
        reader_of(&ud, ws.id, bible.id).unwrap().at,
        CardRef::Passage { missing: false, .. }
    ));

    // A later state replaces the earlier one.
    let later = read_at(one_verse(43, 21, 25), 3);
    ud.set_reader_state(bible.id, &later).unwrap();
    assert_eq!(
        reader_of(&ud, ws.id, bible.id),
        Some(read_at(
            CardRef::Passage {
                span: LocationSpan {
                    start: verse(43, 21, 25),
                    end: verse(43, 21, 25),
                },
                missing: false,
            },
            3
        ))
    );
}

#[test]
fn reader_states_are_per_card() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let other = ud.create_workspace("Other").unwrap();
    let a = ud
        .add_item(ws.id, &excerpt(Some(2), None), &frame(0.0, 0.0))
        .unwrap();
    let b = ud
        .add_item(ws.id, &excerpt(Some(2), None), &frame(300.0, 0.0))
        .unwrap();
    let c = ud
        .add_item(other.id, &excerpt(Some(2), None), &frame(0.0, 0.0))
        .unwrap();
    ud.set_reader_state(a.id, &read_at(excerpt(Some(2), Some(1)), 5))
        .unwrap();
    ud.set_reader_state(b.id, &read_at(excerpt(Some(4), Some(9)), 50))
        .unwrap();
    assert_eq!(
        reader_of(&ud, ws.id, a.id),
        Some(read_at(excerpt(Some(2), Some(1)), 5))
    );
    assert_eq!(
        reader_of(&ud, ws.id, b.id),
        Some(read_at(excerpt(Some(4), Some(9)), 50))
    );
    assert_eq!(reader_of(&ud, other.id, c.id), None);
}

#[test]
fn set_reader_state_touches_nothing_else() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let a = ud
        .add_item(ws.id, &one_verse(43, 1, 1), &frame(10.0, 20.0))
        .unwrap();
    let b = ud
        .add_item(ws.id, &excerpt(Some(1), None), &frame(30.0, 40.0))
        .unwrap();
    ud.set_viewport(
        ws.id,
        &Viewport {
            x: 1.0,
            y: 2.0,
            zoom: 3.0,
        },
    )
    .unwrap();
    env.backdate(a.id);
    let before = ud.items(ws.id, ItemOrder::Z).unwrap();
    let workspaces = ud.workspaces().unwrap();

    // `a`, under `b`, stays under it; only its last use moves on.
    let state = read_at(one_verse(43, 1, 2), 9);
    ud.set_reader_state(a.id, &state).unwrap();
    let after = ud.items(ws.id, ItemOrder::Z).unwrap();
    assert_eq!(ids(&after), [a.id, b.id]);
    assert!(is_utc_timestamp(&after[0].last_used_at));
    assert!(after[0].last_used_at.as_str() > LONG_AGO, "{after:?}");
    assert_eq!(
        after,
        [
            CanvasItem {
                reader: Some(state),
                last_used_at: after[0].last_used_at.clone(),
                ..before[0].clone()
            },
            before[1].clone(),
        ]
    );
    assert_eq!(ud.workspaces().unwrap(), workspaces);
}

#[test]
fn touch_item_bumps_only_last_use() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let a = ud
        .add_item(ws.id, &note_card(&ud, "Logos"), &frame(10.0, 20.0))
        .unwrap();
    let b = ud
        .add_item(ws.id, &excerpt(Some(1), None), &frame(30.0, 40.0))
        .unwrap();
    ud.set_reader_state(b.id, &read_at(excerpt(Some(1), Some(3)), 4))
        .unwrap();
    env.backdate(a.id);
    env.backdate(b.id);
    let before = ud.items(ws.id, ItemOrder::Z).unwrap();
    assert!(before.iter().all(|i| i.last_used_at == LONG_AGO));
    let workspaces = ud.workspaces().unwrap();

    // Touching `a`, under `b`, leaves it under: z, frame, card and `b`
    // are as they were.
    ud.touch_item(a.id).unwrap();
    let after = ud.items(ws.id, ItemOrder::Z).unwrap();
    assert_eq!(ids(&after), [a.id, b.id]);
    assert!(is_utc_timestamp(&after[0].last_used_at));
    assert!(after[0].last_used_at.as_str() > LONG_AGO, "{after:?}");
    assert_eq!(
        after,
        [
            CanvasItem {
                last_used_at: after[0].last_used_at.clone(),
                ..before[0].clone()
            },
            before[1].clone(),
        ]
    );
    assert_eq!(ud.workspaces().unwrap(), workspaces);

    // A reader card keeps its reader state.
    ud.touch_item(b.id).unwrap();
    let touched = item(&ud, ws.id, b.id);
    assert!(touched.last_used_at.as_str() > LONG_AGO);
    assert_eq!(
        touched,
        CanvasItem {
            last_used_at: touched.last_used_at.clone(),
            ..before[1].clone()
        }
    );

    assert!(is_not_found(ud.touch_item(b.id + 100)));
    ud.remove_item(a.id).unwrap();
    assert!(is_not_found(ud.touch_item(a.id)));
}

#[test]
fn bad_reader_states_are_invalid() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let note = ud
        .add_item(ws.id, &note_card(&ud, "Word"), &frame(0.0, 0.0))
        .unwrap();
    let bible = ud
        .add_item(ws.id, &one_verse(43, 1, 1), &frame(0.0, 0.0))
        .unwrap();
    let publication = ud
        .add_item(ws.id, &excerpt(Some(2), Some(3)), &frame(0.0, 0.0))
        .unwrap();
    let nwt_pub = |key: &str, doc_id: Option<i64>, paragraph: Option<u32>| CardRef::Publication {
        location: Location {
            pub_key: key.into(),
            doc_id,
            book: None,
            chapter: None,
            verse: None,
            paragraph,
        },
        missing: true,
    };
    let prefixed = ud
        .add_item(ws.id, &nwt_pub("nwtsty:0:0", None, None), &frame(0.0, 0.0))
        .unwrap();
    let in_other_bible = |key: &str| {
        let at = Location {
            pub_key: key.into(),
            ..verse(43, 1, 2)
        };
        passage(at.clone(), at)
    };
    // Cards whose URL starts with another key's URL: `nwtsty:0:1` must not
    // match `nwtsty:0:10`.
    let long_pub = ud
        .add_item(
            ws.id,
            &nwt_pub("nwtsty:0:10", Some(1), None),
            &frame(0.0, 0.0),
        )
        .unwrap();
    let long_bible = ud
        .add_item(ws.id, &in_other_bible("nwtsty:0:10"), &frame(0.0, 0.0))
        .unwrap();
    let ok_bible = read_at(one_verse(43, 1, 2), 0);
    let ok_pub = read_at(excerpt(Some(2), Some(4)), 0);

    let cases: Vec<(i64, ReaderState)> = vec![
        // A note card can't read.
        (note.id, ok_bible.clone()),
        (note.id, ok_pub.clone()),
        // A note `at`.
        (
            bible.id,
            read_at(
                CardRef::Note {
                    note_id: "00000000-0000-4000-8000-000000000000".into(),
                },
                0,
            ),
        ),
        // Kind mismatches.
        (bible.id, ok_pub.clone()),
        (publication.id, ok_bible.clone()),
        // Another Bible, another publication.
        (bible.id, read_at(in_other_bible("nwt:0:0"), 0)),
        (bible.id, read_at(in_other_bible("nwtsty:1:0"), 0)),
        (
            publication.id,
            read_at(nwt_pub("it:0:0", Some(2), Some(4)), 0),
        ),
        (
            prefixed.id,
            read_at(nwt_pub("nwt:0:0", Some(1), Some(1)), 0),
        ),
        (
            prefixed.id,
            read_at(nwt_pub("nwtsty:0:01", Some(1), Some(1)), 0),
        ),
        (
            long_pub.id,
            read_at(nwt_pub("nwtsty:0:1", Some(1), Some(1)), 0),
        ),
        (long_bible.id, read_at(in_other_bible("nwtsty:0:1"), 0)),
        // Not one verse: a range, across chapters, a whole chapter.
        (
            bible.id,
            read_at(passage(verse(43, 1, 1), verse(43, 1, 2)), 0),
        ),
        (
            bible.id,
            read_at(passage(verse(43, 1, 51), verse(43, 2, 1)), 0),
        ),
        (
            bible.id,
            read_at(
                passage(
                    Location {
                        verse: None,
                        ..verse(43, 2, 1)
                    },
                    Location {
                        verse: None,
                        ..verse(43, 2, 1)
                    },
                ),
                0,
            ),
        ),
        // No paragraph: a whole publication or document.
        (publication.id, read_at(excerpt(None, None), 0)),
        (publication.id, read_at(excerpt(Some(2), None), 0)),
        // What the URL builders reject: book 0, a paragraph without a
        // document, a bad key.
        (bible.id, read_at(one_verse(0, 1, 1), 0)),
        (publication.id, read_at(excerpt(None, Some(4)), 0)),
        (
            publication.id,
            read_at(nwt_pub("a/b:0:0", Some(1), Some(1)), 0),
        ),
    ];
    for (id, state) in &cases {
        assert!(
            is_invalid(ud.set_reader_state(*id, state)),
            "{id}: {state:?}"
        );
    }
    let raw: i64 = env
        .raw()
        .query_row(
            "SELECT COUNT(*) FROM BereanCanvasItem WHERE ReaderAt IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, 0);

    // The nwtsty publication card reads nwtsty documents.
    ud.set_reader_state(
        prefixed.id,
        &read_at(nwt_pub("nwtsty:0:0", Some(5), Some(1)), 2),
    )
    .unwrap();
    ud.set_reader_state(
        long_pub.id,
        &read_at(nwt_pub("nwtsty:0:10", Some(2), Some(1)), 0),
    )
    .unwrap();
    ud.set_reader_state(long_bible.id, &read_at(in_other_bible("nwtsty:0:10"), 0))
        .unwrap();
    assert!(is_not_found(
        ud.set_reader_state(publication.id + 100, &ok_pub)
    ));
}

#[test]
fn removing_an_item_takes_its_reader_state() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let item = ud
        .add_item(ws.id, &excerpt(Some(1), None), &frame(0.0, 0.0))
        .unwrap();
    let state = read_at(excerpt(Some(1), Some(2)), 7);
    ud.set_reader_state(item.id, &state).unwrap();
    ud.remove_item(item.id).unwrap();
    assert_eq!(count(&env.raw(), "BereanCanvasItem"), 0);
    assert!(is_not_found(ud.set_reader_state(item.id, &state)));
    // A new card on the same publication starts fresh.
    let again = ud
        .add_item(ws.id, &excerpt(Some(1), None), &frame(0.0, 0.0))
        .unwrap();
    assert_eq!(again.reader, None);
}

/// `cargo test --release -p berean-core --test studyspace time_1000 --
/// --ignored --nocapture`
#[test]
#[ignore]
fn time_1000_set_reader_state() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    for i in 0..50 {
        ud.add_item(ws.id, &excerpt(Some(i), None), &frame(0.0, 0.0))
            .unwrap();
    }
    let item = ud
        .add_item(
            ws.id,
            &passage(verse(43, 1, 1), verse(43, 1, 18)),
            &frame(0.0, 0.0),
        )
        .unwrap();
    let states: Vec<ReaderState> = (0..1000u32)
        .map(|i| read_at(one_verse(43, 1 + i / 50, 1 + i % 50), i * 7))
        .collect();
    let start = std::time::Instant::now();
    for state in &states {
        ud.set_reader_state(item.id, state).unwrap();
    }
    let total = start.elapsed();
    eprintln!(
        "1000 set_reader_state calls: {total:?} total, {:?} per call",
        total / 1000
    );
    assert_eq!(reader_of(&ud, ws.id, item.id), Some(states[999].clone()));
}

/// The members of the zip at `path`, by name.
fn zip_member(path: &std::path::Path, name: &str) -> Vec<u8> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut bytes = Vec::new();
    zip.by_name(name).unwrap().read_to_end(&mut bytes).unwrap();
    bytes
}

fn names(conn: &Connection) -> Vec<(String, String)> {
    let mut names: Vec<(String, String)> = conn
        .prepare("SELECT type, name FROM sqlite_master")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    names.sort();
    names
}

#[test]
fn export_leaves_studyspace_out() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    ud.set_viewport(
        ws.id,
        &Viewport {
            x: 1.0,
            y: 2.0,
            zoom: 1.5,
        },
    )
    .unwrap();
    ud.add_item(ws.id, &note_card(&ud, "Word"), &frame(0.0, 0.0))
        .unwrap();
    let reader = ud
        .add_item(ws.id, &excerpt(Some(1), Some(2)), &frame(9.0, 9.0))
        .unwrap();
    ud.set_reader_state(reader.id, &read_at(excerpt(Some(3), Some(4)), 12))
        .unwrap();
    let folder = ud.create_folder("Gospels", None).unwrap();
    ud.add_note("Filed", "", None, None, Some(folder.id))
        .unwrap();

    let out_dir = tempfile::tempdir().unwrap();
    let out = out_dir.path().join("backup.jwlibrary");
    ud.export_backup(&out, &|_, _| {}, &CancelToken::new())
        .unwrap();
    let db = out_dir.path().join("userData.db");
    std::fs::write(&db, zip_member(&out, "userData.db")).unwrap();
    let conn = Connection::open(&db).unwrap();

    let exported = names(&conn);
    assert!(
        !exported
            .iter()
            .any(|(_, n)| n.contains("Berean") || n == "sqlite_sequence"),
        "{exported:?}"
    );
    // Exactly JW's v16 schema.
    let vendored = Connection::open_in_memory().unwrap();
    vendored
        .execute_batch(include_str!("../src/userdata_v16.sql"))
        .unwrap();
    assert_eq!(exported, names(&vendored));
    let version: u32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 16);
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    assert_eq!(count(&conn, "Note"), 2);

    // The live data keeps its workspace.
    assert_eq!(workspace(&ud, ws.id).item_count, 2);
}

#[test]
fn reopening_is_idempotent() {
    let env = Env::new();
    let ud = env.ud();
    let ws = ud.create_workspace("John").unwrap();
    let v = Viewport {
        x: 3.0,
        y: 4.0,
        zoom: 2.0,
    };
    ud.set_viewport(ws.id, &v).unwrap();
    ud.add_item(ws.id, &note_card(&ud, "Word"), &frame(0.0, 0.0))
        .unwrap();
    let reader = ud
        .add_item(
            ws.id,
            &passage(verse(43, 1, 1), verse(43, 1, 1)),
            &frame(1.0, 2.0),
        )
        .unwrap();
    ud.set_reader_state(
        reader.id,
        &read_at(passage(verse(43, 3, 16), verse(43, 3, 16)), 40),
    )
    .unwrap();
    let workspaces = ud.workspaces().unwrap();
    let items = ud.items(ws.id, ItemOrder::Z).unwrap();
    assert!(items[1].reader.is_some());
    let schema = names(&env.raw());
    drop(ud);

    let Env { dir, core } = env;
    drop(core);
    for _ in 0..2 {
        let ud = open(&dir).userdata();
        assert_eq!(ud.workspaces().unwrap(), workspaces);
        assert_eq!(ud.items(ws.id, ItemOrder::Z).unwrap(), items);
        let raw = Connection::open(dir.path().join("data/userData.db")).unwrap();
        assert_eq!(names(&raw), schema);
    }
}
