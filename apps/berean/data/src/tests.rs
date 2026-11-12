//! The data crate over the real core. The fixture tests read the pinned
//! Study Bible (core/scripts/fixtures.txt): `core/scripts/fetch-fixtures.sh`
//! downloads it. Without it they skip, unless `BEREAN_REQUIRE_FIXTURE` is
//! set, as CI sets it.

use std::path::{Path, PathBuf};

use super::*;

const JOHN: u32 = 43;

fn fixture() -> Option<PathBuf> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../core/fixtures/nwtsty_E.jwpub");
    if path.exists() {
        return Some(path);
    }
    assert!(
        std::env::var_os("BEREAN_REQUIRE_FIXTURE").is_none(),
        "{} is missing; run core/scripts/fetch-fixtures.sh",
        path.display()
    );
    eprintln!("skipped: {} is missing", path.display());
    None
}

/// A Berean over fresh data and cache directories, with `jwpub` waiting in
/// its inbox the way CI leaves the fixture for the app.
fn berean_with(name: &str, jwpub: Option<&Path>) -> (Berean, PathBuf) {
    let root = std::env::temp_dir().join(format!("berean-data-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (data, cache) = (root.join("data"), root.join("cache"));
    std::fs::create_dir_all(data.join("inbox")).unwrap();
    std::fs::create_dir_all(&cache).unwrap();
    if let Some(jwpub) = jwpub {
        std::fs::copy(jwpub, data.join("inbox/nwtsty_E.jwpub")).unwrap();
    }
    let mut berean = Berean::default();
    berean
        .configure_storage(data, cache, root.join("tmp"))
        .unwrap();
    (berean, root)
}

fn fields(value: &Value) -> &[Value] {
    match value {
        Value::Record(items) | Value::List(items) => items.as_slice(),
        other => panic!("not a record or list: {other:?}"),
    }
}

fn text(value: &Value) -> &str {
    value
        .as_str()
        .unwrap_or_else(|| panic!("not text: {value:?}"))
}

/// Every run of a chapter value: (text, verse, label, mark).
fn runs(chapter: &Value) -> Vec<(String, u32, bool, String)> {
    let mut out = Vec::new();
    for para in fields(&fields(chapter)[5]) {
        for run in fields(&fields(para)[2]) {
            let f = fields(run);
            out.push((
                text(&f[1]).to_string(),
                f[2].as_number().unwrap() as u32,
                f[3].as_bool().unwrap(),
                text(&f[4]).to_string(),
            ));
        }
    }
    out
}

#[test]
fn long_word_finds_the_first_word_over_six_letters() {
    let text = "For God loved the world so much ";
    assert_eq!(long_word(text), None);
    let text = "In the beginning was the Word ";
    let (start, end) = long_word(text).unwrap();
    assert_eq!(&text[start..end], "beginning");
}

#[test]
fn no_storage_says_so() {
    let mut berean = Berean::default();
    let shelf = berean.library();
    assert_eq!(
        text(&fields(&shelf)[0]),
        "This build has no storage to read publications from."
    );
    let chapter = berean.bible_chapter("nwtsty:0:0", JOHN, 3);
    assert_eq!(text(&fields(&chapter)[1]), "No storage in this build.");
}

#[test]
fn an_empty_library_says_nothing_is_installed() {
    let (mut berean, root) = berean_with("empty", None);
    let shelf = berean.library();
    assert_eq!(
        text(&fields(&shelf)[0]),
        "No publications are installed yet."
    );
    assert!(fields(&fields(&shelf)[1]).is_empty());
    let chapter = berean.bible_chapter("nwtsty:0:0", JOHN, 3);
    assert!(text(&fields(&chapter)[1]).starts_with("This publication is not a Bible"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_study_bible_installs_from_the_inbox_and_reads() {
    let Some(jwpub) = fixture() else { return };
    let (mut berean, root) = berean_with("bible", Some(&jwpub));

    let shelf = berean.library();
    assert_eq!(text(&fields(&shelf)[0]), "");
    let pubs = fields(&fields(&shelf)[1]);
    let bible = pubs
        .iter()
        .map(fields)
        .find(|p| text(&p[1]) == "nwtsty")
        .expect("the Study Bible is in the Library");
    assert_eq!(bible[5].as_bool(), Some(true));
    assert_eq!(text(&bible[3]), "Bible");
    assert!(
        !root.join("data/inbox/nwtsty_E.jwpub").exists(),
        "the inbox is emptied once the file is installed"
    );
    let key = text(&bible[0]).to_string();

    let chapter = berean.bible_chapter(&key, JOHN, 3);
    let f = fields(&chapter);
    assert_eq!(text(&f[1]), "", "no message on a chapter that reads");
    assert!(text(&f[0]).ends_with(" 3"), "title {:?}", text(&f[0]));
    assert_eq!(f[2].as_number(), Some(f64::from(JOHN)));
    assert_eq!(f[3].as_number(), Some(3.0));
    assert_eq!(f[4].as_number(), Some(21.0), "John has 21 chapters");

    let runs = runs(&chapter);
    let labelled: Vec<u32> = runs.iter().filter(|r| r.2).map(|r| r.1).collect();
    assert!(labelled.contains(&16), "verse 16 has its number");
    assert_eq!(labelled.iter().max(), Some(&36), "John 3 has 36 verses");
    assert!(runs
        .iter()
        .any(|r| r.1 == MARKED_VERSE && r.3 == "highlight.yellow"));
    let green: Vec<_> = runs.iter().filter(|r| r.3 == "highlight.green").collect();
    assert_eq!(green.len(), 1, "one highlighted word");
    assert_eq!(green[0].1, MARKED_WORD_VERSE);
    assert!(green[0].0.chars().count() > 6);

    let missing = berean.bible_chapter(&key, 99, 1);
    assert_eq!(
        text(&fields(&missing)[1]),
        "This Bible doesn't have that book."
    );

    let _ = std::fs::remove_dir_all(root);
}
