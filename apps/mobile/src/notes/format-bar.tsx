import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { glassFace } from '@/design/chrome';
import { useBerean, useSolidChrome } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';
import { FORMAT_ACTIONS, FORMAT_BUTTONS } from '@/notes/format-bar-config';
import type { FormatAction } from '@/notes/format-edits';

type FormatBarProps = {
  onAction: (action: FormatAction) => void;
};

/**
 * The Write view's formatting bar above the keyboard (guide §7.1), its
 * buttons in FORMAT_ACTIONS order. iOS look: a floating capsule, Liquid
 * Glass approximated as a raised surface with a hairline edge (solid with
 * an outline under Reduce Transparency or Increase Contrast), 44pt
 * buttons. Material look: a solid surface-container toolbar across the
 * width, 48dp buttons. It scrolls sideways when the window is too narrow;
 * taps keep the keyboard up.
 */
export function FormatBar({ onAction }: FormatBarProps) {
  const { look, colors, m3 } = useBerean();
  const solid = useSolidChrome();
  const material = look === 'material';
  const size = material ? 48 : 44;

  return (
    <View
      accessibilityRole="toolbar"
      style={
        material
          ? [styles.materialBar, { backgroundColor: m3.surfaceContainer }]
          : [styles.iosBar, glassFace(solid, colors, hairline), { shadowColor: colors.text }]
      }
    >
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.buttons}
      >
        {FORMAT_ACTIONS.map((action) => {
          const button = FORMAT_BUTTONS[action];
          return (
            <Pressable
              key={action}
              accessibilityRole="button"
              accessibilityLabel={button.accessibilityLabel}
              onPress={() => onAction(action)}
              style={({ pressed }) => [
                styles.button,
                { minWidth: size, minHeight: size, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <ScaledSymbol
                name={button.symbol}
                size={material ? 24 : 20}
                tintColor={material ? m3.onSurfaceVariant : colors.text}
                accessible={false}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // M3 docked toolbar: 64dp, the buttons centered.
  materialBar: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.xs },
  iosBar: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.capsule,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  buttons: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between' },
  button: { alignItems: 'center', justifyContent: 'center' },
});
