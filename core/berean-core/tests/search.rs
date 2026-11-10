//! Full-text search against real JW Library publications. The fixtures are
//! not committed: run `core/scripts/fetch-fixtures.sh` to download them into
//! `core/fixtures/`.

mod common;

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};

use berean_core::library::PubKind;
use berean_core::reader::Location;
use berean_core::search::{Hit, SearchScope, Suggestions, MAX_LIMIT, MAX_SUGGESTIONS};
use berean_core::{CancelToken, Core, CoreError};
use common::{fixture, span_of};
use rusqlite::Connection;

const NWT_E: &str = "nwt:0:0";
const NWT_S: &str = "nwt:1:0";
const W_E: &str = "w26:0:20260800";
const W_S: &str = "w26:1:20260800";
const LL_E: &str = "ll:0:0";
const IT_E: &str = "it:0:0";
const RSG_E: &str = "rsg:0:0";

/// Index rows of the pinned fixtures: verses, and paragraphs of the Bible's
/// other documents (in how many documents).
const NWT_E_VERSES: i64 = 31194;
const NWT_E_PARAGRAPHS: i64 = 12334;
const NWT_E_PARAGRAPH_DOCS: i64 = 129;
const W_E_PARAGRAPHS: i64 = 363;
/// Verses and paragraphs of nwt_E that name Absalom.
const ABSALOM: usize = 98;

/// A paragraph of the Watchtower and one of `ll`, and where they are.
const W_E_PHRASE: &str = "What tactic does Satan use to try to break the integrity";
const W_E_DOC: i64 = 2026520;
const W_E_PARAGRAPH: u32 = 40;
const LL_E_PHRASE: &str = "God reveals precious truths that fill us with joy and hope";
const LL_E_DOC: i64 = 1102011098;
const LL_E_PARAGRAPH: u32 = 4;

/// A core in Cargo's per-target temp dir, emptied first, with `fixtures`
/// installed.
fn new_core(name: &str, fixtures: &[(&str, &str)]) -> (Core, PathBuf) {
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
    (core, dir.join("data/user.sqlite"))
}

/// English and Spanish Bibles and Watchtowers, and `ll`; shared by most
/// tests.
fn core() -> &'static (Core, PathBuf) {
    static CORE: OnceLock<(Core, PathBuf)> = OnceLock::new();
    CORE.get_or_init(|| {
        new_core(
            "search",
            &[
                (NWT_E, "nwt_E.jwpub"),
                (NWT_S, "nwt_S.jwpub"),
                (W_E, "w_E_202608.jwpub"),
                (W_S, "w_S_202608.jwpub"),
                (LL_E, "ll_E.jwpub"),
            ],
        )
    })
}

fn query(text: &str, scope: &SearchScope, limit: u32) -> Vec<Hit> {
    core()
        .0
        .search()
        .query(text, scope, limit)
        .unwrap_or_else(|e| panic!("{text:?}: {e:?}"))
}

fn in_pubs(pub_keys: &[&str]) -> SearchScope {
    SearchScope {
        pub_keys: pub_keys.iter().map(|k| k.to_string()).collect(),
        ..SearchScope::default()
    }
}

fn locations(hits: &[Hit]) -> Vec<Location> {
    hits.iter().map(|h| h.location.clone()).collect()
}

/// The index rows of `pub_key` (`WHERE` clause `extra`), read straight from
/// the user DB.
fn rows(db: &Path, pub_key: &str, extra: &str) -> i64 {
    Connection::open(db)
        .unwrap()
        .query_row(
            &format!("SELECT count(*) FROM search_index WHERE pub_key = ?1 {extra}"),
            [pub_key],
            |r| r.get(0),
        )
        .unwrap()
}

/// `snippet` has `<mark>` tags and no other markup.
fn assert_safe_snippet(snippet: &str) {
    assert!(snippet.contains("<mark>"), "{snippet}");
    let bare = snippet.replace("<mark>", "").replace("</mark>", "");
    assert!(!bare.contains(['<', '>']), "{snippet}");
    assert_eq!(
        snippet.matches("<mark>").count(),
        snippet.matches("</mark>").count(),
        "{snippet}"
    );
}

