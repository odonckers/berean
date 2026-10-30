import { router } from 'expo-router';
import { KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { SearchField } from '@/components/search-field';
import { SearchResults, SearchScopeChips } from '@/components/search-results';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { useKeyboardHeight } from '@/design/use-keyboard-height';

// Material look: the full-screen search view the M3 search bar expands into.
// The field sits at the top beside a back arrow; Back (the arrow or the
// system gesture) collapses it. The results run under the navigation bar
// and the keyboard, padded so the last row scrolls clear of both; the
// keyboard covers the navigation bar where it's open.
export function MaterialSearchView() {
  const { m3, spacing } = useBerean();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  return (
    <View style={[styles.root, { backgroundColor: m3.surface }]}>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: m3.surfaceContainerHigh,
            paddingTop: insets.top + spacing.xs,
            paddingBottom: spacing.xs,
            paddingStart: insets.left + spacing.xs,
            paddingEnd: insets.right + spacing.lg,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          android_ripple={{ color: m3.outline, borderless: true }}
          style={styles.iconButton}
        >
          <ScaledSymbol
            name={{ ios: 'chevron.backward', android: 'arrow_back' }}
            tintColor={m3.onSurface}
            accessible={false}
          />
        </Pressable>
        {/* Flat inside the view's header, as in the M3 search view. */}
        <SearchField
          autoFocus
          style={[styles.flatField, { paddingHorizontal: spacing.sm }]}
        />
      </View>
      <SearchResults
        style={styles.root}
        contentContainerStyle={{
          paddingStart: insets.left + spacing.lg,
          paddingEnd: insets.right + spacing.lg,
          paddingBottom: Math.max(insets.bottom, keyboardHeight) + spacing.lg,
        }}
      />
    </View>
  );
}

type IosSearchViewProps = {
  /** iOS draws the native search field in the header; elsewhere it's drawn here. */
  nativeField: boolean;
  /** The large title, where the native header is hidden. */
  inlineTitle: boolean;
  insets: { top: number; bottom: number; left: number; right: number };
};

// iOS look: scope chips with counts and results filling the screen, with
// the field at the bottom within thumb reach.
export function IosSearchView({ nativeField, inlineTitle, insets }: IosSearchViewProps) {
  const { colors, spacing } = useBerean();
  const horizontal = { paddingStart: insets.left + spacing.lg, paddingEnd: insets.right + spacing.lg };
  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.root, { backgroundColor: colors.surface }]}
    >
      {inlineTitle && (
        <UIText variant="largeTitle" style={[horizontal, { paddingTop: insets.top + spacing.lg }]}>
          Search
        </UIText>
      )}
      <SearchResults
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        header={<SearchScopeChips style={{ paddingBottom: spacing.xs }} />}
        contentContainerStyle={[
          horizontal,
          { paddingTop: inlineTitle ? spacing.sm : insets.top + spacing.lg, paddingBottom: spacing.lg },
        ]}
      />
      {!nativeField && (
        <View
          style={[
            horizontal,
            { paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.sm },
          ]}
        >
          <SearchField />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  flatField: { flex: 1, backgroundColor: 'transparent', borderWidth: 0, minHeight: 48 },
});
