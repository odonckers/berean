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

// The open verse per `${pubKey}/${book}/${chapter}`, with the height the
// pane last settled at (a window fraction; none until it is resized), so an
// open pane survives the reader remounting (switching the dev Look) at the
// height it had.
export type OpenPane = { verse: number; fraction?: number };

const openPanes = new Map<string, OpenPane>();

export function restoredPane(chapterKey: string): OpenPane | undefined {
  return openPanes.get(chapterKey);
}

export function rememberVerse(chapterKey: string, verse: number) {
  openPanes.set(chapterKey, { verse });
}

export function rememberPaneFraction(chapterKey: string, fraction: number) {
  const pane = openPanes.get(chapterKey);
  if (pane !== undefined) openPanes.set(chapterKey, { ...pane, fraction });
}

export function forgetVerse(chapterKey: string) {
  openPanes.delete(chapterKey);
}
