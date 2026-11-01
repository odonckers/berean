import type { CanvasItem, Workspace } from 'berean-ffi-rn';
import { Stack, useFocusEffect } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useHeaderHidden } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { load } from '@/library/load';
import { ActionSheet, type SheetItem } from '@/notes/action-sheet';
import { ConfirmDialog } from '@/notes/confirm-dialog';
import { useNotesRead } from '@/notes/data';
import type { Anchor } from '@/notes/list-rows';
import { NameDialog } from '@/notes/name-dialog';
import { type Camera, deviceClass, type Rect, type Size, zoomLimits } from '@/studyspace/camera';
import { Canvas, type CanvasHandle } from '@/studyspace/canvas';
import { HIGHLIGHT_MS } from '@/studyspace/card';
import {
  addedAnnouncement,
  cardCount,
  deleteWorkspacePrompt,
  isFront,
  pickWorkspace,
  toFront,
  workspaceAnnouncement,
} from '@/studyspace/cards';
import {
  type Addable,
  type CardView,
  invalidNameMessage,
  newNote,
  placeAddable,
  readAddableNotes,
  readAddablePublications,
  readCards,
  readLastWorkspace,
  readWorkspaces,
  rememberWorkspace,
} from '@/studyspace/data';
import { debounce } from '@/studyspace/debounce';
import { type CardAction, nudge, sameFrame } from '@/studyspace/edit';
import {
  freeSpot,
  LANDING_GAP,
  LANDING_GRID,
  LANDING_MARGIN,
  landingTarget,
  NOTE_CARD,
  panIntoView,
  PUBLICATION_CARD,
} from '@/studyspace/landing';
import { WorkspaceTitle } from '@/studyspace/workspace-title';

// The camera is saved this long after a gesture settles (§7.3), and at
// once on a switch, on leaving the tab, and when the app goes to the background.
const SAVE_CAMERA_MS = 300;
// §7.3: switching cross-fades in 150 ms for everyone, Reduce Motion included.
const SWITCH_FADE_MS = 150;
const fadeIn = FadeIn.duration(SWITCH_FADE_MS).reduceMotion(ReduceMotion.Never);
const fadeOut = FadeOut.duration(SWITCH_FADE_MS).reduceMotion(ReduceMotion.Never);

type NameAsk = { kind: 'new' } | { kind: 'rename'; workspace: Workspace };

/** The Add menu, with what its pickers offer, read when it opens. */
type AddMenu = { anchor?: Anchor; notes: Addable[]; publications: Addable[] };
type Picker = { title: string; items: Addable[]; size: Size };

// What a Move or Size action says once done; and when a size can't change.
const ACTION_DONE: Partial<Record<CardAction, string>> = {
  moveLeft: 'Moved left',
  moveRight: 'Moved right',
  moveUp: 'Moved up',
  moveDown: 'Moved down',
  larger: 'Made larger',
  smaller: 'Made smaller',
};
const ACTION_LIMIT: Partial<Record<CardAction, string>> = {
  larger: 'Already the largest size',
  smaller: 'Already the smallest size',
};

/**
 * Studyspace on a phone (findings §7.3, §8): one workspace's canvas, with
 * the screen title as the workspace menu and an Add button for notes and
 * publications. Every change goes through the core; the screen keeps only
 * which workspace is open (the core remembers it too), which card is
 * selected, and the one just added.
 */
