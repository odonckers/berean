import SwiftUI

/// Settings (⌘,). Two panes for now; Appearance grows the theme, accent and
/// appearance pickers in Moss 2 (themes-spec.md §4).
struct MacSettingsView: View {
    var body: some View {
        TabView {
            Tab("General", systemImage: "gearshape") {
                SettingsPlaceholder(
                    title: "General",
                    detail: "General settings come with the reader."
                )
            }
            Tab("Appearance", systemImage: "paintpalette") {
                SettingsPlaceholder(
                    title: "Appearance",
                    detail: "Theme, accent and appearance pickers come in Moss 2."
                )
            }
        }
        .frame(width: 520, height: 320)
    }
}

private struct SettingsPlaceholder: View {
    let title: String
    let detail: String

    @Environment(\.macTheme) private var theme

    var body: some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(theme.textPrimary)

            Text(detail)
                .font(.callout)
                .foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // An explicit token surface, so the text above is measurably
        // `textSecondary` on `background` rather than on whatever the Settings
        // window happens to draw.
        .background(theme.background)
    }
}
