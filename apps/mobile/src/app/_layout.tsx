import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
