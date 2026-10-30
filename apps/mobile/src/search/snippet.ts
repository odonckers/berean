// The core's snippet format, read into runs. A hit's snippet is HTML:
// escaped plain text with each matched word in <mark>…</mark> and no other
// tags (snippet_html in core/berean-core/src/search.rs). This only undoes
// that encoding; it never looks for matches itself.
// TODO(core): a candidate to move into the core as structured runs, so no
// client parses HTML at all.

export type SnippetRun = { text: string; marked: boolean };

// The entities snippet_html emits, plus the hex form of the apostrophe.
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

function unescape(html: string): string {
  return html.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** The snippet's text in order, matched words marked; no empty runs. */
export function snippetRuns(html: string): SnippetRun[] {
  const runs: SnippetRun[] = [];
  let marked = false;
  for (const part of html.split(/(<mark>|<\/mark>)/)) {
    if (part === '<mark>') {
      marked = true;
    } else if (part === '</mark>') {
      marked = false;
    } else if (part !== '') {
      const text = unescape(part);
      const last = runs.at(-1);
      if (last !== undefined && last.marked === marked) last.text += text;
      else runs.push({ text, marked });
    }
  }
  return runs;
}

/** The snippet as plain text, for accessibility labels. */
export function snippetText(html: string): string {
  return snippetRuns(html)
    .map((run) => run.text)
    .join('');
}
