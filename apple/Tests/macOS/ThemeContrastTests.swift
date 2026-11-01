import CupertinoUI
import Testing

/// WCAG contrast floors for every foreground-on-background pair the Mac shell
/// draws.
///
/// The values come from `ThemeTokens`, which is generated from
/// `docs/design/themes/tokens.json`, so this measures exactly what ships. The
/// maths is WCAG 2.x relative luminance, in `ThemeColor`.
///
/// themes-spec.md §15 sets the floors. Three bars are in play:
///
/// - **4.5:1** for body text, which is nearly everything the shell draws.
/// - **7:1** for `textPrimary` on the page and on the raised surface.
/// - **3:1** for the sidebar's SF Symbols, which are non-text graphics
///   (WCAG 1.4.11) rather than text.
///
/// `textTertiary` is deliberately absent: it is under 4.5:1 by design and is
/// only ever a placeholder (§3 rule 10).
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

    /// WCAG 2.2 [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast):
    /// icons and other non-text graphics need 3:1, not 4.5:1. The sidebar's SF
    /// Symbols are measured against this.
    private static let nonTextFloor = 3.0

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

    /// The selected sidebar row's **icon**: the SF Symbol is drawn in `onAccent`
    /// on the accent fill, so it is a non-text graphic and WCAG 1.4.11's 3:1 is
    /// its floor. Checked separately from the row's text because the icon is
    /// what Lumen's review caught being drawn #FFFFFF by AppKit's emphasised
    /// selection (2.27:1 on Paper dark's accent); the token always passed, so
    /// this test is the floor the drawing now has to hold.
    ///
    /// Every slot and every set, since the slot number is what the user picks
    /// (§3 rule 2) and the shell swaps palettes under Increase Contrast.
    @Test(
        "The selected row's icon clears the 3:1 non-text floor, in every slot",
        arguments: ThemeSet.allCases
    )
    func iconOnAccent(set: ThemeSet) {
        for slot in Self.palette.accentSlots {
            let value = slot.value(for: set)
            let ratio = value.onAccent.contrastRatio(against: value.color)
            #expect(
                ratio >= Self.nonTextFloor,
                """
                Paper \(set.rawValue) slot \(slot.slot) (\(slot.name)): the selected \
                row's icon is onAccent \(value.onAccent.hexString) on accent \
                \(value.color.hexString) at \(ratio), under \(Self.nonTextFloor):1
                """
            )
        }
    }

    /// The unselected sidebar row's **icon**: `textSecondary` on the sidebar's
    /// solid surface, also a non-text graphic at 3:1. §3 rule 6 keeps icons
    /// monochrome in `textPrimary` or `textSecondary` rather than the system
    /// grey, and `textSecondary` already clears 4.5:1 as text, so this is a
    /// regression guard rather than a tight floor.
    @Test(
        "The unselected row's icon clears the 3:1 non-text floor",
        arguments: ThemeSet.allCases
    )
    func unselectedIconOnSidebar(set: ThemeSet) {
        let roles = Self.palette.roles(for: set)
        let ratio = roles.textSecondary.contrastRatio(against: roles.surfaceRaised)
        #expect(
            ratio >= Self.nonTextFloor,
            """
            Paper \(set.rawValue): the unselected row's icon is textSecondary \
            \(roles.textSecondary.hexString) on surfaceRaised \
            \(roles.surfaceRaised.hexString) at \(ratio), under \(Self.nonTextFloor):1
            """
        )
    }

    /// The selected sidebar row's **text**: `onAccent` on `accent` at the body
    /// text floor, for every slot, since the slot number is what the user picks
    /// (§3 rule 2). §15 puts `onAccent` on `accent` at 4.5:1.
    @Test(
        "The selected row's text clears 4.5:1 on its accent, in every slot",
        arguments: ThemeSet.allCases
    )
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

    /// One pair the shell actually draws, with the floor that pair has to meet.
    ///
    /// The floor travels with the pair rather than being one value for the whole
    /// test, because the shell draws two kinds of thing: text, at 4.5:1 (§15),
    /// and icons, at WCAG 1.4.11's 3:1.
    private struct ShellPair {
        let what: String
        let foreground: ThemeColor
        let background: ThemeColor
        let floor: Double

        static func text(
            _ what: String,
            _ foreground: ThemeColor,
            on background: ThemeColor
        ) -> ShellPair {
            ShellPair(
                what: what,
                foreground: foreground,
                background: background,
                floor: ThemeContrastTests.bodyTextFloor
            )
        }

        static func icon(
            _ what: String,
            _ foreground: ThemeColor,
            on background: ThemeColor
        ) -> ShellPair {
            ShellPair(
                what: what,
                foreground: foreground,
                background: background,
                floor: ThemeContrastTests.nonTextFloor
            )
        }
    }

    /// The exact pairs the shell draws, named one by one, so a regression says
    /// which bit of UI broke rather than which role did.
    @Test("Every pair the Mac shell draws, by name", arguments: ThemeSet.allCases)
    func theShellsOwnPairs(set: ThemeSet) {
        let theme = ThemeTokens.resolve(.default, set: set)
        let roles = theme.roles

        let pairs: [ShellPair] = [
            .text("the detail title", roles.textPrimary, on: roles.background),
            .text("the detail's scripture line", roles.textPrimary, on: roles.background),
            .text("the detail's secondary lines", roles.textSecondary, on: roles.background),
            .text("an unselected sidebar row", roles.textPrimary, on: roles.surfaceRaised),
            .icon(
                "an unselected sidebar row's icon",
                roles.textSecondary,
                on: roles.surfaceRaised
            ),
            .text("the sidebar section headers", roles.textSecondary, on: roles.surfaceRaised),
            .text("\"Nothing yet\"", roles.textSecondary, on: roles.surfaceRaised),
            .text("the selected sidebar row", theme.onAccentColor, on: theme.accentColor),
            .icon(
                "the selected sidebar row's icon",
                theme.onAccentColor,
                on: theme.accentColor
            ),
            .text("the Omnisearch field", roles.textPrimary, on: roles.surfaceRaised),
            .text("the Omnisearch footer", roles.textSecondary, on: roles.surfaceRaised),
            .text("the Settings pane title", roles.textPrimary, on: roles.background),
            .text("the Settings placeholder text", roles.textSecondary, on: roles.background),
        ]

        for pair in pairs {
            let ratio = pair.foreground.contrastRatio(against: pair.background)
            #expect(
                ratio >= pair.floor,
                """
                Paper \(set.rawValue): \(pair.what) is \
                \(pair.foreground.hexString) on \(pair.background.hexString) at \
                \(ratio), under \(pair.floor):1
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
