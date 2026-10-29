import { SymbolView } from 'expo-symbols';
import type { ColorValue } from 'react-native';

// Decorative: the control around it carries the accessible label.
export function SearchIcon({ color, size = 24 }: { color: ColorValue; size?: number }) {
  return (
    <SymbolView
      name={{ ios: 'magnifyingglass', android: 'search' }}
      tintColor={color}
      size={size}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