export default function StudyspaceScreen() {
  const { look, colors } = useBerean();
  const material = look === 'material';
  const window = useWindowDimensions();
  const limits = useMemo(() => zoomLimits(deviceClass(window)), [window]);
  const headerHidden = useHeaderHidden();
  const insets = useSafeAreaInsets();

  // Bumped after each change, so the workspaces and cards are read again.
  const [version, setVersion] = useState(0);
  const reread = () => setVersion((v) => v + 1);
  const workspaces = useNotesRead(`workspaces:${version}`, readWorkspaces);
  // The core's last workspace on mount; then the one chosen.
  const [wanted, setWanted] = useState(readLastWorkspace);
  const current = workspaces.ok ? pickWorkspace(workspaces.value, wanted) : undefined;
  const currentId = current?.id;
  const cards = useNotesRead(`cards:${currentId}:${version}`, () =>
    currentId === undefined ? [] : readCards(currentId),
  );

  // A switch or a new workspace is remembered as it opens (open()). So is
  // the fallback: the first workspace, when the remembered one is gone
  // (deleted, or imported over) or none is remembered.
  const loaded = workspaces.ok;
  useEffect(() => {
    if (!loaded || currentId === wanted) return;
    // If it has gone too, read again at once, which falls back to the next:
    // the core's answer, not React state, says so; it is rare and one read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (rememberWorkspace(currentId) === 'gone') setVersion((v) => v + 1);
  }, [loaded, currentId, wanted]);

  // A bring-to-front reorders the cards here at once, until they are next read.
  const [front, setFront] = useState<{ from: CardView[]; cards: CardView[] }>();
  const shown = useMemo(
    () => (!cards.ok ? [] : front?.from === cards.value ? front.cards : cards.value),
    [cards, front],
  );

  // The selected card (§7.1), for this session only.
  const [selectedId, setSelectedId] = useState<bigint>();
  const selected = shown.find((c) => c.id === selectedId);
  // The card just added, while its highlight shows (§7.2).
  const [highlighted, setHighlighted] = useState<bigint>();
  useEffect(() => {
    if (highlighted === undefined) return;
    const timer = setTimeout(() => setHighlighted(undefined), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const canvas = useRef<CanvasHandle>(null);
  // The card just added, until the screen reader's focus moves to it once
  // the reread has drawn it (§7.2).
  const [focusPending, setFocusPending] = useState<bigint>();
  useEffect(() => {
    if (focusPending !== undefined && canvas.current?.focusCard(focusPending)) setFocusPending(undefined);
  }, [focusPending, shown]);

  // The camera, saved through the core once it settles.
  const saver = useMemo(
    () =>
      debounce<{ id: bigint; camera: Camera }>(({ id, camera }) => {
        try {
          userdata().setViewport(id, camera);
        } catch {
          // A camera that doesn't save only means the workspace reopens at its previous view.
        }
      }, SAVE_CAMERA_MS),
    [],
  );
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') saver.flush();
    });
    return () => {
      appState.remove();
      saver.flush();
    };
  }, [saver]);
  useFocusEffect(useCallback(() => () => saver.flush(), [saver]));

  // Said after a switch, an add or a card action (§7.2, §7.3, §9):
  // VoiceOver's announcement; on Android a live region TalkBack reads when
  // its text changes.
  const [live, setLive] = useState('');
  const announce = useCallback((text: string) => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text);
    // A no-break space tells a repeat ("Moved left" twice) from no change.
    else setLive((was) => (was === text ? `${text} ` : text));
  }, []);
  const [switches, setSwitches] = useState(0);
  const cardTotal = shown.length;
  const announcement = switches > 0 && current !== undefined ? workspaceAnnouncement(current.name, cardTotal) : '';
  const announcedSwitch = useRef(0);
  useEffect(() => {
    if (announcement === '' || announcedSwitch.current === switches) return;
    announcedSwitch.current = switches;
    announce(announcement);
  }, [announcement, switches, announce]);

  const open = (id: bigint) => {
    saver.flush();
    // Gone already (NotFound) if another change took it: the reread below
    // then opens the first one left, which the effect above remembers.
    rememberWorkspace(id);
    setSwitches((n) => n + 1);
    setSelectedId(undefined);
    setWanted(id);
    reread();
  };

  // Bring a card to the front, unless it is there already. A tap shows the
  // new order at once; a lift draws the card raised until its drop rereads.
  const bringToFront = (id: bigint, reorder: boolean) => {
    if (isFront(shown, id)) return;
    try {
      userdata().bringToFront(id);
    } catch {
      // The card stays where it is in the stack; nothing else depends on it.
      return;
    }
    if (reorder && cards.ok) setFront({ from: cards.value, cards: toFront(shown, id) });
  };

  const liftCard = (id: bigint) => {
    setSelectedId(id);
    bringToFront(id, false);
  };

  /** Save a card's new frame; read the cards again either way (a failed write puts it back). */
  const commitFrame = (id: bigint, frame: Rect): boolean => {
    const card = shown.find((c) => c.id === id);
    let ok = true;
    if (card !== undefined && !sameFrame(card.frame, frame)) {
      try {
        userdata().setFrames([{ id, frame }]);
      } catch (e) {
        ok = false;
        Alert.alert('Couldn’t move the card', coreErrorMessage(e));
      }
    }
    reread();
    return ok;
  };

  const removeCard = (card: CardView) => {
    try {
      userdata().removeItem(card.id);
    } catch (e) {
      Alert.alert('Couldn’t remove the card', coreErrorMessage(e));
      return;
    }
    if (selectedId === card.id) setSelectedId(undefined);
    reread();
    announce(`Removed ${card.title}`);
  };

  // The accessible way to do what the gestures do (§4.3, WCAG 2.5.7).
  const cardAction = (card: CardView, action: CardAction) => {
    if (action === 'remove') {
      removeCard(card);
      return;
    }
    if (action === 'front') {
      bringToFront(card.id, true);
      announce('Brought to front');
      return;
    }
    const frame = nudge(card.frame, action);
    if (sameFrame(frame, card.frame)) {
      announce(ACTION_LIMIT[action] ?? '');
      return;
    }
    if (commitFrame(card.id, frame)) announce(ACTION_DONE[action] ?? '');
  };

  // §7.2: beside the selected card or mid-view, in the nearest free spot,
  // then the view pans just enough to show it.
  const add = (make: () => Addable, size: Size) => {
    if (current === undefined) return;
    const at = canvas.current?.view();
    let made: Addable;
    let item: CanvasItem;
    try {
      const m = make();
      made = m;
      // A New note that can't be placed is removed again (placeAddable).
      item = placeAddable(m, () => {
        const target = landingTarget(size, selected?.frame, at?.camera ?? { x: 0, y: 0, zoom: 1 }, LANDING_GAP);
        const spot = freeSpot(target, shown.map((c) => c.frame), LANDING_GAP, LANDING_GRID);
        return userdata().addItem(current.id, m.card, spot);
      });
    } catch (e) {
      Alert.alert('Couldn’t add to the workspace', coreErrorMessage(e));
      return;
    }
    setSelectedId(item.id);
    setHighlighted(item.id);
    setFocusPending(item.id);
    reread();
    announce(addedAnnouncement(made.title, current.name));
    if (at === undefined) return;
    const to = panIntoView(at.camera, at.size, item.frame, LANDING_MARGIN);
    if (to !== at.camera) canvas.current?.moveTo(to);
  };

  const [addMenu, setAddMenu] = useState<AddMenu>();
  const [picker, setPicker] = useState<Picker>();
  const openAddMenu = (anchor: Anchor) => {
    const notes = load(() => readAddableNotes(shown));
    setAddMenu({
      anchor: material ? anchor : undefined,
      notes: notes.ok ? notes.value : [],
      publications: readAddablePublications(),
    });
  };
  const addItems: SheetItem[] = [
    {
      key: 'new-note',
      label: 'New note',
      icon: { ios: 'square.and.pencil', android: 'edit_square' },
      onPress: () => add(newNote, NOTE_CARD),
    },
    ...(addMenu === undefined || addMenu.notes.length === 0
      ? []
      : [
          {
            key: 'note',
            label: 'Note…',
            icon: { ios: 'note.text', android: 'sticky_note_2' },
            onPress: () => setPicker({ title: 'Add a note', items: addMenu.notes, size: NOTE_CARD }),
          } satisfies SheetItem,
        ]),
    ...(addMenu === undefined || addMenu.publications.length === 0
      ? []
      : [
          {
            key: 'publication',
            label: 'Publication…',
            icon: { ios: 'book', android: 'menu_book' },
            onPress: () =>
              setPicker({ title: 'Add a publication', items: addMenu.publications, size: PUBLICATION_CARD }),
          } satisfies SheetItem,
        ]),
  ];
  const pickerItems: SheetItem[] = (picker?.items ?? []).map((a, i) => ({
    key: String(i),
    label: a.title,
    onPress: () => add(() => a, picker?.size ?? NOTE_CARD),
  }));

  const [menu, setMenu] = useState<{ anchor?: Anchor }>();
  const [ask, setAsk] = useState<NameAsk>();
  const [askError, setAskError] = useState<string>();
  const closeAsk = () => {
    setAsk(undefined);
    setAskError(undefined);
  };

  const submitName = (name: string) => {
    if (ask === undefined) return;
    try {
      if (ask.kind === 'new') {
        const made = userdata().createWorkspace(name);
        closeAsk();
        open(made.id);
      } else {
        userdata().renameWorkspace(ask.workspace.id, name);
        closeAsk();
        reread();
      }
    } catch (e) {
      // The core's refusal (an empty or taken name) stays in the dialog.
      const invalid = invalidNameMessage(e);
      if (invalid !== undefined) {
        setAskError(invalid);
        return;
      }
      closeAsk();
      Alert.alert(ask.kind === 'new' ? 'Couldn’t make the workspace' : 'Couldn’t rename the workspace', coreErrorMessage(e));
    }
  };

  // The workspace Delete Workspace… asks about, while its confirmation is open.
  const [deleting, setDeleting] = useState<Workspace>();
  const remove = (workspace: Workspace) => {
    setDeleting(undefined);
    saver.cancel();
    try {
      userdata().deleteWorkspace(workspace.id);
    } catch (e) {
      Alert.alert('Couldn’t delete the workspace', coreErrorMessage(e));
    }
    // The first one left opens, is remembered (by the effect above; none
    // when none are left), and is announced.
    rememberWorkspace(undefined);
    setSwitches((n) => n + 1);
    setSelectedId(undefined);
    setWanted(undefined);
    reread();
  };

  const menuItems: SheetItem[] = [
    ...(workspaces.ok ? workspaces.value : []).map((w) => ({
      key: String(w.id),
      label: w.name,
      current: w.id === current?.id,
      accessibilityLabel: workspaceAnnouncement(w.name, w.itemCount),
      onPress: () => {
        if (w.id !== current?.id) open(w.id);
      },
    })),
    // The selected card's Remove, here as well as in its accessibility actions.
    ...(selected === undefined
      ? []
      : [
          {
            key: 'remove-card',
            label: 'Remove from workspace',
            accessibilityLabel: `Remove ${selected.title} from workspace`,
            icon: { ios: 'minus.circle', android: 'remove_circle_outline' },
            onPress: () => removeCard(selected),
          } satisfies SheetItem,
        ]),
    {
      key: 'new',
      label: 'New Workspace',
      icon: { ios: 'plus', android: 'add' },
      onPress: () => setAsk({ kind: 'new' }),
    },
    ...(current === undefined
      ? []
      : [
          {
            key: 'rename',
            label: 'Rename',
            icon: { ios: 'pencil', android: 'edit' },
            onPress: () => setAsk({ kind: 'rename', workspace: current }),
          } satisfies SheetItem,
          {
            key: 'delete',
            label: 'Delete Workspace…',
            destructive: true,
            icon: { ios: 'trash', android: 'delete' },
            onPress: () => setDeleting(current),
          } satisfies SheetItem,
        ]),
  ];

  // Material opens an M3 dropdown under the title, at its start edge; the iOS look, a sheet.
  const openMenu = (anchor: Anchor) => setMenu({ anchor: material ? anchor : undefined });

  const title =
    current === undefined ? undefined : (
      <WorkspaceTitle
        name={current.name}
        detail={cardCount(cardTotal)}
        expanded={menu !== undefined}
        onPress={openMenu}
      />
    );
  const addButton =
    current === undefined || !cards.ok ? undefined : (
      <AddButton expanded={addMenu !== undefined} onPress={openAddMenu} />
    );

  const body = !workspaces.ok ? (
    <Message text={workspaces.message} />
  ) : current === undefined ? (
    <View style={styles.empty}>
      <UIText variant="title">No workspaces yet</UIText>
      <UIText secondary style={styles.centred}>
        A workspace is a canvas for your notes and the passages you study, laid out side by side.
      </UIText>
      <TextButton title="New Workspace" onPress={() => setAsk({ kind: 'new' })} />
    </View>
  ) : !cards.ok ? (
    <Message text={cards.message} />
  ) : (
    <Animated.View key={String(current.id)} entering={fadeIn} exiting={fadeOut} style={StyleSheet.absoluteFill}>
      <Canvas
        ref={canvas}
        cards={shown}
        saved={current.viewport}
        limits={limits}
        selected={selectedId}
        highlighted={highlighted}
        onSettle={(camera) => saver.call({ id: current.id, camera })}
        onLiftCard={liftCard}
        onTapCard={(id) => bringToFront(id, true)}
        onCommitCard={commitFrame}
        onCardAction={cardAction}
        onTapEmpty={() => setSelectedId(undefined)}
      />
      {shown.length === 0 && (
        <View pointerEvents="none" style={styles.emptyCanvas}>
          <UIText secondary style={styles.centred}>
            No cards on this workspace yet.
          </UIText>
        </View>
      )}
    </Animated.View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: current?.name ?? 'Studyspace',
          headerLargeTitleEnabled: false,
          headerTitleAlign: material ? 'left' : 'center',
          headerTitle: title === undefined ? undefined : () => title,
          headerRight: addButton === undefined ? undefined : () => addButton,
        }}
      />
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        {headerHidden && (
          // The iOS look on Android draws its own bar (tab-chrome.tsx).
          <View style={[styles.inlineBar, { paddingTop: insets.top }]}>
            {title ?? <UIText variant="title">Studyspace</UIText>}
            {addButton !== undefined && <View style={styles.inlineAction}>{addButton}</View>}
          </View>
        )}
        <View style={styles.root}>{body}</View>
        {Platform.OS === 'android' && (
          <UIText accessibilityLiveRegion="polite" style={styles.liveRegion}>
            {live}
          </UIText>
        )}
      </View>
      <ActionSheet
        visible={menu !== undefined}
        title="Workspaces"
        items={menuItems}
        anchor={menu?.anchor}
        anchorEdge="start"
        onClose={() => setMenu(undefined)}
      />
      <ActionSheet
        visible={addMenu !== undefined}
        title="Add to workspace"
        items={addItems}
        anchor={addMenu?.anchor}
        onClose={() => setAddMenu(undefined)}
      />
      <ActionSheet
        visible={picker !== undefined}
        title={picker?.title ?? ''}
        items={pickerItems}
        onClose={() => setPicker(undefined)}
      />
      {ask !== undefined && (
        <NameDialog
          title={ask.kind === 'new' ? 'New workspace' : 'Rename workspace'}
          initial={ask.kind === 'new' ? '' : ask.workspace.name}
          confirmLabel={ask.kind === 'new' ? 'Create' : 'Rename'}
          fieldLabel="Workspace name"
          error={askError}
          onCancel={closeAsk}
          onSubmit={submitName}
        />
      )}
      {deleting !== undefined && (
        <ConfirmDialog
          {...deleteWorkspacePrompt(deleting.name, deleting.itemCount)}
          confirmLabel="Delete"
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => remove(deleting)}
        />
      )}
    </>
  );
}

