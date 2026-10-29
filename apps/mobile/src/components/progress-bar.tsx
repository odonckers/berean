import { useTheme } from 'expo-router';
import { StyleSheet, View } from 'react-native';

type ProgressBarProps = {
  /** 0 to 100. */
  percent: number;
  label: string;
};

export function ProgressBar({ percent, label }: ProgressBarProps) {
  const { colors } = useTheme();
  const now = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now }}
      style={[styles.track, { backgroundColor: colors.border }]}
    >
      <View style={[styles.fill, { width: `${now}%`, backgroundColor: colors.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4 },
});
