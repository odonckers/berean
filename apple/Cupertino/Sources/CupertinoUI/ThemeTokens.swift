// ThemeTokens.swift — GENERATED FILE. DO NOT EDIT.
//
// Generated from docs/design/themes/tokens.json, the single source of truth for
// Berean's colour themes (docs/design/themes/themes-spec.md §12.1). Nothing
// here is hand-copied, and nothing parses JSON at launch.
//
// Regenerate with:
//
//     apple/scripts/gen-theme-tokens.py
//
// and check it is current with:
//
//     apple/scripts/gen-theme-tokens.py --check
//
// Contents: for each of the four themes, the four sets (light, dark, lightIC,
// darkIC) with all 16 roles, highlights[6] keyed by colour name in display
// order (yellow, green, blue, pink, purple, orange) with their names and spoken
// names, and accents[6] with their slot, name, hex and onAccent per set.
//
// tokens.json's `material3` block is Expo's (themes-spec §9) and is deliberately
// NOT generated here — with one exception. `scrim` and `scrimWarm` live only
// under `material3` because they are the file's only non-opaque values (§2), and
// the Mac shell needs scrimWarm behind the Omnisearch palette, so those two are
// carried over per set rather than hand-copied. Everything else M3 stays out.
//
// The supporting value types (ThemeColor, ThemeRoles, ThemeAccentSlot, …) are
// hand-written in ThemeColor.swift; set resolution is in ThemeResolution.swift.

// swiftlint:disable all
// swift-format-ignore-file

import Foundation

public enum ThemeTokens {
    /// `version` from tokens.json, so a mismatch is visible in tests.
    public static let tokensVersion = "1.0.0"

    /// tokens.json `defaults`: Paper, accent slot 1, Automatic.
    public static let defaultTheme = ThemeID.paper
    public static let defaultAccentSlot = 1
    public static let defaultAppearance = ThemeAppearance.automatic

    /// Every theme, in the order tokens.json documents.
    public static let allPalettes: [ThemePalette] = [paper, sepia, stone, sage]

    public static func palette(_ theme: ThemeID) -> ThemePalette {
        switch theme {
        case .paper: paper
        case .sepia: sepia
        case .stone: stone
        case .sage: sage
        }
    }

    // MARK: Paper

    public static let paper = ThemePalette(
        id: .paper,
        name: "Paper",
        character: "The current Berean look: warm, bright, lightly toned paper with near-black brown ink. Crisp but never stark; the default.",
        isDefault: true,
        light: paperLight,
        dark: paperDark,
        lightIC: paperLightIC,
        darkIC: paperDarkIC,
        accentSlots: paperAccents
    )

