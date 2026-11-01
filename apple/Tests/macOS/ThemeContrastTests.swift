import CupertinoUI
import Testing

/// WCAG contrast floors for every text-on-background pair the Mac shell draws.
///
/// The values come from `ThemeTokens`, which is generated from
/// `docs/design/themes/tokens.json`, so this measures exactly what ships. The
/// maths is WCAG 2.x relative luminance, in `ThemeColor`.
///
/// themes-spec.md §15 sets the floors. The shell only draws body text, so 4.5:1
/// is the bar everywhere here; `textPrimary` on the page actually has a 7:1
/// floor and is checked at that too. `textTertiary` is deliberately absent: it
/// is under 4.5:1 by design and is only ever a placeholder (§3 rule 10).
@Suite("Theme contrast")
struct ThemeContrastTests {
    /// The shell is Paper-only until the picker lands in Moss 2.
    private static let palette = ThemeTokens.palette(.paper)

    /// All four sets: the shell swaps palettes under Increase Contrast too.
    private static let sets: [ThemeSet] = ThemeSet.allCases

    /// The surfaces the shell puts text on.
    ///
    /// - `background` is the detail column and the Settings panes.
    /// - `surface` is the next step up the ladder.
    /// - `surfaceRaised` is the solid chrome: the Reduce Transparency /
    ///   Increase Contrast sidebar and toolbar, and the Omnisearch panel. The
    ///   sidebar's solid surface *is* `surfaceRaised`, so it is the same check.
    private static let surfaceRoles: [ThemeRole] = [
        .background,
        .surface,
        .surfaceRaised,
    ]

    private static let textRoles: [ThemeRole] = [.textPrimary, .textSecondary]

    private static let bodyTextFloor = 4.5
    private static let enhancedTextFloor = 7.0

