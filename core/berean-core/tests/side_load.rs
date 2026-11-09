//! `Library::side_load`: installing a `.jwpub` the user opened from their
//! device. Every publication here is built by hand, so no fixtures are
//! needed; the catalog cases (a file the catalog lists, but not this copy of
//! it) are in `catalog.rs`.

use std::cell::RefCell;
use std::io::Write;
use std::path::{Path, PathBuf};

use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use berean_core::library::{Library, PubKind, PublicationSummary, SideLoad};
use berean_core::search::SearchScope;
use berean_core::{CancelToken, Core, CoreError};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;

const MASK: &str = "11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7";
/// The steps an install counts: open, unpack, check, index, commit.
const TOTAL: u64 = 1 + 100 + 1 + 100 + 1;

/// A hand-built publication.
struct Pub {
    symbol: &'static str,
    language: u32,
    year: u32,
    issue: &'static str,
    title: &'static str,
    publication_type: &'static str,
    html: &'static str,
    /// The identity the content is encrypted for; `None` uses the
    /// publication's own, so it decrypts.
    ident: Option<&'static str>,
}

const TEST: Pub = Pub {
    symbol: "tst",
    language: 0,
    year: 2024,
    issue: "0",
    title: "Test Book",
    publication_type: "Book",
    html: "<p id=\"p1\" data-pid=\"1\">In the beginning</p>",
    ident: None,
};

impl Pub {
    fn ident(&self) -> String {
        match self.ident {
            Some(ident) => ident.to_string(),
            None if self.issue == "0" => {
                format!("{}_{}_{}", self.language, self.symbol, self.year)
            }
            None => format!(
                "{}_{}_{}_{}",
                self.language, self.symbol, self.year, self.issue
            ),
        }
    }

    fn key(&self) -> String {
        format!("{}:{}:{}", self.symbol, self.language, self.issue)
    }

    /// Write the `.jwpub` to `dir/name`.
    fn write(&self, dir: &Path, name: &str) -> PathBuf {
        let db_name = format!("{}.db", self.symbol);
        let db = self.db(dir, &db_name);
        let contents = zip_bytes(&[(&db_name, &db)]);
        let hash = hex::encode(Sha256::digest(&contents));
        let manifest = serde_json::json!({
            "hash": hash,
            "publication": {
                "fileName": db_name,
                "symbol": self.symbol,
                "language": self.language,
                "year": self.year,
                "title": self.title,
            },
        })
        .to_string();
        let path = dir.join(name);
        std::fs::write(
            &path,
            zip_bytes(&[
                ("manifest.json", manifest.as_bytes()),
                ("contents", &contents),
            ]),
        )
        .unwrap();
        path
    }

    fn db(&self, dir: &Path, name: &str) -> Vec<u8> {
        let scratch = tempfile::tempdir_in(dir).unwrap();
        let path = scratch.path().join(name);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE Publication (Title TEXT, Symbol TEXT, Year INTEGER,
                 MepsLanguageIndex INTEGER, IssueTagNumber TEXT,
                 PublicationType TEXT, Type INTEGER);
             CREATE TABLE Document (DocumentId INTEGER, MepsDocumentId INTEGER,
                 Class TEXT, Type INTEGER, Title TEXT, Content BLOB);
             CREATE TABLE DocumentParagraph (DocumentParagraphId INTEGER,
                 DocumentId INTEGER, ParagraphIndex INTEGER,
                 ParagraphNumberLabel INTEGER, BeginPosition INTEGER,
                 EndPosition INTEGER);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Publication VALUES (?1, ?2, ?3, ?4, ?5, ?6, 2)",
            rusqlite::params![
                self.title,
                self.symbol,
                self.year,
                self.language,
                self.issue,
                self.publication_type
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Document VALUES (1, 100, '13', 0, 'Chapter 1', ?1)",
            [encrypt(&self.ident(), self.html)],
        )
        .unwrap();
        // The one paragraph is the whole document.
        conn.execute(
            "INSERT INTO DocumentParagraph VALUES (1, 1, 1, NULL, 0, ?1)",
            [self.html.len() as i64],
        )
        .unwrap();
        drop(conn);
        std::fs::read(path).unwrap()
    }
}

