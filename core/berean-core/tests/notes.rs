//! Rendering note bodies against a real installed publication. The fixtures
//! are not committed: run `core/scripts/fetch-fixtures.sh` to download them
//! into `core/fixtures/`.

mod common;

use berean_core::notes::{Block, Inline, LinkTarget};
use berean_core::reader::{Location, LocationSpan};
use berean_core::{CancelToken, Core};
use common::fixture;

const LL_E: &str = "ll:0:0";

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
