import SwiftUI

/// Omnisearch's second way in: ⌘K shows the same search as a centered palette,
/// carrying over whatever is in the toolbar field.
///
/// Placeholder for now — results land in Moss 5. The scrim is a flat warm
/// color at 45%, with no blur, and the panel is an opaque surface: content is
/// never glass.
struct OmnisearchPalette: View {
    @Binding var query: String
    let close: () -> Void

    @FocusState private var isFieldFocused: Bool

    private static let width: CGFloat = 660
    private static let cornerRadius: CGFloat = 16

    var body: some View {
        ZStack {
            SolidChrome.scrimWarm
                .ignoresSafeArea()
                .onTapGesture(perform: close)

            VStack(alignment: .leading, spacing: 0) {
                TextField("Search Berean", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($isFieldFocused)
                    .onSubmit(close)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)

                Divider()

                Text("Results come in Moss 5")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 24)
            }
            .frame(width: Self.width)
            .background(SolidChrome.surfaceRaised, in: shape)
            .overlay { shape.stroke(SolidChrome.outline, lineWidth: 1) }
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
