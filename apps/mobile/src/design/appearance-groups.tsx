import type { ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { accentOptions, APPEARANCES, type AppearanceChoice, themeName } from '@/design/appearance';
import {
  accentOptionLabel,
  APPEARANCE_NAMES,
  appearanceOptionHint,
  appearanceOptionLabel,
  LOW_CONTRAST_NOTE,
  SYSTEM_COLORS_NAME,
  systemColorsHint,
  type SwatchHalf,
  THEME_HINT,
  themeOptionLabel,
  themeSwatch,
} from '@/design/appearance-picker';
import { useAppearance, useBerean } from '@/design/theme';
import { THEME_IDS } from '@/design/theme-tokens.generated';
import { radii, spacing } from '@/design/tokens';

// The three radio groups of the Appearance picker (themes spec §3 rule 12,
// §5): Theme, Accent (System colors first on Android 12+, §11) and
// Appearance. Every tap applies at once. Settings ›
// Appearance and the reader's Aa picker both draw them.

const SWATCH = 56;
const DOT = 32;
const RING = 3;
// Accent names in the grid of three stop growing here (F01: 18pt), so a
// row of three fits a phone; they wrap rather than truncate.
const GRID_NAME_SIZE = 18;

type AppearanceGroupsProps = {
  /** Theme tiles and Appearance in a row, or as lists (pickerLayout). */
  layout: 'row' | 'list';
  /** Accents as a grid of three with names (the Aa sheet at large text) rather than a list. */
  accentGrid?: boolean;
  /**
   * 'inset': the iOS look's inset grouped cards (Settings). 'plain': the
   * groups sit straight on a sheet that is already surfaceRaised.
   */
  sections?: 'inset' | 'plain';
};

export function AppearanceGroups({ layout, accentGrid = false, sections = 'inset' }: AppearanceGroupsProps) {
  const { look, colors, mode, type, systemAccent } = useBerean();
  const { choice, setChoice } = useAppearance();
  const material = look === 'material';
  const target = material ? 48 : 44;
  const increaseContrast = mode === 'lightIC' || mode === 'darkIC';
  const accentList = layout === 'list' && !accentGrid;
  const choose = (change: Partial<AppearanceChoice>) => setChoice({ ...choice, ...change });

  return (
    <>
      <Group title="Theme" sections={sections}>
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

      <Group title="Accent" sections={sections}>
        {/* System colors, where offered, comes first as a full-width row in
            every layout, so the six slots keep their rows of three or six
            (and the grid its two rows of three). */}
        {systemAccent && (
          <Option
            label={accentOptionLabel(SYSTEM_COLORS_NAME)}
            hint={systemColorsHint(systemAccent.contrastOk)}
            selected={choice.accent === 'system'}
            onPress={() => choose({ accent: 'system' })}
            style={[styles.listRow, styles.systemRow, { minHeight: target }]}
            ring
          >
            <AccentDot
              hex={systemAccent.swatch}
              checkColor={systemAccent.onSwatch}
              selected={choice.accent === 'system'}
              ringed={false}
            />
            <View style={styles.systemText}>
              <UIText style={choice.accent === 'system' && styles.bold}>{SYSTEM_COLORS_NAME}</UIText>
              {!systemAccent.contrastOk && (
                <UIText variant="caption" secondary>
                  {LOW_CONTRAST_NOTE}
                </UIText>
              )}
            </View>
          </Option>
        )}
        <View style={accentList ? styles.list : styles.dotRow}>
          {accentOptions(choice.theme, mode).map((accent) => {
            const selected = accent.slot === choice.accent;
            return (
              <Option
                key={accent.slot}
                label={accentOptionLabel(accent.name)}
                selected={selected}
                onPress={() => choose({ accent: accent.slot })}
                style={
                  accentList
                    ? [styles.listRow, { minHeight: target }]
                    : [accentGrid ? styles.gridItem : styles.dotItem, { minHeight: target }]
                }
                ring={accentList}
              >
                <AccentDot hex={accent.hex} checkColor={accent.onAccent} selected={selected} ringed={!accentList} />
                <Name
                  selected={selected}
                  list={accentList}
                  maxFontSizeMultiplier={
                    accentGrid ? GRID_NAME_SIZE / (type.ui.body.fontSize ?? GRID_NAME_SIZE) : undefined
                  }
                >
                  {accent.name}
                </Name>
              </Option>
            );
          })}
        </View>
      </Group>

      <Group title="Appearance" sections={sections}>
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
    </>
  );
}

/** A radio group with its visible heading: an inset grouped section in the iOS look, an M3 section otherwise. */
function Group({ title, sections, children }: { title: string; sections: 'inset' | 'plain'; children: ReactNode }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const inset = !material && sections === 'inset';
  return (
    <View style={styles.group}>
      <UIText
        accessibilityRole="header"
        variant={material ? 'body' : 'caption'}
        style={[
          material ? styles.materialHeading : inset ? styles.iosHeading : undefined,
          { color: material ? m3.onSurfaceVariant : colors.textSecondary },
        ]}
      >
        {title}
      </UIText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={title}
        style={inset ? [styles.iosSection, { backgroundColor: colors.surfaceRaised }] : undefined}
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
  maxFontSizeMultiplier,
  children,
}: {
  selected: boolean;
  list: boolean;
  /** Truncate rather than wrap (the Appearance row); lists always wrap. */
  oneLine?: boolean;
  maxFontSizeMultiplier?: number;
  children: string;
}) {
  return (
    <UIText
      numberOfLines={oneLine ? 1 : undefined}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[list ? styles.listName : styles.tileName, oneLine && styles.oneLine, selected && styles.bold]}
    >
      {children}
    </UIText>
  );
}

/** An accent's dot, checked when selected; `ringed`, the selected dot carries the accent ring itself. */
function AccentDot({
  hex,
  checkColor,
  selected,
  ringed,
}: {
  hex: string;
  checkColor: string;
  selected: boolean;
  ringed: boolean;
}) {
  const { colors } = useBerean();
  return (
    <View style={[styles.dotRing, { borderColor: selected && ringed ? colors.accent : 'transparent' }]}>
      <View style={[styles.dot, { backgroundColor: hex, borderColor: colors.outline }]}>
        {selected && (
          <ScaledSymbol
            name={{ ios: 'checkmark', android: 'check' }}
            size={18}
            tintColor={checkColor}
            accessible={false}
          />
        )}
      </View>
    </View>
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
  systemRow: { marginBottom: spacing.xs },
  systemText: { flex: 1, gap: 2 },
  // Three to a row on a phone, six on wider windows; names wrap.
  dotItem: { width: 96, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  // Always three to a row: two rows of three.
  gridItem: { width: '32%', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
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