#[test]
fn john_3_16() {
    let core = &core().0;
    let john_3_16 = span_of(core.reader().resolve("John 3:16")).start;
    for text in ["loved the world so much", "\"loved the world so much\""] {
        let hits = query(text, &SearchScope::default(), 3);
        let hit = hits
            .iter()
            .find(|h| h.location == john_3_16)
            .unwrap_or_else(|| panic!("{text}: {hits:?}"));
        assert_eq!(hit.title, "John 3");
        assert_safe_snippet(&hit.snippet);
        let chapter = core.reader().bible_chapter(NWT_E, 43, 3).unwrap();
        assert!(chapter.verses.iter().any(|v| v.verse == 16));
    }
    let hits = query("\"loved the world so much\"", &SearchScope::default(), 3);
    assert_eq!(locations(&hits), [john_3_16]);
    assert!(
        hits[0]
            .snippet
            .contains("God <mark>loved the world so much</mark> that"),
        "{}",
        hits[0].snippet
    );
    let hits = query("loved the world so much", &SearchScope::default(), 3);
    assert!(
        hits[0]
            .snippet
            .contains("<mark>loved</mark> <mark>the</mark> <mark>world</mark>"),
        "{}",
        hits[0].snippet
    );
}

#[test]
fn bible_rows() {
    let db = &core().1;
    assert_eq!(rows(db, NWT_E, "AND verse IS NOT NULL"), NWT_E_VERSES);
    assert_eq!(
        rows(db, NWT_E, "AND paragraph IS NOT NULL"),
        NWT_E_PARAGRAPHS
    );
    let docs: i64 = Connection::open(db)
        .unwrap()
        .query_row(
            "SELECT count(DISTINCT doc_id) FROM search_index \
             WHERE pub_key = ?1 AND paragraph IS NOT NULL",
            [NWT_E],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(docs, NWT_E_PARAGRAPH_DOCS);
    // No book document is indexed as paragraphs: John's is 1001061147.
    assert_eq!(
        rows(
            db,
            NWT_E,
            "AND paragraph IS NOT NULL AND doc_id = 1001061147"
        ),
        0
    );
    assert_eq!(rows(db, W_E, ""), W_E_PARAGRAPHS);

    // A superscription is verse 0.
    let hits = query(
        "\"A melody of David when he was fleeing from his son Absalom\"",
        &in_pubs(&[NWT_E]),
        5,
    );
    let at: Vec<_> = hits
        .iter()
        .map(|h| (h.location.book, h.location.chapter, h.location.verse))
        .collect();
    assert_eq!(at, [(Some(19), Some(3), Some(0))]);
    assert_eq!(hits[0].title, "Psalms 3");
    // Pronunciation marks (`Abʹsa·lom`) neither split a name nor need typing.
    let absalom = locations(&query("Absalom", &in_pubs(&[NWT_E]), MAX_LIMIT));
    assert_eq!(absalom.len(), ABSALOM);
    assert_eq!(
        locations(&query("Abʹsa·lom", &in_pubs(&[NWT_E]), MAX_LIMIT)),
        absalom
    );
}

#[test]
fn case_and_diacritics_do_not_matter() {
    for (pub_key, variants) in [
        (NWT_S, &["Jehová", "JEHOVA", "jehova", "JeHoVá"][..]),
        (NWT_S, &["corazón", "corazon", "CORAZÓN"][..]),
        (NWT_E, &["Jehovah", "JEHOVAH", "jehovah"][..]),
    ] {
        let scope = in_pubs(&[pub_key]);
        let first = query(variants[0], &scope, 100);
        assert_eq!(first.len(), 100, "{variants:?}");
        for text in &variants[1..] {
            assert_eq!(
                locations(&query(text, &scope, 100)),
                locations(&first),
                "{text}"
            );
        }
    }
}

#[test]
fn publication_paragraphs() {
    let reader = core().0.reader();
    for (phrase, pub_key, doc_id, paragraph) in [
        (W_E_PHRASE, W_E, W_E_DOC, W_E_PARAGRAPH),
        (LL_E_PHRASE, LL_E, LL_E_DOC, LL_E_PARAGRAPH),
    ] {
        for text in [phrase.to_string(), format!("\"{phrase}\"")] {
            let hits = query(&text, &SearchScope::default(), 5);
            let hit = &hits[0];
            assert_eq!(
                hit.location,
                Location {
                    pub_key: pub_key.into(),
                    doc_id: Some(doc_id),
                    book: None,
                    chapter: None,
                    verse: None,
                    paragraph: Some(paragraph),
                },
                "{text}"
            );
            assert_safe_snippet(&hit.snippet);
            let document = reader.document(pub_key, doc_id).unwrap();
            assert_eq!(hit.title, document.title);
            assert!(document
                .paragraphs
                .iter()
                .any(|p| p.paragraph == paragraph && p.begin.is_some()));
        }
    }
}

#[test]
fn scope_filters() {
    let pub_keys = |hits: &[Hit]| -> Vec<String> {
        let mut keys: Vec<String> = hits.iter().map(|h| h.location.pub_key.clone()).collect();
        keys.sort();
        keys.dedup();
        keys
    };
    let all = query("Jesus", &SearchScope::default(), MAX_LIMIT);
    assert_eq!(all.len(), MAX_LIMIT as usize);

    let only_w = query("Jesus", &in_pubs(&[W_E]), MAX_LIMIT);
    assert_eq!(pub_keys(&only_w), [W_E]);

    let by_kind = |kinds: Vec<PubKind>| {
        query(
            "Jesus",
            &SearchScope {
                kinds,
                ..SearchScope::default()
            },
            MAX_LIMIT,
        )
    };
    assert_eq!(pub_keys(&by_kind(vec![PubKind::Bible])), [NWT_E, NWT_S]);
    assert_eq!(pub_keys(&by_kind(vec![PubKind::Watchtower])), [W_E, W_S]);
    assert_eq!(
        pub_keys(&by_kind(vec![PubKind::Bible, PubKind::Watchtower])),
        [NWT_E, NWT_S, W_E, W_S]
    );

    let by_language = |languages: Vec<u32>| {
        query(
            "Jesus",
            &SearchScope {
                languages,
                ..SearchScope::default()
            },
            MAX_LIMIT,
        )
    };
    assert_eq!(pub_keys(&by_language(vec![1])), [NWT_S, W_S]);
    let english = pub_keys(&by_language(vec![0]));
    assert!(english
        .iter()
        .all(|k| [NWT_E, W_E, LL_E].contains(&k.as_str())));
    assert!(english.len() >= 2, "{english:?}");

    // Filters combine: Spanish Watchtowers.
    let spanish_w = query(
        "Jesús",
        &SearchScope {
            kinds: vec![PubKind::Watchtower],
            languages: vec![1],
            ..SearchScope::default()
        },
        MAX_LIMIT,
    );
    assert_eq!(pub_keys(&spanish_w), [W_S]);
    let none = SearchScope {
        pub_keys: vec![W_E.into()],
        kinds: vec![PubKind::Bible],
        ..SearchScope::default()
    };
    assert!(query("Jesus", &none, 10).is_empty());

    // Not installed => no hits; malformed => Invalid.
    assert!(query("Jesus", &in_pubs(&["nwt:2:0"]), 10).is_empty());
    let err = core()
        .0
        .search()
        .query("Jesus", &in_pubs(&["nwt"]), 10)
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
}

#[test]
fn paging() {
    let scope = |offset| SearchScope {
        offset,
        ..SearchScope::default()
    };
    let all = query("Jehovah", &scope(0), 60);
    assert_eq!(all.len(), 60);
    let mut pages = Vec::new();
    for offset in [0, 20, 40] {
        let page = query("Jehovah", &scope(offset), 20);
        assert_eq!(page.len(), 20);
        pages.extend(page);
    }
    assert_eq!(pages, all);
    // A limit over the maximum is capped; paging past the end is empty.
    assert_eq!(
        query("Jehovah", &scope(0), 10_000).len(),
        MAX_LIMIT as usize
    );
    assert!(query("Jehovah", &scope(u32::MAX), 10).is_empty());
}

#[test]
fn bad_queries() {
    let search = core().0.search();
    for text in ["", "   ", "\t\n", "\"\"", "\" \""] {
        let err = search.query(text, &SearchScope::default(), 10).unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)), "{text:?}: {err:?}");
    }
    let err = search
        .query("Jesus", &SearchScope::default(), 0)
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");

    // FTS5 syntax is searched as text, never run.
    for text in [
        "NEAR(",
        "NEAR(love world, 2)",
        "\"",
        "\"love",
        "love\"",
        "*",
        "lov*",
        "-",
        "-love",
        "OR",
        "love OR world",
        "AND",
        "NOT",
        "love NOT world",
        "(",
        ")",
        "text:love",
        "{text}: love",
        "^love",
        "+",
        "'",
        "\u{2}",
    ] {
        search
            .query(text, &SearchScope::default(), 10)
            .unwrap_or_else(|e| panic!("{text:?}: {e:?}"));
    }
    // An operator word is just a word.
    let hits = query("OR", &in_pubs(&[NWT_E]), 1);
    assert!(hits[0].snippet.to_lowercase().contains("<mark>or</mark>"));
    assert!(query("lov*", &in_pubs(&[NWT_E]), 1).is_empty());
}

