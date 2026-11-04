import { MaterialSymbols_400Regular_Filled } from '@expo-google-fonts/material-symbols/400Regular_Filled';
import {
  type ComponentRef,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  type LayoutChangeEvent,
  Modal,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TargetedEvent,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { PopoverCard, SheetCloseButton, SheetHandle, SlidingSheet, useSheetChrome } from '@/components/sheet';
import { UIText } from '@/components/text';
import { systemBarStyle, useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { useWindowClass } from '@/design/use-window-class';
import {
  type BookmarkRow,
  DELETE_LABEL,
  MEDIUM_DETENT_MIN_ROWS,
  NOT_FOUND_NOTE,
  type SaveTarget,
  type SlotPlace,
  allSlotsFull,
  bookmarkPickerPlacement,
  bookmarkSheetFit,
  bookmarkSheetHeights,
  bookmarkSheetOpensAt,
  replaceLabel,
  rowAction,
  rowContentKey,
  rowFocusNeighbours,
  rowLabel,
  rowMenuLabel,
  saveLine,
  savedAnnouncement,
} from '@/reader/bookmarks';
import { ActionSheet } from '@/notes/action-sheet';
import { type Anchor, SwipeRow } from '@/notes/list-rows';
import { UndoBar } from '@/notes/undo-bar';
import { LARGE_TEXT_SCALE } from '@/reader/pane-snap';
import { moveAccessibilityFocus } from '@/reader/study-pane';
import { followFocusRingIn } from '../../modules/berean-shortcuts';
import { ModalNavigationBarStyle } from '../../modules/berean-system-bars';

// The Bible reader's bookmarks (bookmarks spec §3, §4, §6): the toolbar
// button, and the picker, which is the list of the open publication's 10
// slots. It opens in its own window (a Modal), so it is modal in every
// form: an M3 modal bottom sheet with a scrim (Material, as tall as its
// content up to the M3 top margin, capped at 640dp and centered from
// 600dp), the iOS look's phone sheet at the medium
// detent with a grabber (drag up to full height, down to dismiss; at the
// large detent when the medium one can't show three whole slots), or the
// iOS look's tablet card anchored under the button (a tap outside closes
// it). Back, and Escape, which Android maps to it, close each of them.
// A filled slot's Replace and Delete are in its trailing ⋯ / ⋮ menu, its
// long press, its custom accessibility actions and, in the iOS look, a
// trailing swipe; Undo shows over the picker while it is open.

type ButtonRef = RefObject<ComponentRef<typeof View> | null>;

// The row's content cross-fades as it changes (spec §5: a save, Replace,
// Delete or Undo), Reduce Motion included: a fade isn't movement.
const SAVE_FADE_MS = 150;
const fadeIn = FadeIn.duration(SAVE_FADE_MS).reduceMotion(ReduceMotion.Never);
const fadeOut = FadeOut.duration(SAVE_FADE_MS).reduceMotion(ReduceMotion.Never);
/** After the fade, the saved row stays this long before the picker goes, so the save is seen. */
const SAVE_HOLD_MS = 300;
/** The slot number's column: as wide as "10" in tabular figures, so references line up. */
const NUMBER_EMS = 1.2;

// The Modal is its own window, outside the root's focus ring.
const followRing = (e: NativeSyntheticEvent<TargetedEvent>) => followFocusRingIn(e.nativeEvent.target);

// Material Symbols draws `bookmark` outlined; its filled form is the same
// name in the filled font, which expo-symbols' own font package carries.
const FILLED_SYMBOLS = { name: 'MaterialSymbols_400Regular_Filled', font: MaterialSymbols_400Regular_Filled };

/** The bookmark glyph, outlined or filled: SF Symbols and Material Symbols. */
function BookmarkGlyph({ filled, size, tintColor }: { filled: boolean; size: number; tintColor: string }) {
  return (
    <ScaledSymbol
      // expo-symbols loads an Android font once per mount, so each form mounts its own.
      key={filled ? 'filled' : 'outline'}
      name={{ ios: filled ? 'bookmark.fill' : 'bookmark', android: 'bookmark' }}
      weight={filled ? { ios: 'unspecified', android: FILLED_SYMBOLS } : undefined}
      size={size}
      tintColor={tintColor}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}

/**
 * The reader's bookmark button, beside Aa: monochrome like it, a 48dp /
 * 44pt target. Filled while the save target is in a slot, which its value
 * says ("John 3 is in slot 2").
 */
export function BookmarkButton({
  buttonRef,
  filled,
  value,
  onPress,
}: {
  buttonRef: ButtonRef;
  filled: boolean;
  value: string | undefined;
  onPress: () => void;
}) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel="Bookmarks"
      accessibilityValue={value === undefined ? undefined : { text: value }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { minWidth: target, minHeight: target, opacity: pressed ? 0.6 : 1 }]}
    >
      <BookmarkGlyph filled={filled} size={material ? 24 : 22} tintColor={material ? m3.onSurfaceVariant : colors.text} />
    </Pressable>
  );
}

