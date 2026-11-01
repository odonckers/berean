import SwiftUI

/// Turning a stored choice into the colours to draw with.
///
/// This is themes-spec.md §12.2, verbatim:
///
/// ```
/// set     = (appearance == automatic ? systemScheme : appearance)
///           + (systemIncreaseContrast ? "IC" : "")
/// roles   = themes[theme].modes[set]
/// accent  = themes[theme].accents.slots[accentChoice].modes[set]
/// focus   = accent.hex
/// ```
///
/// Unknown or out-of-range stored values fall back to the defaults: Paper,
/// slot 1, Automatic (§12.2, §12.3).

// MARK: - The stored choice

/// The value behind the `berean.appearance` defaults key (§12.3).
///
/// The slot *number* is stored, never a hex, so token updates take effect
/// without migrating anything.
public struct ThemeSelection: Hashable, Codable, Sendable {
    public var theme: ThemeID
    public var accentSlot: Int
    public var appearance: ThemeAppearance

    /// Every device starts here (§3 rule 3).
    public static let `default` = ThemeSelection(
        theme: ThemeTokens.defaultTheme,
        accentSlot: ThemeTokens.defaultAccentSlot,
        appearance: ThemeTokens.defaultAppearance
    )

    public init(
        theme: ThemeID = ThemeTokens.defaultTheme,
        accentSlot: Int = ThemeTokens.defaultAccentSlot,
        appearance: ThemeAppearance = ThemeTokens.defaultAppearance
    ) {
        self.theme = theme
        // Out of range falls back to the default slot rather than trapping.
        self.accentSlot = (1...6).contains(accentSlot)
            ? accentSlot
            : ThemeTokens.defaultAccentSlot
        self.appearance = appearance
    }
}

// MARK: - Picking the set

public extension ThemeSet {
    /// Pick the set from the appearance choice, the system's light/dark state
    /// and the system's Increase Contrast setting (§12.1, §12.2).
    ///
    /// `systemIsDark` is only consulted under `.automatic`. On macOS the caller
    /// passes `NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast`
    /// for `increaseContrast`; on iOS, `colorSchemeContrast == .increased`.
    static func resolve(
        appearance: ThemeAppearance,
        systemIsDark: Bool,
        increaseContrast: Bool
    ) -> ThemeSet {
        let isDark: Bool
        switch appearance {
        case .automatic: isDark = systemIsDark
        case .light: isDark = false
        case .dark: isDark = true
        }

        switch (isDark, increaseContrast) {
        case (false, false): return .light
        case (true, false): return .dark
        case (false, true): return .lightIC
        case (true, true): return .darkIC
        }
    }

    /// Convenience for SwiftUI, which hands out `ColorScheme` and
    /// `ColorSchemeContrast`.
    static func resolve(
        appearance: ThemeAppearance,
        colorScheme: ColorScheme,
        contrast: ColorSchemeContrast
    ) -> ThemeSet {
        resolve(
            appearance: appearance,
            systemIsDark: colorScheme == .dark,
            increaseContrast: contrast == .increased
        )
    }

    /// The same set in the other contrast mode, so a caller holding one set can
    /// reach its Increase Contrast twin without re-resolving.
    var increasedContrast: ThemeSet {
        switch self {
        case .light, .lightIC: .lightIC
        case .dark, .darkIC: .darkIC
        }
    }

    var isDark: Bool {
        switch self {
        case .dark, .darkIC: true
        case .light, .lightIC: false
        }
    }
}

// MARK: - The resolved colours

/// Everything a view needs to draw, once a `ThemeSelection` and the system's
/// state are known.
public struct ResolvedTheme: Hashable, Sendable {
    public let selection: ThemeSelection
    public let set: ThemeSet
    public let palette: ThemePalette
    public let roles: ThemeRoles
    /// The chosen accent slot in this set.
    public let accent: ThemeAccentSlot

    /// The accent's fill.
    public var accentColor: ThemeColor { accent.value(for: set).color }
    /// What reads on top of the accent at 4.5:1 or better (7:1 in IC).
    public var onAccentColor: ThemeColor { accent.value(for: set).onAccent }
    /// §3 rule 9: the focus ring follows the *chosen* accent, not slot 1.
    public var focusRing: ThemeColor { accentColor }

    public subscript(role: ThemeRole) -> ThemeColor {
        switch role {
        // The two accent roles follow the chosen slot; `roles.accent` is slot 1.
        case .accent, .focusRing: accentColor
        case .onAccent: onAccentColor
        default: roles[role]
        }
    }
}

public extension ThemeTokens {
    /// Resolve a stored choice against the system's state (§12.2).
    static func resolve(
        _ selection: ThemeSelection = .default,
        set: ThemeSet
    ) -> ResolvedTheme {
        let palette = palette(selection.theme)
        return ResolvedTheme(
            selection: selection,
            set: set,
            palette: palette,
            roles: palette.roles(for: set),
            accent: palette.accentSlot(selection.accentSlot)
        )
    }

    /// Resolve a stored choice against the system's light/dark and Increase
    /// Contrast state.
    static func resolve(
        _ selection: ThemeSelection = .default,
        systemIsDark: Bool,
        increaseContrast: Bool
    ) -> ResolvedTheme {
        resolve(
            selection,
            set: ThemeSet.resolve(
                appearance: selection.appearance,
                systemIsDark: systemIsDark,
                increaseContrast: increaseContrast
            )
        )
    }

    /// `preferredColorScheme` for an appearance choice: `nil` under Automatic
    /// so the system decides (§12.1).
    static func preferredColorScheme(
        for appearance: ThemeAppearance
    ) -> ColorScheme? {
        switch appearance {
        case .automatic: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