#[test]
fn install_remove_and_rebuild() {
    let (core, db) = new_core(
        "search-lifecycle",
        &[(W_E, "w_E_202608.jwpub"), (LL_E, "ll_E.jwpub")],
    );
    let lib = core.library();
    let search = core.search();
    let texts = [W_E_PHRASE, LL_E_PHRASE, "Jehovah", "love"];
    let results = || -> Vec<Vec<Hit>> {
        texts
            .iter()
            .map(|t| search.query(t, &SearchScope::default(), MAX_LIMIT).unwrap())
            .collect()
    };
    let suggestions = || -> Vec<Suggestions> {
        ["jeho", "lo", "God lo"]
            .iter()
            .map(|t| search.suggest(t, &SearchScope::default(), 10).unwrap())
            .collect()
    };
    let baseline = results();
    let suggested = suggestions();
    assert!(baseline.iter().all(|hits| !hits.is_empty()));
    assert!(suggested.iter().all(|s| !s.queries.is_empty()));
    assert_eq!(rows(&db, W_E, ""), W_E_PARAGRAPHS);

    // Remove: no hits from it any more.
    lib.remove(W_E).unwrap();
    assert_eq!(rows(&db, W_E, ""), 0);
    for hits in results() {
        assert!(hits.iter().all(|h| h.location.pub_key != W_E));
    }
    // Reinstall, twice: back to the same hits, no duplicates.
    for _ in 0..2 {
        lib.install(
            W_E,
            fixture("w_E_202608.jwpub"),
            &|_, _| {},
            &CancelToken::new(),
        )
        .unwrap();
        assert_eq!(rows(&db, W_E, ""), W_E_PARAGRAPHS);
        assert_eq!(results(), baseline);
        assert_eq!(suggestions(), suggested);
    }

    // Rebuild, twice: the same hits. Progress is monotonic and completes.
    let mut n = 0;
    for _ in 0..2 {
        let calls = RefCell::new(Vec::new());
        search
            .rebuild_index(&|d, t| calls.borrow_mut().push((d, t)), &CancelToken::new())
            .unwrap();
        let calls = calls.into_inner();
        let total = calls[0].1;
        assert!(calls.iter().all(|&(_, t)| t == total), "{calls:?}");
        assert!(calls.windows(2).all(|w| w[0].0 <= w[1].0), "{calls:?}");
        assert_eq!(calls.last().unwrap().0, total);
        assert_eq!(results(), baseline);
        assert_eq!(suggestions(), suggested);
        n = calls.len();
    }

    // Rows lost (as in a DB from before the index): a cancelled rebuild
    // leaves the index as it was, a finished one restores them.
    Connection::open(&db)
        .unwrap()
        .execute("DELETE FROM search_index WHERE pub_key = ?1", [W_E])
        .unwrap();
    // At the start, after the first step, and once every publication is
    // indexed (the last call commits).
    for cancel_at in [1, 2, n - 1] {
        let token = CancelToken::new();
        let calls = RefCell::new(0);
        let sink = |_, _| {
            *calls.borrow_mut() += 1;
            if *calls.borrow() == cancel_at {
                token.cancel();
            }
        };
        let err = search.rebuild_index(&sink, &token).unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        assert_eq!(rows(&db, W_E, ""), 0);
        assert!(rows(&db, LL_E, "") > 0);
    }
    search
        .rebuild_index(&|_, _| {}, &CancelToken::new())
        .unwrap();
    assert_eq!(results(), baseline);
    assert_eq!(suggestions(), suggested);
}