    private static let paperLight = ThemeRoles(
        background: ThemeColor(hex: 0xFBF7EC),
        surface: ThemeColor(hex: 0xFDF9F0),
        surfaceRaised: ThemeColor(hex: 0xFFFCF5),
        surfaceSunken: ThemeColor(hex: 0xEEE5D3),
        textPrimary: ThemeColor(hex: 0x1F1A14),
        textSecondary: ThemeColor(hex: 0x5C544A),
        textTertiary: ThemeColor(hex: 0x807B73),
        outline: ThemeColor(hex: 0x8B8275),
        separator: ThemeColor(hex: 0xE6DCC2),
        linkUnderline: ThemeColor(hex: 0xC9A493),
        accent: ThemeColor(hex: 0x9B3F2A),
        onAccent: ThemeColor(hex: 0xFFFCF5),
        destructive: ThemeColor(hex: 0xD70015),
        noteMarker: ThemeColor(hex: 0x986C16),
        selection: ThemeColor(hex: 0xFAD4CB),
        focusRing: ThemeColor(hex: 0x9B3F2A),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xFCEDA0)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xC2F8C8)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x8CC1EE)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFBAD4)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xE6DAFF)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xD49E75)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 31, green: 26, blue: 20, alpha: 0.45)
    )

    private static let paperDark = ThemeRoles(
        background: ThemeColor(hex: 0x15120E),
        surface: ThemeColor(hex: 0x1C1814),
        surfaceRaised: ThemeColor(hex: 0x211D18),
        surfaceSunken: ThemeColor(hex: 0x0F0D0A),
        textPrimary: ThemeColor(hex: 0xEDE6D8),
        textSecondary: ThemeColor(hex: 0xA39A8B),
        textTertiary: ThemeColor(hex: 0x928B83),
        outline: ThemeColor(hex: 0x7A7165),
        separator: ThemeColor(hex: 0x38312A),
        linkUnderline: ThemeColor(hex: 0x734F40),
        accent: ThemeColor(hex: 0xE59A7C),
        onAccent: ThemeColor(hex: 0x211D18),
        destructive: ThemeColor(hex: 0xFF453A),
        noteMarker: ThemeColor(hex: 0xA77E39),
        selection: ThemeColor(hex: 0x4C382F),
        focusRing: ThemeColor(hex: 0xE59A7C),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x574A00)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x2C5232)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x013050)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x6D3B4F)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x573C80)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x492606)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let paperLightIC = ThemeRoles(
        background: ThemeColor(hex: 0xF8F4ED),
        surface: ThemeColor(hex: 0xFCF9F3),
        surfaceRaised: ThemeColor(hex: 0xFFFCF5),
        surfaceSunken: ThemeColor(hex: 0xF1ECE4),
        textPrimary: ThemeColor(hex: 0x14110C),
        textSecondary: ThemeColor(hex: 0x39352D),
        textTertiary: ThemeColor(hex: 0x5B564E),
        outline: ThemeColor(hex: 0x5C544A),
        separator: ThemeColor(hex: 0xA49E94),
        linkUnderline: ThemeColor(hex: 0x7A2E1C),
        accent: ThemeColor(hex: 0x7B2815),
        onAccent: ThemeColor(hex: 0xFFFFFF),
        destructive: ThemeColor(hex: 0xA1000D),
        noteMarker: ThemeColor(hex: 0x8E6201),
        selection: ThemeColor(hex: 0xFFDBD3),
        focusRing: ThemeColor(hex: 0x7B2815),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xFFF0A6)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xC6F7CC)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x8CC1EE)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFBAD4)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xE6DAFF)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xD49E75)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 20, green: 17, blue: 12, alpha: 0.45)
    )

    private static let paperDarkIC = ThemeRoles(
        background: ThemeColor(hex: 0x0B0906),
        surface: ThemeColor(hex: 0x110E0B),
        surfaceRaised: ThemeColor(hex: 0x17130F),
        surfaceSunken: ThemeColor(hex: 0x070504),
        textPrimary: ThemeColor(hex: 0xFBF6F0),
        textSecondary: ThemeColor(hex: 0xDAD3CA),
        textTertiary: ThemeColor(hex: 0xB7B0A8),
        outline: ThemeColor(hex: 0xA69D93),
        separator: ThemeColor(hex: 0x635C55),
        linkUnderline: ThemeColor(hex: 0x73564B),
        accent: ThemeColor(hex: 0xF9B093),
        onAccent: ThemeColor(hex: 0x080503),
        destructive: ThemeColor(hex: 0xFF7667),
        noteMarker: ThemeColor(hex: 0xA77E39),
        selection: ThemeColor(hex: 0x3C2821),
        focusRing: ThemeColor(hex: 0xF9B093),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x5F520A)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x315B38)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x0A3859)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x764357)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x5F448A)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x512E0F)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let paperAccents: [ThemeAccentSlot] = [
        ThemeAccentSlot(
            slot: 1,
            name: "Terracotta",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x9B3F2A), onAccent: ThemeColor(hex: 0xFFFCF5)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xE59A7C), onAccent: ThemeColor(hex: 0x211D18)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x7B2815), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xF9B093), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 2,
            name: "Ink blue",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x2860A5), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x84B2EE), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x0F4786), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x9CC7FF), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 3,
            name: "Fern",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x1E7234), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x83C18B), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x00581F), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x9AD6A1), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 4,
            name: "Plum",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x8D4076), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xDA96C3), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x6F285B), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xEEACD8), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 5,
            name: "Ochre",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x825600), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xD4A664), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x624000), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xE8BC7D), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 6,
            name: "Lagoon",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x006D77), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x55C1CD), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x005259), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x72D6E1), onAccent: ThemeColor(hex: 0x080503))
        ),
    ]

    // MARK: Sepia

    public static let sepia = ThemePalette(
        id: .sepia,
        name: "Sepia",
        character: "Deeper, buttery parchment with soft brown ink. Lower contrast than Paper (about 11.7:1 on the page) to ease long sessions, while staying above every floor.",
        isDefault: false,
        light: sepiaLight,
        dark: sepiaDark,
        lightIC: sepiaLightIC,
        darkIC: sepiaDarkIC,
        accentSlots: sepiaAccents
    )

    private static let sepiaLight = ThemeRoles(
        background: ThemeColor(hex: 0xF2E4D1),
        surface: ThemeColor(hex: 0xF5E9D8),
        surfaceRaised: ThemeColor(hex: 0xF9EFDF),
        surfaceSunken: ThemeColor(hex: 0xECDEC9),
        textPrimary: ThemeColor(hex: 0x312718),
        textSecondary: ThemeColor(hex: 0x645949),
        textTertiary: ThemeColor(hex: 0x867C6C),
        outline: ThemeColor(hex: 0x7E7466),
        separator: ThemeColor(hex: 0xDACDBA),
        linkUnderline: ThemeColor(hex: 0xBB9A8B),
        accent: ThemeColor(hex: 0x914F2F),
        onAccent: ThemeColor(hex: 0xFFFFFF),
        destructive: ThemeColor(hex: 0xBE222A),
        noteMarker: ThemeColor(hex: 0xA36527),
        selection: ThemeColor(hex: 0xF9D5C6),
        focusRing: ThemeColor(hex: 0x914F2F),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xF3E390)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xB7EABD)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x8EC8F9)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFB5D1)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xE9DEFF)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xF1A366)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 49, green: 39, blue: 24, alpha: 0.45)
    )

    private static let sepiaDark = ThemeRoles(
        background: ThemeColor(hex: 0x1C160F),
        surface: ThemeColor(hex: 0x221B14),
        surfaceRaised: ThemeColor(hex: 0x282019),
        surfaceSunken: ThemeColor(hex: 0x17110B),
        textPrimary: ThemeColor(hex: 0xE3CFBC),
        textSecondary: ThemeColor(hex: 0xB7A696),
        textTertiary: ThemeColor(hex: 0x918376),
        outline: ThemeColor(hex: 0x7F7265),
        separator: ThemeColor(hex: 0x3D332B),
        linkUnderline: ThemeColor(hex: 0x695044),
        accent: ThemeColor(hex: 0xCB8E72),
        onAccent: ThemeColor(hex: 0x110C08),
        destructive: ThemeColor(hex: 0xFB6157),
        noteMarker: ThemeColor(hex: 0xB17843),
        selection: ThemeColor(hex: 0x4D372E),
        focusRing: ThemeColor(hex: 0xCB8E72),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x473D07)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x2E4331)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x002945)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x563441)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x49306E)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x3D1D01)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let sepiaLightIC = ThemeRoles(
        background: ThemeColor(hex: 0xF4E8D5),
        surface: ThemeColor(hex: 0xF8EDDC),
        surfaceRaised: ThemeColor(hex: 0xFCF2E3),
        surfaceSunken: ThemeColor(hex: 0xEEE1CD),
        textPrimary: ThemeColor(hex: 0x231A0B),
        textSecondary: ThemeColor(hex: 0x403628),
        textTertiary: ThemeColor(hex: 0x5D5445),
        outline: ThemeColor(hex: 0x5B5143),
        separator: ThemeColor(hex: 0xA69987),
        linkUnderline: ThemeColor(hex: 0xAD8E81),
        accent: ThemeColor(hex: 0x733718),
        onAccent: ThemeColor(hex: 0xFFFFFF),
        destructive: ThemeColor(hex: 0x960015),
        noteMarker: ThemeColor(hex: 0x925613),
        selection: ThemeColor(hex: 0xFFDCCD),
        focusRing: ThemeColor(hex: 0x733718),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xF3E390)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xB7EABD)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x89BAE4)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFB5D1)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xE9DEFF)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xCB9D7B)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 35, green: 26, blue: 11, alpha: 0.45)
    )

    private static let sepiaDarkIC = ThemeRoles(
        background: ThemeColor(hex: 0x110C07),
        surface: ThemeColor(hex: 0x17110C),
        surfaceRaised: ThemeColor(hex: 0x1D1711),
        surfaceSunken: ThemeColor(hex: 0x0D0805),
        textPrimary: ThemeColor(hex: 0xFCEBDB),
        textSecondary: ThemeColor(hex: 0xDECEBE),
        textTertiary: ThemeColor(hex: 0xBDAEA0),
        outline: ThemeColor(hex: 0xAA9C8E),
        separator: ThemeColor(hex: 0x63594F),
        linkUnderline: ThemeColor(hex: 0x70574D),
        accent: ThemeColor(hex: 0xEBAE93),
        onAccent: ThemeColor(hex: 0x080503),
        destructive: ThemeColor(hex: 0xFF7C70),
        noteMarker: ThemeColor(hex: 0xB37944),
        selection: ThemeColor(hex: 0x382A24),
        focusRing: ThemeColor(hex: 0xEBAE93),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x594D0D)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x2E5534)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x093351)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x723C52)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x594080)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x4A2A0E)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let sepiaAccents: [ThemeAccentSlot] = [
        ThemeAccentSlot(
            slot: 1,
            name: "Sienna",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x914F2F), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xCB8E72), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x733718), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xEBAE93), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 2,
            name: "Oxblood",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x934951), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xCE898D), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x753139), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xEDA9AD), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 3,
            name: "Olive",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x656818), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x9FA465), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x4C4E00), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xBEC387), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 4,
            name: "Dusk blue",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x32669A), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x75A3D2), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x1A4C7B), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x96C2F0), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 5,
            name: "Mulberry",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x864C7A), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xC08AB4), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x69345E), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xDFAAD3), onAccent: ThemeColor(hex: 0x080503))
        ),
        ThemeAccentSlot(
            slot: 6,
            name: "Juniper",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x007460), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x60B09B), onAccent: ThemeColor(hex: 0x110C08)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x005748), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x84CFBB), onAccent: ThemeColor(hex: 0x080503))
        ),
    ]

    // MARK: Stone

    public static let stone = ThemePalette(
        id: .stone,
        name: "Stone",
        character: "A cool, quiet grey with a faint blue cast, like limestone and slate. Neutral and modern, with graphite ink.",
        isDefault: false,
        light: stoneLight,
        dark: stoneDark,
        lightIC: stoneLightIC,
        darkIC: stoneDarkIC,
        accentSlots: stoneAccents
    )

    private static let stoneLight = ThemeRoles(
        background: ThemeColor(hex: 0xEFF1F4),
        surface: ThemeColor(hex: 0xF5F7F9),
        surfaceRaised: ThemeColor(hex: 0xFBFDFE),
        surfaceSunken: ThemeColor(hex: 0xE6E9EC),
        textPrimary: ThemeColor(hex: 0x1D2126),
        textSecondary: ThemeColor(hex: 0x565B62),
        textTertiary: ThemeColor(hex: 0x787C82),
        outline: ThemeColor(hex: 0x7E848A),
        separator: ThemeColor(hex: 0xD6D9DD),
        linkUnderline: ThemeColor(hex: 0x93A9C7),
        accent: ThemeColor(hex: 0x3464A0),
        onAccent: ThemeColor(hex: 0xFFFFFF),
        destructive: ThemeColor(hex: 0xC9222B),
        noteMarker: ThemeColor(hex: 0xA66D10),
        selection: ThemeColor(hex: 0xCBE0FC),
        focusRing: ThemeColor(hex: 0x3464A0),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xFFEC94)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xBFF5C5)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x89B0D1)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFBAD4)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xD6C2FE)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xD7A178)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 29, green: 33, blue: 38, alpha: 0.45)
    )

    private static let stoneDark = ThemeRoles(
        background: ThemeColor(hex: 0x0E1114),
        surface: ThemeColor(hex: 0x14161A),
        surfaceRaised: ThemeColor(hex: 0x1A1D21),
        surfaceSunken: ThemeColor(hex: 0x090B0E),
        textPrimary: ThemeColor(hex: 0xE5E8ED),
        textSecondary: ThemeColor(hex: 0xB0B4BB),
        textTertiary: ThemeColor(hex: 0x888C92),
        outline: ThemeColor(hex: 0x6F737A),
        separator: ThemeColor(hex: 0x2D3135),
        linkUnderline: ThemeColor(hex: 0x45566C),
        accent: ThemeColor(hex: 0x7CA7DF),
        onAccent: ThemeColor(hex: 0x0A0D12),
        destructive: ThemeColor(hex: 0xFB6157),
        noteMarker: ThemeColor(hex: 0xAF7A31),
        selection: ThemeColor(hex: 0x343E4A),
        focusRing: ThemeColor(hex: 0x7CA7DF),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x554A16)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x304D34)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x002945)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x743450)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x4D3770)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x42260F)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let stoneLightIC = ThemeRoles(
        background: ThemeColor(hex: 0xF2F4F6),
        surface: ThemeColor(hex: 0xF8F9FB),
        surfaceRaised: ThemeColor(hex: 0xFDFEFF),
        surfaceSunken: ThemeColor(hex: 0xEAECEF),
        textPrimary: ThemeColor(hex: 0x0D1116),
        textSecondary: ThemeColor(hex: 0x31363C),
        textTertiary: ThemeColor(hex: 0x52575D),
        outline: ThemeColor(hex: 0x50565D),
        separator: ThemeColor(hex: 0x9B9FA3),
        linkUnderline: ThemeColor(hex: 0x889DB8),
        accent: ThemeColor(hex: 0x1D4B81),
        onAccent: ThemeColor(hex: 0xFFFFFF),
        destructive: ThemeColor(hex: 0xA00017),
        noteMarker: ThemeColor(hex: 0x945F00),
        selection: ThemeColor(hex: 0xD4E6FF),
        focusRing: ThemeColor(hex: 0x1D4B81),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xF9E99C)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xBFF5C5)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x89BEEB)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFBAD4)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xE6DAFF)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xD19B72)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 13, green: 17, blue: 22, alpha: 0.45)
    )

    private static let stoneDarkIC = ThemeRoles(
        background: ThemeColor(hex: 0x07080B),
        surface: ThemeColor(hex: 0x0B0D10),
        surfaceRaised: ThemeColor(hex: 0x111317),
        surfaceSunken: ThemeColor(hex: 0x040506),
        textPrimary: ThemeColor(hex: 0xF5F7FA),
        textSecondary: ThemeColor(hex: 0xD1D4DA),
        textTertiary: ThemeColor(hex: 0xADB1B8),
        outline: ThemeColor(hex: 0x9A9FA6),
        separator: ThemeColor(hex: 0x575B61),
        linkUnderline: ThemeColor(hex: 0x4C5D72),
        accent: ThemeColor(hex: 0x9AC4FB),
        onAccent: ThemeColor(hex: 0x04060A),
        destructive: ThemeColor(hex: 0xFF7569),
        noteMarker: ThemeColor(hex: 0xAF7A31),
        selection: ThemeColor(hex: 0x272E37),
        focusRing: ThemeColor(hex: 0x9AC4FB),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x5F520A)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x315B38)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x0A3859)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x764357)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x5F448A)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x512E0F)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let stoneAccents: [ThemeAccentSlot] = [
        ThemeAccentSlot(
            slot: 1,
            name: "Slate blue",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x3464A0), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x7CA7DF), onAccent: ThemeColor(hex: 0x0A0D12)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x1D4B81), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x9AC4FB), onAccent: ThemeColor(hex: 0x04060A))
        ),
        ThemeAccentSlot(
            slot: 2,
            name: "Brick",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x984839), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xD98E7F), onAccent: ThemeColor(hex: 0x0A0D12)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x793024), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xF5AC9C), onAccent: ThemeColor(hex: 0x04060A))
        ),
        ThemeAccentSlot(
            slot: 3,
            name: "Pine",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x0B764D), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x6CB790), onAccent: ThemeColor(hex: 0x0A0D12)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x005938), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x8CD3AD), onAccent: ThemeColor(hex: 0x04060A))
        ),
        ThemeAccentSlot(
            slot: 4,
            name: "Iris",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x68559B), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xA999DA), onAccent: ThemeColor(hex: 0x0A0D12)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x4F3C7C), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xC5B6F6), onAccent: ThemeColor(hex: 0x04060A))
        ),
        ThemeAccentSlot(
            slot: 5,
            name: "Amber",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x8A5600), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xCB9A60), onAccent: ThemeColor(hex: 0x0A0D12)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x684000), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xE7B780), onAccent: ThemeColor(hex: 0x04060A))
        ),
        ThemeAccentSlot(
            slot: 6,
            name: "Rose",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x924666), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xD48BA8), onAccent: ThemeColor(hex: 0x0A0D12)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x742E4D), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xF0A9C4), onAccent: ThemeColor(hex: 0x04060A))
        ),
    ]

    // MARK: Sage

    public static let sage = ThemePalette(
        id: .sage,
        name: "Sage",
        character: "Muted green-grey, like dried herbs and lichen. Low stimulation: soft chroma everywhere, accents and highlights pulled down a notch.",
        isDefault: false,
        light: sageLight,
        dark: sageDark,
        lightIC: sageLightIC,
        darkIC: sageDarkIC,
        accentSlots: sageAccents
    )

    private static let sageLight = ThemeRoles(
        background: ThemeColor(hex: 0xEAF0E8),
        surface: ThemeColor(hex: 0xF0F4EE),
        surfaceRaised: ThemeColor(hex: 0xF5F9F4),
        surfaceSunken: ThemeColor(hex: 0xE2E8DF),
        textPrimary: ThemeColor(hex: 0x22291F),
        textSecondary: ThemeColor(hex: 0x565D52),
        textTertiary: ThemeColor(hex: 0x777E74),
        outline: ThemeColor(hex: 0x7B8377),
        separator: ThemeColor(hex: 0xD1D9CD),
        linkUnderline: ThemeColor(hex: 0x9CAC94),
        accent: ThemeColor(hex: 0x4E6E3B),
        onAccent: ThemeColor(hex: 0xFFFFFF),
        destructive: ThemeColor(hex: 0xBE2E31),
        noteMarker: ThemeColor(hex: 0xA66A3A),
        selection: ThemeColor(hex: 0xD2D2D2),
        focusRing: ThemeColor(hex: 0x4E6E3B),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xF6E9AB)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xC6EDCA)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x9BC6EC)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFBFD7)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xEBE3FF)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xD7AA88)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 34, green: 41, blue: 31, alpha: 0.45)
    )

    private static let sageDark = ThemeRoles(
        background: ThemeColor(hex: 0x111511),
        surface: ThemeColor(hex: 0x161B16),
        surfaceRaised: ThemeColor(hex: 0x1B211B),
        surfaceSunken: ThemeColor(hex: 0x0C100C),
        textPrimary: ThemeColor(hex: 0xD9E3D8),
        textSecondary: ThemeColor(hex: 0xAAB4AA),
        textTertiary: ThemeColor(hex: 0x858D85),
        outline: ThemeColor(hex: 0x6D766D),
        separator: ThemeColor(hex: 0x2F352E),
        linkUnderline: ThemeColor(hex: 0x4C5846),
        accent: ThemeColor(hex: 0x8AA97A),
        onAccent: ThemeColor(hex: 0x0A0F0A),
        destructive: ThemeColor(hex: 0xF26A5F),
        noteMarker: ThemeColor(hex: 0xAF784E),
        selection: ThemeColor(hex: 0x384034),
        focusRing: ThemeColor(hex: 0x8AA97A),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x514500)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x2E4E33)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x052B46)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x67354A)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x52367B)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x432204)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let sageLightIC = ThemeRoles(
        background: ThemeColor(hex: 0xEEF3EC),
        surface: ThemeColor(hex: 0xF3F7F2),
        surfaceRaised: ThemeColor(hex: 0xF9FCF8),
        surfaceSunken: ThemeColor(hex: 0xE6EBE3),
        textPrimary: ThemeColor(hex: 0x10160D),
        textSecondary: ThemeColor(hex: 0x32392F),
        textTertiary: ThemeColor(hex: 0x52594E),
        outline: ThemeColor(hex: 0x4F574B),
        separator: ThemeColor(hex: 0x98A094),
        linkUnderline: ThemeColor(hex: 0x909F89),
        accent: ThemeColor(hex: 0x365425),
        onAccent: ThemeColor(hex: 0xFFFFFF),
        destructive: ThemeColor(hex: 0x9D0016),
        noteMarker: ThemeColor(hex: 0x955B29),
        selection: ThemeColor(hex: 0xCDD9C8),
        focusRing: ThemeColor(hex: 0x365425),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0xF6E9AB)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0xCCF4D1)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x95C0E5)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0xFFBFD7)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0xEBE3FF)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0xCA9D7C)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 16, green: 22, blue: 13, alpha: 0.45)
    )

    private static let sageDarkIC = ThemeRoles(
        background: ThemeColor(hex: 0x080B08),
        surface: ThemeColor(hex: 0x0C110C),
        surfaceRaised: ThemeColor(hex: 0x121712),
        surfaceSunken: ThemeColor(hex: 0x050705),
        textPrimary: ThemeColor(hex: 0xF0F7F0),
        textSecondary: ThemeColor(hex: 0xCCD6CC),
        textTertiary: ThemeColor(hex: 0xAAB2A9),
        outline: ThemeColor(hex: 0x96A096),
        separator: ThemeColor(hex: 0x565D56),
        linkUnderline: ThemeColor(hex: 0x54604E),
        accent: ThemeColor(hex: 0xAAC99A),
        onAccent: ThemeColor(hex: 0x040704),
        destructive: ThemeColor(hex: 0xFF786D),
        noteMarker: ThemeColor(hex: 0xAF784E),
        selection: ThemeColor(hex: 0x213417),
        focusRing: ThemeColor(hex: 0xAAC99A),
        highlights: [
            ThemeHighlight(key: .yellow, name: "Yellow", spokenName: "Yellow highlight", color: ThemeColor(hex: 0x5F520E)),
            ThemeHighlight(key: .green, name: "Green", spokenName: "Green highlight", color: ThemeColor(hex: 0x365A3B)),
            ThemeHighlight(key: .blue, name: "Blue", spokenName: "Blue highlight", color: ThemeColor(hex: 0x143854)),
            ThemeHighlight(key: .pink, name: "Pink", spokenName: "Pink highlight", color: ThemeColor(hex: 0x764357)),
            ThemeHighlight(key: .purple, name: "Purple", spokenName: "Purple highlight", color: ThemeColor(hex: 0x60448A)),
            ThemeHighlight(key: .orange, name: "Orange", spokenName: "Orange highlight", color: ThemeColor(hex: 0x512E12)),
        ],
        scrim: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32),
        scrimWarm: ThemeScrim(red: 0, green: 0, blue: 0, alpha: 0.32)
    )

    private static let sageAccents: [ThemeAccentSlot] = [
        ThemeAccentSlot(
            slot: 1,
            name: "Moss",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x4E6E3B), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x8AA97A), onAccent: ThemeColor(hex: 0x0A0F0A)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x365425), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xAAC99A), onAccent: ThemeColor(hex: 0x040704))
        ),
        ThemeAccentSlot(
            slot: 2,
            name: "Spruce",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x06726E), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x63AEA9), onAccent: ThemeColor(hex: 0x0A0F0A)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x005653), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x86CDC8), onAccent: ThemeColor(hex: 0x040704))
        ),
        ThemeAccentSlot(
            slot: 3,
            name: "Lake",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x296B8D), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0x6FA6C7), onAccent: ThemeColor(hex: 0x0A0F0A)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x0E5170), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0x91C6E5), onAccent: ThemeColor(hex: 0x040704))
        ),
        ThemeAccentSlot(
            slot: 4,
            name: "Heather",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x755485), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xB091BF), onAccent: ThemeColor(hex: 0x0A0F0A)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x5B3C68), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xCFB0DE), onAccent: ThemeColor(hex: 0x040704))
        ),
        ThemeAccentSlot(
            slot: 5,
            name: "Clay",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x8A5336), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xC69176), onAccent: ThemeColor(hex: 0x0A0F0A)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x6D3B20), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xE5B196), onAccent: ThemeColor(hex: 0x040704))
        ),
        ThemeAccentSlot(
            slot: 6,
            name: "Wheat",
            light: ThemeAccentValue(color: ThemeColor(hex: 0x776022), onAccent: ThemeColor(hex: 0xFFFFFF)),
            dark: ThemeAccentValue(color: ThemeColor(hex: 0xB29C67), onAccent: ThemeColor(hex: 0x0A0F0A)),
            lightIC: ThemeAccentValue(color: ThemeColor(hex: 0x5D4706), onAccent: ThemeColor(hex: 0xFFFFFF)),
            darkIC: ThemeAccentValue(color: ThemeColor(hex: 0xD1BC89), onAccent: ThemeColor(hex: 0x040704))
        ),
    ]
}
