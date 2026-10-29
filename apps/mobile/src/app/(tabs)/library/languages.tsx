import { router, Stack, useTheme } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { catalog } from '@/ffi/core';
import { load } from '@/library/load';
import { useSelectedLanguage } from '@/library/selected-language';

export default function LanguagesScreen() {
  const { colors } = useTheme();
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
        <Text style={[styles.name, { color: colors.notification }]}>{languages.message}</Text>
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
          <Text style={[styles.name, styles.message, { color: colors.text }]}>
            No languages match.
          </Text>
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
              style={[styles.row, { borderColor: colors.border }]}
            >
              <Text style={[styles.name, { color: colors.text }, selected && styles.selected]}>
                {item.name}
              </Text>
              <Text style={[styles.code, { color: colors.text }]}>
                {selected ? `${item.code} · Selected` : item.code}
              </Text>
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, fontSize: 17 },
  selected: { fontWeight: '600' },
  code: { fontSize: 15, opacity: 0.7 },
  message: { padding: 16 },
});
