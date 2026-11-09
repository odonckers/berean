// Library title search results. No React Native imports, so node --test can
// run it.

/** The shape of the core's TitleMatch this module needs. */
export type TitleMatchLike<P> = { publication: P; installed: boolean };

export type TitleSection<P> = { key: 'installed' | 'catalog'; title: string; data: P[] };

/**
 * The core's matches as list sections: the installed ones under "On This
 * Device", then the catalog's under "Catalog · <language>". The core's order
 * is kept, and a section with no matches is left out.
 */
export function titleSections<P>(
  matches: readonly TitleMatchLike<P>[],
  languageName: string | undefined,
): TitleSection<P>[] {
  const installed = matches.filter((m) => m.installed).map((m) => m.publication);
  const catalog = matches.filter((m) => !m.installed).map((m) => m.publication);
  const sections: TitleSection<P>[] = [];
  if (installed.length > 0) {
    sections.push({ key: 'installed', title: 'On This Device', data: installed });
  }
  if (catalog.length > 0) {
    const title = languageName === undefined ? 'Catalog' : `Catalog · ${languageName}`;
    sections.push({ key: 'catalog', title, data: catalog });
  }
  return sections;
}
