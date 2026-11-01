//! Reading one note by id, and rendering note bodies against a real
//! installed publication. The fixtures are not committed: run
//! `core/scripts/fetch-fixtures.sh` to download them into `core/fixtures/`.

mod common;

use berean_core::notes::{Block, Inline, LinkTarget};
use berean_core::reader::{Location, LocationSpan};
use berean_core::userdata::{HighlightColor, Note, NoteFilter, TextRange, UserData};
use berean_core::{CancelToken, Core};
use common::fixture;

const LL_E: &str = "ll:0:0";

/// A fresh core in `dir`.
fn core_in(dir: &tempfile::TempDir) -> Core {
    Core::open(dir.path().join("data"), dir.path().join("cache")).unwrap()
}

/// The entry for `id` among every note `notes` lists.
fn listed(ud: &UserData, id: &str) -> Note {
    ud.notes(&NoteFilter::default())
        .unwrap()
        .into_iter()
        .find(|n| n.id == id)
        .unwrap()
}

#[test]
fn note_matches_its_entry_in_notes() {
    let dir = tempfile::tempdir().unwrap();
    let ud = core_in(&dir).userdata();
    let at = Location {
        pub_key: "w26:0:20260800".into(),
        doc_id: Some(7),
        book: None,
        chapter: None,
        verse: None,
        paragraph: Some(2),
    };
    let h = ud
        .add_highlight(
            &TextRange {
                span: LocationSpan {
                    start: at.clone(),
                    end: at.clone(),
                },
                start_token: Some(1),
                end_token: Some(6),
            },
            HighlightColor::Blue,
        )
        .unwrap();
    let folder = ud.create_folder("Gospels", None).unwrap();
    let marked = ud
        .add_note("On it", "See #study", Some(&at), Some(&h.id), None)
        .unwrap();
    let tag = ud.add_tag("Extra").unwrap();
    ud.tag_note(&marked.id, tag.id).unwrap();
    let filed = ud
        .add_note("Filed", "", None, None, Some(folder.id))
        .unwrap();
    let free = ud.add_note("Free", "", None, None, None).unwrap();

    let read = ud.note(&marked.id).unwrap().unwrap();
    assert_eq!(read, listed(&ud, &marked.id));
    assert_eq!(read.location, Some(at));
    assert_eq!(read.highlight_id, Some(h.id));
    assert_eq!(read.tag_ids.len(), 2);
    let read = ud.note(&filed.id).unwrap().unwrap();
    assert_eq!(read, listed(&ud, &filed.id));
    assert_eq!(read.folder_id, Some(folder.id));
    let read = ud.note(&free.id).unwrap().unwrap();
    assert_eq!(read, listed(&ud, &free.id));
    assert_eq!((read.location, read.folder_id), (None, None));
}

#[test]
fn note_of_an_unknown_guid_is_none() {
    let dir = tempfile::tempdir().unwrap();
    let ud = core_in(&dir).userdata();
    ud.add_note("Kept", "", None, None, None).unwrap();
    assert_eq!(ud.note("no-such-guid").unwrap(), None);
}

#[test]
fn removed_note_is_none() {
    let dir = tempfile::tempdir().unwrap();
    let ud = core_in(&dir).userdata();
    let note = ud.add_note("Gone", "", None, None, None).unwrap();
    assert!(ud.note(&note.id).unwrap().is_some());
    ud.remove_note(&note.id).unwrap();
    assert_eq!(ud.note(&note.id).unwrap(), None);
}

#[test]
fn render_markdown_flags_links_to_publications_not_installed() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(dir.path().join("data"), dir.path().join("cache")).unwrap();
    let ud = core.userdata();
    let markdown = "[John 1:9](berean://bible/nwtsty:0:0/43/1/9)\n\n\
                    See [the brochure](berean://pub/ll:0:0/2).";
    let render = || ud.render_markdown(markdown).unwrap();
    let publication = |missing| Block::Paragraph {
        inlines: vec![
            Inline::Text {
                text: "See ".into(),
            },
            Inline::Link {
                children: vec![Inline::Text {
                    text: "the brochure".into(),
                }],
                url: "berean://pub/ll:0:0/2".into(),
                target: LinkTarget::Publication {
                    location: Location {
                        pub_key: LL_E.into(),
                        doc_id: Some(2),
                        book: None,
                        chapter: None,
                        verse: None,
                        paragraph: None,
                    },
                    missing,
                },
            },
            Inline::Text { text: ".".into() },
        ],
    };
    let john = Location {
        pub_key: "nwtsty:0:0".into(),
        doc_id: None,
        book: Some(43),
        chapter: Some(1),
        verse: Some(9),
        paragraph: None,
    };
    let card = Block::PassageCard {
        text: "John 1:9".into(),
        span: LocationSpan {
            start: john.clone(),
            end: john,
        },
        missing: true,
    };

    assert_eq!(render(), [card.clone(), publication(true)]);

    core.library()
        .install(LL_E, fixture("ll_E.jwpub"), &|_, _| {}, &CancelToken::new())
        .unwrap();
    // The installed brochure is no longer missing; the Bible still is.
    assert_eq!(render(), [card, publication(false)]);
}
