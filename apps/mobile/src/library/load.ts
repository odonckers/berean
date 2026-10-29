import type { Language, PublicationSummary } from 'berean-ffi-rn';

import { catalog } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { KIND_LABELS } from '@/library/labels';

/** A core read's value, or the message to show in its place. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };

export function load<T>(read: () => T): Loaded<T> {
  try {
    return { ok: true, value: read() };
  } catch (e) {
    return { ok: false, message: coreErrorMessage(e) };
  }
}

/** Language names by MEPS id; empty if the catalog can't be read. */
export function languageNames(): ReadonlyMap<number, string> {
  const languages = load<Language[]>(() => catalog().languages());
  return new Map(languages.ok ? languages.value.map((l) => [l.mepsId, l.name]) : []);
}

/** "Book · English · 2024": kind, language, and the year if there is one. */
export function publicationDetail(
  pub: PublicationSummary,
  names: ReadonlyMap<number, string>,
): string {
  const parts = [KIND_LABELS[pub.kind], names.get(pub.mepsLanguage) ?? `MEPS ${pub.mepsLanguage}`];
  if (pub.year > 0) {
    parts.push(String(pub.year));
  }
  return parts.join(' · ');
}
