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
