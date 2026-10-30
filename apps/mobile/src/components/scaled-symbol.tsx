import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useWindowDimensions } from 'react-native';

import { iconBox } from '@/components/icon-box';

// A SymbolView whose box grows with the font scale. A workaround for
// expo-symbols' non-iOS path: it draws the glyph as Text at `size` (scaled by
// the font scale) inside a fixed size x size View, so at large text the glyph
// is clipped. Here the box scales too, so box and glyph agree. On iOS the
// native view fits the symbol to its frame, so the icon scales with text
// there as well, like an SF Symbol with Dynamic Type.
export function ScaledSymbol({ size = 24, style, ...props }: SymbolViewProps) {
  const { fontScale } = useWindowDimensions();
  return <SymbolView {...props} size={size} style={[iconBox(size, fontScale), style]} />;
}
