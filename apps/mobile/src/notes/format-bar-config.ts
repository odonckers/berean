// The Write view's formatting bar and reference suggestion, as settings
// easy to change. Order and placement per Lumen (expo6c spec question 6).
import type { AndroidSymbol, SFSymbol } from 'expo-symbols';

import type { FormatAction } from '@/notes/format-edits';

/** The bar's buttons, in order: reorder here. */
export const FORMAT_ACTIONS: readonly FormatAction[] = [
  'heading',
  'bold',
  'italic',
  'list',
  'checklist',
  'quote',
  'link',
  'tag',
];

type FormatButton = {
  label: string;
  accessibilityLabel: string;
  /** An SF Symbol (iOS) and a Material Symbol (Android). */
  symbol: { ios: SFSymbol; android: AndroidSymbol };
};

export const FORMAT_BUTTONS: Record<FormatAction, FormatButton> = {
  heading: { label: 'Heading', accessibilityLabel: 'Heading', symbol: { ios: 'textformat.size', android: 'title' } },
  bold: { label: 'Bold', accessibilityLabel: 'Bold', symbol: { ios: 'bold', android: 'format_bold' } },
  italic: { label: 'Italic', accessibilityLabel: 'Italic', symbol: { ios: 'italic', android: 'format_italic' } },
  list: { label: 'List', accessibilityLabel: 'Bulleted list', symbol: { ios: 'list.bullet', android: 'format_list_bulleted' } },
  checklist: { label: 'Checklist', accessibilityLabel: 'Checklist', symbol: { ios: 'checklist', android: 'checklist' } },
  quote: { label: 'Quote', accessibilityLabel: 'Quote', symbol: { ios: 'text.quote', android: 'format_quote' } },
  link: { label: 'Link', accessibilityLabel: 'Link', symbol: { ios: 'link', android: 'link' } },
  tag: { label: 'Tag', accessibilityLabel: 'Tag', symbol: { ios: 'number', android: 'tag' } },
};

/**
 * With no Write field focused and no keyboard: hide the bar (Lumen), or
 * keep it docked at the bottom. Fed to formatBarPlacement.
 */
export const FORMAT_BAR_WHEN_KEYBOARD_CLOSED: 'hide' | 'show' = 'hide';

/**
 * How long a field keeps focus with no soft keyboard before the bar docks:
 * the soft keyboard opens a moment after the focus, and the bar shouldn't
 * flash at the bottom on its way above it.
 */
export const FORMAT_BAR_DOCK_DELAY_MS = 500;

/** The most words before the cursor offered to the core as a reference. */
export const REFERENCE_SUGGESTION_MAX_WORDS = 4;
