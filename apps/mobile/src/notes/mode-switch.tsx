import { Pressable, StyleSheet, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';

export type NoteMode = 'write' | 'read';

const MODES: { mode: NoteMode; label: string }[] = [
  { mode: 'write', label: 'Write' },
  { mode: 'read', label: 'Read' },
];

type ModeSwitchProps = {
  mode: NoteMode;
  onChange: (mode: NoteMode) => void;
};

/**
 * The note editor's Write | Read switch (guide §7.1), a pair of tabs. iOS
 * look: a segmented control, the selected segment raised from a capsule
 * track, 44pt tall to touch. Material look: M3 segmented buttons, 40dp
 * outlined segments in a 48dp touch target, the selected one filled with
 * a leading check.
 */
export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  const { look, scheme, m3, studyPane } = useBerean();
  const material = look === 'material';

  return (
    <View accessibilityRole="tablist" style={styles.row}>
      {!material && <View style={[styles.track, { backgroundColor: studyPane.segmentTrack }]} />}
      {MODES.map(({ mode: option, label }, i) => {
        const selected = option === mode;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              material ? styles.materialTarget : styles.iosTarget,
              { opacity: pressed && !selected ? 0.6 : 1 },
            ]}
          >
            {material ? (
              <View
                style={[
                  styles.materialSegment,
                  i === 0 ? styles.materialFirst : styles.materialLast,
                  { borderColor: m3.outline },
                  selected && { backgroundColor: m3.secondaryContainer },
                ]}
              >
                {selected && (
                  <ScaledSymbol
                    name={{ ios: 'checkmark', android: 'check' }}
                    size={18}
                    tintColor={m3.onSecondaryContainer}
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    accessibilityElementsHidden
                  />
                )}
                <UIText
                  numberOfLines={1}
                  style={[styles.materialLabel, { color: selected ? m3.onSecondaryContainer : m3.onSurface }]}
                >
                  {label}
                </UIText>
              </View>
            ) : (
              <View
                // Unselected it has no background, so Fabric would flatten it and the thumb it becomes later loses its radius.
                collapsable={false}
                style={[
                  styles.iosSegment,
                  selected && { backgroundColor: studyPane.segmentThumb },
                  // Only the light thumb lifts off the track.
                  selected && scheme === 'light' && styles.iosThumbShadow,
                ]}
              >
                <UIText
                  variant="caption"
                  numberOfLines={1}
                  style={[styles.iosLabel, { color: studyPane.segmentText }, selected && styles.iosSelectedLabel]}
                >
                  {label}
                </UIText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  // The track sits behind the segments, inside their 44pt touch height.
  track: { position: 'absolute', top: 4, bottom: 4, left: 0, right: 0, borderRadius: radii.capsule },
  iosTarget: { minHeight: 44, justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 2 },
  iosSegment: {
    minHeight: 32,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.capsule,
  },
  iosThumbShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  iosLabel: { fontSize: 13, fontWeight: '500' },
  iosSelectedLabel: { fontWeight: '600' },
  materialTarget: { minHeight: 48, justifyContent: 'center' },
  materialSegment: {
    minHeight: 40,
    minWidth: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  // The two segments share the line between them.
  materialFirst: { borderTopLeftRadius: radii.capsule, borderBottomLeftRadius: radii.capsule },
  materialLast: { borderTopRightRadius: radii.capsule, borderBottomRightRadius: radii.capsule, borderLeftWidth: 0 },
  // M3 label large.
  materialLabel: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
});
