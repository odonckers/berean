import type { Workspace } from 'berean-ffi-rn';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, AppState, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useHeaderHidden } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { ActionSheet, type SheetItem } from '@/notes/action-sheet';
import { ConfirmDialog } from '@/notes/confirm-dialog';
import { useNotesRead } from '@/notes/data';
import type { Anchor } from '@/notes/list-rows';
import { NameDialog } from '@/notes/name-dialog';
import { type Camera, deviceClass, zoomLimits } from '@/studyspace/camera';
import { Canvas } from '@/studyspace/canvas';
import { cardCount, deleteWorkspacePrompt, pickWorkspace, workspaceAnnouncement } from '@/studyspace/cards';
import { invalidNameMessage, readCards, readWorkspaces } from '@/studyspace/data';
import { debounce } from '@/studyspace/debounce';
import { lastWorkspace, rememberWorkspace } from '@/studyspace/session';
import { WorkspaceTitle } from '@/studyspace/workspace-title';

// The camera is saved this long after a gesture settles (§7.3), and at
// once on a switch, on leaving the tab, and when the app goes to the background.
const SAVE_CAMERA_MS = 300;
// §7.3: switching cross-fades in 150 ms for everyone, Reduce Motion included.
const SWITCH_FADE_MS = 150;
const fadeIn = FadeIn.duration(SWITCH_FADE_MS).reduceMotion(ReduceMotion.Never);
const fadeOut = FadeOut.duration(SWITCH_FADE_MS).reduceMotion(ReduceMotion.Never);

type NameAsk = { kind: 'new' } | { kind: 'rename'; workspace: Workspace };

/**
 * Studyspace on a phone (findings §7.3, §8): one workspace's canvas, with
 * the screen title as the workspace menu. Every workspace change goes
 * through the core; the screen keeps only which one is open.
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
  const [wanted, setWanted] = useState(lastWorkspace);
  const current = workspaces.ok ? pickWorkspace(workspaces.value, wanted) : undefined;
  const cards = useNotesRead(`cards:${current?.id}:${version}`, () =>
    current === undefined ? [] : readCards(current.id),
  );

  useEffect(() => rememberWorkspace(current?.id), [current?.id]);

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

  // Said after a switch (§7.3, §9): VoiceOver's announcement; on Android a
  // live region TalkBack reads when its text changes.
  const [switches, setSwitches] = useState(0);
  const cardTotal = cards.ok ? cards.value.length : 0;
  const announcement = switches > 0 && current !== undefined ? workspaceAnnouncement(current.name, cardTotal) : '';
  const announcedSwitch = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'ios' || announcement === '' || announcedSwitch.current === switches) return;
    announcedSwitch.current = switches;
    AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement, switches]);

  const open = (id: bigint) => {
    saver.flush();
    setSwitches((n) => n + 1);
    rememberWorkspace(id);
    setWanted(id);
    reread();
  };

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
    // The first one left opens, and is announced.
    setSwitches((n) => n + 1);
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
        cards={cards.value}
        saved={current.viewport}
        limits={limits}
        onSettle={(camera) => saver.call({ id: current.id, camera })}
      />
      {cards.value.length === 0 && (
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
        }}
      />
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        {headerHidden && (
          // The iOS look on Android draws its own bar (tab-chrome.tsx).
          <View style={[styles.inlineBar, { paddingTop: insets.top }]}>
            {title ?? <UIText variant="title">Studyspace</UIText>}
          </View>
        )}
        <View style={styles.root}>{body}</View>
        {Platform.OS === 'android' && (
          <UIText accessibilityLiveRegion="polite" style={styles.liveRegion}>
            {announcement}
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
      {ask !== undefined && (
        <NameDialog
          title={ask.kind === 'new' ? 'New Workspace' : 'Rename Workspace'}
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

function Message({ text }: { text: string }) {
  const { colors } = useBerean();
  return <UIText style={[styles.message, { color: colors.accent }]}>{text}</UIText>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inlineBar: { alignItems: 'center', paddingBottom: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyCanvas: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  centred: { textAlign: 'center' },
  message: { padding: spacing.lg },
  // On screen for TalkBack to hear, too small to see.
  // Transparent rather than alpha 0, which may drop it from the accessibility tree.
  liveRegion: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' },
});
