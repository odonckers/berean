import SwiftUI

/// Omnisearch's second way in: ⌘K shows the same search as a centered palette,
/// carrying over whatever is in the toolbar field.
///
/// Placeholder for now — results land in Moss 5. The scrim is the theme's
/// `scrimWarm`, with no blur, and the panel is an opaque `surfaceRaised`:
/// content is never glass.
struct OmnisearchPalette: View {
    @Binding var query: String
    let close: () -> Void

    @FocusState private var isFieldFocused: Bool
    @Environment(\.macTheme) private var theme

    private static let width: CGFloat = 660
    private static let cornerRadius: CGFloat = 16

    var body: some View {
        ZStack {
            theme.scrimWarm
                .ignoresSafeArea()
                .onTapGesture(perform: close)

            VStack(alignment: .leading, spacing: 0) {
                TextField(
                    "Search Berean",
                    text: $query,
                    // The one legitimate `textTertiary`: a placeholder, with
                    // the field's own label right there (§3 rule 10).
                    prompt: Text("Search Berean").foregroundStyle(theme.textTertiary)
                )
                .textFieldStyle(.plain)
                .font(.title3)
                .foregroundStyle(theme.textPrimary)
                .focused($isFieldFocused)
                .onSubmit(close)
                .padding(.horizontal, 20)
                .padding(.vertical, 16)

                Divider()

                Text("Results come in Moss 5")
                    .font(.callout)
                    .foregroundStyle(theme.textSecondary)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 24)
            }
            .frame(width: Self.width)
            .background(theme.surfaceRaised, in: shape)
            .overlay { shape.stroke(theme.outline, lineWidth: 1) }
            .shadow(radius: 24, y: 8)

            // Esc, whether or not the text field has eaten the key event.
            Button("Close", action: close)
                .keyboardShortcut(.cancelAction)
                .opacity(0)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
        .onExitCommand(perform: close)
        .onAppear { isFieldFocused = true }
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
    }
}
