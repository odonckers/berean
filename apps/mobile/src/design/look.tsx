import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

export type Look = 'ios' | 'material';

const platformLook: Look = Platform.OS === 'ios' ? 'ios' : 'material';

const LookContext = createContext<Look>(platformLook);

// In release the look is always the platform default. In development the dev
// menu can switch it to preview the other platform's design.
export function LookProvider({ children }: { children: ReactNode }) {
  const [look, setLook] = useState<Look>(platformLook);

  useEffect(() => {
    // The import stays inside `if (__DEV__)` so Metro's constant folding
    // drops it, and expo-dev-menu with it, from release bundles.
    if (__DEV__) {
      import('./dev-look-menu').then(({ registerLookMenu }) => registerLookMenu(look, setLook));
    }
  }, [look]);

  return <LookContext.Provider value={look}>{children}</LookContext.Provider>;
}

export function useLook(): Look {
  return useContext(LookContext);
}