/**
 * The Add button: the iOS look's plus in the navigation bar (44 pt), as the
 * Notes list's New Note; Material's 48 dp top app bar icon button, opening
 * an M3 menu under it.
 */
function AddButton({ expanded, onPress }: { expanded: boolean; onPress: (anchor: Anchor) => void }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const ref = useRef<ComponentRef<typeof Pressable>>(null);
  const open = () => ref.current?.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel="Add to workspace"
      accessibilityState={{ expanded }}
      onPress={open}
      android_ripple={material ? { color: colors.separator, borderless: true } : undefined}
      style={({ pressed }) => [
        material ? styles.materialAction : styles.iosAction,
        !material && { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <ScaledSymbol
        name={{ ios: 'plus', android: 'add' }}
        size={material ? 24 : 22}
        tintColor={material ? m3.onSurfaceVariant : colors.accent}
        accessible={false}
      />
    </Pressable>
  );
}

function Message({ text }: { text: string }) {
  const { colors } = useBerean();
  return <UIText style={[styles.message, { color: colors.accent }]}>{text}</UIText>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inlineBar: { alignItems: 'center', paddingBottom: spacing.sm },
  inlineAction: { position: 'absolute', right: spacing.sm, bottom: spacing.sm },
  iosAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  materialAction: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyCanvas: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  centred: { textAlign: 'center' },
  message: { padding: spacing.lg },
  // On screen for TalkBack to hear, too small to see.
  // Transparent rather than alpha 0, which may drop it from the accessibility tree.
  liveRegion: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' },
});
