// An action sheet's or menu's surface and item ink, by look. Kept free of
// React Native for the tests.

import type { ColorSet, M3Roles } from '@/design/colors';

/** Material: surfaceContainer, as a menu or a bottom sheet. iOS look: the raised paper. */
export function sheetSurface(
  look: 'ios' | 'material',
  colors: Pick<ColorSet, 'surfaceRaised'>,
  m3: Pick<M3Roles, 'surfaceContainer'>,
): string {
  return look === 'material' ? m3.surfaceContainer : colors.surfaceRaised;
}

/**
 * An item's label colour. Material marks a destructive sheet item with
 * primary and a destructive menu item (label and icon) with error; the iOS
 * look draws destructive items in the destructive red, as iOS does.
 */
export function sheetItemInk(
  look: 'ios' | 'material',
  destructive: boolean,
  menu: boolean,
  colors: Pick<ColorSet, 'accent' | 'destructive'>,
  m3: Pick<M3Roles, 'primary' | 'error' | 'onSurface'>,
): string {
  if (look !== 'material') return destructive ? colors.destructive : colors.accent;
  if (!destructive) return m3.onSurface;
  return menu ? m3.error : m3.primary;
}

/**
 * A swipe action's fill and ink. The iOS look: a destructive action in the
 * destructive red with the page as its ink (the page reads on the red in
 * light and dark alike, where white fails on the dark sets' lighter red),
 * the others in textSecondary. Material: a destructive action in primary,
 * the others in secondaryContainer.
 */
export function swipeActionColors(
  look: 'ios' | 'material',
  destructive: boolean,
  colors: Pick<ColorSet, 'surface' | 'textSecondary' | 'destructive'>,
  m3: Pick<M3Roles, 'primary' | 'onPrimary' | 'secondaryContainer' | 'onSecondaryContainer'>,
): { fill: string; ink: string } {
  if (look === 'material') {
    return destructive
      ? { fill: m3.primary, ink: m3.onPrimary }
      : { fill: m3.secondaryContainer, ink: m3.onSecondaryContainer };
  }
  return destructive ? { fill: colors.destructive, ink: colors.surface } : { fill: colors.textSecondary, ink: m3.onPrimary };
}
