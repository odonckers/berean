// The reader's Aa quick picker (themes spec §4, rule 12): where it opens,
// how tall, and how its groups lay out. Pure, for the Node tests.

import type { Scheme } from './appearance.ts';
import { pickerLayout } from './appearance-picker.ts';
import type { ColorSet, M3Roles } from './colors.ts';

type Look = 'ios' | 'material';
type WindowClass = 'compact' | 'medium' | 'expanded';

/**
 * - bottomSheet: M3 standard (non-modal) bottom sheet, no scrim (Android phone).
 * - sheet: the iPhone sheet at a detent.
 * - sideSheet: M3 trailing side sheet; the reading column reflows beside it.
 * - popover: the iPad popover, a card anchored under the Aa button.
 */
export type QuickPickerPlacement = 'bottomSheet' | 'sheet' | 'sideSheet' | 'popover';

export function quickPickerPlacement(look: Look, windowClass: WindowClass): QuickPickerPlacement {
  if (windowClass === 'compact') return look === 'material' ? 'bottomSheet' : 'sheet';
  return look === 'material' ? 'sideSheet' : 'popover';
}

/** The side sheet's and the popover's width (M3 side sheets run 256–400). */
export const QUICK_PICKER_WIDTH = 360;

/** The medium detent, as a fraction of the reader's height. */
export const MEDIUM_DETENT = 0.5;

export type QuickPickerLayout = {
  /** Theme tiles and Appearance in a row, or as lists. */
  layout: 'row' | 'list';
  /** The sheet's detent: large at accessibility text sizes. */
  detent: 'medium' | 'large';
  /** Accents as a grid of three with names, rather than a list. */
  accentGrid: boolean;
};

/**
 * At accessibility text sizes, which is where Settings › Appearance turns
 * its tiles into a list (pickerLayout), the sheet opens at the large
 * detent: Theme and Appearance are lists and the accents wrap to two rows
 * of three with names. Otherwise the medium detent with Settings' rows.
 */
export function quickPickerLayout(contentWidth: number, fontScale: number, look: Look): QuickPickerLayout {
  const layout = pickerLayout(contentWidth, fontScale, look);
  return { layout, detent: layout === 'list' ? 'large' : 'medium', accentGrid: layout === 'list' };
}

/**
 * The sheet's height in the reader's area. Medium is half of it; large
 * leaves a strip of one reader line (with its padding) above the sheet,
 * below any status bar inset the reader draws under, and is never shorter
 * than medium.
 */
export function sheetHeight(
  detent: 'medium' | 'large',
  { areaHeight, topInset, lineHeight }: { areaHeight: number; topInset: number; lineHeight: number },
): number {
  const medium = Math.round(areaHeight * MEDIUM_DETENT);
  if (detent === 'medium') return medium;
  return Math.max(medium, Math.round(areaHeight - topInset - lineHeight - 2 * STRIP_PADDING));
}

const STRIP_PADDING = 8;

/** A drag down further than this, or a flick faster than DISMISS_VELOCITY (dp/s), closes the sheet. */
export const DISMISS_DISTANCE = 96;
export const DISMISS_VELOCITY = 800;

export function dragCloses(translationY: number, velocityY: number): boolean {
  'worklet';
  return translationY > DISMISS_DISTANCE || velocityY > DISMISS_VELOCITY;
}

/**
 * The bottom sheet's, side sheet's and popover's surface. The material look
 * sits on M3 surfaceContainerLow in light; in dark that sinks into the page,
 * so it steps up to surfaceContainerHigh. The iOS look is surfaceRaised.
 */
export function quickPickerSheetSurface(
  look: Look,
  scheme: Scheme,
  m3: Pick<M3Roles, 'surfaceContainerLow' | 'surfaceContainerHigh'>,
  colors: Pick<ColorSet, 'surfaceRaised'>,
): string {
  if (look !== 'material') return colors.surfaceRaised;
  return scheme === 'dark' ? m3.surfaceContainerHigh : m3.surfaceContainerLow;
}
