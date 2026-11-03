import { NativeTabs } from 'expo-router/native-tabs';
import { Platform, useWindowDimensions } from 'react-native';

import { FloatingTabBarLayout } from '@/components/floating-tab-bar';
import { NavigationRailLayout } from '@/components/navigation-rail';
import { tabLabelFontSize } from '@/design/tab-label';
import { useBerean, type Berean } from '@/design/theme';
import { useWindowClass } from '@/design/use-window-class';

// Every color is explicit: NativeTabs otherwise falls back to Material You
// dynamic colors on Android, and nothing may recolor Berean.
function tabColors({ look, colors, m3, type }: Berean, fontScale: number) {
  // Android draws the label's fontSize as sp, scaled by the system font
  // scale, in a fixed-width M3 bar item: at font 2.0 "Studyspace" became
  // "Studys…". The label grows with the font scale only up to 1.3× (see
  // tab-label.ts), as M3 bar labels do. iOS tab bars don't grow their
  // labels with Dynamic Type, so they keep the base size.
  const base = type.ui.label.fontSize ?? 12;
  const fontSize = Platform.OS === 'android' ? tabLabelFontSize(base, fontScale) : base;
  const labelSize = { fontSize, fontWeight: type.ui.label.fontWeight };
  if (look === 'material') {
    return {
      backgroundColor: m3.surfaceContainer,
      indicatorColor: m3.secondaryContainer,
      iconColor: { default: m3.onSurfaceVariant, selected: m3.onSecondaryContainer },
      tintColor: m3.primary,
      rippleColor: colors.separator,
      labelStyle: {
        default: { ...labelSize, color: m3.onSurfaceVariant },
        selected: { ...labelSize, color: m3.onSurface },
      },
    };
  }
  return {
    backgroundColor: colors.surface,
    indicatorColor: colors.surface,
    disableIndicator: true,
    iconColor: { default: colors.textSecondary, selected: colors.accent },
    tintColor: colors.accent,
    rippleColor: colors.separator,
    labelStyle: {
      default: { ...labelSize, color: colors.textSecondary },
      selected: { ...labelSize, color: colors.accent },
    },
  };
}

export default function TabsLayout() {
  const berean = useBerean();
  const { fontScale } = useWindowDimensions();
  const windowClass = useWindowClass();
  // NativeTabs has no rail on Android, so wide Android windows use headless
  // tabs. iOS keeps NativeTabs everywhere: iPadOS draws its own floating tab
  // bar and sidebar. Crossing the breakpoint at runtime may reset tab state.
  if (Platform.OS === 'android' && windowClass !== 'compact') {
    return berean.look === 'material' ? <NavigationRailLayout /> : <FloatingTabBarLayout />;
  }
  return (
    <NativeTabs labelVisibilityMode="labeled" {...tabColors(berean, fontScale)}>
      <NativeTabs.Trigger name="(read)">
        <NativeTabs.Trigger.Label>Read</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'book', selected: 'book.fill' }} md="menu_book" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="studyspace">
        <NativeTabs.Trigger.Label>Studyspace</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" md="edit_note" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notes">
        <NativeTabs.Trigger.Label>Notes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="note.text" md="sticky_note_2" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
          md="library_books"
        />
      </NativeTabs.Trigger>
      {/* iOS look only: on iOS 26 the search role renders the separate
          trailing glass search tab. The material look searches from the
          docked bar or the top app bar instead. */}
      <NativeTabs.Trigger name="search" role="search" hidden={berean.look !== 'ios'}>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
