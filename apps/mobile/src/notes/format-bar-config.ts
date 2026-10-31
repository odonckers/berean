// The Write view's formatting bar and reference suggestion, as settings
// easy to change: the button order and whether the bar stays with the
// keyboard closed wait on Lumen's answer (expo6c spec question 6).
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

/** With the keyboard closed: hide the bar, or keep it at the bottom. */
export const FORMAT_BAR_WHEN_KEYBOARD_CLOSED: 'hide' | 'show' = 'hide';

/** The most words before the cursor offered to the core as a reference. */
export const REFERENCE_SUGGESTION_MAX_WORDS = 4;
