import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

/** MEPS language id 0 is English. */
const DEFAULT_MEPS_LANGUAGE = 0;

type SelectedLanguage = {
  mepsLanguage: number;
  setMepsLanguage: (mepsId: number) => void;
};

const SelectedLanguageContext = createContext<SelectedLanguage>({
  mepsLanguage: DEFAULT_MEPS_LANGUAGE,
  setMepsLanguage: () => {},
});

/** The browsed language: Library's catalog and Read's Today. Not persisted. */
export function SelectedLanguageProvider({ children }: { children: ReactNode }) {
  const [mepsLanguage, setMepsLanguage] = useState(DEFAULT_MEPS_LANGUAGE);
  const value = useMemo(() => ({ mepsLanguage, setMepsLanguage }), [mepsLanguage]);
  return <SelectedLanguageContext value={value}>{children}</SelectedLanguageContext>;
}

export function useSelectedLanguage(): SelectedLanguage {
  return useContext(SelectedLanguageContext);
}
