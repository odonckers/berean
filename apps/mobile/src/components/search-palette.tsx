import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { SearchField } from '@/components/search-field';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';

type SearchPaletteProps = {
  visible: boolean;
  onClose: () => void;
};

// Ctrl+K / Cmd+K: the same search, centered in a Material dialog shape over
// the scrim. Back and Escape (Android maps Escape to back) close it through
// onRequestClose; tapping the scrim closes it too.
export function SearchPalette({ visible, onClose }: SearchPaletteProps) {
  const { m3, radii, spacing } = useBerean();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.center, { padding: spacing.xl }]}>
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
              padding: spacing.xl,
              gap: spacing.lg,
            },
          ]}
        >
          <SearchField autoFocus />
          <UIText variant="caption" secondary>
            Results arrive with Expo 5.
          </UIText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 660 },
});
