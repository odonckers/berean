// Berean's TypeScript data module. On iOS, macOS and Linux every source is
// answered by the Rust data crate (data/src/lib.rs), over the core. The web
// build has no core yet (core/ isn't built for Wasm), so this module answers
// there, saying so.
import type { Answer, Sources } from './app.contract.d.ts';

export const grants = '';

const notYet = 'Berean on the web needs the core built for WebAssembly, which comes later.';

const sources: Sources = {
  library: () => ({ message: notYet, pubs: [] }),
  bibleChapter: ([, book, chapter]) => ({ title: '', message: notYet, book, chapter, last: 0, paras: [] }),
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
