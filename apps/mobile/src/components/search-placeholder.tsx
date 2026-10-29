import { StyleSheet, View } from 'react-native';

import { SearchField } from '@/components/search-field';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';

// Placeholder search screen; no search logic until Expo 5. The iOS search tab
// passes showField={false} because its native header search field is used.
export function SearchPlaceholder({ showField = true }: { showField?: boolean }) {
  const { colors, spacing } = useBerean();
  return (
    <View style={[styles.root, { backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.lg }]}>
      {showField && <SearchField autoFocus />}
      <UIText secondary>
        Search across Scripture and your studies. Results arrive with Expo 5.
      </UIText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
