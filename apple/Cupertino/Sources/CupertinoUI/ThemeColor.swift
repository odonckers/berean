import Foundation
import SwiftUI

/// The value types behind `ThemeTokens`.
///
/// These are hand-written; the data itself is generated into `ThemeTokens.swift`
/// from `docs/design/themes/tokens.json` by `apple/scripts/gen-theme-tokens.py`.
/// Everything here is platform-neutral so `CupertinoUI` keeps building for iOS
/// as well as macOS.

// MARK: - Colour

/// One opaque sRGB colour from the theme tokens.
///
/// themes-spec.md §2: every token value is an opaque sRGB hex, so the hex *is*
/// the colour — there is no colour space to negotiate. The WCAG helpers are on
/// the type so the contrast tests measure exactly what the app draws.
public struct ThemeColor: Hashable, Sendable {
    /// `0xRRGGBB`.
    public let hex: UInt32

    public init(hex: UInt32) {
        self.hex = hex & 0x00FF_FFFF
    }

    /// 0…1 sRGB channels.
    public var red: Double { Double((hex >> 16) & 0xFF) / 255 }
    public var green: Double { Double((hex >> 8) & 0xFF) / 255 }
    public var blue: Double { Double(hex & 0xFF) / 255 }

    /// `#RRGGBB`, uppercase, the form tokens.json uses.
    public var hexString: String {
        String(format: "#%06X", hex)
    }

    /// The SwiftUI colour, in sRGB so it matches the token exactly.
    public var color: Color {
        Color(.sRGB, red: red, green: green, blue: blue, opacity: 1)
    }

