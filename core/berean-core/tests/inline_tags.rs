//! Inline #tags in note bodies: syncing them with the note's tags on
//! `add_note` and `update_note`, rewriting them on `rename_tag`, and
//! checking tasks with `set_task`.

use berean_core::notes::{Block, NoteTask};
use berean_core::reader::Location;
use berean_core::userdata::{Note, NoteFilter, UserData};
use berean_core::{Core, CoreError};
use rusqlite::Connection;

struct Env {
    dir: tempfile::TempDir,
    core: Core,
}

impl Env {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(dir.path().join("data"), dir.path().join("cache"))
            .unwrap_or_else(|e| panic!("open core: {e:?}"));
        Env { dir, core }
    }

    fn ud(&self) -> UserData {
        self.core.userdata()
    }

    /// A second, raw connection to `userData.db`, to check rows.
    fn raw(&self) -> Connection {
        Connection::open(self.dir.path().join("data/userData.db")).unwrap()
    }

    /// Backdate the note `id`, so a write that stamps it shows.
    fn backdate(&self, id: &str) {
        self.raw()
            .execute(
                "UPDATE Note SET LastModified = '2000-01-01T00:00:00Z' WHERE Guid = ?1",
                [id],
            )
            .unwrap();
    }
}

fn add(ud: &UserData, content: &str) -> Note {
    ud.add_note("t", content, None, None, None).unwrap()
}

fn note(ud: &UserData, id: &str) -> Note {
    ud.notes(&NoteFilter::default())
        .unwrap()
        .into_iter()
        .find(|n| n.id == id)
        .unwrap()
}

/// The user tag names, oldest first.
fn tag_names(ud: &UserData) -> Vec<String> {
    ud.tags().unwrap().into_iter().map(|t| t.name).collect()
}

/// The names of the note `id`'s tags, sorted.
fn note_tags(ud: &UserData, id: &str) -> Vec<String> {
    let tags = ud.tags().unwrap();
    let mut names: Vec<String> = note(ud, id)
        .tag_ids
        .iter()
        .map(|t| tags.iter().find(|tag| tag.id == *t).unwrap().name.clone())
        .collect();
    names.sort();
    names
}

fn tag_id(ud: &UserData, name: &str) -> i64 {
    ud.tags()
        .unwrap()
        .into_iter()
        .find(|t| t.name == name)
        .unwrap()
        .id
}

fn is_invalid<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::Invalid(_)))
}

fn is_not_found<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::NotFound))
}

// Sync on add and update.