#[test]
fn cancelled_install_leaves_the_index_unchanged() {
    let (core, db) = new_core("search-cancel", &[(W_E, "w_E_202608.jwpub")]);
    let lib = core.library();
    let search = core.search();
    let before = search
        .query(W_E_PHRASE, &SearchScope::default(), MAX_LIMIT)
        .unwrap();

    // A full install's progress calls, to cancel during indexing.
    let full = RefCell::new(Vec::new());
    new_core("search-cancel-ref", &[])
        .0
        .library()
        .install(
            W_S,
            fixture("w_S_202608.jwpub"),
            &|d, t| full.borrow_mut().push((d, t)),
            &CancelToken::new(),
        )
        .unwrap();
    let full = full.into_inner();
    let n = full.len();
    let total = full[0].1;
    // The last call commits; the one before ends indexing.
    assert_eq!(full[n - 2].0, total - 1);

    for (key, file) in [(W_S, "w_S_202608.jwpub"), (W_E, "w_E_202608.jwpub")] {
        // Mid-indexing, and once indexing is done.
        for cancel_at in [n - 3, n - 2] {
            let token = CancelToken::new();
            let calls = RefCell::new(0);
            let sink = |_, _| {
                *calls.borrow_mut() += 1;
                if *calls.borrow() == cancel_at {
                    token.cancel();
                }
            };
            let err = lib.install(key, fixture(file), &sink, &token).unwrap_err();
            assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        }
    }
    assert_eq!(rows(&db, W_S, ""), 0);
    assert_eq!(rows(&db, W_E, ""), W_E_PARAGRAPHS);
    assert_eq!(
        search
            .query(W_E_PHRASE, &SearchScope::default(), MAX_LIMIT)
            .unwrap(),
        before
    );
}

