import SwiftUI

/// Settings (⌘,). Two panes for now; Appearance grows the theme, accent and
/// appearance pickers once the generated theme tokens land.
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

    var body: some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.headline)
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
