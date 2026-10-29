import { NativeTabs } from 'expo-router/native-tabs';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <NativeTabs>
        <NativeTabs.Trigger name="(read)">
          <NativeTabs.Trigger.Label>Read</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'book', selected: 'book.fill' }} md="menu_book" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="studyspace">
          <NativeTabs.Trigger.Label>Studyspace</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf="square.and.pencil"
            md="edit_note"
          />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="search">
          <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="library">
          <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
            md="library_books"
          />
        </NativeTabs.Trigger>
      </NativeTabs>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
