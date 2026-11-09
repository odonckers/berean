import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useReducer, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { reader } from '@/ffi/core';
import { localDay } from '@/ffi/local-day';
import { load } from '@/library/load';
import { UndoBar, useUndoBarBottom } from '@/notes/undo-bar';
import { BookmarkButton, BookmarkPicker, useBookmarkPicker } from '@/reader/bookmark-picker';
import {
  type BookmarkChange,
  barContentInset,
  barDuration,
  bookmarkBar,
  bookmarkUndoMessages,
  restoredAnnouncement,
} from '@/reader/bookmark-undo';
import {
  type BookmarkLocation,
  type BookmarkRow,
  type LocateResult,
  type SaveTarget,
  bookmarkRows,
  jumpAnnouncement,
  locationKey,
  shortcutOpensBookmarks,
  toolbarBookmark,
} from '@/reader/bookmarks';
import { useBookmarks } from '@/reader/use-bookmarks';
import { useBookmarkShortcut } from '../../modules/berean-shortcuts';

// A reader's bookmarks (bookmarks spec §3–§7), shared by the Bible reader
// and a publication's documents: the toolbar button and its state, the
// picker over the open publication's 10 slots with where each is now, the
// bar over the picker or the reader (Undo, or where a jump went), and
// Ctrl+D. The reader says what its button saves, where a slot is now in
// its own terms, and how a jump lands.

export type FilledRow = Extract<BookmarkRow, { kind: 'filled' }>;

/** A filled slot as the core holds it, for Undo to put back. */
const heldOf = (pubKey: string, row: FilledRow) => ({
  pubKey,
  slot: row.slot,
  location: row.location,
  title: row.title,
  snippet: row.snippet,
});

/** Reader.locate's answer for a saved location, or that it threw. A sync call that reads at most one chapter or document. */
export function locateNow(location: BookmarkLocation): LocateResult {
  const read = load(() => reader().locate(location, localDay()));
  return read.ok ? { ok: true, value: read.value } : { ok: false };
}

/**
 * The bar over a reader (spec §3.2, §7): one at a time, its clock started
 * as it shows (longer with a screen reader on), and gone with the reader:
 * when it loses focus or its publication changes. Also whether the reader
 * is focused, which Ctrl+D needs, and the bar's laid-out height.
 */
export function useBookmarkBar(pubKey: string) {
  const [bar, dispatchBar] = useReducer(bookmarkBar, undefined);
  const [barPubKey, setBarPubKey] = useState(pubKey);
  if (barPubKey !== pubKey) {
    setBarPubKey(pubKey);
    dispatchBar({ kind: 'left' });
  }
  useEffect(() => {
    if (bar === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled()
      .catch(() => false)
      .then((on) => {
        if (!cancelled) timer = setTimeout(() => dispatchBar({ kind: 'expired', id: bar.id }), barDuration(bar, on));
      });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [bar]);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        dispatchBar({ kind: 'left' });
      };
    }, []),
  );
  // Each bar lays out afresh; until it has, its height is estimated.
  const [height, setHeight] = useState<{ id: number; height: number }>();
  const barHeight = bar !== undefined && height?.id === bar.id ? height.height : undefined;
  const onBarHeight = (h: number) => {
    if (bar !== undefined) setHeight((was) => (was?.id === bar.id && was.height === h ? was : { id: bar.id, height: h }));
  };
  /** Say where a jump went instead (spec §7), on the bar and to screen readers. */
  const notice = (message: string) => {
    dispatchBar({ kind: 'notice', message });
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  };
  return { bar, dispatchBar, focused, barHeight, onBarHeight, notice };
}

/** A notice over a screen with no picker (a publication's contents, opened by a jump). */
export function NoticeBar({ bar }: { bar: ReturnType<typeof useBookmarkBar> }) {
  const bottom = useUndoBarBottom();
  if (bar.bar?.kind !== 'notice') return null;
  return <UndoBar key={bar.bar.id} label={bar.bar.message} bottom={bottom} onHeight={bar.onBarHeight} />;
}

