import { useWindowDimensions } from 'react-native';

import { breakpoints } from '@/design/tokens';

export type WindowClass = 'compact' | 'medium' | 'expanded';

export function useWindowClass(): WindowClass {
  const { width } = useWindowDimensions();
  if (width >= breakpoints.expanded) return 'expanded';
  if (width >= breakpoints.medium) return 'medium';
  return 'compact';
}
