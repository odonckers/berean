import { type CoreDocBlock, docText } from '../studyspace/reader-state.ts';

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/**
 * The blocks without the document's own title, which the reader already
 * shows as its heading: the first heading or paragraph whose text is the
 * title, ignoring case and spacing. Every other block stays, and a document
 * whose blocks never repeat the title comes back unchanged.
 */
export function withoutTitle<B extends CoreDocBlock>(blocks: readonly B[], title: string): readonly B[] {
  const want = normalized(title);
  if (want === '') return blocks;
  const at = blocks.findIndex(
    (block) => (block.tag === 'Heading' || block.tag === 'Paragraph') && normalized(docText(block.inner.inlines)) === want,
  );
  return at === -1 ? blocks : [...blocks.slice(0, at), ...blocks.slice(at + 1)];
}
