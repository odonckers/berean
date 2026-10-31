// The Write view's formatting bar as text edits: Markdown marker characters
// put in at the selection, as typing them would. Nothing here reads the
// Markdown; an action only inserts, never removes syntax already there
// (toggling off would need the core's markdown_spans to see it). Kept free
// of React Native so Node can test it.

/** A selection in UTF-16 offsets, end exclusive; start === end is a cursor. */
export type Selection = { start: number; end: number };

/** A field's text and its selection. */
export type EditState = { text: string; selection: Selection };

export type FormatAction = 'heading' | 'bold' | 'italic' | 'list' | 'checklist' | 'quote' | 'link' | 'tag';

const WRAPS = { bold: '**', italic: '*' } as const;
const PREFIXES = { heading: '# ', list: '- ', checklist: '- [ ] ', quote: '> ' } as const;

function ordered(state: EditState): Selection {
  const clamp = (n: number) => Math.min(Math.max(n, 0), state.text.length);
  const a = clamp(state.selection.start);
  const b = clamp(state.selection.end);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** The selection wrapped in `marker` on both sides, still selected; a cursor lands between them. */
function wrap(state: EditState, marker: string): EditState {
  const { start, end } = ordered(state);
  const { text } = state;
  return {
    text: text.slice(0, start) + marker + text.slice(start, end) + marker + text.slice(end),
    selection: { start: start + marker.length, end: end + marker.length },
  };
}

/**
 * `prefix` at the start of each line the selection touches. Blank lines
 * inside a selection of several lines are left alone; the cursor's own line
 * gets it even when blank.
 */
function prefixLines(state: EditState, prefix: string): EditState {
  const { start, end } = ordered(state);
  const { text } = state;
  const lineStarts = [text.lastIndexOf('\n', start - 1) + 1];
  for (let i = text.indexOf('\n', start); i !== -1 && i + 1 < end; i = text.indexOf('\n', i + 1)) {
    lineStarts.push(i + 1);
  }
  const lineEnd = (at: number) => {
    const i = text.indexOf('\n', at);
    return i === -1 ? text.length : i;
  };
  const prefixed =
    lineStarts.length === 1 ? lineStarts : lineStarts.filter((at) => text.slice(at, lineEnd(at)).trim() !== '');
  let out = '';
  let from = 0;
  for (const at of prefixed) {
    out += text.slice(from, at) + prefix;
    from = at;
  }
  out += text.slice(from);
  const before = (offset: number) => prefixed.filter((at) => at <= offset).length * prefix.length;
  // A selection starting at a line's start moves past its new prefix too.
  return { text: out, selection: { start: start + before(start), end: end + before(end) } };
}

/** A '#' at the selection's start, after a space unless whitespace or the start is there already. */
function insertTag(state: EditState): EditState {
  const { start, end } = ordered(state);
  const { text } = state;
  const inserted = start === 0 || /\s/.test(text[start - 1]) ? '#' : ' #';
  return {
    text: text.slice(0, start) + inserted + text.slice(start),
    selection: { start: start + inserted.length, end: end + inserted.length },
  };
}

/** A formatting bar button's edit; link has its own, insertLink. */
export function applyFormat(state: EditState, action: Exclude<FormatAction, 'link'>): EditState {
  switch (action) {
    case 'bold':
    case 'italic':
      return wrap(state, WRAPS[action]);
    case 'heading':
    case 'list':
    case 'checklist':
    case 'quote':
      return prefixLines(state, PREFIXES[action]);
    case 'tag':
      return insertTag(state);
  }
}

/** `range` replaced by `inserted`, the cursor after it. */
export function replaceRange(state: EditState, range: Selection, inserted: string): EditState {
  const { start, end } = ordered({ text: state.text, selection: range });
  const at = start + inserted.length;
  return { text: state.text.slice(0, start) + inserted + state.text.slice(end), selection: { start: at, end: at } };
}

/**
 * The selection as a link: `[text](url)` with the cursor after it, or with
 * no target known, `[selection]()` with the cursor between the parentheses.
 * The url comes from the core (passageUrl); none is made here.
 */
export function insertLink(state: EditState, link?: { text: string; url: string }): EditState {
  const selection = ordered(state);
  if (link !== undefined) return replaceRange(state, selection, `[${link.text}](${link.url})`);
  const label = state.text.slice(selection.start, selection.end);
  const edited = replaceRange(state, selection, `[${label}]()`);
  const inside = edited.selection.start - 1;
  return { text: edited.text, selection: { start: inside, end: inside } };
}

/**
 * What may be a reference just before the cursor: the runs of up to
 * `maxWords` whitespace-separated words ending at the cursor on its line,
 * longest first ("see 1 John 1:14" gives "see 1 John 1:14", "1 John 1:14",
 * "John 1:14", "1:14"). Only substrings to hand the core's resolve; nothing
 * here knows what a reference looks like. None when the cursor follows
 * whitespace or starts the line.
 */
export function referenceCandidates(text: string, cursor: number, maxWords: number): string[] {
  if (maxWords <= 0 || cursor <= 0 || cursor > text.length || /\s/.test(text[cursor - 1])) return [];
  const line = text.slice(text.lastIndexOf('\n', cursor - 1) + 1, cursor);
  const starts: number[] = [];
  for (const match of line.matchAll(/\S+/g)) starts.push(match.index);
  return starts.slice(-maxWords).map((at) => line.slice(at));
}