#[test]
fn add_note_creates_and_tags_inline_tags() {
    let env = Env::new();
    let ud = env.ud();
    let n = add(&ud, "Read John 1 #light #Prologue");
    assert_eq!(tag_names(&ud), ["light", "Prologue"]);
    assert_eq!(note_tags(&ud, &n.id), ["Prologue", "light"]);
    // `add_note` returns the note as tagged.
    assert_eq!(n.tag_ids.len(), 2);
    // Positions follow `tag_note`'s rule: last among each tag's members.
    let m = add(&ud, "#light again");
    let position: i64 = env
        .raw()
        .query_row(
            "SELECT m.Position FROM TagMap m JOIN Note n ON n.NoteId = m.NoteId \
             WHERE n.Guid = ?1",
            [&m.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(position, 1);
}

#[test]
fn inline_tags_match_existing_tags_ignoring_case() {
    let env = Env::new();
    let ud = env.ud();
    let light = ud.add_tag("Light").unwrap();
    let luz = ud.add_tag("Luz").unwrap();
    let ever = ud.add_tag("Ÿear").unwrap();
    let n = add(&ud, "#light #LIGHT #luz #LUZ #ÿEAR #Ñandú");
    // No duplicates; non-ASCII case folds too; a new tag is spelled as typed.
    assert_eq!(tag_names(&ud), ["Light", "Luz", "Ÿear", "Ñandú"]);
    let mut ids = note(&ud, &n.id).tag_ids;
    ids.sort();
    let mut want = vec![light.id, luz.id, ever.id, tag_id(&ud, "Ñandú")];
    want.sort();
    assert_eq!(ids, want);
    // A second spelling in one body makes one new tag, not two.
    add(&ud, "#Gracia #gracia");
    assert_eq!(tag_names(&ud).last().unwrap(), "Gracia");
    assert_eq!(tag_names(&ud).len(), 5);
}

#[test]
fn tags_in_code_and_link_text_are_ignored() {
    let env = Env::new();
    let ud = env.ud();
    let n = add(
        &ud,
        "`#code` [#text](https://x.org/#url)\n\n```\n#fenced\n```\n\n    #indented\n\n\
         # Heading\n\na#b",
    );
    assert!(tag_names(&ud).is_empty(), "{:?}", tag_names(&ud));
    assert!(note(&ud, &n.id).tag_ids.is_empty());
}

#[test]
fn update_removes_only_tags_that_left_the_body() {
    let env = Env::new();
    let ud = env.ud();
    let n = add(&ud, "#light #prologue #word");
    let manual = ud.add_tag("Sermons").unwrap();
    ud.tag_note(&n.id, manual.id).unwrap();
    // `#prologue` left (and `#Word` is the same tag as `#word`).
    ud.update_note(&n.id, "t", "#light #Word #new").unwrap();
    assert_eq!(note_tags(&ud, &n.id), ["Sermons", "light", "new", "word"]);
    // The tag itself stays.
    assert!(tag_names(&ud).contains(&"prologue".to_string()));
    // A tag added by hand that is also inline goes when it leaves the body;
    // one that was never inline stays even though the body doesn't name it.
    let manual_inline = tag_id(&ud, "prologue");
    ud.tag_note(&n.id, manual_inline).unwrap();
    ud.update_note(&n.id, "t", "no tags").unwrap();
    assert_eq!(note_tags(&ud, &n.id), ["Sermons", "prologue"]);
    // Writing `#sermons` then dropping it takes the tag off.
    ud.update_note(&n.id, "t", "#sermons").unwrap();
    ud.update_note(&n.id, "t", "").unwrap();
    assert_eq!(note_tags(&ud, &n.id), ["prologue"]);
    assert!(is_not_found(ud.update_note("nope", "t", "#x")));
    assert!(!tag_names(&ud).contains(&"x".to_string()));
}

#[test]
fn favorites_are_untouched() {
    let env = Env::new();
    let ud = env.ud();
    let fav = Location {
        pub_key: "nwtsty:0:0".into(),
        doc_id: None,
        book: None,
        chapter: None,
        verse: None,
        paragraph: None,
    };
    ud.add_favorite(&fav).unwrap();
    let favorites = |env: &Env| {
        env.raw()
            .prepare(
                "SELECT t.TagId, t.Type, t.Name, m.Position FROM Tag t \
                 LEFT JOIN TagMap m ON m.TagId = t.TagId WHERE t.Type <> 1 ORDER BY t.TagId",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let before = favorites(&env);
    // The built-in Favorites tag is called "Favorite".
    let n = add(&ud, "#Favorite #favorite");
    ud.update_note(&n.id, "t", "gone").unwrap();
    assert_eq!(favorites(&env), before);
    assert_eq!(ud.favorites().unwrap(), [fav]);
    // `#Favorite` made a user tag of that name.
    assert_eq!(tag_names(&ud), ["Favorite"]);
}

// Rename.

#[test]
fn rename_tag_rewrites_inline_tags_in_tagged_notes() {
    let env = Env::new();
    let ud = env.ud();
    let body = "#light and #Light, not #lights or `#light`\n\n\
                [#light](https://x.org/#light) - [ ] #light_x **#LIGHT**\n\n\
                > quoted #light\n";
    let tagged = add(&ud, body);
    let other = ud.add_note("o", "#light", None, None, None).unwrap();
    // A note without the tag (it was taken off by hand) keeps its body.
    let light = tag_id(&ud, "light");
    ud.untag_note(&other.id, light).unwrap();
    env.backdate(&tagged.id);
    env.backdate(&other.id);
    ud.rename_tag(light, "lumen").unwrap();
    assert_eq!(
        note(&ud, &tagged.id).content,
        "#lumen and #lumen, not #lights or `#light`\n\n\
         [#light](https://x.org/#light) - [ ] #light_x **#lumen**\n\n\
         > quoted #lumen\n"
    );
    assert_ne!(note(&ud, &tagged.id).modified, "2000-01-01T00:00:00Z");
    assert_eq!(note(&ud, &other.id).content, "#light");
    assert_eq!(note(&ud, &other.id).modified, "2000-01-01T00:00:00Z");
    assert_eq!(note_tags(&ud, &tagged.id), ["light_x", "lights", "lumen"]);
    // The next edit keeps the tag: the body now says `#lumen`.
    let content = note(&ud, &tagged.id).content;
    ud.update_note(&tagged.id, "t", &content).unwrap();
    assert_eq!(note_tags(&ud, &tagged.id), ["light_x", "lights", "lumen"]);
}

#[test]
fn rename_to_a_name_that_isnt_an_inline_tag_keeps_bodies() {
    let env = Env::new();
    let ud = env.ud();
    let n = add(&ud, "#light here");
    let light = tag_id(&ud, "light");
    env.backdate(&n.id);
    ud.rename_tag(light, "true light").unwrap();
    assert_eq!(tag_names(&ud), ["true light"]);
    assert_eq!(note(&ud, &n.id).content, "#light here");
    assert_eq!(note(&ud, &n.id).modified, "2000-01-01T00:00:00Z");
    // An old name that isn't an inline tag rewrites nothing either.
    let spaced = ud.add_tag("my tag").unwrap();
    ud.tag_note(&n.id, spaced.id).unwrap();
    ud.rename_tag(spaced.id, "mine").unwrap();
    assert_eq!(note(&ud, &n.id).content, "#light here");
    // Validation is unchanged.
    assert!(is_invalid(ud.rename_tag(light, "mine")));
    assert!(is_invalid(ud.rename_tag(light, " ")));
    assert!(is_not_found(ud.rename_tag(999, "x")));
}

#[test]
fn remove_tag_keeps_bodies() {
    let env = Env::new();
    let ud = env.ud();
    let n = add(&ud, "#light");
    ud.remove_tag(tag_id(&ud, "light")).unwrap();
    assert_eq!(note(&ud, &n.id).content, "#light");
    assert!(note(&ud, &n.id).tag_ids.is_empty());
    // The next edit brings it back.
    ud.update_note(&n.id, "t", "#light").unwrap();
    assert_eq!(note_tags(&ud, &n.id), ["light"]);
}

// Tasks.

/// The tasks of a rendered body, in document order.
fn tasks(blocks: &[Block], out: &mut Vec<NoteTask>) {
    for block in blocks {
        match block {
            Block::List { items, .. } => {
                for item in items {
                    out.extend(item.task.clone());
                    tasks(&item.blocks, out);
                }
            }
            Block::Quote { blocks } => tasks(blocks, out),
            _ => {}
        }
    }
}

fn checked(ud: &UserData, id: &str) -> Vec<bool> {
    let mut out = Vec::new();
    tasks(
        &ud.render_markdown(&note(ud, id).content).unwrap(),
        &mut out,
    );
    out.iter()
        .enumerate()
        .map(|(i, t)| {
            assert_eq!(t.index as usize, i);
            t.checked
        })
        .collect()
}

#[test]
fn set_task_rewrites_only_the_marker() {
    let env = Env::new();
    let ud = env.ud();
    let body = "Plan [ ] not a task #todo\n\n\
                - [ ] one\n  - [X] two, nested\n    1. [ ] three, deeper\n\
                - [x] four `[ ]`\n\n\
                > - [ ] five\n\n\
                ```\n- [ ] code, not a task\n```\n";
    let n = add(&ud, body);
    assert_eq!(checked(&ud, &n.id), [false, true, false, true, false]);
    env.backdate(&n.id);

    ud.set_task(&n.id, 2, true).unwrap();
    let want = body.replacen("1. [ ] three", "1. [x] three", 1);
    assert_eq!(note(&ud, &n.id).content, want);
    assert_ne!(note(&ud, &n.id).modified, "2000-01-01T00:00:00Z");
    assert_eq!(checked(&ud, &n.id), [false, true, true, true, false]);

    // Checking a checked `X` keeps it; unchecking it clears it.
    ud.set_task(&n.id, 1, true).unwrap();
    assert_eq!(note(&ud, &n.id).content, want);
    ud.set_task(&n.id, 1, false).unwrap();
    let want = want.replacen("[X] two", "[ ] two", 1);
    assert_eq!(note(&ud, &n.id).content, want);

    ud.set_task(&n.id, 4, true).unwrap();
    ud.set_task(&n.id, 3, false).unwrap();
    let want =
        want.replacen("> - [ ] five", "> - [x] five", 1)
            .replacen("- [x] four", "- [ ] four", 1);
    assert_eq!(note(&ud, &n.id).content, want);
    assert_eq!(checked(&ud, &n.id), [false, false, true, false, true]);
    // Tags are unchanged.
    assert_eq!(note_tags(&ud, &n.id), ["todo"]);

    assert!(is_invalid(ud.set_task(&n.id, 5, true)));
    assert!(is_invalid(ud.set_task(&n.id, u32::MAX, true)));
    assert_eq!(note(&ud, &n.id).content, want);
    assert!(is_not_found(ud.set_task("nope", 0, true)));
    let empty = add(&ud, "");
    assert!(is_invalid(ud.set_task(&empty.id, 0, true)));
}
