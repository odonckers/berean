//! Berean's data sources on Exact (docs/frontend-rebuild.md, slice 1).
//!
//! The view's resources are answered here, in Rust, by the same core the
//! Expo app uses. The crate opens the core in the app's own data directory,
//! which the host names in `configure_storage`; it is placed on a worker, so
//! the core's SQLite and file reads never run on the thread that draws.

use std::path::PathBuf;

use berean_core::library::{PubKind, PublicationSummary};
use berean_core::reader::{BibleChapter, ChapterBlock, ParagraphStyle};
use berean_core::{CancelToken, Core};
use exact_plan::Value;
pub use exact_runner::Placement;
use exact_runner::{Answer, DataError, DataSource, Store};

/// The app's identity, shared with `app.ts` and `app.json`.
pub const APP: &str = "com.odonckers.berean.exact";
/// No storage grants: the core reads and writes its own files under the
/// data directory, never through the host's `storage` requests.
pub const GRANTS: &str = "";

/// The sources this crate owns: every source the view declares.
pub const RUST_SOURCES: &[&str] = &["library", "bibleChapter"];

/// The sources `app.ts` owns: none.
pub const TYPESCRIPT_SOURCES: &[&str] = &[];

/// The app's two owners, TypeScript (empty) and this crate, placed.
pub type Data<J> = exact_data::Mixed<J, exact_data::Placed<Berean>>;

/// Compose the TypeScript module with this crate, placed as `rust` says.
pub fn mixed<J: DataSource>(javascript: J, rust: Placement) -> Data<J> {
    exact_data::Mixed::new(
        javascript,
        exact_data::Placed::new(Berean::default(), rust),
        TYPESCRIPT_SOURCES,
        RUST_SOURCES,
    )
    .expect("Berean's sources have one owner each and one app identity")
    .with_embedded_rust(|placed| {
        Ok(exact_data::Placed::new(
            Berean::default(),
            placed.given_placement(),
        ))
    })
}

/// The core, opened on first use in the directory the host names.
#[derive(Default)]
pub struct Berean {
    dirs: Option<(PathBuf, PathBuf)>,
    core: Option<Core>,
}

impl Berean {
    /// The open core, opening it (and installing anything waiting in the
    /// inbox) the first time. `None` where the host gave no storage: the
    /// build's bake and a drive with no scratch store.
    fn core(&mut self) -> Result<Option<&Core>, String> {
        if self.core.is_none() {
            let Some((data, cache)) = self.dirs.clone() else {
                return Ok(None);
            };
            let core =
                Core::open(data.join("core"), cache.join("core")).map_err(|e| e.to_string())?;
            take_inbox(&core, &data.join("inbox"));
            self.core = Some(core);
        }
        Ok(self.core.as_ref())
    }

    fn library(&mut self) -> Value {
        let core = match self.core() {
            Ok(Some(core)) => core,
            Ok(None) => {
                return shelf(
                    "This build has no storage to read publications from.",
                    vec![],
                )
            }
            Err(error) => return shelf(&format!("The library could not open: {error}"), vec![]),
        };
        match core.library().installed() {
            Ok(pubs) if pubs.is_empty() => shelf("No publications are installed yet.", vec![]),
            Ok(pubs) => shelf("", pubs.iter().map(publication).collect()),
            Err(error) => shelf(&format!("The library could not be read: {error}"), vec![]),
        }
    }

    fn bible_chapter(&mut self, key: &str, book: u32, chapter: u32) -> Value {
        if key.is_empty() {
            return empty_chapter(book, chapter, "");
        }
        let core = match self.core() {
            Ok(Some(core)) => core,
            Ok(None) => return empty_chapter(book, chapter, "No storage in this build."),
            Err(error) => return empty_chapter(book, chapter, &error),
        };
        let reader = core.reader();
        let books = match reader.bible_books(key) {
            Ok(books) => books,
            Err(error) => {
                return empty_chapter(
                    book,
                    chapter,
                    &format!("This publication is not a Bible: {error}"),
                )
            }
        };
        let Some(info) = books.iter().find(|b| b.book == book) else {
            return empty_chapter(book, chapter, "This Bible doesn't have that book.");
        };
        match reader.bible_chapter(key, book, chapter) {
            Ok(read) => chapter_value(&read, &info.name, info.chapter_count),
            Err(error) => empty_chapter(
                book,
                chapter,
                &format!("The chapter could not be read: {error}"),
            ),
        }
    }
}

/// Install each `.jwpub` waiting in `inbox`, then remove it. This is how the
/// test build gets a Bible without a download screen: CI copies the pinned
/// fixture there before it drives the app.
fn take_inbox(core: &Core, inbox: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(inbox) else {
        return;
    };
    let cancel = CancelToken::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jwpub") {
            continue;
        }
        let none = |_: u64, _: u64| {};
        if let Err(error) = core.library().side_load(&path, true, &none, &cancel) {
            eprintln!("berean: {} could not be installed: {error}", path.display());
        }
        let _ = std::fs::remove_file(&path);
    }
}

fn shelf(message: &str, pubs: Vec<Value>) -> Value {
    Value::record(vec![Value::str(message), Value::list(pubs)])
}

