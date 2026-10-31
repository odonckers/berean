import type { ReactNode } from 'react';
import { type ColorValue, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';

type NoteAppBarProps = {
  /** Back on a pushed note; Close (X) over the tabs, for a note started at a verse. */
  leading: 'back' | 'close';
  onLeading: () => void;
  /** The Write | Read switch, in the title slot. */
  title?: ReactNode;
  /** The overflow button. */
  trailing?: ReactNode;
  /** The screen's fill (useTopAppBarFill), else the surface. */
  backgroundColor?: ColorValue;
};

/**
 * The note editor's top app bar on the Material look (Lumen): 64dp, a 48dp
 * navigation icon, the Write | Read switch in the title slot, then the 48dp
 * overflow. The native header is 56dp and takes no height, so the screen
 * draws this as its header instead.
 */
export function NoteAppBar({ leading, onLeading, title, trailing, backgroundColor }: NoteAppBarProps) {
  const { colors, m3 } = useBerean();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: backgroundColor ?? m3.surface,
        paddingTop: insets.top,
        paddingStart: insets.left + spacing.xs,
        paddingEnd: insets.right + spacing.xs,
      }}
    >
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={leading === 'back' ? 'Back' : 'Close'}
          onPress={onLeading}
          android_ripple={{ color: colors.separator, borderless: true }}
          style={styles.icon}
        >
          <ScaledSymbol
            name={leading === 'back' ? { ios: 'chevron.backward', android: 'arrow_back' } : { ios: 'xmark', android: 'close' }}
            size={24}
            tintColor={m3.onSurface}
            accessible={false}
          />
        </Pressable>
        <View style={styles.title}>{title}</View>
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center' },
});