/**
 * The open publication's bookmarks in a reader. `target` is what the
 * toolbar button saves; `scope` names the chapter or document it belongs
 * to, so a verse's Bookmark… (openFor) saves that verse only while it is
 * still the one open. `locate` says where a filled slot is now (and
 * whether it is missing), `snippet` what a save stores with the picker's
 * target, and `onJump` takes the reader there, returning the not-found
 * notice to show, if any, or nothing when it went nowhere. `ready`: the
 * text is read, so Ctrl+D opens the picker.
 */
export function useBookmarkHost<P extends { missing: boolean }>({
  pubKey,
  title,
  target,
  scope,
  locate,
  snippet,
  onJump,
  ready,
}: {
  pubKey: string;
  title: string;
  target: SaveTarget;
  scope: string;
  locate: (location: BookmarkLocation) => P;
  snippet: (target: SaveTarget) => string | undefined;
  onJump: (row: FilledRow, place: P) => { notice: string | undefined } | undefined;
  ready: boolean;
}): {
  button: ReactNode;
  open: boolean;
  openFor: (target: SaveTarget) => void;
  bar: ReturnType<typeof useBookmarkBar>;
  /** The reader's extra bottom padding while a bar shows over it. */
  contentInset: number;
  /** The picker, and the bar over the reader once it has closed. */
  overlay: ReactNode;
} {
  const { look } = useBerean();
  const bookmarks = useBookmarks(pubKey);
  const picker = useBookmarkPicker();
  const toolbarRows: readonly BookmarkRow[] | { message: string } = bookmarks.list.ok
    ? bookmarkRows(bookmarks.list.value, target.place)
    : { message: bookmarks.list.message };
  const toolbarState =
    'message' in toolbarRows ? { filled: false, value: undefined } : toolbarBookmark(toolbarRows, target.reference);
  // A Bookmark… on the text opens the picker in save mode for that place
  // (spec §3.1); the button and Ctrl+D save what the button would. Set as
  // the picker opens, for that opening and its scope.
  const [asked, setAsked] = useState<{ scope: string; target: SaveTarget }>();
  const pickerTarget = asked?.scope === scope ? asked.target : target;
  const slotRows: readonly BookmarkRow[] | { message: string } =
    'message' in toolbarRows || pickerTarget === target
      ? toolbarRows
      : bookmarkRows(bookmarks.list.ok ? bookmarks.list.value : [], pickerTarget.place);
  // Each opening reads the list again and locates its places afresh.
  const [openings, setOpenings] = useState(0);
  const openBookmarks = () => {
    if (!picker.open) {
      bookmarks.refresh();
      setAsked(undefined);
      setOpenings((n) => n + 1);
    }
    picker.toggle();
  };
  const openFor = (asking: SaveTarget) => {
    bookmarks.refresh();
    setAsked({ scope, target: asking });
    setOpenings((n) => n + 1);
    picker.show();
  };

  // Where each filled slot is now in this edition (spec §7), from the
  // core's Reader.locate: each place is located once per opening (and
  // publication), only while the picker is open. Kept as state, added to
  // as the rows render.
  const [located, setLocated] = useState<{ opening: number; pubKey: string; places: ReadonlyMap<string, P> }>(
    () => ({ opening: openings, pubKey, places: new Map() }),
  );
  let locatedNow =
    located.opening === openings && located.pubKey === pubKey
      ? located
      : { opening: openings, pubKey, places: new Map<string, P>() };
  const unlocated =
    picker.open && !('message' in slotRows)
      ? slotRows.flatMap((row) =>
          row.kind === 'filled' && !locatedNow.places.has(locationKey(row.location)) ? [row.location] : [],
        )
      : [];
  if (unlocated.length > 0) {
    const places = new Map(locatedNow.places);
    for (const location of unlocated) places.set(locationKey(location), locate(location));
    locatedNow = { ...locatedNow, places };
  }
  if (locatedNow !== located) setLocated(locatedNow);
  const placeOf = (location: BookmarkLocation): P => locatedNow.places.get(locationKey(location)) ?? locate(location);
  const slotPlaces = new Map<number, P>(
    picker.open && !('message' in slotRows)
      ? slotRows.flatMap((row) => (row.kind === 'filled' ? [[row.slot, placeOf(row.location)] as const] : []))
      : [],
  );

  // The bar over the picker, or over the reader once it closes.
  const bar = useBookmarkBar(pubKey);
  const { dispatchBar } = bar;
  const barBottom = useUndoBarBottom();
  const offerUndo = (change: BookmarkChange) => {
    dispatchBar({ kind: 'changed', change });
    AccessibilityInfo.announceForAccessibilityWithOptions(bookmarkUndoMessages(look, change).announcement, {
      queue: true,
    });
  };
  const undoBookmark = () => {
    if (bar.bar?.kind !== 'undo') return;
    const { previous } = bar.bar.change;
    dispatchBar({ kind: 'undone' });
    const message = bookmarks.restore(previous);
    AccessibilityInfo.announceForAccessibility(message ?? restoredAnnouncement(previous));
  };
  const barShown =
    bar.bar === undefined
      ? undefined
      : bar.bar.kind === 'undo'
        ? { label: bookmarkUndoMessages(look, bar.bar.change).label, onUndo: undoBookmark }
        : { label: bar.bar.message };

  // Saving the picker's target into a slot (an empty one, or a Replace):
  // its reference as the title, and the first line of its text.
  const saveBookmark = (slot: number) => {
    const message = bookmarks.save(slot, pickerTarget.place, pickerTarget.reference, snippet(pickerTarget));
    if (message === undefined) dispatchBar({ kind: 'saved', pubKey, slot });
    return message;
  };
  // Replace and Delete take effect at once, then offer Undo (Decision 4).
  const replaceBookmark = (row: FilledRow) => {
    const message = saveBookmark(row.slot);
    if (message === undefined) {
      offerUndo({ kind: 'replace', previous: heldOf(pubKey, row), reference: pickerTarget.reference });
    }
    return message;
  };
  const deleteBookmark = (row: FilledRow) => {
    const message = bookmarks.remove(row.slot);
    if (message === undefined) offerUndo({ kind: 'delete', previous: heldOf(pubKey, row) });
    return message;
  };
  // A jump closes the picker; the reader lands it, and a slot it couldn't
  // find exactly says where it went instead (spec §7). The slot stays.
  const jumpTo = (row: FilledRow) => {
    picker.close();
    const went = onJump(row, placeOf(row.location));
    if (went === undefined) return;
    AccessibilityInfo.announceForAccessibilityWithOptions(jumpAnnouncement(row.number, row.title), { queue: true });
    if (went.notice !== undefined) bar.notice(went.notice);
  };

  // Ctrl+D (or Meta+D) in the focused reader opens the picker in save mode (spec §4).
  useBookmarkShortcut((key) => {
    if (shortcutOpensBookmarks(key, { focused: bar.focused, chapterRead: ready }) && !picker.open) openBookmarks();
  }, bar.focused);

  const overReader = !picker.open && barShown !== undefined;
  const overlay = (
    <>
      <BookmarkPicker
        open={picker.open}
        onClose={picker.close}
        buttonRef={picker.buttonRef}
        title={title}
        target={pickerTarget}
        rows={slotRows}
        onSave={saveBookmark}
        onJump={jumpTo}
        places={slotPlaces}
        onReplace={replaceBookmark}
        onDelete={deleteBookmark}
        bar={picker.open ? barShown : undefined}
      />
      {/* Over the reader once the picker has closed; above the tab bar. */}
      {overReader && (
        <UndoBar
          key={bar.bar?.id}
          label={barShown.label}
          onUndo={barShown.onUndo}
          bottom={barBottom}
          onHeight={bar.onBarHeight}
        />
      )}
    </>
  );

  return {
    button: (
      <BookmarkButton
        buttonRef={picker.buttonRef}
        filled={toolbarState.filled}
        value={toolbarState.value}
        onPress={openBookmarks}
      />
    ),
    open: picker.open,
    openFor,
    bar,
    contentInset: barContentInset(overReader, bar.barHeight, spacing.lg),
    overlay,
  };
}
