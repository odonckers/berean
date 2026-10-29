import { registerDevMenuItems } from 'expo-dev-menu';

import type { Look } from '@/design/look';

// Dev-only. Imported solely from inside `if (__DEV__)` in look.tsx, so it and
// expo-dev-menu's JS never reach a release bundle.
export function registerLookMenu(current: Look, setLook: (look: Look) => void) {
  const mark = (look: Look) => (look === current ? '✓ ' : '');
  void registerDevMenuItems([
    {
      name: `${mark('ios')}Look: iOS design preview`,
      callback: () => setLook('ios'),
      shouldCollapse: true,
    },
    {
      name: `${mark('material')}Look: Material`,
      callback: () => setLook('material'),
      shouldCollapse: true,
    },
  ]);
}
