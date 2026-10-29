//! Library install/remove against real JW Library publications. The fixtures
//! are not committed: run `core/scripts/fetch-fixtures.sh` to download them
//! into `core/fixtures/`.

mod common;

use std::cell::RefCell;
use std::io::Read;
use std::path::{Path, PathBuf};

use berean_core::library::{Library, PubKind, PublicationSummary};
use berean_core::{CancelToken, Core, CoreError};
use common::fixture;

const W_E: &str = "w26:0:20260800";
const W_S: &str = "w26:1:20260800";
const LL_E: &str = "ll:0:0";
/// The steps `install` counts for unpacking, and for indexing.
const UNPACK_STEPS: u64 = 100;
const INDEX_STEPS: u64 = 100;

struct Env {
    _dir: tempfile::TempDir,
    data: PathBuf,
    cache: PathBuf,
}

impl Env {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Env {
            data: dir.path().join("data"),
            cache: dir.path().join("cache"),
            _dir: dir,
        }
    }

    fn core(&self) -> Core {
        Core::open(&self.data, &self.cache).unwrap_or_else(|e| panic!("open core: {e:?}"))
    }

    fn store(&self) -> PathBuf {
        self.data.join("publications")
    }

    /// Names of the publication directories in the store.
    fn store_dirs(&self) -> Vec<String> {
        let mut names: Vec<String> = list(&self.store())
            .into_iter()
            .filter(|n| !n.starts_with('.'))
            .collect();
        names.sort();
        names
    }

    /// `.staging` and `.trash` exist and are empty.
    fn assert_no_leftovers(&self) {
        assert_eq!(list(&self.store().join(".staging")), Vec::<String>::new());
        assert_eq!(list(&self.store().join(".trash")), Vec::<String>::new());
    }
}