#[test]
fn insight() {
    let (core, _) = new_core("search-insight", &[(IT_E, "it_E.jwpub")]);
    let hits = core
        .search()
        .query("Melchizedek", &in_pubs(&[IT_E]), 20)
        .unwrap();
    assert_eq!(hits.len(), 20);
    let reader = core.reader();
    for hit in &hits {
        let location = &hit.location;
        assert_eq!(location.pub_key, IT_E);
        assert_safe_snippet(&hit.snippet);
        let paragraph = location.paragraph.unwrap();
        let document = reader.document(IT_E, location.doc_id.unwrap()).unwrap();
        assert_eq!(hit.title, document.title);
        assert!(document.paragraphs.iter().any(|p| p.paragraph == paragraph));
    }
    assert_eq!(hits[0].title, "Melchizedek");

    // Its articles are topic suggestions, opening the article itself.
    let suggested = core
        .search()
        .suggest("melchiz", &SearchScope::default(), 5)
        .unwrap();
    let topic = &suggested.topics[0];
    assert_eq!(topic.title, "Melchizedek");
    assert_eq!(topic.location.pub_key, IT_E);
    let document = reader
        .document(IT_E, topic.location.doc_id.unwrap())
        .unwrap();
    assert_eq!(document.title, "Melchizedek");
    assert_eq!(suggested.queries[0], "Melchizedek");
    // Typed in full, the article comes first.
    let topics = core
        .search()
        .suggest("melchizedek", &SearchScope::default(), 5)
        .unwrap()
        .topics;
    assert_eq!(topics[0].title, "Melchizedek");
}

