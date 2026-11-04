import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScriptureText } from '@/components/text';
import { AppearanceGroups } from '@/design/appearance-groups';
import { pickerLayout } from '@/design/appearance-picker';
import { useBerean } from '@/design/theme';
import { HIGHLIGHT_ORDER } from '@/reader/highlights';
import { radii, spacing } from '@/design/tokens';

// Settings › Appearance (themes spec §3 rule 12, §5): Theme, Accent and
// Appearance as radio groups. Every tap applies at once; the preview at the
// top shows the page, the six highlights and a link in the result.

const MAX_WIDTH = 640;

// John 1:1 (ASV), one phrase per highlight in the display order.
const PREVIEW_PHRASES = ['In the beginning', 'was the Word,', 'and the Word', 'was with God,', 'and the Word', 'was God.'];

export default function AppearanceScreen() {
  const { look, colors, m3 } = useBerean();
  const { width, fontScale } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const material = look === 'material';

  // The iOS look's options sit in an inset grouped card, padded inside.
  const content = Math.min(width - 2 * spacing.lg, MAX_WIDTH) - (material ? 0 : 2 * spacing.md);
  const layout = pickerLayout(content, fontScale, look);

  return (
    <ScrollView
      style={{ backgroundColor: material ? m3.surface : colors.surface }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: safe.bottom + spacing.xl }]}
    >
      <View style={styles.column}>
        <Preview />
        <AppearanceGroups layout={layout} />
      </View>
    </ScrollView>
  );
}

/** The page in the result: scripture with the six highlights in order, and a link. */
function Preview() {
  const { colors, highlights } = useBerean();
  return (
    <View style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
      <ScriptureText>
        {HIGHLIGHT_ORDER.map((name, i) => (
          <Text key={name}>
            <Text style={{ backgroundColor: highlights[name], color: colors.text }}>{PREVIEW_PHRASES[i]}</Text>
            {i < HIGHLIGHT_ORDER.length - 1 ? ' ' : ''}
          </Text>
        ))}
      </ScriptureText>
      <ScriptureText variant="noteBody">
        See{' '}
        <Text
          style={{
            color: colors.text,
            textDecorationLine: 'underline',
            textDecorationColor: colors.linkUnderline,
            textDecorationStyle: 'solid',
          }}
        >
          Genesis 1:1
        </Text>
        .
      </ScriptureText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: 'center' },
  column: { width: '100%', maxWidth: MAX_WIDTH, gap: spacing.xl },
  preview: {
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
