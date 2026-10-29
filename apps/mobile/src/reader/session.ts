import type { PaneTab } from '@/reader/study-pane';

// Session memory for the reader: plain module state, gone when the app
// restarts. Nothing here is persisted.

// The Bible and chapter last open in the Read tab, shown when Read opens
// without params.
export type BibleLocation = { pubKey: string; title: string; book: number; chapter: number };

let lastBible: BibleLocation | undefined;

export function rememberedBible(): BibleLocation | undefined {
  return lastBible;
}

export function rememberBible(location: BibleLocation) {
  lastBible = location;
}

// The last study pane tab used, per publication (spec §2).
const lastTab = new Map<string, PaneTab>();

export function rememberedTab(pubKey: string): PaneTab | undefined {
  return lastTab.get(pubKey);
}

export function rememberTab(pubKey: string, tab: PaneTab) {
  lastTab.set(pubKey, tab);
}

// The open verse per `${pubKey}/${book}/${chapter}`, so an open pane
// survives the reader remounting (switching the dev Look).
const openVerse = new Map<string, number>();

export function restoredVerse(chapterKey: string): number | undefined {
  return openVerse.get(chapterKey);
}

export function rememberVerse(chapterKey: string, verse: number) {
  openVerse.set(chapterKey, verse);
}

export function forgetVerse(chapterKey: string) {
  openVerse.delete(chapterKey);
}
