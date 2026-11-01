@testable import Berean
import Testing

/// `WindowModel` is per-window state: the selection, the back/forward stack it
/// keeps in step, and the search text the ⌘K palette carries over.
@Suite("WindowModel")
@MainActor
struct WindowModelTests {
    @Test("A fresh window starts on Read with no history")
    func freshWindow() {
        let model = WindowModel()
        #expect(model.selection == .read)
        #expect(model.history.current == .read)
        #expect(!model.canGoBack)
        #expect(!model.canGoForward)
        #expect(!model.isPaletteOpen)
        #expect(model.searchText.isEmpty)
    }

    /// The window title is the section's title (`.navigationTitle`), so these
    /// are the four titles the title bar shows.
    @Test("The selection's title is what the window titles itself")
    func selectionTitles() {
        let model = WindowModel()
        let expected: [SidebarItem: String] = [
            .read: "Read",
            .studyspace: "Studyspace",
            .notes: "Notes",
            .library: "Library",
        ]

        for (item, title) in expected {
            model.select(item)
            #expect(model.selection.title == title)
        }
    }

    @Test("⌘1–⌘4 map to the four sections in order")
    func keyboardDigits() {
        #expect(SidebarItem.allCases.map(\.keyboardDigit) == [1, 2, 3, 4])
        #expect(SidebarItem.allCases == [.read, .studyspace, .notes, .library])
    }

    @Test("Selecting records a hop and keeps selection and history in step")
    func selectRecords() {
        let model = WindowModel()
        model.select(.notes)

        #expect(model.selection == .notes)
        #expect(model.history.current == .notes)
        #expect(model.canGoBack)
        #expect(!model.canGoForward)
    }

    @Test("Reselecting the current section records nothing")
    func reselectIsANoOp() {
        let model = WindowModel()
        model.select(.read)

        #expect(!model.canGoBack)
        #expect(model.history.back.isEmpty)
    }

    @Test("Back and forward move the selection without recording")
    func backAndForward() {
        let model = WindowModel()
        model.select(.studyspace)
        model.select(.library)

        model.goBack()
        #expect(model.selection == .studyspace)
        #expect(model.canGoForward)

        model.goForward()
        #expect(model.selection == .library)
        #expect(!model.canGoForward)
    }

    @Test("Back at the start of the stack changes nothing")
    func backAtTheStart() {
        let model = WindowModel()
        model.goBack()

        #expect(model.selection == .read)
        #expect(!model.canGoBack)
    }

    /// Restoration — scene storage, and the DEBUG section override — lands on a
    /// section without inventing history for it.
    @Test("Restore lands on a section with a clean history")
    func restoreResetsHistory() {
        let model = WindowModel()
        model.select(.notes)
        model.select(.library)

        model.restore(.studyspace)

        #expect(model.selection == .studyspace)
        #expect(model.history.current == .studyspace)
        #expect(!model.canGoBack)
        #expect(!model.canGoForward)
    }

    @Test("The palette opens and closes without touching the query")
    func palette() {
        let model = WindowModel()
        model.searchText = "psalm 23"

        model.openPalette()
        #expect(model.isPaletteOpen)
        #expect(model.searchText == "psalm 23")

        model.closePalette()
        #expect(!model.isPaletteOpen)
        #expect(model.searchText == "psalm 23")
    }

    @Test("Two windows navigate independently")
    func windowsAreIndependent() {
        let first = WindowModel()
        let second = WindowModel()

        first.select(.notes)

        #expect(first.selection == .notes)
        #expect(second.selection == .read)
        #expect(!second.canGoBack)
    }
}