#[test]
fn suggestions_complete_the_last_word() {
    let search = core().0.search();
    let suggest = |text: &str, scope: &SearchScope| {
        search
            .suggest(text, scope, 8)
            .unwrap_or_else(|e| panic!("{text:?}: {e:?}"))
    };
    let all = SearchScope::default();

    // Each language's own spelling, most common first.
    assert_eq!(suggest("jeho", &in_pubs(&[NWT_E])).queries[0], "Jehovah");
    assert_eq!(suggest("jeho", &in_pubs(&[NWT_S])).queries[0], "Jehová");
    assert_eq!(suggest("JEHO", &in_pubs(&[NWT_S])).queries[0], "Jehová");
    // Pronunciation marks don't split a name.
    assert!(suggest("absa", &in_pubs(&[NWT_E]))
        .queries
        .contains(&"Absalom".to_string()));

    // A word's usual spelling inside sentences, not its capital at the
    // start of one ("Look!").
    let god_lo = suggest("God lo", &in_pubs(&[NWT_E])).queries;
    assert!(god_lo.contains(&"God look".to_string()), "{god_lo:?}");
    assert!(god_lo.contains(&"God Lord".to_string()), "{god_lo:?}");

    let love = suggest("lov", &all).queries;
    assert_eq!(love.len(), 8);
    assert_eq!(love[0], "love");
    // Every completion finds something, alone or with the other words.
    for text in ["lov", "God lov", "\"loved the wor", "Jehovah sal"] {
        let queries = suggest(text, &all).queries;
        assert!(!queries.is_empty(), "{text:?}");
        for q in &queries {
            assert!(!query(q, &all, 1).is_empty(), "{text:?} => {q:?}");
        }
    }
    assert_eq!(
        suggest("\"loved the wor", &in_pubs(&[NWT_E])).queries[0],
        "\"loved the world\""
    );
    // No Insight installed: no topics.
    assert!(suggest("melch", &all).topics.is_empty());
    // Nothing to complete.
    for text in ["", "love ", "John 3:16", "Jehovah’s"] {
        assert_eq!(suggest(text, &all), Suggestions::default(), "{text:?}");
    }
    // The limit is capped.
    assert_eq!(
        search.suggest("a", &all, 1000).unwrap().queries.len(),
        MAX_SUGGESTIONS as usize
    );
}

#[test]
fn index_publications_are_not_indexed() {
    let (core, db) = new_core("search-index-kind", &[(W_E, "w_E_202608.jwpub")]);
    let lib = core.library();
    let search = core.search();
    let calls = RefCell::new(Vec::new());
    lib.install(
        RSG_E,
        fixture("rsg_E.jwpub"),
        &|d, t| calls.borrow_mut().push((d, t)),
        &CancelToken::new(),
    )
    .unwrap();
    let calls = calls.into_inner();
    let total = calls[0].1;
    assert!(calls.windows(2).all(|w| w[0].0 <= w[1].0), "{calls:?}");
    assert_eq!(*calls.last().unwrap(), (total, total));
    assert!(lib
        .installed()
        .unwrap()
        .iter()
        .any(|p| p.pub_key == RSG_E && p.kind == PubKind::Index));

    let check = || {
        assert_eq!(rows(&db, RSG_E, ""), 0);
        assert!(search
            .query("Jehovah", &in_pubs(&[RSG_E]), MAX_LIMIT)
            .unwrap()
            .is_empty());
        let hits = search
            .query("Jehovah", &SearchScope::default(), MAX_LIMIT)
            .unwrap();
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|h| h.location.pub_key == W_E));
        assert_eq!(rows(&db, W_E, ""), W_E_PARAGRAPHS);
    };
    check();

    let calls = RefCell::new(Vec::new());
    search
        .rebuild_index(&|d, t| calls.borrow_mut().push((d, t)), &CancelToken::new())
        .unwrap();
    let calls = calls.into_inner();
    let total = calls[0].1;
    assert!(calls.windows(2).all(|w| w[0].0 <= w[1].0), "{calls:?}");
    assert_eq!(*calls.last().unwrap(), (total, total));
    check();
}

