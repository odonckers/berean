import AppKit
import CupertinoUI
import SwiftUI

/// The Mac shell's colours, resolved from the generated theme tokens.
///
/// No hex value lives here. Every colour comes from `ThemeTokens`, which
/// `apple/scripts/gen-theme-tokens.py` writes from
/// `docs/design/themes/tokens.json`.
///
/// Light and dark are handed to macOS as one dynamic `NSColor` per role, so a
/// single `Color` is correct in both and the view tree does not rebuild when the
/// appearance flips. Increase Contrast is *not* an appearance, so it is baked in
/// when the value is made; `ThemedScene` remakes the theme when the system
/// setting changes (themes-spec.md §12.1).
struct MacTheme: Equatable {
    /// The stored choice. The picker arrives in Moss 2, so this is the default
    /// for now: Paper, accent slot 1 (Terracotta), Automatic.
    let selection: ThemeSelection
    /// `NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast`.
    let increaseContrast: Bool

    init(
        selection: ThemeSelection = .default,
        increaseContrast: Bool = false
    ) {
        self.selection = selection
        self.increaseContrast = increaseContrast
    }

    // MARK: Roles

    /// Content surfaces.
    var background: Color { color(.background) }
    var surface: Color { color(.surface) }
    /// The solid stand-in for Liquid Glass chrome (§3 rule 5).
    var surfaceRaised: Color { color(.surfaceRaised) }

    /// Text. `textTertiary` is placeholders only (§3 rule 10).
    var textPrimary: Color { color(.textPrimary) }
    var textSecondary: Color { color(.textSecondary) }
    var textTertiary: Color { color(.textTertiary) }

    /// Borders that have to read as a boundary. `separator` is decorative.
    var outline: Color { color(.outline) }

    /// The chosen accent slot, and what reads on top of it.
    var accent: Color { color(.accent) }
    var onAccent: Color { color(.onAccent) }

    /// The `selection` role — the unemphasised selection fill, used for the
    /// selected sidebar row while the window is not key — has no named property
    /// of its own: `selection` here is the stored choice, and the sidebar names
    /// its roles through `SidebarRowStyle` and reaches them with `color(_:)`,
    /// which is dynamic in exactly the same way as the properties above.

    /// The scrim behind the Omnisearch palette. Warm ink at 45% in light, plain
    /// black at 32% in dark — generated from tokens.json's `material3` scrims,
    /// the file's only non-opaque values (themes-spec.md §2, §9).
    var scrimWarm: Color {
        dynamic(
            light: resolved(isDark: false).roles.scrimWarm,
            dark: resolved(isDark: true).roles.scrimWarm
        )
    }

    /// Any role, as a dynamic colour.
    func color(_ role: ThemeRole) -> Color {
        dynamic(
            light: resolved(isDark: false)[role],
            dark: resolved(isDark: true)[role]
        )
    }

    /// The set that would be used for a given system appearance. Exposed so
    /// tests and callers can name the exact token set the shell draws with.
    func set(isDark: Bool) -> ThemeSet {
        ThemeSet.resolve(
            appearance: selection.appearance,
            systemIsDark: isDark,
            increaseContrast: increaseContrast
        )
    }

    func resolved(isDark: Bool) -> ResolvedTheme {
        ThemeTokens.resolve(selection, set: set(isDark: isDark))
    }

    /// `preferredColorScheme`: `nil` under Automatic, so the system decides.
    var preferredColorScheme: ColorScheme? {
        ThemeTokens.preferredColorScheme(for: selection.appearance)
    }

    // MARK: Dynamic colours

    private func dynamic(light: ThemeColor, dark: ThemeColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let token = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                ? dark
                : light
            return NSColor(
                srgbRed: CGFloat(token.red),
                green: CGFloat(token.green),
                blue: CGFloat(token.blue),
                alpha: 1
            )
        })
    }

    private func dynamic(light: ThemeScrim, dark: ThemeScrim) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let token = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                ? dark
                : light
            return NSColor(
                srgbRed: CGFloat(token.red) / 255,
                green: CGFloat(token.green) / 255,
                blue: CGFloat(token.blue) / 255,
                alpha: CGFloat(token.alpha)
            )
        })
    }
}

extension EnvironmentValues {
    /// The scene's theme. Set by `ThemedScene`.
    @Entry var macTheme = MacTheme()

    /// True when the chrome must be opaque rather than glass: Reduce
    /// Transparency, Increase Contrast, or the DEBUG-only override
    /// (themes-spec.md §3 rule 5).
    @Entry var macSolidChrome = false
}