    @Test(
        "textPrimary and textSecondary clear 4.5:1 on every surface the shell uses",
        arguments: ThemeSet.allCases
    )
    func textOnSurfaces(set: ThemeSet) {
        let roles = Self.palette.roles(for: set)

        for textRole in Self.textRoles {
            for surfaceRole in Self.surfaceRoles {
                let ratio = roles[textRole].contrastRatio(against: roles[surfaceRole])
                #expect(
                    ratio >= Self.bodyTextFloor,
                    """
                    Paper \(set.rawValue): \(textRole.rawValue) \
                    \(roles[textRole].hexString) on \(surfaceRole.rawValue) \
                    \(roles[surfaceRole].hexString) is \(ratio), under \
                    \(Self.bodyTextFloor):1
                    """
                )
            }
        }
    }

    @Test(
        "textPrimary clears the enhanced 7:1 floor on the page and the raised surface",
        arguments: ThemeSet.allCases
    )
    func primaryTextIsEnhanced(set: ThemeSet) {
        let roles = Self.palette.roles(for: set)

        for surfaceRole in [ThemeRole.background, .surfaceRaised] {
            let ratio = roles.textPrimary.contrastRatio(against: roles[surfaceRole])
            #expect(
                ratio >= Self.enhancedTextFloor,
                """
                Paper \(set.rawValue): textPrimary on \(surfaceRole.rawValue) is \
                \(ratio), under \(Self.enhancedTextFloor):1
                """
            )
        }
    }

    /// The selected sidebar row: `onAccent` on `accent`, for every slot, since
    /// the slot number is what the user picks (§3 rule 2).
    @Test("onAccent clears 4.5:1 on its accent, in every slot", arguments: ThemeSet.allCases)
    func onAccentOnAccent(set: ThemeSet) {
        for slot in Self.palette.accentSlots {
            let value = slot.value(for: set)
            let ratio = value.onAccent.contrastRatio(against: value.color)
            #expect(
                ratio >= Self.bodyTextFloor,
                """
                Paper \(set.rawValue) slot \(slot.slot) (\(slot.name)): onAccent \
                \(value.onAccent.hexString) on accent \(value.color.hexString) is \
                \(ratio), under \(Self.bodyTextFloor):1
                """
            )
        }
    }

    /// §6: every accent reaches 4.5:1 on the page in every set, so the accent is
    /// safe as text and as a 1 pt mark, not just as a fill.
    @Test("Every accent clears 4.5:1 on the page", arguments: ThemeSet.allCases)
    func accentOnBackground(set: ThemeSet) {
        let roles = Self.palette.roles(for: set)

        for slot in Self.palette.accentSlots {
            let accent = slot.value(for: set).color
            let ratio = accent.contrastRatio(against: roles.background)
            #expect(
                ratio >= Self.bodyTextFloor,
                """
                Paper \(set.rawValue) slot \(slot.slot) (\(slot.name)): accent \
                \(accent.hexString) on background \(roles.background.hexString) is \
                \(ratio), under \(Self.bodyTextFloor):1
                """
            )
        }
    }

    /// The exact pairs the shell draws, named one by one, so a regression says
    /// which bit of UI broke rather than which role did.
    @Test("Every pair the Mac shell draws, by name", arguments: ThemeSet.allCases)
    func theShellsOwnPairs(set: ThemeSet) {
        let theme = ThemeTokens.resolve(.default, set: set)
        let roles = theme.roles

        let pairs: [(what: String, foreground: ThemeColor, background: ThemeColor)] = [
            ("the detail title", roles.textPrimary, roles.background),
            ("the detail's scripture line", roles.textPrimary, roles.background),
            ("the detail's secondary lines", roles.textSecondary, roles.background),
            ("an unselected sidebar row", roles.textPrimary, roles.surfaceRaised),
            ("the sidebar section headers", roles.textSecondary, roles.surfaceRaised),
            ("\"Nothing yet\"", roles.textSecondary, roles.surfaceRaised),
            ("the selected sidebar row", theme.onAccentColor, theme.accentColor),
            ("the Omnisearch field", roles.textPrimary, roles.surfaceRaised),
            ("the Omnisearch footer", roles.textSecondary, roles.surfaceRaised),
            ("the Settings pane title", roles.textPrimary, roles.background),
            ("the Settings placeholder text", roles.textSecondary, roles.background),
        ]

        for pair in pairs {
            let ratio = pair.foreground.contrastRatio(against: pair.background)
            #expect(
                ratio >= Self.bodyTextFloor,
                """
                Paper \(set.rawValue): \(pair.what) is \
                \(pair.foreground.hexString) on \(pair.background.hexString) at \
                \(ratio), under \(Self.bodyTextFloor):1
                """
            )
        }
    }

    // MARK: The maths itself

    @Test("Relative luminance matches the WCAG reference values")
    func luminanceReferenceValues() {
        #expect(ThemeColor(hex: 0x000000).relativeLuminance == 0)
        #expect(abs(ThemeColor(hex: 0xFFFFFF).relativeLuminance - 1) < 1e-12)
        // sRGB mid grey #808080 linearises to 0.2158605…
        #expect(abs(ThemeColor(hex: 0x808080).relativeLuminance - 0.215_860_500_5) < 1e-9)
    }

    @Test("Contrast ratio matches the WCAG reference values")
    func contrastReferenceValues() {
        let black = ThemeColor(hex: 0x000000)
        let white = ThemeColor(hex: 0xFFFFFF)

        #expect(abs(white.contrastRatio(against: black) - 21) < 1e-9)
        // Symmetric.
        #expect(black.contrastRatio(against: white) == white.contrastRatio(against: black))
        #expect(white.contrastRatio(against: white) == 1)
        // #767676 on white is the canonical "just clears 4.5:1" boundary case,
        // and #777777 is the first grey that misses it.
        #expect(abs(ThemeColor(hex: 0x767676).contrastRatio(against: white) - 4.5424) < 0.001)
        #expect(ThemeColor(hex: 0x767676).contrastRatio(against: white) >= 4.5)
        #expect(ThemeColor(hex: 0x777777).contrastRatio(against: white) < 4.5)
    }

    /// An arbitrary value, not a theme colour: theme hex lives only in the
    /// generated `ThemeTokens.swift`.
    @Test("Channels and the hex string round-trip")
    func channelsRoundTrip() {
        let color = ThemeColor(hex: 0x1234_56)
        #expect(color.hexString == "#123456")
        #expect(abs(color.red - 18.0 / 255) < 1e-12)
        #expect(abs(color.green - 52.0 / 255) < 1e-12)
        #expect(abs(color.blue - 86.0 / 255) < 1e-12)

        // Paper slot 1 is Terracotta; its hex comes from the tokens, never from
        // a literal here.
        let terracotta = ThemeTokens.palette(.paper).accentSlot(1).light.color
        #expect(terracotta.hexString.hasPrefix("#"))
        #expect(terracotta.hexString.count == 7)
    }
}
