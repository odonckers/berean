import { Pressable, StyleSheet, View } from 'react-native';

import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';

import { type PeriodLike, axisTicks, spokenDate, timelineBars, yearLabel } from './model';

// The periods on a year axis, to scale: each a bar from its first year to
// its last, in lanes where they share a year. Tapping one shows it on the
// map. Each bar is a button that says its name, years and passage.

const BAR = 24;
const LANE_GAP = 8;

type Props = {
  periods: readonly (PeriodLike & { passage: { reference: string } })[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function Timeline({ periods, selectedId, onSelect }: Props) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const { bars, first, last, lanes } = timelineBars(periods);
  const span = Math.max(last - first, 1);
  const ticks = axisTicks(first, last, span > 30 ? 10 : 5);
  const byId = new Map(periods.map((p) => [p.id, p]));
  const accent = material ? m3.primary : colors.accent;
  const idle = material ? m3.secondaryContainer : colors.surfaceRaised;
  const idleEdge = material ? m3.outline : colors.outline;
  const height = lanes * BAR + (lanes - 1) * LANE_GAP;

  return (
    <View style={styles.block}>
      <View style={[styles.track, { height }]}>
        {bars.map((bar) => {
          const period = byId.get(bar.id)!;
          const selected = bar.id === selectedId;
          return (
            <Pressable
              key={bar.id}
              accessibilityRole="button"
              accessibilityLabel={`${period.name}, ${spokenDate(period.date)}`}
              accessibilityHint={`Shows it on the map, ${period.passage.reference.replace(/[–-]/g, ' to ')}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(bar.id)}
              // The bars are short; the touch target reaches past them.
              hitSlop={{ top: LANE_GAP, bottom: LANE_GAP, left: 2, right: 2 }}
              style={({ pressed }) => [
                styles.bar,
                {
                  left: `${((bar.start - first) / span) * 100}%`,
                  width: `${((bar.end - bar.start) / span) * 100}%`,
                  top: bar.lane * (BAR + LANE_GAP),
                  backgroundColor: selected ? accent : idle,
                  borderColor: selected ? accent : idleEdge,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.axis} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ticks.map((year) => (
          <View key={year} style={[styles.tick, { left: `${((year - first) / span) * 100}%` }]}>
            <View style={[styles.tickMark, { backgroundColor: idleEdge }]} />
            <UIText variant="caption" secondary numberOfLines={1} style={styles.tickLabel}>
              {yearLabel(year)}
            </UIText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs, paddingHorizontal: spacing.xs },
  track: { position: 'relative' },
  bar: {
    position: 'absolute',
    height: BAR,
    borderRadius: radii.chip,
    borderWidth: StyleSheet.hairlineWidth * 2,
    // A bar a year wide stays visible.
    minWidth: 12,
  },
  axis: { height: 30, position: 'relative' },
  tick: { position: 'absolute', top: 0, alignItems: 'center', width: 80, marginLeft: -40 },
  tickMark: { width: 1, height: 6 },
  tickLabel: { textAlign: 'center' },
});
