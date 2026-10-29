import { useCallback, useState } from 'react';

import { SearchPalette } from '@/components/search-palette';
import { useSearchShortcut } from '../../modules/berean-shortcuts';

// Mounted once at the root: Ctrl+K (Android) opens the search palette.
export function SearchShortcut() {
  const [open, setOpen] = useState(false);
  useSearchShortcut(useCallback(() => setOpen(true), []));
  return <SearchPalette visible={open} onClose={() => setOpen(false)} />;
}
