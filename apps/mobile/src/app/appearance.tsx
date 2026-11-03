import type { ReactNode } from 'react';
import { Pressable, ScrollView, type StyleProp, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { ScriptureText, UIText } from '@/components/text';
import {
  accentOptions,
  APPEARANCES,
  type AppearanceChoice,
  themeName,
} from '@/design/appearance';
import {
  accentOptionLabel,
  APPEARANCE_NAMES,
  appearanceOptionHint,
  appearanceOptionLabel,
  pickerLayout,
  type SwatchHalf,
  THEME_HINT,
  themeOptionLabel,
  themeSwatch,
} from '@/design/appearance-picker';
import { useAppearance, useBerean } from '@/design/theme';
import { THEME_IDS } from '@/design/theme-tokens.generated';
import { HIGHLIGHT_ORDER } from '@/reader/highlights';
import { radii, spacing } from '@/design/tokens';

// Settings › Appearance (themes spec §3 rule 12, §5): Theme, Accent and
// Appearance as radio groups. Every tap applies at once; the preview at the
// top shows the page, the six highlights and a link in the result.

const SWATCH = 56;
const DOT = 32;
const RING = 3;
const MAX_WIDTH = 640;

// John 1:1 (ASV), one phrase per highlight in the display order.
const PREVIEW_PHRASES = ['In the beginning', 'was the Word,', 'and the Word', 'was with God,', 'and the Word', 'was God.'];

export default function AppearanceScreen() {
  const { look, colors, m3, mode } = useBerean();
  const { choice, setChoice } = useAppearance();
  const { width, fontScale } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const material = look === 'material';
  const target = material ? 48 : 44;
  const increaseContrast = mode === 'lightIC' || mode === 'darkIC';

  // The iOS look's options sit in an inset grouped card, padded inside.
  const content = Math.min(width - 2 * spacing.lg, MAX_WIDTH) - (material ? 0 : 2 * spacing.md);
  const layout = pickerLayout(content, fontScale);
  const choose = (change: Partial<AppearanceChoice>) => setChoice({ ...choice, ...change });

  return (
    <ScrollView
      style={{ backgroundColor: material ? m3.surface : colors.surface }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: safe.bottom + spacing.xl }]}
    >
      <View style={styles.column}>
        <Preview />

        <Group title="Theme">
          <View style={layout === 'row' ? styles.tileRow : styles.list}>
            {THEME_IDS.map((theme) => {
              const selected = theme === choice.theme;
              const swatch = (
                // In a list the row carries the ring and a trailing checkmark.
                <Swatch {...themeSwatch(theme, choice.appearance, increaseContrast)} selected={selected && layout === 'row'} />
              );
              return (
                <Option
                  key={theme}
                  label={themeOptionLabel(theme)}
                  hint={THEME_HINT}
                  selected={selected}
                  onPress={() => choose({ theme })}
                  style={layout === 'row' ? styles.tile : [styles.listRow, { minHeight: target }]}
                  ring={layout === 'list'}
                >
                  {swatch}
                  <Name selected={selected} list={layout === 'list'}>
                    {themeName(theme)}
                  </Name>
                  {layout === 'list' && selected && <Check />}
                </Option>
              );
            })}
          </View>
        </Group>

        <Group title="Accent">
          <View style={layout === 'row' ? styles.dotRow : styles.list}>
            {accentOptions(choice.theme, mode).map((accent) => {
              const selected = accent.slot === choice.accent;
              return (
                <Option
                  key={accent.slot}
                  label={accentOptionLabel(accent.name)}
                  selected={selected}
                  onPress={() => choose({ accent: accent.slot })}
                  style={layout === 'row' ? [styles.dotItem, { minHeight: target }] : [styles.listRow, { minHeight: target }]}
                  ring={layout === 'list'}
                >
                  <View style={[styles.dotRing, { borderColor: selected && layout === 'row' ? colors.accent : 'transparent' }]}>
                    <View style={[styles.dot, { backgroundColor: accent.hex, borderColor: colors.outline }]}>
                      {selected && (
                        <ScaledSymbol
                          name={{ ios: 'checkmark', android: 'check' }}
                          size={18}
                          tintColor={accent.onAccent}
                          accessible={false}
                        />
                      )}
                    </View>
                  </View>
                  <Name selected={selected} list={layout === 'list'}>
                    {accent.name}
                  </Name>
                </Option>
              );
            })}
          </View>
        </Group>

        <Group title="Appearance">
          <View style={layout === 'row' ? styles.tileRow : styles.list}>
            {APPEARANCES.map((appearance) => {
              const selected = appearance === choice.appearance;
              return (
                <Option
                  key={appearance}
                  label={appearanceOptionLabel(appearance)}
                  hint={appearanceOptionHint(appearance)}
                  selected={selected}
                  onPress={() => choose({ appearance })}
                  ring
                  bordered
                  style={[layout === 'row' ? styles.appearanceTile : styles.listRow, { minHeight: target }]}
                >
                  <Name selected={selected} list={layout === 'list'} oneLine={layout === 'row'}>
                    {APPEARANCE_NAMES[appearance]}
                  </Name>
                  {selected &&
                    (layout === 'list' ? (
                      <Check />
                    ) : (
                      // In a row the check is the theme tiles' corner badge, so the label keeps the tile's width.
                      <View style={[styles.badge, styles.appearanceBadge, { backgroundColor: colors.accent }]}>
                        <ScaledSymbol
                          name={{ ios: 'checkmark', android: 'check' }}
                          size={14}
                          tintColor={colors.onAccent}
                          accessible={false}
                        />
                      </View>
                    ))}
                </Option>
              );
            })}
          </View>
        </Group>
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

/** A radio group with its visible heading: an inset grouped section in the iOS look, an M3 section otherwise. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  return (
    <View style={styles.group}>
      <UIText
        accessibilityRole="header"
        variant={material ? 'body' : 'caption'}
        style={[
          material ? styles.materialHeading : styles.iosHeading,
          { color: material ? m3.onSurfaceVariant : colors.textSecondary },
        ]}
      >
        {title}
      </UIText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={title}
        style={material ? undefined : [styles.iosSection, { backgroundColor: colors.surfaceRaised }]}
      >
        {children}
      </View>
    </View>
  );
}

type OptionProps = {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  /** Draw the selection ring around the whole option (lists and Appearance tiles). */
  ring?: boolean;
  /** An outline border when unselected (Appearance tiles). */
  bordered?: boolean;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
};

