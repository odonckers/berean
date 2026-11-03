// Turns docs/design/themes/tokens.json into src/design/theme-tokens.generated.ts
// (themes spec §12.1), so the app parses no JSON and hand-copies no hex.
// Run it with plain node after any change to tokens.json:
//
//   npm run gen:theme-tokens
//
// src/design/theme-tokens.test.ts regenerates in memory and fails when the
// checked-in file has drifted from tokens.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const TOKENS_PATH = join(here, '../../../docs/design/themes/tokens.json');
export const GENERATED_PATH = join(here, '../src/design/theme-tokens.generated.ts');

type Json = Record<string, unknown>;

function object(value: unknown, at: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${at}: not an object`);
  return value as Json;
}

function array(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at}: not an array`);
  return value;
}

function string(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`${at}: not a string`);
  return value;
}

function strings(value: unknown, at: string): string[] {
  return array(value, at).map((v, i) => string(v, `${at}[${i}]`));
}

/** Picks `keys` from `source` in that order, each a string. */
function pick(source: unknown, keys: readonly string[], at: string): Record<string, string> {
  const o = object(source, at);
  return Object.fromEntries(keys.map((key) => [key, string(o[key], `${at}.${key}`)]));
}

// The Material 3 roles, in tokens.json's order.
const M3_ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondaryContainer',
  'onSecondaryContainer',
  'surface',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'onSurface',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'error',
  'onError',
  'scrim',
  'scrimWarm',
] as const;

const literal = (value: unknown) => JSON.stringify(value, null, 2);

/** The generated module's source for a parsed tokens.json. */
export function generateThemeTokens(tokens: unknown): string {
  const root = object(tokens, 'tokens');
  const modes = strings(root.modes, 'modes');
  const roles = strings(root.roles, 'roles');
  const families = array(root.highlightFamilies, 'highlightFamilies').map((f, i) =>
    object(f, `highlightFamilies[${i}]`),
  );
  const highlightKeys = [...families]
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((f, i) => string(f.key, `highlightFamilies[${i}].key`));
  const themesJson = object(root.themes, 'themes');
  const themeIds = Object.keys(themesJson);

  const themes = Object.fromEntries(
    themeIds.map((id) => {
      const at = `themes.${id}`;
      const theme = object(themesJson[id], at);
      const themeModes = object(theme.modes, `${at}.modes`);
      const accents = object(theme.accents, `${at}.accents`);
      const material3 = object(theme.material3, `${at}.material3`);
      return [
        id,
        {
          name: string(theme.name, `${at}.name`),
          modes: Object.fromEntries(
            modes.map((mode) => {
              const set = object(themeModes[mode], `${at}.modes.${mode}`);
              const byKey = new Map(
                array(set.highlights, `${at}.modes.${mode}.highlights`).map((h, i) => {
                  const hl = object(h, `${at}.modes.${mode}.highlights[${i}]`);
                  return [hl.key, hl];
                }),
              );
              return [
                mode,
                {
                  roles: pick(set, roles, `${at}.modes.${mode}`),
                  highlights: Object.fromEntries(
                    highlightKeys.map((key) => [
                      key,
                      pick(byKey.get(key), ['name', 'spokenName', 'hex'], `${at}.modes.${mode}.highlights.${key}`),
                    ]),
                  ),
                },
              ];
            }),
          ),
          accents: array(accents.slots, `${at}.accents.slots`).map((s, i) => {
            const slot = object(s, `${at}.accents.slots[${i}]`);
            const slotModes = object(slot.modes, `${at}.accents.slots[${i}].modes`);
            return {
              name: string(slot.name, `${at}.accents.slots[${i}].name`),
              modes: Object.fromEntries(
                modes.map((mode) => [
                  mode,
                  pick(slotModes[mode], ['hex', 'onAccent'], `${at}.accents.slots[${i}].modes.${mode}`),
                ]),
              ),
            };
          }),
          material3: Object.fromEntries(
            modes.map((mode) => [mode, pick(material3[mode], M3_ROLES, `${at}.material3.${mode}`)]),
          ),
        },
      ];
    }),
  );

  return `// Generated by scripts/gen-theme-tokens.ts from docs/design/themes/tokens.json
// (version ${string(root.version, 'version')}). Do not edit: change tokens.json and run
// \`npm run gen:theme-tokens\`.

export const THEME_IDS = ${literal(themeIds)} as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_MODES = ${literal(modes)} as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_ROLES = ${literal(roles)} as const;
export type ThemeRole = (typeof THEME_ROLES)[number];

/** The highlights' display order (themes spec rule 8). */
export const HIGHLIGHT_KEYS = ${literal(highlightKeys)} as const;
export type HighlightKey = (typeof HIGHLIGHT_KEYS)[number];

export const MATERIAL3_ROLES = ${literal(M3_ROLES)} as const;
export type Material3Role = (typeof MATERIAL3_ROLES)[number];

export const themeTokens = ${literal(themes)} as const;
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  writeFileSync(GENERATED_PATH, generateThemeTokens(JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))));
  console.log(`Wrote ${GENERATED_PATH}`);
}
