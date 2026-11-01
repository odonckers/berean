// A destructive confirmation's buttons, by look. Kept free of React Native
// for the tests.

import type { ColorSet, M3Roles } from '@/design/colors';

export type ConfirmButton = { role: 'cancel' | 'confirm'; label: string; color: string; bold: boolean };

/**
 * Sentence case, Cancel then the destructive action last (on the right).
 * Material (M3 dialog): Cancel in primary, the action in error. iOS look
 * (alert): Cancel bold, as iOS bolds the safe choice beside a destructive
 * one; the action in the destructive red.
 */
export function confirmButtons(
  look: 'ios' | 'material',
  confirmLabel: string,
  colors: Pick<ColorSet, 'accent' | 'destructive'>,
  m3: Pick<M3Roles, 'primary' | 'error'>,
): [ConfirmButton, ConfirmButton] {
  const material = look === 'material';
  return [
    { role: 'cancel', label: 'Cancel', color: material ? m3.primary : colors.accent, bold: !material },
    { role: 'confirm', label: confirmLabel, color: material ? m3.error : colors.destructive, bold: false },
  ];
}

/**
 * The dialog's surface. iOS look: the raised paper. Material: the raised
 * paper in light, so error clears 4.5:1 on it (it is 4.3:1 on
 * surfaceContainerHigh); surfaceContainerHigh in dark.
 */
export function dialogSurface(
  look: 'ios' | 'material',
  dark: boolean,
  colors: Pick<ColorSet, 'surfaceRaised'>,
  m3: Pick<M3Roles, 'surfaceContainerHigh'>,
): string {
  return look === 'material' && dark ? m3.surfaceContainerHigh : colors.surfaceRaised;
}

export type NameDialogInk = { error: string; fieldBorder: string; confirmBold: boolean };

/**
 * The name dialog's inks. The inline error in the destructive red. The
 * field's border: Material, primary (error while the name is refused); iOS
 * look, the outline, as the field's fill is barely off the card's. iOS look
 * bolds the confirm action (nothing destructive beside it); Material bolds
 * neither.
 */
export function nameDialogInk(
  look: 'ios' | 'material',
  refused: boolean,
  colors: Pick<ColorSet, 'destructive' | 'outline'>,
  m3: Pick<M3Roles, 'primary'>,
): NameDialogInk {
  const material = look === 'material';
  return {
    error: colors.destructive,
    fieldBorder: material ? (refused ? colors.destructive : m3.primary) : colors.outline,
    confirmBold: !material,
  };
}