fn list(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

fn install(lib: &Library, key: &str, file: impl AsRef<Path>) -> Result<(), CoreError> {
    lib.install(key, file, &|_, _| {}, &CancelToken::new())
}

fn keys(lib: &Library) -> Vec<String> {
    lib.installed()
        .unwrap()
        .into_iter()
        .map(|s| s.pub_key)
        .collect()
}

/// The installed w_E opens from the store and decrypts a known document.
fn assert_w_e_opens(lib: &Library) {
    let publication = lib.publication(W_E).unwrap();
    assert_eq!(publication.meta().symbol, "w26");
    assert!(publication.document_html(2).unwrap().contains("SONG 55"));
}

#[test]
fn install_list_open_remove() {
    let env = Env::new();
    let lib = env.core().library();
    assert!(lib.installed().unwrap().is_empty());

    install(&lib, W_E, fixture("w_E_202608.jwpub")).unwrap();
    assert_eq!(
        lib.installed().unwrap(),
        vec![PublicationSummary {
            pub_key: W_E.into(),
            symbol: "w26".into(),
            meps_language: 0,
            issue_tag: 20260800,
            year: 2026,
            title: "The Watchtower Announcing Jehovah’s Kingdom (Study)—2026".into(),
            kind: PubKind::Watchtower,
        }]
    );
    assert_w_e_opens(&lib);
    assert_eq!(env.store_dirs().len(), 1);
    env.assert_no_leftovers();

    lib.remove(W_E).unwrap();
    assert!(lib.installed().unwrap().is_empty());
    assert!(env.store_dirs().is_empty());
    assert!(matches!(lib.publication(W_E), Err(CoreError::NotFound)));
    assert!(matches!(lib.remove(W_E), Err(CoreError::NotFound)));
    env.assert_no_leftovers();
}

#[test]
fn install_all_and_reinstall() {
    let env = Env::new();
    let lib = env.core().library();
    install(&lib, W_E, fixture("w_E_202608.jwpub")).unwrap();
    install(&lib, LL_E, fixture("ll_E.jwpub")).unwrap();
    install(&lib, W_S, fixture("w_S_202608.jwpub")).unwrap();

    let installed = lib.installed().unwrap();
    assert_eq!(
        installed.iter().map(|s| &s.pub_key).collect::<Vec<_>>(),
        [LL_E, W_E, W_S]
    );
    assert_eq!(installed[0].kind, PubKind::Brochure);
    assert_eq!(installed[2].kind, PubKind::Watchtower);
    assert_eq!(installed[2].meps_language, 1);
    assert!(lib
        .publication(W_S)
        .unwrap()
        .document_html(2)
        .unwrap()
        .contains("CANCIÓN 55"));

    install(&lib, W_E, fixture("w_E_202608.jwpub")).unwrap();
    assert_eq!(keys(&lib), [LL_E, W_E, W_S]);
    assert_w_e_opens(&lib);
    assert_eq!(env.store_dirs().len(), 3);
    env.assert_no_leftovers();
}

#[test]
fn cancel_mid_install_leaves_nothing() {
    let env = Env::new();
    let lib = env.core().library();
    install(&lib, LL_E, fixture("ll_E.jwpub")).unwrap();
    let before = env.store_dirs();

    let token = CancelToken::new();
    let calls = RefCell::new(Vec::new());
    let sink = |done, _| {
        calls.borrow_mut().push(done);
        if calls.borrow().len() == 3 {
            token.cancel();
        }
    };
    let err = lib
        .install(W_E, fixture("w_E_202608.jwpub"), &sink, &token)
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    let calls = calls.into_inner();
    assert_eq!(calls.len(), 3);
    // Cancelled part way through unpacking.
    assert!(calls[2] > 1 && calls[2] < 1 + UNPACK_STEPS, "{calls:?}");
    assert_eq!(keys(&lib), [LL_E]);
    assert_eq!(env.store_dirs(), before);
    env.assert_no_leftovers();
}

#[test]
fn cancel_before_start() {
    let env = Env::new();
    let lib = env.core().library();
    let token = CancelToken::new();
    token.cancel();
    let calls = RefCell::new(0);
    let err = lib
        .install(
            W_E,
            fixture("w_E_202608.jwpub"),
            &|_, _| *calls.borrow_mut() += 1,
            &token,
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    assert_eq!(*calls.borrow(), 0);
    assert!(lib.installed().unwrap().is_empty());
    assert!(env.store_dirs().is_empty());
    env.assert_no_leftovers();
}

#[test]
fn corrupt_file_leaves_installed_copy() {
    let env = Env::new();
    let lib = env.core().library();
    install(&lib, W_E, fixture("w_E_202608.jwpub")).unwrap();
    let before = lib.installed().unwrap();
    let dirs = env.store_dirs();

    let good = std::fs::read(fixture("w_E_202608.jwpub")).unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let mut flipped = good.clone();
    let mid = flipped.len() / 2;
    for b in &mut flipped[mid..mid + 64] {
        *b ^= 0xff;
    }
    let truncated = &good[..good.len() / 2];
    for (name, bytes) in [
        ("flipped.jwpub", &flipped[..]),
        ("truncated.jwpub", truncated),
    ] {
        let path = tmp.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        let err = install(&lib, W_E, &path).unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{name}: {err:?}");
        assert_eq!(lib.installed().unwrap(), before);
        assert_eq!(env.store_dirs(), dirs);
        assert_w_e_opens(&lib);
        env.assert_no_leftovers();
    }
}

#[test]
fn wrong_publication_or_bad_key_is_invalid() {
    let env = Env::new();
    let lib = env.core().library();
    install(&lib, W_E, fixture("w_E_202608.jwpub")).unwrap();
    let before = lib.installed().unwrap();
    let dirs = env.store_dirs();

    for (key, file) in [
        (W_E, "ll_E.jwpub"),
        (W_S, "w_E_202608.jwpub"),
        ("w26", "w_E_202608.jwpub"),
        ("w26:0:020260800", "w_E_202608.jwpub"),
    ] {
        let err = install(&lib, key, fixture(file)).unwrap_err();
        assert!(
            matches!(err, CoreError::Invalid(_)),
            "{key} {file}: {err:?}"
        );
        assert_eq!(lib.installed().unwrap(), before);
        assert_eq!(env.store_dirs(), dirs);
        env.assert_no_leftovers();
    }
    assert_w_e_opens(&lib);
    assert!(matches!(lib.remove("bad"), Err(CoreError::Invalid(_))));
    assert!(matches!(lib.publication("bad"), Err(CoreError::Invalid(_))));
}

#[test]
fn installs_persist_across_reopen() {
    let env = Env::new();
    let core = env.core();
    install(&core.library(), W_E, fixture("w_E_202608.jwpub")).unwrap();
    let before = core.library().installed().unwrap();
    drop(core);

    let lib = env.core().library();
    assert_eq!(lib.installed().unwrap(), before);
    assert_w_e_opens(&lib);
}

#[test]
fn progress_is_monotonic_and_completes() {
    let env = Env::new();
    let lib = env.core().library();
    let calls = RefCell::new(Vec::new());
    lib.install(
        W_E,
        fixture("w_E_202608.jwpub"),
        &|done, total| calls.borrow_mut().push((done, total)),
        &CancelToken::new(),
    )
    .unwrap();

    let calls = calls.into_inner();
    assert!(calls.len() > 2, "{calls:?}");
    let total = calls[0].1;
    assert!(calls.iter().all(|&(_, t)| t == total), "{calls:?}");
    assert!(calls.windows(2).all(|w| w[0].0 <= w[1].0), "{calls:?}");
    assert!(calls.iter().all(|&(d, _)| d <= total), "{calls:?}");
    assert_eq!(calls.last().unwrap().0, total);
}

#[test]
fn progress_is_bounded_however_many_entries() {
    // Insight unpacks far more entries than install may report steps.
    let bound = 1 + UNPACK_STEPS + 1 + INDEX_STEPS + 1;
    let file = fixture("it_E.jwpub");
    let mut outer = zip::ZipArchive::new(std::fs::File::open(&file).unwrap()).unwrap();
    let mut contents = Vec::new();
    outer
        .by_name("contents")
        .unwrap()
        .read_to_end(&mut contents)
        .unwrap();
    let entries = zip::ZipArchive::new(std::io::Cursor::new(contents))
        .unwrap()
        .len() as u64;
    assert!(entries > bound, "{entries} entries");

    let env = Env::new();
    let lib = env.core().library();
    let calls = RefCell::new(Vec::new());
    lib.install(
        "it:0:0",
        &file,
        &|done, total| calls.borrow_mut().push((done, total)),
        &CancelToken::new(),
    )
    .unwrap();

    let calls = calls.into_inner();
    assert!(calls.len() as u64 <= bound, "{} calls", calls.len());
    assert!(calls.iter().all(|&(_, t)| t == bound), "{calls:?}");
    assert!(calls.windows(2).all(|w| w[0].0 < w[1].0), "{calls:?}");
    assert_eq!(calls.last().unwrap().0, bound);
}

#[test]
fn reopen_clears_leftovers() {
    let env = Env::new();
    let core = env.core();
    install(&core.library(), W_E, fixture("w_E_202608.jwpub")).unwrap();
    drop(core);
    let dirs = env.store_dirs();

    let store = env.store();
    std::fs::create_dir_all(store.join(".staging/junk/pub")).unwrap();
    std::fs::write(store.join(".staging/junk/pub/x.db"), b"junk").unwrap();
    std::fs::write(store.join(".staging/stray"), b"junk").unwrap();
    std::fs::create_dir_all(store.join(".trash/old/pub")).unwrap();
    std::fs::write(store.join(".trash/old/pub/x.jpg"), b"junk").unwrap();
    // A directory no record points at, as left by a crash mid-install.
    std::fs::create_dir_all(store.join("w26_0_20260800.tmpcrash")).unwrap();
    std::fs::write(store.join("w26_0_20260800.tmpcrash/x.db"), b"junk").unwrap();

    let lib = env.core().library();
    env.assert_no_leftovers();
    assert_eq!(env.store_dirs(), dirs);
    assert_eq!(keys(&lib), [W_E]);
    assert_w_e_opens(&lib);
}