/** Whether the picker is open, and the ref for the button it anchors to. */
export function useBookmarkPicker() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<ComponentRef<typeof View>>(null);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, show, close, buttonRef };
}

type FilledRow = Extract<BookmarkRow, { kind: 'filled' }>;

type PickerProps = {
  open: boolean;
  onClose: () => void;
  buttonRef: ButtonRef;
  /** The publication's title, the header's first line. */
  title: string;
  target: SaveTarget;
  /** The 10 rows, or the core's message when its list couldn't be read. */
  rows: readonly BookmarkRow[] | { message: string };
  /** Save the target into an empty slot. A core error's message, or none. */
  onSave: (slot: number) => string | undefined;
  /** Go to a filled slot's place; the picker closes and focus goes with the jump. */
  onJump: (row: FilledRow) => void;
  /** Where each filled slot opens (by slot), from the core's locate: a missing one is noted. */
  places: ReadonlyMap<number, SlotPlace>;
  /** Replace a filled slot with the target, or empty it, at once. A core error's message, or none. */
  onReplace: (row: FilledRow) => string | undefined;
  onDelete: (row: FilledRow) => string | undefined;
  /** The reader's Undo or notice, shown over the picker while it is open. */
  bar: { label: string; onUndo?: () => void } | undefined;
};