function Option({ label, hint, selected, onPress, ring = false, bordered = false, style, children }: OptionProps) {
  const { colors } = useBerean();
  // The selected ring is RING wide; unselected options keep the same box
  // with a 1-wide outline (or none) inside it, so nothing shifts.
  const borderColor = ring && selected ? colors.accent : 'transparent';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderColor, opacity: pressed ? 0.6 : 1 },
        bordered && !selected && { borderWidth: 1, margin: RING - 1, borderColor: colors.outline },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

function Name({
  selected,
  list,
  oneLine = false,
  children,
}: {
  selected: boolean;
  list: boolean;
  /** Truncate rather than wrap (the Appearance row); lists always wrap. */
  oneLine?: boolean;
  children: string;
}) {
  return (
    <UIText
      numberOfLines={oneLine ? 1 : undefined}
      style={[list ? styles.listName : styles.tileName, oneLine && styles.oneLine, selected && styles.bold]}
    >
      {children}
    </UIText>
  );
}

function Check() {
  const { colors } = useBerean();
  return (
    <ScaledSymbol
      name={{ ios: 'checkmark', android: 'check' }}
      size={20}
      tintColor={colors.accent}
      accessible={false}
    />
  );
}

/**
 * A theme's page with a line of ink. Split diagonally when it has two
 * halves: the first top-left, the second bottom-right. Selected, it takes
 * the accent ring and a checkmark badge.
 */
function Swatch({ first, second, selected }: { first: SwatchHalf; second?: SwatchHalf; selected: boolean }) {
  const { colors } = useBerean();
  // A square √2 times the swatch's inner side, centered on its bottom-right
  // corner and turned 45°, covers exactly the half below the diagonal.
  const inner = SWATCH - 2;
  const side = inner * Math.SQRT2;
  const offset = inner - side / 2;
  return (
    <View style={[styles.swatchRing, { borderColor: selected ? colors.accent : 'transparent' }]}>
      <View style={[styles.swatch, { backgroundColor: first.page, borderColor: colors.outline }]}>
        {second && (
          <View
            style={[
              styles.swatchHalf,
              { width: side, height: side, left: offset, top: offset, backgroundColor: second.page },
            ]}
          />
        )}
        <View
          style={[
            styles.ink,
            { backgroundColor: first.ink },
            second ? styles.inkTopLeft : styles.inkWhole,
          ]}
        />
        {second && <View style={[styles.ink, styles.inkBottomRight, { backgroundColor: second.ink }]} />}
      </View>
      {selected && (
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <ScaledSymbol
            name={{ ios: 'checkmark', android: 'check' }}
            size={14}
            tintColor={colors.onAccent}
            accessible={false}
          />
        </View>
      )}
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
  group: { gap: spacing.sm },
  iosHeading: { paddingHorizontal: spacing.lg },
  materialHeading: { fontWeight: '500' },
  iosSection: { borderRadius: radii.card, padding: spacing.md },
  option: { borderWidth: RING, borderRadius: radii.card },
  tileRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  tile: { flex: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  // Padding sits inside the border, and Option keeps the border box RING
  // wide selected or not, so the label stays spacing.sm clear of the ring's
  // inner edge in every state.
  appearanceTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  // The badge is placed from the padding box: pushed out by the ring and
  // spacing.sm, it perches on the tile's corner instead of over the label.
  appearanceBadge: { top: -(RING + spacing.sm), right: -(RING + spacing.sm) },
  list: { gap: spacing.xs },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dotRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm },
  // Three to a row on a phone, six on wider windows; names wrap.
  dotItem: { width: 96, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  dotRing: { borderWidth: RING, borderRadius: radii.capsule, padding: 2 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radii.capsule,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { textAlign: 'center' },
  oneLine: { flexShrink: 1 },
  listName: { flex: 1 },
  bold: { fontWeight: '700' },
  swatchRing: { borderWidth: RING, borderRadius: radii.card + RING, padding: 2 },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: radii.card, borderWidth: 1, overflow: 'hidden' },
  swatchHalf: { position: 'absolute', transform: [{ rotate: '45deg' }] },
  ink: { position: 'absolute', height: 3, borderRadius: 1.5 },
  inkWhole: { left: 10, right: 10, top: SWATCH / 2 - 2 },
  inkTopLeft: { left: 8, width: 18, top: 14 },
  inkBottomRight: { right: 8, width: 18, bottom: 14 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
