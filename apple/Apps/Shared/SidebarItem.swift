import SwiftUI

/// The four top-level places in Berean. Shared by every Apple platform: the
/// Mac sidebar and Go menu, and later the iPhone tab bar and iPad sidebar.
enum SidebarItem: String, CaseIterable, Hashable, Codable, Identifiable {
    case read
    case studyspace
    case notes
    case library

    var id: String { rawValue }

    /// Shown in the sidebar, the Go menu, and the detail placeholder.
    var title: String {
        switch self {
        case .read: "Read"
        case .studyspace: "Studyspace"
        case .notes: "Notes"
        case .library: "Library"
        }
    }

    /// SF Symbol for the sidebar row and menu item.
    var symbolName: String {
        switch self {
        case .read: "book"
        case .studyspace: "square.on.square.dashed"
        case .notes: "note.text"
        case .library: "books.vertical"
        }
    }

    /// The digit this item answers to, as ⌘1–⌘4 on Mac (Ctrl+1–4 elsewhere).
    var keyboardDigit: Int {
        switch self {
        case .read: 1
        case .studyspace: 2
        case .notes: 3
        case .library: 4
        }
    }
}
