import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { IosSearchView } from '@/components/search-view';
import { useContentInsets, useHeaderHidden } from '@/design/tab-chrome';
import { useSearch } from '@/search/search-context';

// The iOS look's Search tab. On iOS the native header search field is the
// control: the tab's search role puts it at the bottom of the glass tab bar
// (iOS 26). That native field exists only on iOS, hence the Platform check;
// elsewhere IosSearchView draws the field at the bottom itself.
export default function SearchTabScreen() {
  const insets = useContentInsets();
  const inlineTitle = useHeaderHidden();
  const nativeField = Platform.OS === 'ios';
  const { text, setText, fills } = useSearch();

  // The native field keeps its own text: on focus it takes the shared query,
  // so a query typed in the palette carries over.
  const searchBar = useRef<SearchBarCommands>(null);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useFocusEffect(
    useCallback(() => {
      searchBar.current?.setText(textRef.current);
    }, []),
  );
  // A chosen suggestion goes into the native field too.
  useEffect(() => {
    if (fills > 0) searchBar.current?.setText(textRef.current);
  }, [fills]);

  return (
    <>
      {nativeField && (
        <Stack.Screen
          options={{
            headerSearchBarOptions: {
              ref: searchBar,
              placeholder: 'Search Berean',
              autoCapitalize: 'none',
              onChangeText: (e) => setText(e.nativeEvent.text),
            },
          }}
        />
      )}
      <IosSearchView nativeField={nativeField} inlineTitle={inlineTitle} insets={insets} />
    </>
  );
}
