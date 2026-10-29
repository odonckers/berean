import { StyleSheet, View } from 'react-native';

import { useBerean } from '@/design/theme';

type ProgressBarProps = {
  /** 0 to 100. */
  percent: number;
  label: string;
};

export function ProgressBar({ percent, label }: ProgressBarProps) {
  const { colors } = useBerean();
  const now = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now }}
      style={[styles.track, { backgroundColor: colors.separator }]}
    >
      <View style={[styles.fill, { width: `${now}%`, backgroundColor: colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4 },
});
