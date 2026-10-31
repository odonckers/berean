# Color themes

**Status:** **Decided Oct 31, 2026.** Owen ruled the theme count and the accents through Wren, and every other call is final (§14). Kerning & Co. made the recommendation (Iris, with Nova, Hinge and Pebble), and Lumen wrote it up.
**Platforms:** SwiftUI on iOS, iPadOS and macOS. Expo (`apps/mobile`) on iOS and Android, in both looks: Material 3 and the iOS look.
**Owner:** Design (Lumen). **Core:** none. Themes are design tokens only, and nothing goes in the Rust core or in sync. **Build:** Kiwi and Moss (SwiftUI), Otter (Expo).
**Data:** [tokens.json](tokens.json) is the source of truth. [contrast.py](contrast.py) checks it, and the result is **2,448 checks, 0 FAIL**. See [README.md](README.md) for the schema and how to re-check.

This spec supersedes the guide's single palette, which had light, dark, sepia and Increase Contrast sets ([berean-design-guide.md](../berean-design-guide.md) §1, Color). The old separate sepia reading surface is now the Sepia theme.

## 1. Purpose

Readers choose how the page looks. There are four themes, each with six preset accents, and each works in light, dark and Increase Contrast. Every combination meets the contrast floors in §15, and a script checks this rather than anyone judging by eye. The reader itself is the preview, so a choice applies at once, with no Apply step.

## 2. Structure

- **Themes:** **Paper** (the default; today's shipped Berean look), **Sepia** (deeper parchment with softer ink, for long reading), **Stone** (a cool limestone gray with graphite ink) and **Sage** (a muted green-gray with the lowest chroma, for low stimulation).
- **Sets per theme:** `light`, `dark`, `lightIC` and `darkIC`, where IC is Increase Contrast. That makes 16 sets.
- **Roles per set (16, plus highlights):**
  - Surfaces: `background`, `surface`, `surfaceRaised`, `surfaceSunken`.
  - Text: `textPrimary`, `textSecondary`, and `textTertiary` (placeholders only).
  - Lines: `outline`, `separator` (decorative only) and `linkUnderline` (decorative only).
  - Accent: `accent`, `onAccent`.
  - Other: `destructive`, `noteMarker`, `selection`, `focusRing`.
  - `highlights`: six, keyed by color name (§7).
- **Links:** the link text is `textPrimary`, and the **underline is the non-color cue** (WCAG 1.4.1). `linkUnderline` colors only that underline (1 px, 3 px offset). It is decorative and has no contrast floor; `contrast.py` reports it as INFO in group `separator`. Paper uses the shipped value. The other themes and all IC sets derive it as the midpoint of the accent and page lightness, at 0.45 × the accent's chroma.
- **All colors are opaque sRGB hex**, with one exception. Highlights and selection are solid, pre-blended fills, never alpha, so iOS, macOS, Android and the web render them the same on every surface. The exception is the Material 3 scrims (`scrim`, `scrimWarm`), which are `rgba()` because a scrim has to dim whatever is behind it.
- **Paper is today's look** (§2.1). For every Paper role in light and dark, the shipped value in `apps/mobile/src/design/tokens.ts` is used wherever it passes our floors. Where a shipped value fails a floor, the solved value is kept, and the change is an **intended accessibility fix**. Roles that `tokens.ts` doesn't define are solved under the same floors.
- **Paper's surface ladder** runs the same way as the shipped M3 container ladder:
  - Light: surfaceRaised `#FFFCF5` > surface `#FDF9F0` > page `#FBF7EC` > surfaceSunken `#EEE5D3` (the shipped `surfaceContainerHigh`).
  - Dark: surfaceSunken `#0F0D0A` < page `#15120E` < surface `#1C1814` (the shipped `surfaceContainer`) < surfaceRaised `#211D18`.
- **The other themes** keep their solved values. Sepia's light outline is `#7E7466` (the old sepia surface's outline) and its light ink is `#312718`. Paper's IC outline is `#5C544A`.

### 2.1 Paper: shipped vs solved

"Shipped" means the value in `apps/mobile/src/design/tokens.ts` at origin/main.

| role | light | dark | source |
| --- | --- | --- | --- |
| background (page) | `#FBF7EC` | `#15120E` | shipped (`surface`) |
| surface | `#FDF9F0` | `#1C1814` | light solved (tokens.ts has no step between page and raised); dark shipped (`surfaceContainer`) |
| surfaceRaised | `#FFFCF5` | `#211D18` | shipped |
| surfaceSunken | `#EEE5D3` | `#0F0D0A` | light shipped (`surfaceContainerHigh`); dark solved (tokens.ts has nothing below the page) |
| textPrimary | `#1F1A14` | `#EDE6D8` | shipped |
| textSecondary | `#5C544A` | `#A39A8B` | shipped |
| textTertiary | `#807B73` | `#928B83` | solved (not in tokens.ts), ≥3:1 on all four surfaces |
| outline | `#8B8275` | `#7A7165` | solved. **Accessibility fix:** shipped `outline` is the separator at 1.28:1, and control borders need 3:1 (WCAG 1.4.11). |
| separator | `#E6DCC2` | `#38312A` | shipped |
| linkUnderline | `#C9A493` | `#734F40` | shipped |
| accent / focusRing | `#9B3F2A` | `#E59A7C` | shipped |
| onAccent | `#FFFCF5` | `#211D18` | shipped |
| destructive | `#D70015` | `#FF453A` | shipped |
| noteMarker | `#986C16` | `#A77E39` | solved (not in tokens.ts), ≥3:1 on all four surfaces |
| selection | `#FAD4CB` | `#4C382F` | solved (not in tokens.ts) |
| highlights | see §7.1 | see §7.1 | solved. **Accessibility fix:** the shipped set fails neighbor ΔE, the CVD ΔL floor and the lightness tiers (§7.2). |
| M3 primary, onPrimary | `#9B3F2A`, `#FFFFFF` | `#E59A7C`, `#3A140A` | shipped |
| M3 primaryContainer, onPrimaryContainer | `#FFD7CD`, `#542115` | `#512919`, `#F5CEBE` | solved (not in tokens.ts); kept for the M3 FAB and navigation indicator (see §9) |
| M3 secondaryContainer, onSecondaryContainer | `#F1DCD1`, `#3A1A10` | `#4A2C22`, `#F6DDD2` | shipped |
| M3 surface, Low, Container, High, Highest | `#FBF7EC` `#F7F1E4` `#F3ECDD` `#EEE5D3` `#E9E0CC` | `#15120E` `#1A1612` `#1C1814` `#26211C` `#312B25` | shipped |
| M3 surfaceContainerLowest | `#FFFCF5` | `#0F0D0A` | solved (= surfaceRaised / surfaceSunken; not in tokens.ts) |
| M3 onSurface, onSurfaceVariant | `#1F1A14`, `#5C544A` | `#EDE6D8`, `#A39A8B` | shipped (text roles) |
| M3 outline | `#867D70` | `#7E7468` | solved. **Accessibility fix:** shipped M3 outline is the separator, below 3:1 on every container (WCAG 1.4.11). It is a touch darker than the role outline so it also clears 3:1 on the shipped Highest. |
| M3 outlineVariant | `#D2C5AA` | `#4E443B` | shipped (decorative) |
| M3 error, onError | `#D70015`, `#FFFFFF` | `#FF453A`, `#0C0905` | solved pair (not in tokens.ts); error = destructive |
| M3 scrim, scrimWarm | `rgba(0,0,0,0.32)`, `rgba(31,26,20,0.45)` | `rgba(0,0,0,0.32)` (both) | shipped |