export function BookmarkPicker({
  open,
  onClose,
  buttonRef,
  title,
  target,
  rows,
  onSave,
  onJump,
  places,
  onReplace,
  onDelete,
  bar,
}: PickerProps) {
  const { look, scheme, m3 } = useBerean();
  const material = look === 'material';
  const windowClass = useWindowClass();
  const placement = bookmarkPickerPlacement(look, windowClass);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { background, edge } = useSheetChrome();

  // The slot just saved into, while it shows before the picker goes, and
  // the last save's error. Both belong to one opening.
  const [saved, setSaved] = useState<number>();
  const [error, setError] = useState<string>();
  // The sheet's laid-out header (handle included): with the first rows,
  // the detent the iOS-look sheet opens at, once per opening; with the
  // list's content, the Material sheet's height.
  const [measured, setMeasured] = useState<{
    header?: number;
    rows: readonly (number | undefined)[];
    content?: number;
  }>({ rows: [] });
  const [opensAt, setOpensAt] = useState<'medium' | 'large'>();
  // A filled slot's menu (⋯ / ⋮ at its button, or a long press), and the
  // rows' native tags for hardware ↑/↓.
  const [menu, setMenu] = useState<{ row: FilledRow; anchor?: Anchor }>();
  const [tags, setTags] = useState<readonly (number | undefined)[]>([]);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSaved(undefined);
      setError(undefined);
      setMeasured({ rows: [] });
      setOpensAt(undefined);
      setMenu(undefined);
    }
  }
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A save's dismissal belongs to its opening: closed sooner, it is dropped.
  useEffect(() => {
    if (!open) clearTimeout(dismissTimer.current);
  }, [open]);
  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  // The window stays up while a sheet slides away; the popover's fades with it.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  if (!open && shown && placement.form === 'popover') setShown(false);
  // Where focus goes once it has gone: back to the button, unless a jump
  // took it to the landed verse.
  const jumped = useRef(false);
  const wasShown = useRef(shown);
  useEffect(() => {
    const went = wasShown.current && !shown;
    wasShown.current = shown;
    if (shown) jumped.current = false;
    if (!went || jumped.current) return;
    const frame = requestAnimationFrame(() => moveAccessibilityFocus(buttonRef.current));
    return () => cancelAnimationFrame(frame);
  }, [shown, buttonRef]);
  const hide = useCallback(() => setShown(false), []);

  // The card hangs under the button, wherever the header put it.
  const [anchor, setAnchor] = useState<{ top: number; right: number }>();
  useEffect(() => {
    if (!open || placement.form !== 'popover') return;
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ top: y + height + spacing.xs, right: Math.max(spacing.sm, window.width - (x + width)) });
    });
  }, [open, placement.form, buttonRef, window.width]);

  const save = (row: BookmarkRow) => {
    const message = onSave(row.slot);
    if (message !== undefined) {
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    setError(undefined);
    setSaved(row.slot);
    AccessibilityInfo.announceForAccessibilityWithOptions(savedAnnouncement(row.number), { queue: true });
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(onClose, SAVE_FADE_MS + SAVE_HOLD_MS);
  };
  const press = (row: BookmarkRow) => {
    // Once a save is in, the picker is on its way out.
    if (saved !== undefined) return;
    if (row.kind === 'empty') {
      save(row);
    } else {
      jumped.current = true;
      onJump(row);
    }
  };
  // Replace and Delete take effect at once (Decision 4); the reader offers
  // Undo and announces it. The row stays, its content cross-fading.
  const change = (row: FilledRow, how: 'replace' | 'delete') => {
    if (saved !== undefined) return;
    const message = how === 'replace' ? onReplace(row) : onDelete(row);
    setError(message);
    if (message !== undefined) AccessibilityInfo.announceForAccessibility(message);
  };
  const recordTag = (index: number, tag: number | undefined) => {
    setTags((was) => {
      if (was[index] === tag) return was;
      const next = [...was];
      next[index] = tag;
      return next;
    });
  };

  const sheetHeights =
    placement.form === 'popover'
      ? undefined
      : bookmarkSheetHeights(placement.form, { windowHeight: window.height, topInset: insets.top });
  // Measured before it is seen (the sheet waits off screen), so it opens
  // once, at the detent it settles at.
  const counted = 'message' in rows ? 0 : Math.min(MEDIUM_DETENT_MIN_ROWS, rows.length);
  const rowHeights = measured.rows.slice(0, counted).filter((height) => height !== undefined);
  if (
    open &&
    placement.form === 'sheet' &&
    sheetHeights?.restHeight !== undefined &&
    opensAt === undefined &&
    measured.header !== undefined &&
    rowHeights.length === counted
  ) {
    setOpensAt(
      bookmarkSheetOpensAt({
        mediumHeight: sheetHeights.restHeight,
        headerHeight: measured.header,
        rowHeights,
        bottomInset: insets.bottom,
      }),
    );
  }
  // The Material sheet fits its content up to its max height, and waits
  // off screen until both parts are measured, so it opens once at that height.
  const fit =
    placement.form === 'bottomSheet' &&
    sheetHeights !== undefined &&
    measured.header !== undefined &&
    measured.content !== undefined
      ? bookmarkSheetFit({ contentHeight: measured.header + measured.content, maxHeight: sheetHeights.height })
      : undefined;
  const measureContent = (_width: number, height: number) => {
    setMeasured((was) => (was.content === height ? was : { ...was, content: height }));
  };
  const measureHeader = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    setMeasured((was) => (was.header === height ? was : { ...was, header: height }));
  };
  const measureRow = (index: number) => (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    setMeasured((was) => {
      if (was.rows[index] === height) return was;
      const next = [...was.rows];
      next[index] = height;
      return { ...was, rows: next };
    });
  };

  const full = 'message' in rows ? false : allSlotsFull(rows);
  const header = (
    <Header title={title} line={saveLine(target.reference, full)} onClose={onClose} closeButton={!material} />
  );
  const body = (
    <>
      {error !== undefined && (
        <UIText accessibilityLiveRegion="polite" secondary style={styles.message}>
          {error}
        </UIText>
      )}
      {'message' in rows ? (
        <UIText secondary style={styles.message}>
          {rows.message}
        </UIText>
      ) : (
        // The rows don't fade in as the picker opens; a saved row's new content does.
        <LayoutAnimationConfig skipEntering skipExiting>
          {rows.map((row, index) => (
            <SlotRow
              key={row.slot}
              row={row}
              reference={target.reference}
              missing={row.kind === 'filled' && places.get(row.slot)?.missing === true}
              separated={index > 0}
              background={background}
              focus={rowFocusNeighbours(index, tags)}
              onTag={(tag) => recordTag(index, tag)}
              onLayout={index < MEDIUM_DETENT_MIN_ROWS ? measureRow(index) : undefined}
              onPress={() => press(row)}
              onMenu={(anchor) => row.kind === 'filled' && setMenu({ row, anchor })}
              onReplace={() => row.kind === 'filled' && change(row, 'replace')}
              onDelete={() => row.kind === 'filled' && change(row, 'delete')}
            />
          ))}
        </LayoutAnimationConfig>
      )}
    </>
  );

  let content;
  if (placement.form === 'popover') {
    const width = Math.min(placement.maxWidth, window.width - 2 * spacing.lg);
    // Drawn once the button is measured.
    const top = anchor?.top ?? 0;
    const right = Math.min(anchor?.right ?? 0, window.width - width - spacing.sm);
    content = (
      <>
        {/* A tap outside the card closes it. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        {anchor !== undefined && (
        <PopoverCard
          top={top}
          right={right}
          width={width}
          maxHeight={window.height - top - insets.bottom - spacing.lg}
          radius={radii.card}
          onClose={onClose}
        >
          <View style={styles.popoverHeader}>{header}</View>
          <ScrollView contentContainerStyle={styles.list}>{body}</ScrollView>
        </PopoverCard>
        )}
      </>
    );
  } else if (sheetHeights !== undefined) {
    const { restHeight } = sheetHeights;
    const height = fit?.height ?? sheetHeights.height;
    const width =
      placement.form === 'bottomSheet' && placement.maxWidth !== undefined
        ? Math.min(placement.maxWidth, window.width)
        : window.width;
    const corner = material ? radii.sheet : radii.iosSheet;
    content = (
      <SheetWithScrim
        firstRowTag={tags[0]}
        open={open}
        onClose={onClose}
        onHidden={hide}
        height={height}
        restHeight={restHeight}
        opening={
          placement.form !== 'sheet'
            ? fit === undefined
              ? 'pending'
              : undefined
            : opensAt === undefined
              ? 'pending'
              : opensAt === 'large'
                ? 'full'
                : 'rest'
        }
        scrim={material ? m3.scrim : m3.scrimWarm}
        style={[
          {
            left: (window.width - width) / 2,
            width,
            backgroundColor: background,
            borderTopLeftRadius: corner,
            borderTopRightRadius: corner,
          },
          edge,
        ]}
        header={
          <View onLayout={measureHeader}>
            <SheetHandle onClose={onClose} />
            {header}
          </View>
        }
      >
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.lg }]}
          onContentSizeChange={material ? measureContent : undefined}
          scrollEnabled={fit?.scrolls ?? true}
        >
          {body}
        </ScrollView>
      </SheetWithScrim>
    );
  }

  return (
    <Modal
      visible={shown}
      transparent
      animationType={placement.form === 'popover' ? 'fade' : 'none'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <ModalNavigationBarStyle barStyle={systemBarStyle(scheme)} />
      <View style={styles.root}>
        {content}
        {bar !== undefined && (
          <UndoBar label={bar.label} onUndo={bar.onUndo} bottom={insets.bottom + spacing.lg} />
        )}
      </View>
      {menu !== undefined && (
        <ActionSheet
          visible
          title={`Slot ${menu.row.number}, ${menu.row.title}`}
          anchor={material ? menu.anchor : undefined}
          items={[
            {
              key: 'replace',
              label: replaceLabel(target.reference),
              icon: { ios: 'arrow.triangle.2.circlepath', android: 'swap_horiz' },
              onPress: () => change(menu.row, 'replace'),
            },
            {
              key: 'delete',
              label: DELETE_LABEL,
              icon: { ios: 'trash', android: 'delete' },
              destructive: true,
              onPress: () => change(menu.row, 'delete'),
            },
          ]}
          onClose={() => setMenu(undefined)}
        />
      )}
    </Modal>
  );
}

/** A sliding sheet over a scrim that fades with it; tapping the scrim closes it. */
function SheetWithScrim({
  scrim,
  firstRowTag,
  ...sheet
}: Omit<Parameters<typeof SlidingSheet>[0], 'visibility' | 'fadeUnderReducedMotion'> & {
  scrim: string;
  /** Hardware ↓ from the scrim (where Android's first arrow press can land) goes to slot 1. */
  firstRowTag: number | undefined;
}) {
  const visibility = useSharedValue(0);
  const fade = useAnimatedStyle(() => ({ opacity: visibility.get() }));
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={sheet.onClose}
          onFocus={followRing}
          nextFocusDown={firstRowTag}
          style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]}
        />
      </Animated.View>
      <SlidingSheet {...sheet} visibility={visibility} fadeUnderReducedMotion />
    </>
  );
}

