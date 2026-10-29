import { Platform, StyleSheet, View } from 'react-native';

import { SearchPlaceholder } from '@/components/search-placeholder';
import { UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';

export default function SearchTabScreen() {
  const { colors, spacing } = useBerean();
  const insets = useContentInsets();
  if (Platform.OS === 'ios') return <SearchPlaceholder showField={false} />;
  // The iOS look on Android hides the native header, so the title is drawn here.
  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.surface, paddingTop: insets.top + spacing.lg },
      ]}
    >
      <UIText variant="largeTitle" style={{ paddingHorizontal: spacing.lg }}>
        Search
      </UIText>
      <SearchPlaceholder />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
