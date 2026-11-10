// The article's Languages list (JW Library's "Languages" for the page being
// read). No React Native imports, so node --test can run it.

/** The shapes of the core's DocumentLanguage this module needs. */
export type LanguageLike = { mepsId: number; code: string; name: string; vernacular: string };
export type DocumentLanguageLike<P extends { pubKey: string }> = {
  language: LanguageLike;
  publication: P;
  installed: boolean;
};

export type LanguageSection<D> = { key: 'device' | 'download'; title: string; data: D[] };

/** Above this many languages the list offers a search field. */
export const SEARCH_THRESHOLD = 8;

/**
 * Whether `language` matches the search `query`: its English name, its own
 * name or its code, ignoring case and Latin diacritics. An empty query
 * matches every language.
 */
export function languageMatches(language: LanguageLike, query: string): boolean {
  const needle = fold(query.trim());
  if (needle === '') return true;
  return (
    fold(language.name).includes(needle) ||
    fold(language.vernacular).includes(needle) ||
    language.code.toLowerCase() === needle
  );
}

/**
 * The list's sections: the article on this device (the language being
 * read first, then the others in the core's order, by English name), then
 * the languages to download. A section with nothing in it is left out.
 */
export function languageSections<P extends { pubKey: string }, D extends DocumentLanguageLike<P>>(
  languages: readonly D[],
  reading: string,
  query: string,
): LanguageSection<D>[] {
  const shown = languages.filter((l) => languageMatches(l.language, query));
  const current = shown.filter((l) => l.publication.pubKey === reading);
  const device = shown.filter((l) => l.installed && l.publication.pubKey !== reading);
  const download = shown.filter((l) => !l.installed);
  const sections: LanguageSection<D>[] = [];
  if (current.length + device.length > 0) {
    sections.push({ key: 'device', title: 'On This Device', data: [...current, ...device] });
  }
  if (download.length > 0) {
    sections.push({ key: 'download', title: 'Download', data: download });
  }
  return sections;
}

/**
 * The second line under a language's English name: its own name when that
 * differs ("español"), else nothing.
 */
export function vernacularLine(language: LanguageLike): string | undefined {
  return fold(language.vernacular) === fold(language.name) ? undefined : language.vernacular;
}

/** What a screen reader hears for a row. */
export function languageRowLabel(
  language: LanguageLike,
  state: 'reading' | 'installed' | 'download' | 'downloading',
): string {
  const vernacular = vernacularLine(language);
  const name = vernacular === undefined ? language.name : `${language.name}, ${vernacular}`;
  switch (state) {
    case 'reading':
      return `${name}, reading now`;
    case 'installed':
      return name;
    case 'download':
      return `${name}, not downloaded`;
    case 'downloading':
      return `${name}, downloading`;
  }
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
