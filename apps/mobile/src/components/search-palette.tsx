import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { SearchField } from '@/components/search-field';
import { SearchResults, SearchScopeChips, useVisibleGroups } from '@/components/search-results';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { hairline } from '@/design/tokens';
import { resultsLabel } from '@/search/results';
import { useSearch } from '@/search/search-context';

type SearchPaletteProps = {
  visible: boolean;
  onClose: () => void;
};

// Ctrl+K / Cmd+K: the same search, centered in a Material dialog shape over
// the scrim, with the query, results and counts of every other entry. Back
// and Escape (Android maps Escape to back) close it through onRequestClose;
// tapping the scrim closes it too.
export function SearchPalette({ visible, onClose }: SearchPaletteProps) {
  const { m3, radii, spacing } = useBerean();
  const { total, truncated, open } = useSearch();
  const groups = useVisibleGroups();

  // Enter opens the top result.
  const openFirst = () => {
    const first = groups[0]?.hits[0];
    if (first === undefined) return;
    onClose();
    open(first.hit);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding" style={[styles.center, { padding: spacing.xl }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close search"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: m3.scrim }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: m3.surfaceContainerHigh,
              borderRadius: radii.sheet,
              paddingTop: spacing.xl,
              gap: spacing.md,
            },
          ]}
        >
          <SearchField
            autoFocus
            onSubmitEditing={openFirst}
            submitBehavior="submit"
            style={{ marginHorizontal: spacing.xl }}
          />
          <SearchResults
            header={<SearchScopeChips style={{ paddingBottom: spacing.xs }} />}
            onOpened={onClose}
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
                {resultsLabel(total, truncated)}
              </UIText>
              <UIText variant="caption" secondary>
                Enter to open
              </UIText>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 660, maxHeight: '100%', overflow: 'hidden' },
  results: { flexGrow: 0, flexShrink: 1 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    borderTopWidth: hairline,
  },
});
