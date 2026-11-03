// The Appearance choice on this device (themes spec §12.3): one small file
// in the app's document directory holding the `berean.appearance` value.
// Nothing goes in the core or sync. The file is read synchronously at
// startup, so the first frame is already in the stored theme; nothing is
// written until the user changes something. The logic is in appearance.ts.

import { File, Paths } from 'expo-file-system';

import { APPEARANCE_KEY, type AppearanceChoice, parseChoice, serializeChoice } from '@/design/appearance';

// The value as last read or written, so a stored "system" accent survives
// where System colors isn't offered (serializeChoice).
let stored: unknown;
// Whether System colors is offered, as loadChoice was told.
let systemColors = false;

function file(): File {
  return new File(Paths.document, `${APPEARANCE_KEY}.json`);
}

/**
 * The stored choice; the defaults when there is none or it can't be read.
 * A stored System colors accent is the choice only where it is offered
 * (parseChoice).
 */
export function loadChoice(systemColorsOffered: boolean): AppearanceChoice {
  systemColors = systemColorsOffered;
  try {
    const f = file();
    stored = f.exists ? JSON.parse(f.textSync()) : undefined;
  } catch {
    stored = undefined;
  }
  return parseChoice(stored, systemColorsOffered);
}

/** Stores the choice. If that fails the app carries on with it in memory. */
export function saveChoice(choice: AppearanceChoice): void {
  const json = serializeChoice(choice, stored, systemColors);
  try {
    const f = file();
    if (!f.exists) f.create();
    f.writeSync(json);
    stored = JSON.parse(json);
  } catch {
    // Kept in memory only; the next change tries again.
  }
}
