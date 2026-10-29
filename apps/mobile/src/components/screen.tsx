import { useNavigation } from 'expo-router';
import { useLayoutEffect, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppBarSearchBar, DockedSearchBar } from '@/components/search-bar';
import { UIText } from '@/components/text';
import { useContentInsets, useHeaderHidden } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { useWindowClass } from '@/design/use-window-class';

type ScreenProps = {
  title: string;
  children: ReactNode;
  // Material look only: a docked search bar on phones, a search bar in the
  // top app bar on tablets.
  search?: boolean;
  // Max width of a centered content column; the inline large title is
  // capped and centered to match it.
  measure?: number;
};

// Scroll content on a solid surface.
export function Screen({ title, children, search = false, measure }: ScreenProps) {
  const { look, colors, spacing } = useBerean();
  const windowClass = useWindowClass();
  const navigation = useNavigation();
  const fill = useTopAppBarFill();
  const insets = useContentInsets();

  const material = look === 'material';
  const docked = material && search && windowClass === 'compact';
  const appBarSearch = material && search && windowClass !== 'compact';
  // With the native header hidden, the large title is drawn in the content.
  const inlineLargeTitle = useHeaderHidden();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: appBarSearch ? () => <AppBarSearchBar /> : undefined,
    });
  }, [navigation, appBarSearch]);

  return (
    <>
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.surface }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
        scrollEventThrottle={16}
        {...fill}
      >
        {inlineLargeTitle &&
          (measure ? (
            <View style={[styles.measure, { maxWidth: measure }]}>
              <UIText variant="largeTitle">{title}</UIText>
            </View>
          ) : (
            <UIText variant="largeTitle">{title}</UIText>
          ))}
        {children}
      </ScrollView>
      {docked && <DockedSearchBar />}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  measure: { width: '100%', alignSelf: 'center' },
});
