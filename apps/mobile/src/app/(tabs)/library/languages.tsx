import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { catalog } from '@/ffi/core';
import { load } from '@/library/load';
import { useSelectedLanguage } from '@/library/selected-language';

export default function LanguagesScreen() {
  const { colors } = useBerean();
  const { mepsLanguage, setMepsLanguage } = useSelectedLanguage();
  const [languages] = useState(() => load(() => catalog().languages()));
  const [query, setQuery] = useState('');

  const screen = (
    <Stack.Screen
      options={{
        headerSearchBarOptions: {
          placeholder: 'Search languages',
          onChangeText: (e) => setQuery(e.nativeEvent.text),
        },
      }}
    />
  );

  if (!languages.ok) {
    return (
      <View style={styles.message}>
        {screen}
        <UIText style={[styles.name, { color: colors.accent }]}>{languages.message}</UIText>
      </View>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = languages.value.filter(
    (l) => l.name.toLowerCase().includes(needle) || l.code.toLowerCase().includes(needle),
  );

  return (
    <>
      {screen}
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={shown}
        keyExtractor={(l) => String(l.mepsId)}
        ListEmptyComponent={
          <UIText style={[styles.name, styles.message]}>No languages match.</UIText>
        }
        renderItem={({ item }) => {
          const selected = item.mepsId === mepsLanguage;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              accessibilityState={{ selected }}
              onPress={() => {
                setMepsLanguage(item.mepsId);
                router.back();
              }}
              style={[styles.row, { borderColor: colors.separator }]}
            >
              <UIText style={[styles.name, selected && styles.selected]}>{item.name}</UIText>
              <UIText secondary style={styles.code}>
                {selected ? `${item.code} · Selected` : item.code}
              </UIText>
            </Pressable>
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  row: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: hairline,
  },
  name: { flex: 1 },
  selected: { fontWeight: '600' },
  code: { fontSize: 15 },
  message: { padding: spacing.lg },
});
