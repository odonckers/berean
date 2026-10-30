import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { paletteFrame } from '@/components/palette-frame';
import { SearchField } from '@/components/search-field';
import { SearchIcon } from '@/components/search-icon';
import { SearchResults, SearchScopeChips, useVisibleGroups } from '@/components/search-results';
import { UIText } from '@/components/text';
import { systemBarStyle, useBerean } from '@/design/theme';
import { hairline } from '@/design/tokens';
import { useKeyboardHeight } from '@/design/use-keyboard-height';
import {
  flattenGroups,
  moveSelection,
  NO_SELECTION,
  resultsId,
  selectedIndex,
} from '@/search/palette-selection';
import { resultsLabel } from '@/search/results';
import { useSearch } from '@/search/search-context';
import { followFocusRingIn, useListKeys } from '../../modules/berean-shortcuts';
import { ModalNavigationBarStyle } from '../../modules/berean-system-bars';

type SearchPaletteProps = {
  visible: boolean;
  onClose: () => void;
};

// Ctrl+K / Cmd+K: the same search, centered in a Material dialog shape over
// the scrim, with the query, results and counts of every other entry. Back
// and Escape (Android maps Escape to back) close it through onRequestClose;
// tapping the scrim closes it too. The dialog, footer included, stays a
// margin clear of the system bars and the keyboard; the results scroll
// within it. On a hardware keyboard Up and Down move a selection through
// the results, starting on the first, and Enter opens the selected one.
// The Material palette has no scope chips and shows every group (scoping
// lives in the search view); the iOS look pins the chips under the field.
export function SearchPalette({ visible, onClose }: SearchPaletteProps) {
  const { look, scheme, m3, radii, spacing } = useBerean();
  const search = useSearch();
  const { text, total, truncated, open } = search;
  const chips = look === 'ios';
  const scope = chips ? search.scope : 'all';
  const groups = useVisibleGroups(scope);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // The modal's own height once laid out; the window's until then.
  const windowHeight = useWindowDimensions().height;
  const [measured, setMeasured] = useState<number>();
  const { maxHeight, ...padding } = paletteFrame(
    measured ?? windowHeight,
    insets,
    keyboardHeight,
    Platform.OS === 'android',
    spacing.xl,
  );

  const rows = flattenGroups(groups);
  const results = resultsId(
    text,
    scope,
    rows.map((row) => row.key),
  );
  const [selection, setSelection] = useState(NO_SELECTION);
  // Each opening starts on the first result, even with the same results.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setSelection(NO_SELECTION);
  }
  const selected = rows[selectedIndex(selection, results, rows.length)];
  const listKeys = useListKeys((key) =>
    setSelection((s) => moveSelection(s, results, rows.length, key === 'up' ? -1 : 1)),
  );

  // Enter opens the selected result.
  const openSelected = () => {
    if (selected === undefined) return;
    onClose();
    open(selected.hit);
  };

  const field = (style: StyleProp<TextStyle>) => (
    <SearchField
      autoFocus
      onSubmitEditing={openSelected}
      onFocus={(e) => {
        listKeys.capture(e.nativeEvent.target);
        // The palette's Modal is its own window, outside the root's ring.
        followFocusRingIn(e.nativeEvent.target);
      }}
      onBlur={(e) => listKeys.release(e.nativeEvent.target)}
      submitBehavior="submit"
      style={style}
    />
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <ModalNavigationBarStyle barStyle={systemBarStyle(scheme)} />
      <View
        onLayout={(e) => setMeasured(e.nativeEvent.layout.height)}
        style={[styles.center, padding]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close search"
          onPress={onClose}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: look === 'ios' ? m3.scrimWarm : m3.scrim },
          ]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: m3.surfaceContainerHigh,
              borderRadius: radii.sheet,
              maxHeight,
              paddingTop: spacing.xl,
              gap: spacing.md,
            },
          ]}
        >
          {look === 'material' ? (
            // The tablet mock's flat field row: icon, query, Ctrl K keycap,
            // and a divider above the results.
            <View
              style={[
                styles.fieldRow,
                {
                  borderBottomColor: m3.outlineVariant,
                  paddingHorizontal: spacing.xl,
                  paddingBottom: spacing.sm,
                  gap: spacing.md,
                },
              ]}
            >
              <SearchIcon color={m3.onSurfaceVariant} />
              {field(styles.flatField)}
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                style={[
                  styles.keycap,
                  {
                    borderColor: m3.outline,
                    borderRadius: radii.chip,
                    paddingHorizontal: spacing.sm,
                  },
                ]}
              >
                <UIText variant="label" secondary>
                  Ctrl K
                </UIText>
              </View>
            </View>
          ) : (
            // In the dialog's column only the results may shrink: SearchField's
            // flexShrink (for row layouts) would otherwise clip the field once
            // the results reach maxHeight.
            field({ marginHorizontal: spacing.xl, flexShrink: 0 })
          )}
          {chips && total > 0 && <SearchScopeChips style={{ paddingHorizontal: spacing.xl }} />}
          <SearchResults
            scope={scope}
            onOpened={onClose}
            selectedKey={selected?.key}
            style={styles.results}
            contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg }}
          />
          {total > 0 && (
            <View
              style={[
                styles.footer,
                {
                  borderTopColor: m3.outlineVariant,
                  paddingHorizontal: spacing.xl,
                  paddingVertical: spacing.md,
                  gap: spacing.lg,
                },
              ]}
            >
              <UIText variant="caption" secondary>
                {resultsLabel(rows.length, truncated)}
              </UIText>
              <UIText variant="caption" secondary>
                Enter to open
              </UIText>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 660, overflow: 'hidden' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: hairline },
  // Flat: no fill or pill; the row pads it.
  flatField: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 0,
    paddingHorizontal: 0,
  },
  keycap: { borderWidth: 1, paddingVertical: 2 },
  results: { flexGrow: 0, flexShrink: 1 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    borderTopWidth: hairline,
  },
});
