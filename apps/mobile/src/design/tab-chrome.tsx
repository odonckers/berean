import { createContext, useContext } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBerean } from '@/design/theme';

// The four destinations, in order, shared by every tabs layout. `md` names
// are Material Symbols (expo-symbols draws them on Android).
export const destinations = [
  { name: '(read)', href: '/', label: 'Read', md: 'menu_book' },
  { name: 'studyspace', href: '/studyspace', label: 'Studyspace', md: 'edit_note' },
  { name: 'notes', href: '/notes', label: 'Notes', md: 'sticky_note_2' },
  { name: 'library', href: '/library', label: 'Library', md: 'library_books' },
] as const;

// Which system bar insets the tabs layout's own chrome already covers, so
// Screen pads only the rest. The default is NativeTabs: its bottom bar
// reserves the navigation bar, nothing reserves the status bar.
type TabChrome = { coversTop: boolean; coversBottom: boolean };

export const TabChromeContext = createContext<TabChrome>({ coversTop: false, coversBottom: true });

// Preview approximation: the iOS look on Android hides the native header
// (it has no large title) and Screen draws the title in the content.
export function useHeaderHidden(): boolean {
  return useBerean().look === 'ios' && Platform.OS === 'android';
}

// Content padding for the system bars nothing else covers.
export function useContentInsets(): { top: number; bottom: number } {
  const chrome = useContext(TabChromeContext);
  const insets = useSafeAreaInsets();
  const headerHidden = useHeaderHidden();
  return {
    top: headerHidden && !chrome.coversTop ? insets.top : 0,
    bottom: Platform.OS === 'android' && !chrome.coversBottom ? insets.bottom : 0,
  };
}
