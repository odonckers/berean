import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { undoDuration, undoMessages } from '@/notes/undo';

type Pending = { id: number; label: string; onUndo: () => void };

type UndoContextValue = {
  /** Offer Undo for "<subject> deleted" (Material) or Deleted “<name>” (iOS look). */
  show: (subject: string, name: string, onUndo: () => void) => void;
  /** The bar's height while it shows, 0 otherwise: a FAB rises by this. */
  height: number;
};

const UndoContext = createContext<UndoContextValue>({ show: () => {}, height: 0 });

export function useUndo(): UndoContextValue {
  return useContext(UndoContext);
}

/**
 * Undo after a delete, over the Notes stack. Material: an M3 snackbar above
 * the navigation bar. iOS look: a toast capsule above the tab bar. It stays
 * 8 s, 16 s with a screen reader on; appearing is announced, and Undo is
 * the bar's accessibility action as well as its button.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const safe = useSafeAreaInsets();
  const content = useContentInsets();
  const [pending, setPending] = useState<Pending | undefined>();
  const [height, setHeight] = useState(0);
  const nextId = useRef(0);

  const show = useCallback(
    (subject: string, name: string, onUndo: () => void) => {
      const { label, announcement } = undoMessages(look, subject, name);
      nextId.current += 1;
      setPending({ id: nextId.current, label, onUndo });
      AccessibilityInfo.announceForAccessibility(announcement);
    },
    [look],
  );

  // Each new offer restarts the clock; the newest replaces the last.
  useEffect(() => {
    if (pending === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled()
      .catch(() => false)
      .then((on) => {
        if (!cancelled) timer = setTimeout(() => setPending(undefined), undoDuration(on));
      });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pending]);

  const undo = () => {
    pending?.onUndo();
    setPending(undefined);
  };

  const value = useMemo(() => ({ show, height: pending ? height : 0 }), [show, pending, height]);

  // On iOS the tab bar is in the safe area; Android's native tabs sit below
  // the content already.
  const bottom = (Platform.OS === 'ios' ? safe.bottom : content.bottom) + spacing.lg;
  // M3 inverse roles: the other scheme's ink, and the chosen accent in the
  // theme's other scheme (inversePrimary).
  const inverseAccent = m3.inversePrimary;

  return (
    <UndoContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {pending !== undefined && (
          // The iOS toast sits in a row inset 16pt from each edge that
          // centers it, so the capsule is as wide as its content and wraps
          // its label before it reaches the insets.
          <View key={pending.id} pointerEvents="box-none" style={[material ? styles.snackbarRow : styles.toastRow, { bottom }]}>
            <View
              onLayout={(e) => setHeight(e.nativeEvent.layout.height + spacing.lg)}
              accessible
              accessibilityLabel={pending.label}
              accessibilityActions={[
                { name: 'activate', label: 'Undo' },
                { name: 'undo', label: 'Undo' },
              ]}
              onAccessibilityAction={undo}
              style={[
                material ? styles.snackbar : styles.toast,
                material
                  ? { backgroundColor: m3.onSurface }
                  : { backgroundColor: colors.surfaceRaised, shadowColor: colors.text },
              ]}
            >
              <UIText style={[material ? styles.snackbarLabel : styles.toastLabel, { color: material ? m3.surface : colors.text }]}>
                {pending.label}
              </UIText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Undo"
                onPress={undo}
                style={({ pressed }) => [styles.action, { minHeight: material ? 48 : 44, opacity: pressed ? 0.6 : 1 }]}
              >
                <UIText style={[styles.actionLabel, { color: material ? inverseAccent : colors.accent }]}>Undo</UIText>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </UndoContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // M3 snackbar: 48dp min, extra-small corners, 16dp from the edges.
  snackbarRow: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  snackbar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingStart: spacing.lg,
    paddingEnd: spacing.sm,
    borderRadius: 4,
    elevation: 3,
  },
  // iOS toast: 16pt from the edges at most, 480pt wide at most, else as
  // wide as its content.
  toastRow: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  toast: {
    maxWidth: 480,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingStart: spacing.xl,
    paddingEnd: spacing.sm,
    borderRadius: radii.capsule,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  snackbarLabel: { flexShrink: 1, flexGrow: 1 },
  // Shrinks (wraps) but never grows the capsule.
  toastLabel: { flexShrink: 1 },
  action: { paddingHorizontal: spacing.md, justifyContent: 'center' },
  actionLabel: { fontWeight: '600' },
});
