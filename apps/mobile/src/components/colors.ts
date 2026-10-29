import { Platform, PlatformColor } from 'react-native';

// System colors so light/dark mode follows the OS without custom palettes.
export const colors = Platform.select({
  ios: {
    background: PlatformColor('systemGroupedBackground'),
    card: PlatformColor('secondarySystemGroupedBackground'),
    label: PlatformColor('label'),
    secondaryLabel: PlatformColor('secondaryLabel'),
    tint: PlatformColor('systemBlue'),
  },
  default: {
    background: PlatformColor('?android:attr/colorBackground'),
    card: PlatformColor('?android:attr/colorBackgroundFloating'),
    label: PlatformColor('?android:attr/textColorPrimary'),
    secondaryLabel: PlatformColor('?android:attr/textColorSecondary'),
    tint: PlatformColor('?android:attr/colorAccent'),
  },
});
