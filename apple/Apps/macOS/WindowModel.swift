import CupertinoUI
import SwiftUI

/// Per-window state. One instance per `MacRootView`, so two windows navigate
/// and search independently, and the menu bar talks to whichever one is key
/// (see `FocusedValues.windowModel`).
@Observable
@MainActor
final class WindowModel {
    /// Where the window is right now. Always in sync with `history.current`.
    var selection: SidebarItem

    /// Back/forward stack over the sidebar items.
    var history: NavigationHistory<SidebarItem>

    /// Whether the ⌘K Omnisearch palette is showing.
    var isPaletteOpen = false

    /// The toolbar search field's query, carried into the palette.
    var searchText = ""

    /// Placeholder: the inline study pane docks to the side in Moss 4.
    var isReadingPaneDocked = false

    init(start: SidebarItem = .read) {
        selection = start
        history = NavigationHistory(start)
    }

    var canGoBack: Bool { history.canGoBack }
    var canGoForward: Bool { history.canGoForward }

    /// A sidebar click or ⌘1–⌘4: records a hop.
    func select(_ item: SidebarItem) {
        guard item != selection else { return }
        history.visit(item)
        selection = item
    }

    /// Scene restoration: land on an item without inventing history for it.
    func restore(_ item: SidebarItem) {
        selection = item
        history = NavigationHistory(item)
    }

    /// Walks the history; does not record.
    func goBack() {
        guard let item = history.goBack() else { return }
        selection = item
    }

    /// Walks the history; does not record.
    func goForward() {
        guard let item = history.goForward() else { return }
        selection = item
    }

    func openPalette() { isPaletteOpen = true }
    func closePalette() { isPaletteOpen = false }
}

extension FocusedValues {
    /// The key window's model, so `MacCommands` acts on the right window.
    @Entry var windowModel: WindowModel?
}
