// Where a dragged sheet settles, kept free of React Native so the drag runs
// it on the UI thread and Node can test it. A sheet with one height closes
// or springs back; one that opens at a lower detent (the iOS medium) also
// drags up to its full height and back down to the detent.

import { DISMISS_VELOCITY, dragCloses } from './quick-picker.ts';

/** A drag up further than this, or a flick up faster than DISMISS_VELOCITY, expands the sheet. */
export const EXPAND_DISTANCE = 48;

export type SheetDragEnd = 'close' | 'expand' | 'collapse' | 'stay';

export function sheetDragEnd(
  { expandable, expanded }: { expandable: boolean; expanded: boolean },
  translationY: number,
  velocityY: number,
): SheetDragEnd {
  'worklet';
  if (!expandable) return dragCloses(translationY, velocityY) ? 'close' : 'stay';
  if (expanded) return dragCloses(translationY, velocityY) ? 'collapse' : 'stay';
  if (translationY < -EXPAND_DISTANCE || velocityY < -DISMISS_VELOCITY) return 'expand';
  return dragCloses(translationY, velocityY) ? 'close' : 'stay';
}