fn publication(p: &PublicationSummary) -> Value {
    let kind = match p.kind {
        PubKind::Bible => "Bible",
        PubKind::Book => "Book",
        PubKind::Brochure => "Brochure",
        PubKind::Watchtower => "The Watchtower",
        PubKind::Awake => "Awake!",
        PubKind::Index => "Index",
        PubKind::MeetingWorkbook => "Meeting Workbook",
        PubKind::Other => "Publication",
    };
    let title = p.issue_title.clone().unwrap_or_else(|| p.title.clone());
    let detail = if p.year > 0 {
        format!("{kind} · {}", p.year)
    } else {
        kind.to_string()
    };
    Value::record(vec![
        Value::str(&p.pub_key),
        Value::str(&p.symbol),
        Value::str(&title),
        Value::str(kind),
        Value::str(&detail),
        Value::Bool(matches!(p.kind, PubKind::Bible)),
    ])
}

fn empty_chapter(book: u32, chapter: u32, message: &str) -> Value {
    Value::record(vec![
        Value::str(""),
        Value::str(message),
        Value::Number(book as f64),
        Value::Number(chapter as f64),
        Value::Number(0.0),
        Value::list(vec![]),
    ])
}

/// A run of the view's paragraph: `Run` in app.contract, its fields in order.
fn run(id: String, text: &str, verse: u32, label: bool, mark: &str) -> Value {
    Value::record(vec![
        Value::str(&id),
        Value::str(text),
        Value::Number(verse as f64),
        Value::Bool(label),
        Value::str(mark),
    ])
}

/// The test build's sample highlights: verse 16 in yellow and, in verse 3,
/// the first word of more than six letters in green. Real highlights come
/// from the user's data once word highlighting (#116) merges.
const MARKED_VERSE: u32 = 16;
const MARKED_WORD_VERSE: u32 = 3;

fn chapter_value(read: &BibleChapter, book_name: &str, last: u32) -> Value {
    let mut paras = Vec::new();
    for (index, block) in read.blocks.iter().enumerate() {
        match block {
            ChapterBlock::Heading { text } => paras.push(Value::record(vec![
                Value::str(&format!("h{index}")),
                Value::str("heading"),
                Value::list(vec![run(format!("h{index}"), text, 0, false, "")]),
            ])),
            ChapterBlock::Paragraph { style, runs, .. } => {
                let kind = match style {
                    ParagraphStyle::Prose => "prose",
                    ParagraphStyle::PoetryLine | ParagraphStyle::PoetryContinuation => "poetry",
                    ParagraphStyle::Superscription => "superscription",
                    ParagraphStyle::Note => "note",
                };
                let mut out = Vec::new();
                for (r, part) in runs.iter().enumerate() {
                    let id = format!("{index}.{r}");
                    if let Some(label) = &part.label {
                        out.push(run(format!("{id}l"), label, part.verse, true, ""));
                    }
                    let text = format!("{} ", part.text);
                    if part.verse == MARKED_WORD_VERSE {
                        if let Some((start, end)) = long_word(&text) {
                            out.push(run(format!("{id}a"), &text[..start], part.verse, false, ""));
                            out.push(run(
                                format!("{id}b"),
                                &text[start..end],
                                part.verse,
                                false,
                                "markGreen",
                            ));
                            out.push(run(format!("{id}c"), &text[end..], part.verse, false, ""));
                            continue;
                        }
                    }
                    let mark = if part.verse == MARKED_VERSE {
                        "markYellow"
                    } else {
                        ""
                    };
                    out.push(run(format!("{id}t"), &text, part.verse, false, mark));
                }
                paras.push(Value::record(vec![
                    Value::str(&format!("p{index}")),
                    Value::str(kind),
                    Value::list(out),
                ]));
            }
        }
    }
    Value::record(vec![
        Value::str(&format!("{book_name} {}", read.chapter)),
        Value::str(""),
        Value::Number(read.book as f64),
        Value::Number(read.chapter as f64),
        Value::Number(last as f64),
        Value::list(paras),
    ])
}

/// The byte range of the first word longer than six letters, if any.
fn long_word(text: &str) -> Option<(usize, usize)> {
    let mut start = None;
    for (i, c) in text.char_indices() {
        match (c.is_alphabetic(), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                if text[s..i].chars().count() > 6 {
                    return Some((s, i));
                }
                start = None;
            }
            _ => {}
        }
    }
    None
}

fn number(args: &[Value], at: usize) -> u32 {
    args.get(at)
        .and_then(Value::as_number)
        .filter(|n| *n >= 0.0)
        .map_or(0, |n| n as u32)
}

fn string(args: &[Value], at: usize) -> String {
    args.get(at)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

impl DataSource for Berean {
    fn app_id(&self) -> &str {
        APP
    }

    fn grants(&self) -> &str {
        GRANTS
    }

    fn configure_storage(
        &mut self,
        data: PathBuf,
        cache: PathBuf,
        _temporary: PathBuf,
    ) -> Result<(), DataError> {
        // Paths only: the core opens on the first answer, after first pixel.
        self.dirs = Some((data, cache));
        Ok(())
    }

    /// The build's first frame: nothing is installed yet as far as it knows.
    fn query(&mut self, source: &str, args: &[Value]) -> Result<Value, DataError> {
        match source {
            "library" => Ok(shelf("", vec![])),
            "bibleChapter" => Ok(empty_chapter(number(args, 1), number(args, 2), "")),
            _ => Err(DataError::UnknownSource(source.into())),
        }
    }

    fn answer(&mut self, _: &mut Store, source: &str, args: &[Value]) -> Result<Answer, DataError> {
        Ok(Answer::Now(match source {
            "library" => self.library(),
            "bibleChapter" => {
                self.bible_chapter(&string(args, 0), number(args, 1), number(args, 2))
            }
            _ => return Err(DataError::UnknownSource(source.into())),
        }))
    }
}