    /// WCAG 2.x relative luminance.
    public var relativeLuminance: Double {
        func linear(_ channel: Double) -> Double {
            channel <= 0.040_45
                ? channel / 12.92
                : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    /// WCAG 2.x contrast ratio, 1…21. Symmetric, so the argument order is free.
    public func contrastRatio(against other: ThemeColor) -> Double {
        let lhs = relativeLuminance
        let rhs = other.relativeLuminance
        return (max(lhs, rhs) + 0.05) / (min(lhs, rhs) + 0.05)
    }
}

/// A translucent scrim. themes-spec.md §2: the Material 3 scrims are the one
/// exception to "all colours are opaque", because a scrim dims what is behind it.
public struct ThemeScrim: Hashable, Sendable {
    public let red: Int
    public let green: Int
    public let blue: Int
    public let alpha: Double

    public var color: Color {
        Color(
            .sRGB,
            red: Double(red) / 255,
            green: Double(green) / 255,
            blue: Double(blue) / 255,
            opacity: alpha
        )
    }
}

// MARK: - Identifiers

/// The four themes (themes-spec.md §2). Paper is the default.
public enum ThemeID: String, CaseIterable, Hashable, Codable, Sendable {
    case paper
    case sepia
    case stone
    case sage
}

/// The four sets per theme. `IC` is Increase Contrast.
public enum ThemeSet: String, CaseIterable, Hashable, Codable, Sendable {
    case light
    case dark
    case lightIC
    case darkIC
}

/// The user's appearance choice (themes-spec.md §3 rule 1).
public enum ThemeAppearance: String, CaseIterable, Hashable, Codable, Sendable {
    case automatic
    case light
    case dark
}

/// The 16 roles in a set, in the order `tokens.json` lists them.
public enum ThemeRole: String, CaseIterable, Hashable, Sendable {
    case background
    case surface
    case surfaceRaised
    case surfaceSunken
    case textPrimary
    case textSecondary
    case textTertiary
    case outline
    case separator
    case linkUnderline
    case accent
    case onAccent
    case destructive
    case noteMarker
    case selection
    case focusRing
}

/// The six highlight families, keyed by the Rust core's colour names
/// (themes-spec.md §7). The case order is the display order.
public enum HighlightKey: String, CaseIterable, Hashable, Codable, Sendable {
    case yellow
    case green
    case blue
    case pink
    case purple
    case orange
}

// MARK: - Values

/// One highlight in one set: the colour plus the labels screen readers speak.
public struct ThemeHighlight: Hashable, Sendable {
    public let key: HighlightKey
    /// The plain hue, e.g. "Purple".
    public let name: String
    /// What VoiceOver says, e.g. "Purple highlight".
    public let spokenName: String
    public let color: ThemeColor
}

/// One accent slot's colour in one set.
public struct ThemeAccentValue: Hashable, Sendable {
    public let color: ThemeColor
    /// White or the set's dark ink, whichever contrasts more (§6).
    public let onAccent: ThemeColor
}

/// One of the six preset accents, across all four sets (themes-spec.md §6).
public struct ThemeAccentSlot: Hashable, Sendable {
    /// 1…6. Slot 1 is the theme default; the slot number survives a theme swap.
    public let slot: Int
    /// The screen-reader and label name, e.g. "Terracotta".
    public let name: String

    public let light: ThemeAccentValue
    public let dark: ThemeAccentValue
    public let lightIC: ThemeAccentValue
    public let darkIC: ThemeAccentValue

    /// What VoiceOver says for the accent dot (themes-spec.md §5).
    public var spokenName: String { "\(name), accent" }

    public func value(for set: ThemeSet) -> ThemeAccentValue {
        switch set {
        case .light: light
        case .dark: dark
        case .lightIC: lightIC
        case .darkIC: darkIC
        }
    }
}

/// Every colour one theme uses in one set: the 16 roles, the six highlights and
/// the two scrims.
public struct ThemeRoles: Hashable, Sendable {
    public let background: ThemeColor
    public let surface: ThemeColor
    public let surfaceRaised: ThemeColor
    public let surfaceSunken: ThemeColor
    public let textPrimary: ThemeColor
    public let textSecondary: ThemeColor
    /// Placeholders only — it is under 4.5:1 (themes-spec.md §3 rule 10).
    public let textTertiary: ThemeColor
    public let outline: ThemeColor
    /// Decorative only; anything that must read as a boundary uses `outline`.
    public let separator: ThemeColor
    /// Decorative only; the underline's shape is the link cue.
    public let linkUnderline: ThemeColor
    public let accent: ThemeColor
    public let onAccent: ThemeColor
    public let destructive: ThemeColor
    public let noteMarker: ThemeColor
    public let selection: ThemeColor
    public let focusRing: ThemeColor

    /// The six highlights in display order: yellow, green, blue, pink, purple,
    /// orange (themes-spec.md §7).
    public let highlights: [ThemeHighlight]

    public let scrim: ThemeScrim
    public let scrimWarm: ThemeScrim

    public subscript(role: ThemeRole) -> ThemeColor {
        switch role {
        case .background: background
        case .surface: surface
        case .surfaceRaised: surfaceRaised
        case .surfaceSunken: surfaceSunken
        case .textPrimary: textPrimary
        case .textSecondary: textSecondary
        case .textTertiary: textTertiary
        case .outline: outline
        case .separator: separator
        case .linkUnderline: linkUnderline
        case .accent: accent
        case .onAccent: onAccent
        case .destructive: destructive
        case .noteMarker: noteMarker
        case .selection: selection
        case .focusRing: focusRing
        }
    }

    /// Highlights are stored by colour name, never by position (§12.5).
    public func highlight(_ key: HighlightKey) -> ThemeHighlight {
        // The generator guarantees all six, in display order.
        highlights.first { $0.key == key } ?? highlights[0]
    }
}

/// One whole theme.
public struct ThemePalette: Hashable, Sendable, Identifiable {
    public let id: ThemeID
    /// The display name, e.g. "Paper".
    public let name: String
    /// The one-line description from `tokens.json`.
    public let character: String
    public let isDefault: Bool

    public let light: ThemeRoles
    public let dark: ThemeRoles
    public let lightIC: ThemeRoles
    public let darkIC: ThemeRoles

    /// The six preset accents, slot 1 first.
    public let accentSlots: [ThemeAccentSlot]

    public func roles(for set: ThemeSet) -> ThemeRoles {
        switch set {
        case .light: light
        case .dark: dark
        case .lightIC: lightIC
        case .darkIC: darkIC
        }
    }

    /// Slot 1…6, falling back to slot 1 for anything out of range (§12.2).
    public func accentSlot(_ slot: Int) -> ThemeAccentSlot {
        accentSlots.first { $0.slot == slot } ?? accentSlots[0]
    }
}
