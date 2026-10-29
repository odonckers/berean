import type { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

import { useBerean } from '@/design/theme';

type StackOptions = NonNullable<ComponentProps<typeof Stack>['screenOptions']>;

// Header options for each tab's stack, by look. Screen adds the scroll-driven
// tonal fill and the tablet top app bar search bar on top of these.
export function useStackOptions(): Exclude<StackOptions, (...args: never[]) => unknown> {
  const { look, colors, m3, type } = useBerean();
  if (look === 'material') {
    // M3 small top app bar: flat, on the solid surface.
    return {
      headerLargeTitleEnabled: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: m3.surface },
      headerTintColor: m3.onSurface,
      headerTitleStyle: { fontSize: type.ui.title.fontSize, fontWeight: '400' },
      contentStyle: { backgroundColor: colors.surface },
    };
  }
  return {
    headerLargeTitleEnabled: true,
    headerLargeTitleShadowVisible: false,
    // Accent tints the back button only; titles stay in the text color.
    headerTintColor: colors.accent,
    headerTitleStyle: { color: colors.text },
    headerLargeTitleStyle: { color: colors.text },
    contentStyle: { backgroundColor: colors.surface },
    // Android's native header has no large title, so it is hidden; Screen
    // draws the title in the content, under the status bar.
    ...(Platform.OS === 'android' ? { headerShown: false } : null),
  };
}