/// Encrypt `html` the way JWPUB content is stored, for the identity string
/// `ident` (e.g. `0_tst_2024`).
fn encrypt(ident: &str, html: &str) -> Vec<u8> {
    let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    z.write_all(html.as_bytes()).unwrap();
    let plain = z.finish().unwrap();
    let mask = hex::decode(MASK).unwrap();
    let d: Vec<u8> = Sha256::digest(ident.as_bytes())
        .iter()
        .zip(mask)
        .map(|(a, b)| a ^ b)
        .collect();
    let mut buf = plain.clone();
    buf.resize(plain.len() + 16, 0);
    let n = cbc::Encryptor::<aes::Aes128>::new(d[..16].into(), d[16..].into())
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plain.len())
        .unwrap()
        .len();
    buf.truncate(n);
    buf
}

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in entries {
        w.start_file(*name, SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

struct Env {
    dir: tempfile::TempDir,
}

impl Env {
    fn new() -> Self {
        Env {
            dir: tempfile::tempdir().unwrap(),
        }
    }

    fn core(&self) -> Core {
        Core::open(self.dir.path().join("data"), self.dir.path().join("cache"))
            .unwrap_or_else(|e| panic!("open core: {e:?}"))
    }

    /// A folder for the files the "user" opens.
    fn files(&self) -> PathBuf {
        let path = self.dir.path().join("files");
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn store(&self) -> PathBuf {
        self.dir.path().join("data/publications")
    }

    /// The publication directories in the store.
    fn store_dirs(&self) -> Vec<String> {
        let mut names: Vec<String> = list(&self.store())
            .into_iter()
            .filter(|n| !n.starts_with('.'))
            .collect();
        names.sort();
        names
    }

    fn assert_no_leftovers(&self) {
        assert!(list(&self.store().join(".staging")).is_empty());
        assert!(list(&self.store().join(".trash")).is_empty());
    }
}

fn list(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

fn side_load(lib: &Library, path: &Path, replace: bool) -> Result<SideLoad, CoreError> {
    lib.side_load(path, replace, &|_, _| {}, &CancelToken::new())
}

fn summary(p: &Pub) -> PublicationSummary {
    PublicationSummary {
        pub_key: p.key(),
        symbol: p.symbol.into(),
        meps_language: p.language,
        issue_tag: p.issue.parse().unwrap(),
        year: p.year,
        title: p.title.into(),
        issue_title: None,
        kind: match p.publication_type {
            "Book" => PubKind::Book,
            "Watchtower" => PubKind::Watchtower,
            other => panic!("add {other}"),
        },
    }
}

#[test]
fn installs_a_file_by_its_own_key() {
    let env = Env::new();
    let lib = env.core().library();
    let path = TEST.write(&env.files(), "from-a-friend.jwpub");

    let progress = RefCell::new(Vec::new());
    let done = lib
        .side_load(
            &path,
            false,
            &|d, t| progress.borrow_mut().push((d, t)),
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(
        done,
        SideLoad::Installed {
            publication: summary(&TEST)
        }
    );
    assert_eq!(lib.installed().unwrap(), vec![summary(&TEST)]);
    let publication = lib.publication(&TEST.key()).unwrap();
    assert_eq!(publication.document_html(1).unwrap(), TEST.html);
    assert_eq!(progress.borrow().last(), Some(&(TOTAL, TOTAL)));
    assert!(progress.borrow().windows(2).all(|w| w[0].0 <= w[1].0));
    // The user's file is left where it was.
    assert!(path.is_file());
    env.assert_no_leftovers();

    // It is searchable like a downloaded copy.
    let hits = env
        .core()
        .search()
        .query("beginning", &SearchScope::default(), 10)
        .unwrap();
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0].location.pub_key, TEST.key());
    assert_eq!(hits[0].location.paragraph, Some(1));
}

#[test]
fn a_dated_issue_keeps_its_issue_tag() {
    let env = Env::new();
    let lib = env.core().library();
    let issue = Pub {
        symbol: "w99",
        year: 2099,
        issue: "20990100",
        title: "The Test Tower",
        publication_type: "Watchtower",
        ..TEST
    };
    let done = side_load(&lib, &issue.write(&env.files(), "w.jwpub"), false).unwrap();
    assert_eq!(
        done,
        SideLoad::Installed {
            publication: summary(&issue)
        }
    );
    assert_eq!(lib.installed().unwrap()[0].pub_key, "w99:0:20990100");
}

#[test]
fn an_installed_publication_is_left_alone_unless_replacing() {
    let env = Env::new();
    let lib = env.core().library();
    let files = env.files();
    side_load(&lib, &TEST.write(&files, "first.jwpub"), false).unwrap();
    let dirs = env.store_dirs();

    // Another copy of the same publication, with different content.
    let newer = Pub {
        html: "<p id=\"p1\" data-pid=\"1\">A newer printing</p>",
        ..TEST
    };
    let path = newer.write(&files, "second.jwpub");
    let progress = RefCell::new(Vec::new());
    let done = lib
        .side_load(
            &path,
            false,
            &|d, t| progress.borrow_mut().push((d, t)),
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(
        done,
        SideLoad::AlreadyInstalled {
            publication: summary(&TEST)
        }
    );
    // Nothing changed, and it stopped before indexing.
    assert_eq!(env.store_dirs(), dirs);
    let publication = lib.publication(&TEST.key()).unwrap();
    assert_eq!(publication.document_html(1).unwrap(), TEST.html);
    drop(publication);
    assert!(progress.borrow().iter().all(|&(d, _)| d <= 101));
    env.assert_no_leftovers();

    // Replacing installs it in a new directory and drops the old one.
    let done = side_load(&lib, &path, true).unwrap();
    assert_eq!(
        done,
        SideLoad::Installed {
            publication: summary(&TEST)
        }
    );
    assert_eq!(env.store_dirs().len(), 1);
    assert_ne!(env.store_dirs(), dirs);
    let publication = lib.publication(&TEST.key()).unwrap();
    assert_eq!(publication.document_html(1).unwrap(), newer.html);
    env.assert_no_leftovers();
}

#[test]
fn a_downloaded_copy_can_be_replaced_by_a_side_loaded_one_and_back() {
    let env = Env::new();
    let lib = env.core().library();
    let files = env.files();
    // With no catalog, `install` takes any file that is the named key.
    let path = TEST.write(&files, "t.jwpub");
    lib.install(&TEST.key(), &path, &|_, _| {}, &CancelToken::new())
        .unwrap();
    assert!(matches!(
        side_load(&lib, &path, false),
        Ok(SideLoad::AlreadyInstalled { .. })
    ));
    assert!(matches!(
        side_load(&lib, &path, true),
        Ok(SideLoad::Installed { .. })
    ));
    lib.install(&TEST.key(), &path, &|_, _| {}, &CancelToken::new())
        .unwrap();
    assert_eq!(lib.installed().unwrap(), vec![summary(&TEST)]);
    env.assert_no_leftovers();
}

#[test]
fn files_that_are_not_intact_publications_are_corrupt() {
    let env = Env::new();
    let lib = env.core().library();
    let files = env.files();
    // An installed publication that must survive every failure below.
    side_load(&lib, &TEST.write(&files, "good.jwpub"), false).unwrap();
    let before = lib.installed().unwrap();
    let dirs = env.store_dirs();

    let good = std::fs::read(
        Pub {
            symbol: "oth",
            ..TEST
        }
        .write(&files, "other.jwpub"),
    )
    .unwrap();
    let mut cases: Vec<(&str, Vec<u8>)> = vec![
        ("not a zip", b"%PDF-1.7 not a publication".to_vec()),
        ("empty", Vec::new()),
        ("truncated", good[..good.len() / 2].to_vec()),
        (
            "a zip of something else",
            zip_bytes(&[("notes.txt", b"hi")]),
        ),
    ];
    // Content that can't be decrypted with the publication's own key.
    cases.push((
        "wrong key",
        std::fs::read(
            Pub {
                symbol: "oth",
                ident: Some("1_oth_2024"),
                ..TEST
            }
            .write(&files, "wrong-key.jwpub"),
        )
        .unwrap(),
    ));
    // An identity no key can be made from.
    cases.push((
        "empty symbol",
        std::fs::read(Pub { symbol: "", ..TEST }.write(&files, "no-symbol.jwpub")).unwrap(),
    ));
    for (name, bytes) in cases {
        let path = files.join("case.jwpub");
        std::fs::write(&path, bytes).unwrap();
        for replace in [false, true] {
            let err = side_load(&lib, &path, replace).unwrap_err();
            assert!(matches!(err, CoreError::Corrupt), "{name}: {err:?}");
            assert_eq!(lib.installed().unwrap(), before, "{name}");
            assert_eq!(env.store_dirs(), dirs, "{name}");
            env.assert_no_leftovers();
        }
    }

    let err = side_load(&lib, &files.join("absent.jwpub"), false).unwrap_err();
    assert!(matches!(err, CoreError::Io(_)), "{err:?}");
    assert_eq!(lib.installed().unwrap(), before);
}

#[test]
fn cancelling_leaves_nothing() {
    let env = Env::new();
    let lib = env.core().library();
    let path = TEST.write(&env.files(), "t.jwpub");

    let cancel = CancelToken::new();
    cancel.cancel();
    let err = lib
        .side_load(&path, false, &|_, _| {}, &cancel)
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");

    // Cancelled partway, once unpacking has started.
    let cancel = CancelToken::new();
    let err = lib
        .side_load(
            &path,
            false,
            &|d, _| {
                if d > 1 {
                    cancel.cancel();
                }
            },
            &cancel,
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    assert!(lib.installed().unwrap().is_empty());
    assert!(env.store_dirs().is_empty());
    env.assert_no_leftovers();
}

#[test]
fn side_loaded_publications_persist_across_reopen() {
    let env = Env::new();
    let path = TEST.write(&env.files(), "t.jwpub");
    side_load(&env.core().library(), &path, false).unwrap();
    let lib = env.core().library();
    assert_eq!(lib.installed().unwrap(), vec![summary(&TEST)]);
    assert_eq!(
        lib.publication(&TEST.key())
            .unwrap()
            .document_html(1)
            .unwrap(),
        TEST.html
    );
}
