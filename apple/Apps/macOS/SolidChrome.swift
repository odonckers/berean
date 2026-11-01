import AppKit
import SwiftUI

/// Temporary Paper-theme constants for the Mac shell.
///
/// These are hand-copied from `docs/design/themes/tokens.json`, the Paper
/// theme's `light` and `dark` modes, as dynamic `NSColor`-backed `Color`s so
/// they follow the window's appearance. Only the few roles the shell needs are
/// here; Increase Contrast (`lightIC`/`darkIC`) is deliberately not modelled
/// yet — under Increase Contrast the shell only switches to the solid chrome
/// path, it does not swap palettes.
///
/// Kiwi 2's generated `ThemeTokens.swift` (all four themes, all four modes)
/// replaces this file in Moss 2. Nothing outside the Mac shell should grow a
/// dependency on it.
enum SolidChrome {
    /// Paper `background`: the content surface behind detail views.
    static let background = paperColor(light: 0xFBF7EC, dark: 0x15120E)

    /// Paper `surfaceRaised`: the solid stand-in for Liquid Glass chrome.
    static let surfaceRaised = paperColor(light: 0xFFFCF5, dark: 0x211D18)

    /// Paper `outline`: the 1 pt border that replaces glass edges.
    static let outline = paperColor(light: 0x8B8275, dark: 0x7A7165)

    /// Paper `scrimWarm`, used behind the Omnisearch palette. Warm ink in
    /// light, plain black in dark; the palette asks for 45% in both.
    static let scrimWarm = paperColor(light: 0x1F1A14, dark: 0x000000, alpha: 0.45)

    private static func paperColor(
        light: UInt32,
        dark: UInt32,
        alpha: CGFloat = 1
    ) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let hex = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            return NSColor(
                srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: alpha
            )
        })
    }
}
