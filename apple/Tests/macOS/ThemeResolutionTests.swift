import CupertinoUI
import Testing

/// themes-spec.md §12.2: turning a stored choice plus the system's state into
/// the set the app draws with.
@Suite("Theme resolution")
struct ThemeResolutionTests {
    @Test("Automatic follows the system, and Light or Dark overrides it")
    func appearanceDrivesLightAndDark() {
        #expect(
            ThemeSet.resolve(appearance: .automatic, systemIsDark: false, increaseContrast: false)
                == .light
        )
        #expect(
            ThemeSet.resolve(appearance: .automatic, systemIsDark: true, increaseContrast: false)
                == .dark
        )
        // The explicit choices ignore the system scheme entirely.
        #expect(
            ThemeSet.resolve(appearance: .light, systemIsDark: true, increaseContrast: false)
                == .light
        )
        #expect(
            ThemeSet.resolve(appearance: .dark, systemIsDark: false, increaseContrast: false)
                == .dark
        )
    }

    @Test("Increase Contrast selects the IC set of the current mode")
    func increaseContrastSelectsICSets() {
        #expect(
            ThemeSet.resolve(appearance: .automatic, systemIsDark: false, increaseContrast: true)
                == .lightIC
        )
        #expect(
            ThemeSet.resolve(appearance: .automatic, systemIsDark: true, increaseContrast: true)
                == .darkIC
        )
        #expect(
            ThemeSet.resolve(appearance: .light, systemIsDark: true, increaseContrast: true)
                == .lightIC
        )
        #expect(
            ThemeSet.resolve(appearance: .dark, systemIsDark: false, increaseContrast: true)
                == .darkIC
        )
    }

    @Test("The defaults are Paper, slot 1, Automatic")
    func defaults() {
        let selection = ThemeSelection.default
        #expect(selection.theme == .paper)
        #expect(selection.accentSlot == 1)
        #expect(selection.appearance == .automatic)

        let resolved = ThemeTokens.resolve(selection, systemIsDark: false, increaseContrast: false)
        #expect(resolved.set == .light)
        #expect(resolved.palette.id == .paper)
        #expect(resolved.palette.isDefault)
        // Paper slot 1 is Terracotta (§6).
        #expect(resolved.accent.slot == 1)
        #expect(resolved.accent.name == "Terracotta")
    }

    @Test("An out-of-range accent slot falls back to slot 1", arguments: [0, -1, 7, 99])
    func outOfRangeSlotFallsBack(slot: Int) {
        #expect(ThemeSelection(accentSlot: slot).accentSlot == 1)
        #expect(ThemeTokens.palette(.paper).accentSlot(slot).slot == 1)
    }

    @Test("The resolved accent follows the chosen slot, not the token's slot 1")
    func accentFollowsTheChosenSlot() {
        let paper = ThemeTokens.palette(.paper)
        let slotThree = ThemeSelection(theme: .paper, accentSlot: 3, appearance: .light)
        let resolved = ThemeTokens.resolve(slotThree, set: .light)

        // §6: Paper slot 3 is Fern.
        #expect(resolved.accent.name == "Fern")
        #expect(resolved.accentColor == paper.accentSlots[2].light.color)
        #expect(resolved.onAccentColor == paper.accentSlots[2].light.onAccent)
        // §3 rule 9: the ring follows the chosen accent.
        #expect(resolved.focusRing == resolved.accentColor)
        // And the role subscript agrees, rather than handing back slot 1.
        #expect(resolved[.accent] == resolved.accentColor)
        #expect(resolved[.focusRing] == resolved.accentColor)
        #expect(resolved[.accent] != resolved.roles.accent)
        // Non-accent roles come straight from the set.
        #expect(resolved[.background] == resolved.roles.background)
    }

    @Test("Switching theme keeps the slot number")
    func themeSwapKeepsTheSlot() {
        for theme in ThemeID.allCases {
            let resolved = ThemeTokens.resolve(
                ThemeSelection(theme: theme, accentSlot: 3, appearance: .light),
                set: .light
            )
            #expect(resolved.accent.slot == 3)
        }
        // §3 rule 2: slot 3 is Fern in Paper and Lake in Sage.
        #expect(ThemeTokens.palette(.paper).accentSlot(3).name == "Fern")
        #expect(ThemeTokens.palette(.sage).accentSlot(3).name == "Lake")
    }

    @Test("preferredColorScheme is nil under Automatic")
    func preferredColorScheme() {
        #expect(ThemeTokens.preferredColorScheme(for: .automatic) == nil)
        #expect(ThemeTokens.preferredColorScheme(for: .light) == .light)
        #expect(ThemeTokens.preferredColorScheme(for: .dark) == .dark)
    }

    @Test("Highlights are reachable by colour name and stay in display order")
    func highlightsByName() {
        for theme in ThemeID.allCases {
            for set in ThemeSet.allCases {
                let roles = ThemeTokens.palette(theme).roles(for: set)
                #expect(roles.highlights.map(\.key) == HighlightKey.allCases)
                for key in HighlightKey.allCases {
                    #expect(roles.highlight(key).key == key)
                }
            }
        }
    }

    @Test("Accent dots speak their name and role")
    func accentSpokenNames() {
        // §5: "Terracotta, accent, selected" — the platform adds "selected".
        #expect(ThemeTokens.palette(.paper).accentSlot(1).spokenName == "Terracotta, accent")
    }
}