/// A progress sink may call back into the core: progress is never reported
/// while a core lock is held (over the bindings, a progress call blocks on
/// the caller's thread, which may be making that call).
#[test]
fn progress_can_call_back_into_the_core() {
    let (core, _) = new_core("search-reentrant", &[(LL_E, "ll_E.jwpub")]);
    let core = Arc::new(core);
    type Work = fn(&Core, &dyn Fn(u64, u64)) -> Result<(), CoreError>;
    // Runs `work` on its own thread, so a deadlock fails the test instead of
    // hanging it.
    let run = |name: &str, work: Work| {
        let (tx, rx) = mpsc::channel();
        let core = core.clone();
        std::thread::spawn(move || {
            let calls = Cell::new(0);
            let sink = |_, _| {
                calls.set(calls.get() + 1);
                core.library().installed().unwrap();
                core.search()
                    .query("Jehovah", &SearchScope::default(), 10)
                    .unwrap();
            };
            let result = work(&core, &sink);
            let _ = tx.send(result.map(|()| calls.get()));
        });
        let calls = rx
            .recv_timeout(Duration::from_secs(120))
            .unwrap_or_else(|e| panic!("{name}: no result ({e}); deadlocked?"))
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert!(calls > 1, "{name}: {calls} progress calls");
    };
    run("rebuild_index", |core, sink| {
        core.search().rebuild_index(&sink, &CancelToken::new())
    });
    run("install", |core, sink| {
        core.library()
            .install(W_E, fixture("w_E_202608.jwpub"), &sink, &CancelToken::new())
    });
}

/// Query and rebuild timings over the big set. Run in release:
/// `cargo test --release -p berean-core --test search query_timings -- --ignored --nocapture`.
#[test]
#[ignore]
fn query_timings() {
    let (core, _) = new_core(
        "search-timings",
        &[
            (NWT_E, "nwt_E.jwpub"),
            (NWT_S, "nwt_S.jwpub"),
            (W_E, "w_E_202608.jwpub"),
            (W_S, "w_S_202608.jwpub"),
            (LL_E, "ll_E.jwpub"),
            (IT_E, "it_E.jwpub"),
        ],
    );
    let search = core.search();
    let at = |offset| SearchScope {
        offset,
        ..SearchScope::default()
    };
    let cases = [
        ("love", at(0), 50),
        ("Jehovah", at(0), 500),
        ("\"loved the world\"", at(0), 50),
        ("the", at(0), 500),
        ("the", at(400), 50),
        ("God", in_pubs(&[NWT_E]), 50),
        ("zzqxj", at(0), 50),
    ];
    for (text, scope, limit) in &cases {
        let mut ms = Vec::new();
        let mut hits = 0;
        for _ in 0..5 {
            let start = Instant::now();
            hits = search.query(text, scope, *limit).unwrap().len();
            ms.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        ms.sort_by(f64::total_cmp);
        eprintln!(
            "query {text:?} pub_keys={:?} offset={} limit={limit}: {hits} hits, \
             min {:.2} ms, median {:.2} ms",
            scope.pub_keys, scope.offset, ms[0], ms[2]
        );
    }
    for (text, scope) in [
        ("a", at(0)),
        ("lo", at(0)),
        ("melch", at(0)),
        ("God lo", at(0)),
        ("\"loved the wo", at(0)),
        ("jeho", in_pubs(&[NWT_S])),
    ] {
        let mut ms = Vec::new();
        let mut found = Suggestions::default();
        for _ in 0..5 {
            let start = Instant::now();
            found = search.suggest(text, &scope, 8).unwrap();
            ms.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        ms.sort_by(f64::total_cmp);
        eprintln!(
            "suggest {text:?} pub_keys={:?}: {} topics, {} queries, min {:.2} ms, median {:.2} ms",
            scope.pub_keys,
            found.topics.len(),
            found.queries.len(),
            ms[0],
            ms[2]
        );
    }
    let start = Instant::now();
    search
        .rebuild_index(&|_, _| {}, &CancelToken::new())
        .unwrap();
    eprintln!(
        "rebuild_index: {:.0} ms",
        start.elapsed().as_secs_f64() * 1000.0
    );
}
