import AppKit
import CupertinoUI
import SwiftUI

/// The root of every Berean Mac scene.
///
/// It does three things, and every scene needs all three:
///
/// 1. Resolves the theme set from the appearance choice, the window's light or
///    dark appearance and the system's Increase Contrast setting, and publishes
///    it as `\.macTheme` (themes-spec.md §12.1, §12.2).
/// 2. Decides glass vs. solid chrome and publishes it as `\.macSolidChrome`
///    (§3 rule 5).
/// 3. Tints the scene with the theme's accent — Paper slot 1, Terracotta — so
///    Berean never shows the Mac's own accent colour. §10 makes the System
///    accent strictly opt-in, and the picker that opts in arrives in Moss 2, so
///    until then the theme accent is the only accent.
///
/// It reads system settings and never writes one.
struct ThemedScene<Content: View>: View {
    @ViewBuilder var content: Content

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    /// Increase Contrast is not an appearance, so SwiftUI does not hand it over
    /// on macOS. It is read from `NSWorkspace` and kept current by the
    /// accessibility-options notification (§12.1).
    @State private var increaseContrast = false

    /// Moss 2 replaces this with the stored `berean.appearance` value (§12.3).
    private let selection = ThemeSelection.default

    var body: some View {
        let theme = MacTheme(selection: selection, increaseContrast: increaseContrast)

        content
            .environment(\.macTheme, theme)
            .environment(\.macSolidChrome, wantsSolidChrome)
            .tint(theme.accent)
            .preferredColorScheme(theme.preferredColorScheme)
            .onAppear(perform: readIncreaseContrast)
            .onReceive(NSWorkspace.shared.notificationCenter.publisher(
                for: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification
            )) { _ in
                readIncreaseContrast()
            }
    }

    /// True when the chrome must be opaque rather than glass.
    private var wantsSolidChrome: Bool {
        #if DEBUG
        // Debug-only override for design proofs. It reads an env var and
        // nothing else — it never touches a system setting.
        if ProcessInfo.processInfo.environment["BEREAN_FORCE_REDUCE_TRANSPARENCY"] == "1" {
            return true
        }
        #endif
        return reduceTransparency || increaseContrast
    }

    private func readIncreaseContrast() {
        increaseContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
    }
}
