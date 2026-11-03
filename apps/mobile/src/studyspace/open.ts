// What a tap on a card does, by device (findings §6.1, §8), and the
// full-screen reader's route params. Kept free of React Native for the tests.

import type { DeviceClass } from '@/studyspace/camera';
import type { CardKind } from '@/studyspace/cards';

/**
 * openReader: the full-screen reader (phone). openNote: the note editor
 * (phone). focus: the reader card takes focus (tablet). front: brought to
 * the front only.
 */
export type TapAction = 'openReader' | 'openNote' | 'focus' | 'front';

/**
 * A tap on a card (§8): on a phone a reader card opens the full-screen
 * reader and a note the note editor; on a tablet a reader card is focused
 * (touch and pointer alike) and a note comes to the front. A missing card
 * has nothing to open or read, so it only comes to the front.
 */
export function tapAction(kind: CardKind, device: DeviceClass, missing: boolean): TapAction {
  if (missing) return 'front';
  if (device === 'phone') return kind === 'note' ? 'openNote' : 'openReader';
  return kind === 'note' ? 'front' : 'focus';
}

/** The full-screen reader's route params: the workspace and its canvas item, as strings. */
export type ReaderParams = { workspace: string; item: string };

export function readerParams(workspace: bigint, item: bigint): ReaderParams {
  return { workspace: String(workspace), item: String(item) };
}

function bigintOf(value: string | string[] | undefined): bigint | undefined {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return undefined;
  return BigInt(value);
}

/** The reader's route params back as ids; none if either is missing or not a number. */
export function parseReaderParams(params: {
  workspace?: string | string[];
  item?: string | string[];
}): { workspace: bigint; item: bigint } | undefined {
  const workspace = bigintOf(params.workspace);
  const item = bigintOf(params.item);
  return workspace === undefined || item === undefined ? undefined : { workspace, item };
}
