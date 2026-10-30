import { registerDevMenuItems } from 'expo-dev-menu';
import { Alert } from 'react-native';

import type { Look } from '@/design/look';
import { coreErrorMessage } from '@/ffi/errors';
import { seedSampleNotes } from '@/notes/dev-seed';
import { setSimulatingCoreFailure, simulatingCoreFailure } from '@/search/dev-fault';

// Dev-only. Imported solely from inside `if (__DEV__)` in look.tsx, so it and
// expo-dev-menu's JS never reach a release bundle.
export function registerLookMenu(current: Look, setLook: (look: Look) => void) {
  const mark = (on: boolean) => (on ? '✓ ' : '');
  // registerDevMenuItems replaces the whole list, so the toggle re-registers
  // every item to move its mark.
  void registerDevMenuItems([
    {
      name: `${mark(current === 'ios')}Look: iOS design preview`,
      callback: () => setLook('ios'),
      shouldCollapse: true,
    },
    {
      name: `${mark(current === 'material')}Look: Material`,
      callback: () => setLook('material'),
      shouldCollapse: true,
    },
    {
      name: `${mark(simulatingCoreFailure())}Search: simulate core failure`,
      callback: () => {
        setSimulatingCoreFailure(!simulatingCoreFailure());
        registerLookMenu(current, setLook);
      },
      shouldCollapse: true,
    },
    {
      name: 'Notes: seed sample notes',
      callback: () => {
        let message: string;
        try {
          message = seedSampleNotes();
        } catch (e) {
          message = coreErrorMessage(e);
        }
        Alert.alert('Sample notes', message);
      },
      shouldCollapse: true,
    },
  ]);
}
