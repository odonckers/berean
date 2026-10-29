//! Berean note folders in `userData.db`: names, tree order and counts, move,
//! delete and restore, filing notes, and the folder and tag note filters.
//! Import, undo and the schema checks are in `userdata.rs`, beside its
//! backup helpers.

use berean_core::userdata::{Folder, FolderScope, Note, NoteFilter, UserData};
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
}

fn is_invalid<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::Invalid(_)))
}

fn is_not_found<T: std::fmt::Debug>(r: Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::NotFound))
}

/// (name, depth, position) of every folder, in `folders()` order.
fn tree(ud: &UserData) -> Vec<(String, u32, u32)> {
    ud.folders()
        .unwrap()
        .into_iter()
        .map(|f| (f.name, f.depth, f.position))
        .collect()
}

fn t(name: &str, depth: u32, position: u32) -> (String, u32, u32) {
    (name.to_string(), depth, position)
}

fn folder(ud: &UserData, id: i64) -> Folder {
    ud.folders()
        .unwrap()
        .into_iter()
        .find(|f| f.id == id)
        .unwrap()
}

/// Add `n` free-standing notes filed in `folder`.
fn notes_in(ud: &UserData, folder: Option<i64>, n: usize) -> Vec<Note> {
    (0..n)
        .map(|i| {
            ud.add_note(&format!("n{i}"), "", None, None, folder)
                .unwrap()
        })
        .collect()
}

fn ids(notes: Vec<Note>) -> Vec<String> {
    notes.into_iter().map(|n| n.id).collect()
}

fn all_notes(ud: &UserData) -> Vec<Note> {
    ud.notes(&NoteFilter::default()).unwrap()
}

#[test]
fn folder_names_are_trimmed_non_empty_and_unique_among_siblings() {
    let env = Env::new();
    let ud = env.ud();
    let psalms = ud.create_folder("  Psalms  ", None).unwrap();
    assert_eq!(
        psalms,
        Folder {
            id: psalms.id,
            parent_id: None,
            name: "Psalms".into(),
            position: 0,
            depth: 0,
            note_count: 0,
            subfolder_count: 0,
        }
    );
    assert!(is_invalid(ud.create_folder("", None)));
    assert!(is_invalid(ud.create_folder(" \t\n", None)));
    // Case-insensitive, as SQLite's NOCASE (ASCII).
    let r = ud.create_folder("PSALMS", None);
    match &r {
        Err(CoreError::Invalid(msg)) => assert!(msg.contains("already there"), "{msg}"),
        other => panic!("{other:?}"),
    }
    assert!(is_invalid(ud.create_folder(" psalms ", None)));
    // The same name is fine under another parent.
    let john = ud.create_folder("John", None).unwrap();
    let inner = ud.create_folder("Psalms", Some(john.id)).unwrap();
    assert_eq!((inner.parent_id, inner.depth), (Some(john.id), 1));
    assert!(is_not_found(ud.create_folder("x", Some(9999))));

    // Rename: the same rules, the folder's own name (any case) is fine.
    ud.rename_folder(psalms.id, "psalms").unwrap();
    ud.rename_folder(psalms.id, " Songs ").unwrap();
    assert_eq!(folder(&ud, psalms.id).name, "Songs");
    assert!(is_invalid(ud.rename_folder(psalms.id, "  ")));
    assert!(is_invalid(ud.rename_folder(psalms.id, "JOHN")));
    ud.rename_folder(inner.id, "Songs").unwrap();
    assert!(is_not_found(ud.rename_folder(9999, "x")));
    // A failed call changes nothing.
    assert_eq!(
        tree(&ud),
        [t("Songs", 0, 0), t("John", 0, 1), t("Songs", 1, 0)]
    );
}

/// The guide's example: Gospel of John > Prologue (6), Signs (5),
/// Witnesses (3), plus Psalms with a nested folder.
struct Guide {
    env: Env,
    john: Folder,
    prologue: Folder,
    signs: Folder,
    witnesses: Folder,
    psalms: Folder,
    royal: Folder,
}

impl Guide {
    fn new() -> Self {
        let env = Env::new();
        let ud = env.ud();
        let john = ud.create_folder("Gospel of John", None).unwrap();
        let prologue = ud.create_folder("Prologue", Some(john.id)).unwrap();
        let signs = ud.create_folder("Signs", Some(john.id)).unwrap();
        let witnesses = ud.create_folder("Witnesses", Some(john.id)).unwrap();
        let psalms = ud.create_folder("Psalms", None).unwrap();
        let royal = ud.create_folder("Royal", Some(psalms.id)).unwrap();
        notes_in(&ud, Some(prologue.id), 6);
        notes_in(&ud, Some(signs.id), 5);
        notes_in(&ud, Some(witnesses.id), 3);
        notes_in(&ud, Some(royal.id), 1);
        notes_in(&ud, None, 2);
        drop(ud);
        Guide {
            env,
            john,
            prologue,
            signs,
            witnesses,
            psalms,
            royal,
        }
    }

