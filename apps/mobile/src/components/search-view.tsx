import { router } from 'expo-router';
import { useRef } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { SearchField } from '@/components/search-field';
import { SearchResults, SearchScopeChips } from '@/components/search-results';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { useKeyboardHeight } from '@/design/use-keyboard-height';
import { useSearch } from '@/search/search-context';

// Material look: the full-screen search view the M3 search bar expands into.
// The field sits at the top between a back arrow and, once there's a query,
// a clear button; Back (the arrow or the system gesture) collapses it. The
// filter chips sit under the field once there are results to scope. The results run under the navigation bar
// and the keyboard, padded so the last row scrolls clear of both; the
// keyboard covers the navigation bar where it's open.
export function MaterialSearchView() {
  const { m3, spacing } = useBerean();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { text, setText, total } = useSearch();
  const field = useRef<TextInputInstance>(null);
  const clear = () => {
    setText('');
    field.current?.focus();
  };
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
            paddingEnd: insets.right + spacing.xs,
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
          ref={field}
          autoFocus
          style={[styles.flatField, { paddingHorizontal: spacing.sm }]}
        />
        {text.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={clear}
            android_ripple={{ color: m3.outline, borderless: true }}
            style={styles.iconButton}
          >
            <ScaledSymbol
              name={{ ios: 'xmark', android: 'close' }}
              tintColor={m3.onSurfaceVariant}
              accessible={false}
            />
          </Pressable>
        )}
      </View>
      {total > 0 && (
        <SearchScopeChips
          style={{
            paddingStart: insets.left + spacing.lg,
            paddingEnd: insets.right + spacing.lg,
            paddingVertical: spacing.xs,
          }}
        />
      )}
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

// iOS look: scope chips with counts, pinned under the title (atop the
// content under the native header), and results filling the screen, with
// the field at the bottom within thumb reach.
export function IosSearchView({ nativeField, inlineTitle, insets }: IosSearchViewProps) {
  const { colors, spacing } = useBerean();
  const { total } = useSearch();
  const horizontal = { paddingStart: insets.left + spacing.lg, paddingEnd: insets.right + spacing.lg };
  const top = inlineTitle ? spacing.sm : insets.top + spacing.lg;
  const chips = total > 0;
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
      {chips && (
        <SearchScopeChips style={[horizontal, { paddingTop: top, paddingBottom: spacing.xs }]} />
      )}
      <SearchResults
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          horizontal,
          { paddingTop: chips ? 0 : top, paddingBottom: spacing.lg },
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