## 3. Rules

1. **Four themes, three appearances.** The themes are Paper (default), Sepia, Stone and Sage. The appearances are Automatic (the default; it follows the system), Light and Dark. Theme and appearance are separate choices, so Sepia under Automatic switches between Sepia light and Sepia dark. Increase Contrast selects the IC set of the current mode.
2. **Six preset accents per theme. There is no free color picker.** Slot 1 is the default. Switching theme keeps the slot number, so slot 3 is Fern in Paper and Lake in Sage.
3. **Choices are stored per device** (§12.3). Nothing goes in core or sync, so a phone and a Mac can differ. Every device starts on Paper, slot 1, Automatic.
4. **Increase Contrast and Reduce Transparency follow the system settings.** There is no in-app toggle. Our tokens switch when the settings are on.
5. **Glass stays clear, with no accent tint.** Toolbars, the tab bar and the picker sheet or popover use the system material. Under Reduce Transparency or Increase Contrast they become solid `surfaceRaised` with a 1 px `outline`.
6. **The accent appears only on the one primary action per screen and on selected states.** Selected states are the current tab, the selected tile, dot or chip, the selected canvas card and the focus ring. Toolbar and tab icons stay monochrome (`textPrimary` or `textSecondary`), per the HIG [Color](https://developer.apple.com/design/human-interface-guidelines/color) page.
7. **Scripture text, the page and the highlights always come from the theme.** No system palette touches them (§10, §11).
8. **Highlights are colors only, with no category names.** They keep the same six hue families in one fixed order in every theme and on every chip row: **yellow, green, blue, pink, purple, orange**. The visible and spoken name is the plain hue ("Yellow", "Yellow highlight"). Highlights never carry meaning.
9. **The focus ring follows the accent the user picks.** Every slot passes 3:1 as a focus ring in every set. The `focusRing` token is slot 1, the default.
10. **`textTertiary` is for placeholders only.** It is under 4.5:1, so it is never used for content, and every field also has a visible label.
11. **Selection stays clear of every highlight.** The token is at least ΔE2000 10 from each highlight in its set (§8). The apps still draw selection with the system handles.
12. **The picker:**
    - It has three radio groups: Theme (4 tiles), Accent (6 dots, plus System on Mac and System colors on Android 12 and later) and Appearance (3 tiles).
    - Every tap or arrow key applies at once. There is no Done or Apply, and the reader behind is the live preview.
    - The selected option has a ring, a checkmark and a bold label, so selection never relies on color alone.
    - Tile and dot borders are at least 3:1 against the sheet (4.5:1 in IC).
    - Under Automatic, every theme tile is split diagonally: the light page top-left and the dark page bottom-right. Under Light or Dark the tiles show that mode only.
    - Under Reduce Motion the theme swaps instantly. Otherwise it cross-fades over 200 ms with no movement. The 200 ms is a proposal to check on device.
    - At accessibility text sizes (AX1 and up; F01 shows AX3) the iPhone sheet opens at the large detent, with a thin strip of reader text pinned above it. Theme tiles become a vertical list (swatch, name, checkmark), accents wrap to two rows of three with names, and Appearance becomes a list. Every target is at least 44 × 44 pt.

## 4. Where the picker lives

| Platform | Quick access (the reader is the preview) | Full set |
| --- | --- | --- |
| iPhone | **Aa** in the reader toolbar opens a sheet at the medium detent. The large detent shows the same controls. | Settings › Appearance |
| iPad | **Aa** opens a popover anchored to the button, so the reading column stays uncovered. In compact Split View or Slide Over it becomes the iPhone sheet. | Settings › Appearance |
| Mac | **Aa** in the window toolbar opens the same popover. **View › Theme** in the menu bar lists the themes and Automatic, Light and Dark as checkable items, plus *Appearance Settings…* (⌘,). | Settings (⌘,) › Appearance pane |
| Android phone | **Aa** opens a standard (non-modal) M3 bottom sheet with no scrim. Drag down or press Back to close it. | Settings › Appearance |
| Android tablet or unfolded foldable | **Aa** opens a trailing side sheet, and the reading column reflows instead of being covered. | Settings › Appearance |

Frames: F01 (iPhone), F02 (iPad), F03 (Mac), F04 (Android).

## 5. Accessibility: keyboard and spoken labels

Keyboard (F05):

| Key | Action |
| --- | --- |
| Tab / ⇧Tab | Move between groups: Theme → Accent → Appearance → Text size and font. Each group is one tab stop. |
| ← → ↑ ↓ | Move within a group and apply at once (the radio-group pattern). |
| Home / End | Go to the first or last option in the group. |
| Space / Return | Not needed to apply. On a focused option it does nothing extra. |
| Esc | Close the sheet or popover. The choice is kept. |
| ⌘, (Mac) | Settings › Appearance. View › Theme holds the same choices as checkable menu items. |
| Switch Control / Full Keyboard Access | The same order as Tab. Each tile is one item. |

Spoken labels (VoiceOver and TalkBack) give the name, then the role, then "selected" when chosen, and the platform adds the position:

- **Theme tile:** "Paper, theme, selected", with the hint "Changes the reading colors". Unselected tiles drop "selected".
- **Accent:** "Terracotta, accent, selected". Names come from `tokens.json` (`themes.<id>.accents.slots[n].name`).
- **System accent:** on Mac, "System, accent", with the hint "Follows your Mac's accent color". On Android, "System colors, accent", with the hint "From your wallpaper".
- **Appearance:** "Automatic, appearance" (plus "selected" when chosen), with the hint "Follows the system light or dark setting".
- **Highlight in text:** "Yellow highlight" before the highlighted words, read from the highlight's `spokenName`. This replaces the guide's earlier "Highlighted, yellow".
- **Note marker:** "Note" and the first line of the note. It is a button.

**Focus ring:** 3 px in the current accent with a 3 px offset, at least 3:1 against the sheet in every set (§15).

## 6. Accents

- **Six presets per theme.** Slot 1 is the theme default.
- **The OKLCH rule:** every slot in a set shares one OKLCH lightness and target chroma, and only the hue changes, so all six pass the same floors. Chroma is only ever reduced, to fit sRGB, and the chroma actually used is recorded. Twelve slot values across nine slots were gamut-mapped, and each one is listed in that slot's `flags`.
- **Layout:** `themes.<id>.accents.slots[n].modes.<set> = { hex, onAccent, oklch: [L, C, H] }`, and `accents.sharedOklch.<set> = { L, C }`.
- **Names:** each slot has a `name` for screen readers and labels.
- **onAccent** is white or the set's dark ink, whichever contrasts more.
- **Paper slot 1 keeps the baseline exactly.** Its shared L is the baseline's own (0.489 light, 0.754 dark). The baseline's chroma is 0.128 against a shared 0.125, and its hue shifts from 34.3° (light) to 42.6° (dark). That shift comes from the baseline itself, and it is flagged in the tokens.
- Every accent reaches 4.5:1 on the page in every set, so any accent can be used as text. In IC every accent reaches 7:1 or more.

| theme | light L/C | dark L/C | lightIC L/C | darkIC L/C | slots 1–6 |
| --- | --- | --- | --- | --- | --- |
| Paper | 0.489/0.125 | 0.754/0.1 | 0.4/0.119 | 0.82/0.095 | Terracotta, Ink blue, Fern, Plum, Ochre, Lagoon |
| Sepia | 0.5/0.1 | 0.7/0.085 | 0.409/0.095 | 0.8/0.081 | Sienna, Oxblood, Olive, Dusk blue, Mulberry, Juniper |
| Stone | 0.5/0.11 | 0.72/0.095 | 0.41/0.104 | 0.81/0.09 | Slate blue, Brick, Pine, Iris, Amber, Rose |
| Sage | 0.5/0.085 | 0.7/0.075 | 0.41/0.081 | 0.8/0.071 | Moss, Spruce, Lake, Heather, Clay, Wheat |

## 7. Highlights

- **Keys are color names:** `yellow`, `green`, `blue`, `pink`, `purple` and `orange`, the same names as the Rust core's `HighlightColor`.
- **Display order:** yellow, green, blue, pink, purple, orange, in every theme and on every chip row. The order is by name and independent of the core's `ColorIndex`, so storage maps by color name, never by position.
- **Names:** each highlight has a `name`, the hue as a label ("Purple"), and a `spokenName` for screen readers ("Purple highlight").
- **Per theme:** each theme tunes only lightness and chroma, so Sage and Stone get softer, grayer versions of the same hues. The hue is the identity.
- **Hard rules, all checked:**
  - `textPrimary` on each highlight is at least 7:1 in every set. Dark mode sits right at the target, so dark highlights can't get any lighter.
  - Each highlight is at least ΔE2000 12 from `background`, `surface` and `surfaceRaised`, so it never vanishes into the page.
  - Neighboring highlights are at least ΔE2000 15 apart, with orange wrapping round to yellow.
- **Color-vision simulation:** Machado et al. 2009 at severity 1.0 in linear sRGB, for deuteranopia, protanopia and tritanopia. The per-set minimum over all 15 pairs is reported as INFO. Pairs under ΔE 8 are listed in the table's notes.

### 7.1 Lightness tiers for color-blind readers

Under simulation, four pairs collapse when hue is their only difference: **yellow–orange, blue–purple, pink–orange and green–blue.** Green and blue also sit side by side in the chip row, and orange wraps round to yellow. So these pairs are also separated by OKLCH lightness:

- **Tiers:** yellow, green, pink and purple are the **light** tier, and blue and orange are the **deep** tier (`highlightFamilies[n].tier`). Each prone pair crosses tiers, so it differs in lightness as well as hue. The order follows each hue's natural lightness, so no hue goes muddy.
- **Floor:** OKLCH |ΔL| of at least **0.05** for each pair, which FAILs below. The **target is 0.08 or more**, noted on each line.
- **Method:** the solver maximizes the smallest ΔL across the four pairs, capped at 0.14 in light and 0.10 in dark so other qualities aren't traded away. Text at 7:1 or more, neighbor ΔE 15 or more and page ΔE 12 or more are hard constraints.
- **Checks:** in `contrast.py`, group `highlightΔL` has one line per pair per set. Group `highlightCVD` also has one INFO line: the minimum simulated ΔE2000 across the four pairs and three simulations.
- **What it cost:** Sepia light `textPrimary` went from OKLCH L 0.330 to 0.280 (`#312718`). That is 11.7:1 on the page, up from about 9.2:1 and still clearly softer than Paper. The softer ink had capped how deep orange could go while keeping text at 7:1, and that left pink–orange at 0.019.
- **Result:** every set clears the 0.05 floor, and 62 of 64 pairs meet the 0.08 target. The two below it are both in **Sepia light**: pink–orange at **0.071** and green–blue at **0.079**. Sepia's low-contrast parchment leaves the narrowest lightness band. Dark modes reach **0.088 to 0.121**. Across the four pairs, the minimum simulated ΔE2000 rose from about 3.7–5.5 to **8.1–10.3**. So no margin glyph is needed as a fallback for this.

| theme | set | Yellow–Orange | Blue–Purple | Pink–Orange | Green–Blue | min ΔL | min sim. ΔE (4 pairs) | yellow green blue pink purple orange |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| paper | light | 0.200 | 0.119 | 0.119 | 0.139 | **0.119** | 8.41 (protanopia, Blue–Purple) | `#FCEDA0` `#C2F8C8` `#8CC1EE` `#FFBAD4` `#E6DAFF` `#D49E75` |
| paper | dark | 0.101 | 0.121 | 0.111 | 0.102 | **0.101** | 9.44 (tritanopia, Green–Blue) | `#574A00` `#2C5232` `#013050` `#6D3B4F` `#573C80` `#492606` |
| paper | lightIC | 0.210 | 0.119 | 0.119 | 0.140 | **0.119** | 8.41 (protanopia, Blue–Purple) | `#FFF0A6` `#C6F7CC` `#8CC1EE` `#FFBAD4` `#E6DAFF` `#D49E75` |
| paper | darkIC | 0.099 | 0.120 | 0.111 | 0.101 | **0.099** | 9.82 (tritanopia, Green–Blue) | `#5F520A` `#315B38` `#0A3859` `#764357` `#5F448A` `#512E0F` |
| sepia | light | 0.131 | 0.108 | 0.071 | 0.079 | **0.071** | 8.83 (protanopia, Blue–Purple) | `#F3E390` `#B7EABD` `#8EC8F9` `#FFB5D1` `#E9DEFF` `#F1A366` |
| sepia | dark | 0.090 | 0.099 | 0.100 | 0.088 | **0.088** | 8.05 (deuteranopia, Yellow–Orange) | `#473D07` `#2E4331` `#002945` `#563441` `#49306E` `#3D1D01` |
| sepia | lightIC | 0.180 | 0.150 | 0.120 | 0.120 | **0.120** | 9.98 (tritanopia, Pink–Orange) | `#F3E390` `#B7EABD` `#89BAE4` `#FFB5D1` `#E9DEFF` `#CB9D7B` |
| sepia | darkIC | 0.100 | 0.119 | 0.111 | 0.101 | **0.100** | 9.52 (tritanopia, Green–Blue) | `#594D0D` `#2E5534` `#093351` `#723C52` `#594080` `#4A2A0E` |
| stone | light | 0.189 | 0.110 | 0.110 | 0.180 | **0.110** | 8.32 (protanopia, Blue–Purple) | `#FFEC94` `#BFF5C5` `#89B0D1` `#FFBAD4` `#D6C2FE` `#D7A178` |
| stone | dark | 0.110 | 0.118 | 0.120 | 0.118 | **0.110** | 9.42 (protanopia, Blue–Purple) | `#554A16` `#304D34` `#002945` `#743450` `#4D3770` `#42260F` |
| stone | lightIC | 0.198 | 0.128 | 0.128 | 0.139 | **0.128** | 9.08 (protanopia, Blue–Purple) | `#F9E99C` `#BFF5C5` `#89BEEB` `#FFBAD4` `#E6DAFF` `#D19B72` |
| stone | darkIC | 0.099 | 0.120 | 0.111 | 0.101 | **0.099** | 9.82 (tritanopia, Green–Blue) | `#5F520A` `#315B38` `#0A3859` `#764357` `#5F448A` `#512E0F` |
| sage | light | 0.159 | 0.121 | 0.099 | 0.100 | **0.099** | 8.19 (tritanopia, Pink–Orange) | `#F6E9AB` `#C6EDCA` `#9BC6EC` `#FFBFD7` `#EBE3FF` `#D7AA88` |
| sage | dark | 0.100 | 0.121 | 0.109 | 0.112 | **0.100** | 9.7 (tritanopia, Pink–Orange) | `#514500` `#2E4E33` `#052B46` `#67354A` `#52367B` `#432204` |
| sage | lightIC | 0.200 | 0.141 | 0.140 | 0.139 | **0.139** | 10.33 (protanopia, Blue–Purple) | `#F6E9AB` `#CCF4D1` `#95C0E5` `#FFBFD7` `#EBE3FF` `#CA9D7C` |
| sage | darkIC | 0.099 | 0.121 | 0.111 | 0.102 | **0.099** | 9.87 (tritanopia, Green–Blue) | `#5F520E` `#365A3B` `#143854` `#764357` `#60448A` `#512E12` |

- **Paper and Stone share identical highlights in darkIC.** The studio accepted this at that extreme (§14, open item 3).
- **Paper dark and Stone dark no longer match.** Stone dark is re-biased to a quieter chroma (dark C 0.055, was 0.075). All six of its highlights move ΔE2000 2.4–3.4 from Paper dark and read cooler, and every floor still holds: neighbors 16.27 or more, ΔL 0.110 or more, page ΔE 12.10 or more. Stone dark's selection was re-solved to `#343E4A`, 10.32 from blue.
- Paper lightIC shares blue to orange with Paper light, which is fine.

### 7.2 The shipped highlight set, checked

The highlights in `apps/mobile/src/design/tokens.ts` (`highlightFills`) were run through the same checks. They pass the text and page checks but fail neighbor separation, the color-blind ΔL floor and the lightness tiers. So moving Paper to the solved highlights is an **intended accessibility change**, not drift.

| check | floor | shipped light | shipped dark |
| --- | --- | --- | --- |
| textPrimary on highlight | ≥7 | pass, min 12.58 (pink) | pass, min 9.64 |
| ΔE2000 vs page | ≥12 | pass, min 13.41 (yellow) | pass, min 12.52 |
| neighbor ΔE2000 | ≥15 | **fail**: pink–purple 9.75, orange–yellow 12.56 (others 16.88–33.82) | **fail**: pink–purple 9.28, orange–yellow 11.47 |
| OKLCH ΔL, 4 CVD pairs | ≥0.05 | **fail**: yellow–orange .008, blue–purple .002, pink–orange .001, green–blue .005 | **fail**: .001–.002 on all four |
| lightness tiers (blue, orange deep) | required | **fail**: all six at L .902–.911 | **fail**: all six at L .329–.331 |

## 8. Other derived roles

- **`focusRing`:** accent slot 1 for the set. At runtime the ring follows the chosen accent (rule 9), and every slot passes 3:1.
- **`selection`:** a solid, low-chroma tint of slot 1's hue, solved after the highlights. `contrast.py` enforces these rules:
  - `textPrimary` on selection is at least 7:1 in every set, standard and IC.
  - Selection is at least ΔE2000 10 from every highlight in the same set. The lowest per theme are Paper 10.59 (dark, orange), Sepia 10.41 (dark, orange), Stone 10.32 (dark, blue) and Sage 10.42 (dark, green).
  - It is at least ΔE2000 8 from `background`, `surface` and `surfaceRaised`, so it stays visible on the page.

  The solver starts from L 0.90 / C 0.045 (light), L 0.92 (lightIC), L 0.36 / C 0.055 (dark) and L 0.30 (darkIC). It lowers chroma first, then shifts lightness, and picks the smallest change. Sage light ends fully neutral (`#D2D2D2`), and Stone dark and Sage dark and lightIC end near neutral. Selection is temporary and highlights are permanent, so the highlights keep the color.
- **`linkUnderline`:** see §2. It is decorative: the underline's shape, not its color, marks the link.
- **`noteMarker`:** a gilt or ochre hue per theme (Paper H78, Sepia H62, Stone H72, Sage H58). It is at least 3:1 (4.5:1 in IC).
- **`destructive`:** Paper keeps the shipped value, and the other themes are solved in OKLCH. It is at least 4.5:1 on surfaces in IC.

## 9. Material 3 mapping (Expo, Material look)

`themes.<id>.material3.<set>` holds `primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer`, `secondaryContainer`, `onSecondaryContainer`, `surface`, `surfaceContainerLowest` through `surfaceContainerHighest`, `onSurface`, `onSurfaceVariant`, `outline`, `outlineVariant`, `error`, `onError`, `scrim` and `scrimWarm`.

- **Paper uses the shipped M3 roles** wherever they pass (§2.1), including its container ladder. The exception is M3 `outline`, an accessibility fix: the shipped value is the separator, which is under 3:1 on every container.
- **`primaryContainer` and `onPrimaryContainer` are ours.** `tokens.ts` doesn't define them. They're kept because standard M3 components (the FAB and the navigation indicator) read them. Otter to confirm whether the Expo build reads them; if it doesn't, they can be dropped (§14, follow-ups).
- **`outlineVariant`** is decorative. Paper uses the shipped value, and the other themes use their separator.
- **Scrims:** `scrim` is `rgba(0,0,0,0.32)` in every set. `scrimWarm` is `textPrimary` at 0.45 in light sets and equals `scrim` in dark sets, as shipped.
- **Light ladder** (the other themes): Lowest = surfaceRaised, Low = surface, Container = background, High = the midpoint of background and sunken, Highest = surfaceSunken.
- **Dark ladder** (the other themes): Lowest = surfaceSunken, Low = background, Container = surface, High = surfaceRaised, Highest = raised + 0.025 L.
- `primary` is accent slot 1. When the user picks another slot, swap `primary` and `onPrimary` for that slot's `hex` and `onAccent`.
- `contrast.py` checks all of it (group `M3`): onSurface, onSurfaceVariant, outline, primary and error on every container, plus onPrimary, onPrimaryContainer, onSurface on primaryContainer, onSecondaryContainer and onSurface on secondaryContainer (4.5, or 7 in IC), and onError.
- Standard M3 components need no per-theme overrides. F06–F09 show an M3 strip for each set.

## 10. Mac: the System accent

- **The default accent is the theme's slot 1 on every platform, Mac included** (Terracotta in Paper).
- **System is opt-in.** It is listed first in the Mac Accent row. Choosing it makes Berean follow the Mac's accent color (`NSColor.controlAccentColor`).
- **When the Mac accent is Multicolor** (the macOS default), an app's own accent is what shows, so System resolves to the theme's slot 1.
- **When the Mac accent is anything else** (Graphite, Blue and so on), macOS draws system controls in that color and Berean follows it. Settings shows a one-line note: "System follows your Mac's accent color, now Graphite. When the Mac is set to Multicolor, it uses Terracotta, the theme's default. Pick any accent to use it instead." Next to it is an **Open Appearance Settings…** button. The six presets stay available. Picking one turns System off and applies that preset as an explicit tint. The app never shows two accents at once.
- **The System accent covers chrome only:** selected rows, the primary button and the focus ring. Scripture, highlights and the page stay with the theme. In SwiftUI and AppKit, use `controlAccentColor` and the default `.tint` rather than hard-coding a color.

## 11. Android: Material You ("System colors")

- **"System colors" is an opt-in accent on Android 12 (API 31) and later.** It is listed first in the Accent row, off by default, and hidden on Android 11 and earlier.
- **Chrome only.** The wallpaper palette supplies `primary` and `onPrimary`, `primaryContainer` and `onPrimaryContainer`, and `secondaryContainer`. These are used for buttons, the FAB, the navigation indicator, selection rings and the focus ring. Background, surfaces, scripture text, highlights, links and the note marker always come from the theme.
- **Reading the palette needs an Expo native module** (§12.4).
- **Runtime contrast guard.** Before the system palette is applied, it is checked against the current theme set:
  - `primary` is at least 3:1 on background, surface and surfaceRaised (4.5:1 in IC).
  - `onPrimary` on `primary` is at least 4.5:1 (7:1 in IC).
  - `onPrimaryContainer` on `primaryContainer` is at least 4.5:1.

  If any check fails, slot 1 is used and the option shows "Not enough contrast with this theme". The guard runs again when the theme, the mode, IC or the wallpaper changes.
- **The palette in F04 is a made-up example:** primary `#3E6375` on Paper light is 6.0:1 on background and 6.3:1 on surfaceRaised, onPrimary white is 6.5:1, and onPrimaryContainer is 7.2:1. It doesn't come from any real device.
- Every other role maps to Material 3 as in §9.

## 12. Implementation notes (Kiwi, Moss, Otter)

### 12.1 Reading `tokens.json`

`docs/design/themes/tokens.json` is the only place theme colors are defined. Neither app hand-copies hex values. **Generating code from it is suggested, not built.** No generator exists yet, and choosing and writing one is part of the implementation rows.

- **SwiftUI (Kiwi, Moss):** suggested approach: a small script under `apple/scripts/` turns `tokens.json` into a checked-in `ThemeTokens.swift`. It would hold one value per theme × set, with the 16 roles as `Color`, `highlights[6]` (keyed by color name), `accents[6]` (name, hex, onAccent) and the spoken names, so the app parses no JSON at launch. The alternative is to bundle `tokens.json` as a resource and decode it with `Codable` at launch. Either way:
  - Pick the set from `colorScheme` and `colorSchemeContrast == .increased`, or on macOS from `NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast`.
  - Use `accessibilityReduceTransparency` to decide between glass and solid `surfaceRaised` (rule 5).
  - Appearance Light or Dark sets `preferredColorScheme`, and Automatic leaves it `nil`.
- **Expo (Otter):** suggested approach: a Node script turns `tokens.json` into a typed `apps/mobile/src/design/theme-tokens.generated.ts` (a `ThemeId`, `Mode` and `Role` union, and frozen records). That file then replaces the hand-written `colorSets`, `highlightFills` and `m3Roles` in `apps/mobile/src/design/tokens.ts`. Importing the JSON directly also works, since Expo's base tsconfig turns on `resolveJsonModule` (check this in the app), but a generated file gives literal types. To pick the set:
  - `useColorScheme()` for light or dark.
  - For IC on iOS, `AccessibilityInfo.isDarkerSystemColorsEnabled()` and the `darkerSystemColorsChanged` event.
  - For IC on Android there is no exact match. The suggestion is `UiModeManager.getContrast()` on Android 14 and later, through the same native module as §12.4, as an open item (§14, open item 2).
  - On iOS, `AccessibilityInfo.isReduceTransparencyEnabled()` decides glass vs solid.
- **Keeping it honest:** a CI step can run `python3 docs/design/themes/contrast.py --check`. A generator's test should confirm the generated file matches `tokens.json`.

### 12.2 Resolving a choice

```
set     = (appearance == automatic ? systemScheme : appearance) + (systemIncreaseContrast ? "IC" : "")
roles   = themes[theme].modes[set]
accent  = accentChoice == system ? systemAccent(guarded) : themes[theme].accents.slots[accentChoice].modes[set]
focus   = accent.hex            // rule 9: the ring follows the chosen accent
```

Unknown or out-of-range stored values fall back to the defaults: `paper`, slot `1` and `automatic`. `system` on a platform that doesn't offer it (iOS, or Android 11 and earlier) falls back to slot 1, and the stored value is kept.

### 12.3 Per-device storage key

One key, **`berean.appearance`**, holds a small JSON value:

```json
{ "version": 1, "theme": "paper", "accent": 1, "appearance": "automatic" }
```

- `theme` is one of `paper`, `sepia`, `stone` or `sage`.
- `accent` is `1`–`6` or `"system"` (Mac, and Android 12 and later).
- `appearance` is one of `automatic`, `light` or `dark`.

Store the slot number, never a hex value, so token updates take effect without migrating stored choices.

- **Apple:** `UserDefaults.standard`. Never use `NSUbiquitousKeyValueStore`, iCloud or core sync, because the choice is per device.
- **Expo:** a device-local key-value store. `apps/mobile` has no storage dependency today, so choosing one is part of the Expo row. Keep the key name and the value shape the same.
- With no key stored, use the defaults. Nothing is written until the user changes something.
- The key name is a proposal for Kiwi, Moss and Otter to confirm, since the repo has no app-settings key convention yet.

### 12.4 The Expo native module for Material You

Expo has no built-in API for the Android 12 wallpaper palette, so "System colors" needs a small native module. The suggestion is `apps/mobile/modules/berean-system-colors`, built with the Expo Modules API in Kotlin, like `modules/berean-shortcuts`.

- `isAvailable(): boolean`: returns `Build.VERSION.SDK_INT >= 31`.
- `getSystemColors(scheme: 'light' | 'dark')`: returns `{ primary, onPrimary, primaryContainer, onPrimaryContainer, secondaryContainer }` as `#RRGGBB`. Read the system tonal palettes (`android.R.color.system_accent1_*` / `system_accent2_*`) or Material Components' dynamic color, and map tones to roles the way Material 3 does.
- Emit an event when the palette may have changed, such as on configuration change or when the app returns to the foreground, so JS can re-run the contrast guard (§11).
- The same module can expose `getContrast()` (Android 14 and later) for IC detection (§12.1).
- It belongs to the Android app shell only. It isn't part of core and has no iOS implementation.

### 12.5 Other notes

- **The focus ring follows the accent** (rule 9). In Expo, `focusRing(colors.accent)` in `apps/mobile/src/design/focus-ring.ts` already takes the accent, so pass the resolved accent, not slot 1. In SwiftUI, the system focus ring follows `.tint`.
- **`textTertiary` is for placeholders only** (rule 10). Never use it for labels, captions or metadata; use `textSecondary`.
- **Highlight keys are the core's color names, and the array order is the display order, not JW Library's `ColorIndex`.** The core's `HighlightColor` uses the `ColorIndex` order Yellow 1, Green 2, Blue 3, Pink 4, Orange 5, Purple 6 (`core/berean-core/src/userdata.rs`). Map by name (`yellow` = Yellow, `purple` = Purple, and so on), never by position. Nothing changes in core.
- **The chip order is yellow, green, blue, pink, purple, orange.** Expo has purple before pink today, and that is drift for Otter to fix: `HIGHLIGHT_ORDER` in `apps/mobile/src/reader/highlights.ts` and its test in `highlights.test.ts` (which asserts the old order), plus the `HighlightName` order in `apps/mobile/src/design/tokens.ts`.
- **Moving Expo's Paper to these tokens changes a few shipped values on purpose.** These are the §2.1 accessibility fixes: the role outline, the M3 outline and the six highlights. Every other Paper light and dark value is the shipped one.
- **The iOS 120 Hz Info.plist key (`CADisableMinimumFrameDuration`) is unrelated to themes.** Don't add it as part of this work.
- **`separator` is decorative only.** Anything that has to be seen as a boundary, such as control borders, tiles or fields, uses `outline`.

## 13. Frames

The frames are in [frames/](frames/) as 2× PNGs. Every number printed on a frame is computed from `tokens.json`. Reading text is Literata, standing in for New York, which wasn't installed on the render machine. UI text is Inter, standing in for SF Pro, with Roboto on Android.

The sample scripture in every frame is Psalm 23 from the American Standard Version (1901, public domain), which uses the name Jehovah. The header reads "PSALMS · AMERICAN STANDARD VERSION", shortened to "ASV" where space is tight. The highlights sit on "Jehovah is my shepherd" (yellow), "green pastures" (green), "He restoreth my soul" (blue), "I will fear no evil" (pink), "Thou hast anointed my head with oil" (purple) and "goodness and lovingkindness" (orange). The selection is on "Thy rod and thy staff".

| Frame | Content |
| --- | --- |
| [F01](frames/F01-picker-iphone.png) | iPhone in four states: the reader with the sheet closed; the Aa sheet at the medium detent (Paper, Automatic, so the tiles are split); a live change to Sage dark with Moss; and the AX3 layout (large detent, pinned reader strip, theme list, 2 × 3 named accents, targets of 44 pt or more). It also shows VoiceOver labels: "Yellow highlight", "Paper, theme, selected", "Terracotta, accent, selected" and "Automatic, appearance". |
| [F02](frames/F02-picker-ipad.png) | iPad in landscape: the Aa popover over the uncovered reading column (Stone, Automatic with split tiles, Slate blue). |
| [F03](frames/F03-picker-mac.png) | Mac: the Aa popover at the default (Terracotta, slot 1; Automatic with split tiles), the Settings › Appearance pane with System opted in and the Mac on Graphite, and the View › Theme menu. |
| [F04](frames/F04-picker-android.png) | Android: the phone bottom sheet (Sepia, Automatic with split tiles) and the tablet side sheet, with the made-up "System colors" palette on chrome only. |
| [F05](frames/F05-keyboard-accessibility.png) | Focus order in three steps, the keys, the spoken labels, picker contrast for all 16 sets, the system settings, and glass vs solid in IC. |
| [F06](frames/F06-theme-paper.png), [F07](frames/F07-theme-sepia.png), [F08](frames/F08-theme-stone.png), [F09](frames/F09-theme-sage.png) | One theme per frame across Light, Dark, Light IC and Dark IC. Each shows the reader (with highlights, a note marker and a selection), the notes list, the Studyspace canvas and an M3 strip, with the measured key ratios. |
| [F10](frames/F10-accents-overview.png) | All 96 accent values as primary buttons, by theme and set, with the hex, hue, onAccent and page ratios, the shared OKLCH L/C, the Paper slot 1 flag, and the Mac and Android System options. |

## 14. Decisions, open items and follow-ups

| # | Decision | Ruled by | Status |
| --- | --- | --- | --- |
| 1 | Four themes in v1: Paper (the default, today's look), Sepia, Stone and Sage. Owen had asked for "a bunch". The studio recommended four, since a fifth would be a near-duplicate and every theme multiplies the QA work. | Owen, via Wren (Oct 31, 2026) | Final |
| 2 | Six preset accents per theme, no free color picker, slot 1 as the default (Mac included). Six rather than Hinge's suggested four, because the OKLCH rule makes all six pass the same floors. | Owen, via Wren (Oct 31, 2026); six over four by the studio (Iris, Nova) | Final |
| 3 | Appearance: Automatic (follows the system) by default, with Light and Dark as options. Theme and appearance are separate choices. | Wren (Oct 31, 2026), on the studio's recommendation | Final |
| 4 | Choices are stored per device. Every device starts on Paper, slot 1, Automatic. | Wren (Oct 31, 2026) | Final |
| 5 | Themes are pure design tokens read by Swift and Expo. Nothing goes in the Rust core or sync. | Wren (Oct 31, 2026) | Final |
| 6 | Increase Contrast and Reduce Transparency follow the system, with no in-app toggle. | Studio (Iris, Pebble); adopted by Lumen | Final |
| 7 | Highlights are colors only, with no category names or meanings. The only label is the hue. | Owen (design guide v3 Notes correction, Oct 28, 2026) | Final |
| 8 | Six fixed hue families in the order yellow, green, blue, pink, purple, orange, keyed by the core's color names. Themes tune only lightness and chroma, and screen readers say the plain hue ("Yellow highlight"). | Lumen proposed spoken hue words; the studio (Iris) agreed; Lumen asked for the core's color names as keys and labels, and the studio rebuilt with them | Final |
| 9 | Lightness tiers for color-blind readers: yellow, green, pink and purple light; blue and orange deep. No margin glyph is needed as a fallback. | Lumen asked for it; the studio (Iris) delivered it; Lumen accepted | Final |
| 10 | Sepia light ink is `#312718` (11.7:1), so the tiers fit in Sepia light. | Lumen (Oct 31, 2026) | Final |
| 11 | The old separate sepia reading surface folds into the Sepia theme, with `#7E7466` as Sepia light's outline. | Lumen proposed; the studio (Iris) agreed | Final |
| 12 | Glass stays clear, with no accent tint. The accent appears only on the single primary action and on selected states, and toolbar icons stay monochrome. | Studio (Pebble, per the HIG); adopted by Lumen | Final |
| 13 | Mac gets an opt-in System accent, which resolves to slot 1 under Multicolor. | Studio (Iris); adopted by Lumen | Final |
| 14 | Android gets opt-in Material You "System colors" on Android 12 and later, for chrome only. Paper, scripture text and highlights always use our colors. | Studio (Iris, Pebble); adopted by Lumen | Final |
| 15 | The picker: the reader is the live preview, with three radio groups and the placements in §4. | Studio (Hinge, Pebble); adopted by Lumen | Final |
| 16 | Selection stays at least ΔE2000 10 from every highlight and 8 from the page, with text on it at 7:1 or more. Nine selection values changed for this. | Studio (Iris); adopted by Lumen | Final |
| 17 | The focus ring follows the chosen accent. `textTertiary` is for placeholders only. | Studio (Iris); adopted by Lumen | Final |
| 18 | Paper pins today's shipped values (`tokens.ts`) wherever they pass the floors. Where one fails, the solved value is kept as an intended accessibility fix: the role outline, the M3 outline and the six highlights (§2.1, §7.2). | Lumen asked; the studio (Iris) rebuilt Paper | Final |
| 19 | Links keep `textPrimary` text with an underline as the cue, and a decorative `linkUnderline` token colors the underline. Paper uses the shipped light and dark values. | Studio (Iris); adopted by Lumen | Final |
| 20 | Stone dark is re-biased to a quieter chroma, so it no longer matches Paper dark. | Studio (Iris); adopted by Lumen | Final |

**Open items.** These don't block the decisions above.

1. **Differentiate Without Color shapes.** The guide's margin shapes (circle, square, triangle, diamond, bar, ring) are a separate, approved feature from the dropped hue glyph, and they're unchanged here.
2. **Increase Contrast on Android.** Android has no exact equivalent to Increase Contrast. The suggestion is to use the IC sets when `UiModeManager.getContrast()` reports high contrast on Android 14 and later. This is Otter's call, with design review.
3. **Paper and Stone darkIC highlights are identical.** The studio accepted this at that extreme. It is a studio call, not a ruling from Owen.
4. **Paper's IC link underline.** Paper's IC sets derive `linkUnderline`. Whether to adopt the shipped `increaseContrast` link color (`#7A2E1C`, the accent itself) for the IC underline is open.

**Follow-ups** (from the studio):

- **Chip order (Otter):** Expo lists purple before pink. Reorder it to yellow, green, blue, pink, purple, orange, and update the test (§12.5). Storage maps by color name, never by the core's index.
- **M3 containers (Otter):** confirm whether the Expo Material build reads `primaryContainer` and `onPrimaryContainer` (§9). Ours are kept until then.

**Resolved since the first draft:** Paper now matches the shipped values (decision 18), and the highlight word is Purple, as in core and Expo (decision 8).

## 15. Contrast summary

`contrast.py` result: **2,448 checks: 2,160 pass, 0 fail, 288 informational.** The full table is in [contrast-table.md](contrast-table.md). Floors are WCAG 2.x contrast ratios unless marked ΔE2000.

| role | standard | IC |
| --- | --- | --- |
| textPrimary on background, surfaceRaised | 7 | 7 |
| textPrimary on surface, surfaceSunken | 4.5 | 7 |
| textPrimary on each highlight | 4.5 (all sets built to 7 or more) | 7 |
| textPrimary on selection | 7 | 7 |
| textSecondary | 4.5 | 7 |
| textTertiary (placeholders) | 3 | 4.5 |
| outline, noteMarker | 3 | 4.5 |
| accent on background, surface, surfaceRaised | 3 (4.5 or more noted as usable as text) | 4.5 |
| onAccent on accent | 4.5 | 7 |
| focusRing, and every accent as a focus ring | 3 | 3 |
| destructive | 3 (4.5 or more noted as usable as text) | 4.5 |

Minimums across all 16 sets:

| Check | Floor (std / IC) | Lowest, standard sets | Lowest, IC sets |
| --- | --- | --- | --- |
| textPrimary on page | 7 / 7 | 10.62 (Sepia dark) | 14.17 (Sepia lightIC) |
| text on highlights | 7 / 7 | 7.07 (Sage dark) | 7.07 (Sepia lightIC) |
| text on selection | 7 / 7 | 7.32 (Sepia dark) | 11.83 (Sepia darkIC) |
| selection vs highlights, ΔE2000 | ≥10 | 10.32 (Stone dark, Blue) | 10.43 (Sage lightIC, Green) |
| selection vs page, ΔE2000 | ≥8 | 8.22 (Sage light) | 8.00 (Sepia darkIC) |
| textSecondary | 4.5 / 7 | 5.17 (Sepia light) | 9.17 (Sepia lightIC) |
| textTertiary (placeholders) | 3 / 4.5 | 3.10 (Sepia light) | 5.78 (Sepia lightIC) |
| outline | 3 / 4.5 | 3.03 (Paper light, on surfaceSunken) | 6.03 (Sepia lightIC) |
| noteMarker | 3 / 4.5 | 3.55 (Sage light) | 4.55 (Stone lightIC) |
| accent on surfaces | 3 / 4.5 | 4.58 (Sepia light) | 7.06 (Sepia lightIC) |
| onAccent | 4.5 / 7 | 5.66 (Stone light) | 8.45 (Stone lightIC) |
| focusRing | 3 / 3 | 4.58 (Sepia light) | 7.06 (Sepia lightIC) |
| destructive | 3 / 4.5 | 4.87 (Sepia light) | 7.05 (Sage darkIC) |
| highlight vs page, ΔE2000 | ≥12 | 12.10 (Stone dark) | 14.41 (Sage lightIC) |
| highlight neighbors, ΔE2000 | ≥15 | 15.48 (Paper light) | 15.48 (Paper and Stone lightIC) |
| M3 roles | 3 / 4.5 | 3.05 (Paper dark, outline on Highest) | 6.03 (Sepia lightIC) |

Picker checks, all against `surfaceRaised` (the solid fallback for the sheet or popover), across all six slots:

| Check | Floor (std / IC) | Lowest, standard | Lowest, IC |
| --- | --- | --- | --- |
| Tile and dot border (`outline`) | 3 / 4.5 | 3.43 (Sepia dark) | 6.64 (Sepia darkIC) |
| Selected ring (accent, any slot) | 3 / 4.5 | 5.03 (Sepia light) | 7.71 (Sepia lightIC) |
| Checkmark (onAccent on accent, any slot) | 4.5 / 7 | 5.66 (Stone light) | 8.45 (Stone lightIC) |
| Focus ring (slot 1) | 3 / 3 | 5.46 (Sage light) | 8.28 (Sage and Sepia lightIC) |

The color-vision notes are informational. Four highlight pairs fall in the close range (ΔE 5–8) under simulation, and they're listed in `contrast-table.md`. Highlights carry no meaning, so this can't break WCAG 1.4.1.

## 16. References

- HIG: [Color](https://developer.apple.com/design/human-interface-guidelines/color), [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)
- Material 3: [Color roles](https://m3.material.io/styles/color/roles), [Dynamic color](https://m3.material.io/styles/color/dynamic/user-generated-source), [Bottom sheets](https://m3.material.io/components/bottom-sheets/overview), [Side sheets](https://m3.material.io/components/side-sheets/overview)
- WCAG 2.2: [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum), [1.4.6 Contrast (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced), [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast), [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color)
- Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6).
- Berean: [berean-design-guide.md](../berean-design-guide.md), [README.md](README.md), [tokens.json](tokens.json), [contrast.py](contrast.py)
