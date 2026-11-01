import SwiftUI

/// The menu bar. Everything here acts on the key window's `WindowModel`,
/// reached through `@FocusedValue`, and is disabled when no window is key.
struct MacCommands: Commands {
    @FocusedValue(\.windowModel) private var model

    var body: some Commands {
        // System-supplied groups: Hide Sidebar, Customize Toolbar, and the
        // standard Edit items.
        SidebarCommands()
        ToolbarCommands()
        TextEditingCommands()

        // View, after Customize Toolbar.
        CommandGroup(after: .toolbar) {
            Divider()
            Button("Toggle Reading Pane") {
                // The reader and its inline study pane arrive in Moss 4.
            }
            .keyboardShortcut("\\", modifiers: .command)
            .disabled(true)
        }

        // Edit, next to the find items. ⌘K opens Omnisearch as a palette with
        // the toolbar's query already in it.
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Search…") {
                model?.openPalette()
            }
            .keyboardShortcut("k", modifiers: .command)
            .disabled(model == nil)
        }

        CommandMenu("Go") {
            Button("Back") {
                model?.goBack()
            }
            .keyboardShortcut("[", modifiers: .command)
            .disabled(!(model?.canGoBack ?? false))

            Button("Forward") {
                model?.goForward()
            }
            .keyboardShortcut("]", modifiers: .command)
            .disabled(!(model?.canGoForward ?? false))

            Divider()

            ForEach(SidebarItem.allCases) { item in
                Button(item.title) {
                    model?.select(item)
                }
                .keyboardShortcut(
                    KeyEquivalent(Character("\(item.keyboardDigit)")),
                    modifiers: .command
                )
                .disabled(model == nil)
            }
        }
    }
}