/**
 * The publication's title, where a screen reader lands as the picker
 * opens, then what an empty slot saves (or that all 10 are in use).
 */
function Header({
  title,
  line,
  onClose,
  closeButton,
}: {
  title: string;
  line: string;
  onClose: () => void;
  closeButton: boolean;
}) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const ref = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => moveAccessibilityFocus(ref.current));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text
          ref={ref}
          accessibilityRole="header"
          accessibilityLabel={`Bookmarks, ${title}`}
          style={[type.ui.title, { color: material ? m3.onSurface : colors.text }]}
        >
          {title}
        </Text>
        <UIText secondary>{line}</UIText>
      </View>
      {closeButton && <SheetCloseButton onClose={onClose} />}
    </View>
  );
}

/**
 * One slot, one element (spec §6). Empty: "Slot 4" and Save here. Filled:
 * the slot number at the leading edge, the reference (which wraps, never
 * truncates) and the snippet, with the filled glyph at the current place
 * and "Not found in this edition" where the core no longer has it. A
 * filled slot's trailing ⋯ / ⋮ is its own full-size target; screen readers
 * reach Replace and Delete as the slot's custom actions instead, so it is
 * hidden from them. The iOS look also swipes the slot to show them.
 */
function SlotRow({
  row,
  reference,
  missing,
  separated,
  background,
  focus,
  onTag,
  onLayout,
  onPress,
  onMenu,
  onReplace,
  onDelete,
}: {
  row: BookmarkRow;
  reference: string;
  missing: boolean;
  separated: boolean;
  /** The picker's surface, which covers the swipe actions until they show. */
  background: string;
  /** Hardware ↑/↓: the rows above and below, by native tag. */
  focus: { up: number | undefined; down: number | undefined };
  onTag: (tag: number | undefined) => void;
  /** Its laid-out height, for the detent the iOS-look sheet opens at. */
  onLayout: ((e: LayoutChangeEvent) => void) | undefined;
  onPress: () => void;
  /** Open the slot's menu: at the ⋯ / ⋮ (its window frame), or with none for a long press. */
  onMenu: (anchor: Anchor | undefined) => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const { fontScale } = useWindowDimensions();
  const accent = material ? m3.primary : colors.accent;
  const filled = row.kind === 'filled';
  const target = material ? 48 : 44;
  const rowRef = useRef<ComponentRef<typeof View>>(null);
  const menuRef = useRef<ComponentRef<typeof View>>(null);
  const openMenu = () =>
    menuRef.current?.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }));
  const line = (
    <View
      onLayout={onLayout}
      style={[
        styles.rowLine,
        { backgroundColor: background },
        !material && separated && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
      ]}
    >
      <Pressable
        ref={rowRef}
        accessibilityRole="button"
        accessibilityLabel={rowLabel(row, missing)}
        accessibilityHint={rowAction(row, reference)}
        accessibilityActions={
          filled
            ? [
                { name: 'replace', label: replaceLabel(reference) },
                { name: 'delete', label: DELETE_LABEL },
              ]
            : undefined
        }
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'replace') onReplace();
          else if (e.nativeEvent.actionName === 'delete') onDelete();
        }}
        onPress={onPress}
        onLongPress={filled ? () => onMenu(undefined) : undefined}
        onFocus={followRing}
        onLayout={() => onTag(findNodeHandle(rowRef.current) ?? undefined)}
        nextFocusUp={focus.up}
        nextFocusDown={focus.down}
        style={({ pressed }) => [
          styles.row,
          { minHeight: target, opacity: pressed ? 0.6 : 1 },
          filled && styles.rowBeforeMenu,
        ]}
      >
        {/* Keyed by what it shows, so a save, Replace, Delete or Undo cross-fades it. */}
        <Animated.View key={rowContentKey(row)} entering={fadeIn} exiting={fadeOut} style={styles.rowContent}>
          {row.kind === 'empty' ? (
            <>
              <UIText secondary style={styles.rowText}>
                {`Slot ${row.number}`}
              </UIText>
              <View style={styles.saveHere}>
                <ScaledSymbol
                  name={{ ios: 'plus', android: 'add' }}
                  size={material ? 18 : 15}
                  tintColor={accent}
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                />
                <UIText style={{ color: accent }}>Save here</UIText>
              </View>
            </>
          ) : (
            <>
              <Text style={[type.ui.body, styles.number, { minWidth: NUMBER_EMS * (type.ui.body.fontSize ?? 17) * fontScale, color: colors.textSecondary }]}>
                {row.number}
              </Text>
              <View style={styles.rowText}>
                <UIText>{row.title}</UIText>
                {row.snippet !== undefined && (
                  <UIText variant="caption" secondary numberOfLines={fontScale >= LARGE_TEXT_SCALE ? 2 : 1}>
                    {row.snippet}
                  </UIText>
                )}
                {missing && (
                  <UIText variant="caption" secondary>
                    {NOT_FOUND_NOTE}
                  </UIText>
                )}
              </View>
              {row.current && <BookmarkGlyph filled size={material ? 20 : 17} tintColor={accent} />}
            </>
          )}
        </Animated.View>
      </Pressable>
      {row.kind === 'filled' && (
        <Pressable
          ref={menuRef}
          accessibilityRole="button"
          accessibilityLabel={rowMenuLabel(row)}
          importantForAccessibility="no"
          accessibilityElementsHidden
          onPress={openMenu}
          onFocus={followRing}
          nextFocusUp={focus.up}
          nextFocusDown={focus.down}
          style={({ pressed }) => [styles.menuButton, { minWidth: target, minHeight: target, opacity: pressed ? 0.6 : 1 }]}
        >
          <ScaledSymbol
            // ⋮ in Material, ⋯ in the iOS look.
            name={material ? { ios: 'ellipsis', android: 'more_vert' } : { ios: 'ellipsis', android: 'more_horiz' }}
            size={material ? 24 : 20}
            tintColor={material ? m3.onSurfaceVariant : colors.textSecondary}
            accessible={false}
          />
        </Pressable>
      )}
    </View>
  );
  if (material) return line;
  // The iOS look's trailing swipe; never the only way (spec §3.2). A slot
  // that empties keeps its element, so focus stays on it.
  return (
    <SwipeRow
      enabled={filled}
      actions={[
        { key: 'replace', label: 'Replace', icon: { ios: 'arrow.triangle.2.circlepath', android: 'swap_horiz' }, onPress: onReplace },
        { key: 'delete', label: DELETE_LABEL, icon: { ios: 'trash', android: 'delete' }, destructive: true, onPress: onDelete },
      ]}
    >
      {line}
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  popoverHeader: { paddingTop: spacing.md },
  headerText: { flex: 1, gap: spacing.xs },
  list: { paddingBottom: spacing.lg },
  message: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  rowLine: { flexDirection: 'row', alignItems: 'center' },
  row: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  // The ⋯ / ⋮ target brings its own space at the trailing edge.
  rowBeforeMenu: { paddingEnd: 0 },
  menuButton: { alignItems: 'center', justifyContent: 'center', marginEnd: spacing.xs },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  number: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  rowText: { flex: 1 },
  saveHere: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