    fn ud(&self) -> UserData {
        self.env.ud()
    }
}

#[test]
fn folders_come_in_tree_order_with_recursive_counts() {
    let g = Guide::new();
    let ud = g.ud();
    let all = ud.folders().unwrap();
    let rows: Vec<_> = all
        .iter()
        .map(|f| {
            (
                f.name.as_str(),
                f.parent_id,
                f.depth,
                f.position,
                f.note_count,
                f.subfolder_count,
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("Gospel of John", None, 0, 0, 14, 3),
            ("Prologue", Some(g.john.id), 1, 0, 6, 0),
            ("Signs", Some(g.john.id), 1, 1, 5, 0),
            ("Witnesses", Some(g.john.id), 1, 2, 3, 0),
            ("Psalms", None, 0, 1, 1, 1),
            ("Royal", Some(g.psalms.id), 1, 0, 1, 0),
        ]
    );
    // A note filed directly in a parent counts there too.
    notes_in(&ud, Some(g.john.id), 1);
    assert_eq!(folder(&ud, g.john.id).note_count, 15);
    assert_eq!(all_notes(&ud).len(), 18);
}

#[test]
fn move_folder_reparents_reorders_and_clamps() {
    let g = Guide::new();
    let ud = g.ud();
    // Move Down / Move Up within the parent.
    ud.move_folder(g.prologue.id, Some(g.john.id), 1).unwrap();
    assert_eq!(
        tree(&ud)[1..4],
        [t("Signs", 1, 0), t("Prologue", 1, 1), t("Witnesses", 1, 2)]
    );
    ud.move_folder(g.prologue.id, Some(g.john.id), 0).unwrap();
    assert_eq!(
        tree(&ud)[1..4],
        [t("Prologue", 1, 0), t("Signs", 1, 1), t("Witnesses", 1, 2)]
    );
    // Clamped to the end.
    ud.move_folder(g.prologue.id, Some(g.john.id), 99).unwrap();
    assert_eq!(
        tree(&ud)[1..4],
        [t("Signs", 1, 0), t("Witnesses", 1, 1), t("Prologue", 1, 2)]
    );

    // Reparent: dense positions in the old parent and the new one.
    ud.move_folder(g.signs.id, Some(g.psalms.id), 0).unwrap();
    assert_eq!(
        tree(&ud),
        [
            t("Gospel of John", 0, 0),
            t("Witnesses", 1, 0),
            t("Prologue", 1, 1),
            t("Psalms", 0, 1),
            t("Signs", 1, 0),
            t("Royal", 1, 1),
        ]
    );
    assert_eq!(folder(&ud, g.john.id).note_count, 9);
    assert_eq!(folder(&ud, g.psalms.id).note_count, 6);
    // To the top level, between the two, carrying its subtree.
    ud.move_folder(g.psalms.id, None, 0).unwrap();
    ud.move_folder(g.royal.id, None, 1).unwrap();
    assert_eq!(
        tree(&ud),
        [
            t("Psalms", 0, 0),
            t("Signs", 1, 0),
            t("Royal", 0, 1),
            t("Gospel of John", 0, 2),
            t("Witnesses", 1, 0),
            t("Prologue", 1, 1),
        ]
    );
    // Deeper nesting moves with its parent.
    ud.move_folder(g.witnesses.id, Some(g.signs.id), 0).unwrap();
    ud.move_folder(g.psalms.id, Some(g.john.id), 0).unwrap();
    assert_eq!(
        tree(&ud),
        [
            t("Royal", 0, 0),
            t("Gospel of John", 0, 1),
            t("Psalms", 1, 0),
            t("Signs", 2, 0),
            t("Witnesses", 3, 0),
            t("Prologue", 1, 1),
        ]
    );
}

#[test]
fn move_folder_rejects_cycles_clashes_and_unknowns() {
    let g = Guide::new();
    let ud = g.ud();
    let before = ud.folders().unwrap();
    // Into itself, a child, or a grandchild.
    assert!(is_invalid(ud.move_folder(g.john.id, Some(g.john.id), 0)));
    assert!(is_invalid(ud.move_folder(g.john.id, Some(g.signs.id), 0)));
    assert_eq!(ud.folders().unwrap(), before);
    ud.move_folder(g.witnesses.id, Some(g.signs.id), 0).unwrap();
    let before_deep = ud.folders().unwrap();
    assert!(is_invalid(ud.move_folder(
        g.john.id,
        Some(g.witnesses.id),
        0
    )));
    assert_eq!(ud.folders().unwrap(), before_deep);
    // A name taken in the new parent (any case).
    ud.create_folder("royal", Some(g.john.id)).unwrap();
    let with_clash = ud.folders().unwrap();
    assert!(is_invalid(ud.move_folder(g.royal.id, Some(g.john.id), 0)));
    assert!(is_not_found(ud.move_folder(9999, None, 0)));
    assert!(is_not_found(ud.move_folder(g.royal.id, Some(9999), 0)));
    assert_eq!(ud.folders().unwrap(), with_clash);
}

#[test]
fn delete_folder_unfiles_its_notes_and_restore_puts_it_back() {
    let g = Guide::new();
    let ud = g.ud();
    let before = ud.folders().unwrap();
    let notes_before = all_notes(&ud);

    let deleted = ud.delete_folder(g.john.id).unwrap();
    // The snapshot: the subtree in tree order, and every filed note in it.
    assert_eq!(deleted.folders, before[..4]);
    assert_eq!(deleted.notes.len(), 14);
    let filed: Vec<(String, i64)> = notes_before
        .iter()
        .filter(|n| n.folder_id.is_some_and(|f| f != g.royal.id))
        .map(|n| (n.id.clone(), n.folder_id.unwrap()))
        .collect();
    assert_eq!(
        deleted
            .notes
            .iter()
            .map(|n| (n.note_id.clone(), n.folder_id))
            .collect::<Vec<_>>(),
        filed
    );
    // The subtree is gone; the notes stay in All Notes, unfiled; Psalms
    // moved up to position 0.
    assert_eq!(tree(&ud), [t("Psalms", 0, 0), t("Royal", 1, 0)]);
    let after = all_notes(&ud);
    assert_eq!(after.len(), notes_before.len());
    assert_eq!(after.iter().filter(|n| n.folder_id.is_none()).count(), 16);
    let raw = env_rows(&g.env, "SELECT COUNT(*) FROM BereanNoteFolder");
    assert_eq!(raw, 1);
    assert!(is_not_found(ud.delete_folder(g.john.id)));

    // Meanwhile: one note is deleted, one is filed elsewhere.
    let (gone, moved) = (&filed[0].0, &filed[1].0);
    ud.remove_note(gone).unwrap();
    ud.set_note_folder(moved, Some(g.royal.id)).unwrap();
    // And a new top-level folder appears where John was.
    let newer = ud.create_folder("Newer", None).unwrap();

    ud.restore_folder(&deleted).unwrap();
    let mut want = before.clone();
    // John is back at position 0; Psalms and Newer follow, renumbered.
    want[4].position = 1;
    want[5].note_count = 2;
    want[4].note_count = 2;
    want[0].note_count = 12;
    want[1].note_count = 4;
    let back = ud.folders().unwrap();
    assert_eq!(back[..6], want[..6]);
    assert_eq!(back[6].id, newer.id);
    assert_eq!(back[6].position, 2);
    // The ids are the same.
    assert_eq!(back[1].id, g.prologue.id);
    // Refiled, except the deleted note and the one filed elsewhere.
    let notes = all_notes(&ud);
    for n in &notes {
        let was = notes_before.iter().find(|b| b.id == n.id).unwrap();
        if n.id == *moved {
            assert_eq!(n.folder_id, Some(g.royal.id));
        } else {
            assert_eq!(n.folder_id, was.folder_id, "{}", n.title);
        }
    }
    assert!(!notes.iter().any(|n| n.id == *gone));

    // Restoring twice: the ids are taken now.
    assert!(is_invalid(ud.restore_folder(&deleted)));
}

#[test]
fn delete_renumbers_siblings_and_restore_checks_its_parent() {
    let g = Guide::new();
    let ud = g.ud();
    let deleted = ud.delete_folder(g.prologue.id).unwrap();
    assert_eq!(
        tree(&ud)[..3],
        [
            t("Gospel of John", 0, 0),
            t("Signs", 1, 0),
            t("Witnesses", 1, 1)
        ]
    );
    assert_eq!(folder(&ud, g.john.id).note_count, 8);
    // Restored in its place among the siblings.
    ud.restore_folder(&deleted).unwrap();
    assert_eq!(
        tree(&ud)[..4],
        [
            t("Gospel of John", 0, 0),
            t("Prologue", 1, 0),
            t("Signs", 1, 1),
            t("Witnesses", 1, 2),
        ]
    );
    assert_eq!(folder(&ud, g.john.id).note_count, 14);

    // A sibling took the name meanwhile: Invalid, nothing changes.
    let deleted = ud.delete_folder(g.prologue.id).unwrap();
    let clash = ud.create_folder("PROLOGUE", Some(g.john.id)).unwrap();
    let state = (ud.folders().unwrap(), all_notes(&ud));
    assert!(is_invalid(ud.restore_folder(&deleted)));
    assert_eq!((ud.folders().unwrap(), all_notes(&ud)), state);
    ud.delete_folder(clash.id).unwrap();

    // The parent is gone: Invalid, nothing changes.
    ud.delete_folder(g.john.id).unwrap();
    let state = (ud.folders().unwrap(), all_notes(&ud));
    assert!(is_invalid(ud.restore_folder(&deleted)));
    assert_eq!((ud.folders().unwrap(), all_notes(&ud)), state);
}

fn env_rows(env: &Env, sql: &str) -> i64 {
    env.raw().query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn notes_are_filed_unfiled_and_lose_filing_on_removal() {
    let env = Env::new();
    let ud = env.ud();
    let a = ud.create_folder("A", None).unwrap();
    let b = ud.create_folder("B", None).unwrap();
    let n = ud.add_note("In A", "", None, None, Some(a.id)).unwrap();
    assert_eq!(n.folder_id, Some(a.id));
    assert!(is_not_found(ud.add_note("x", "", None, None, Some(9999))));
    // Not added at all: the folder check is in the same transaction.
    assert_eq!(all_notes(&ud).len(), 1);

    ud.set_note_folder(&n.id, Some(b.id)).unwrap();
    assert_eq!(all_notes(&ud)[0].folder_id, Some(b.id));
    ud.set_note_folder(&n.id, None).unwrap();
    assert_eq!(all_notes(&ud)[0].folder_id, None);
    ud.set_note_folder(&n.id, None).unwrap();
    assert!(is_not_found(ud.set_note_folder("nope", Some(a.id))));
    assert!(is_not_found(ud.set_note_folder("nope", None)));
    assert!(is_not_found(ud.set_note_folder(&n.id, Some(9999))));

    ud.set_note_folder(&n.id, Some(a.id)).unwrap();
    assert_eq!(folder(&ud, a.id).note_count, 1);
    ud.remove_note(&n.id).unwrap();
    assert_eq!(folder(&ud, a.id).note_count, 0);
    assert_eq!(env_rows(&env, "SELECT COUNT(*) FROM BereanNoteFolder"), 0);
}

#[test]
fn note_filter_by_folder_scope_and_all_tags() {
    let g = Guide::new();
    let ud = g.ud();
    let by = |folder: FolderScope| {
        ud.notes(&NoteFilter {
            folder: Some(folder),
            ..NoteFilter::default()
        })
    };
    let scope = |id: i64, include_subfolders: bool| FolderScope::Folder {
        id,
        include_subfolders,
    };
    assert_eq!(by(FolderScope::Unfiled).unwrap().len(), 2);
    assert_eq!(by(scope(g.signs.id, false)).unwrap().len(), 5);
    assert_eq!(by(scope(g.signs.id, true)).unwrap().len(), 5);
    assert!(by(scope(g.john.id, false)).unwrap().is_empty());
    assert_eq!(by(scope(g.john.id, true)).unwrap().len(), 14);
    assert_eq!(by(scope(g.psalms.id, true)).unwrap().len(), 1);
    assert!(is_not_found(by(scope(9999, false))));
    assert!(is_not_found(by(scope(9999, true))));
    assert!(by(scope(g.signs.id, false))
        .unwrap()
        .iter()
        .all(|n| n.folder_id == Some(g.signs.id)));

    // Tags: a note must have all of them.
    let signs = ids(by(scope(g.signs.id, false)).unwrap());
    let x = ud.add_tag("x").unwrap();
    let y = ud.add_tag("y").unwrap();
    for id in &signs[..3] {
        ud.tag_note(id, x.id).unwrap();
    }
    for id in &signs[1..] {
        ud.tag_note(id, y.id).unwrap();
    }
    let tagged = |tag_ids: Vec<i64>| {
        ids(ud
            .notes(&NoteFilter {
                tag_ids,
                ..NoteFilter::default()
            })
            .unwrap())
    };
    assert_eq!(tagged(vec![x.id]), signs[..3]);
    assert_eq!(tagged(vec![y.id]), signs[1..]);
    assert_eq!(tagged(vec![x.id, y.id]), signs[1..3]);
    assert_eq!(tagged(vec![y.id, x.id]), signs[1..3]);
    assert_eq!(tagged(vec![]).len(), 17);
    // Combined with a folder scope.
    let in_john_xy = ud
        .notes(&NoteFilter {
            tag_ids: vec![x.id, y.id],
            folder: Some(scope(g.john.id, true)),
            location: None,
        })
        .unwrap();
    assert_eq!(ids(in_john_xy), signs[1..3]);
    let unfiled_x = ud
        .notes(&NoteFilter {
            tag_ids: vec![x.id],
            folder: Some(FolderScope::Unfiled),
            location: None,
        })
        .unwrap();
    assert!(unfiled_x.is_empty());
}
