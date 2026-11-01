import { type ComponentRef, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import type { Anchor } from '@/notes/list-rows';

type WorkspaceTitleProps = {
  name: string;
  /** Spoken after the name: "Romans, 4 cards". */
  detail: string;
  expanded: boolean;
  /** Opens the workspace menu at the title. */
  onPress: (anchor: Anchor) => void;
};

/**
 * The phone's workspace switcher (§7.3): the screen title is a menu
 * button. iOS look: the centred navigation title with a chevron, as a
 * title menu. Material: the top app bar's start-aligned title with the
 * dropdown arrow, as an exposed dropdown.
 */
export function WorkspaceTitle({ name, detail, expanded, onPress }: WorkspaceTitleProps) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const ref = useRef<ComponentRef<typeof Pressable>>(null);
  const open = () => ref.current?.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${detail}`}
      accessibilityHint="Switch, add, rename or delete workspaces"
      accessibilityState={{ expanded }}
      onPress={open}
      android_ripple={material ? { color: colors.separator, borderless: false } : undefined}
      style={({ pressed }) => [
        styles.button,
        { minHeight: material ? 48 : 44 },
        !material && { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          material ? type.ui.title : styles.iosTitle,
          styles.text,
          { color: material ? m3.onSurface : colors.text },
        ]}
      >
        {name}
      </Text>
      <ScaledSymbol
        name={{ ios: 'chevron.down', android: 'arrow_drop_down' }}
        size={material ? 24 : 13}
        weight={material ? undefined : 'semibold'}
        tintColor={material ? m3.onSurfaceVariant : colors.accent}
        accessible={false}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  text: { flexShrink: 1 },
  iosTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
});
