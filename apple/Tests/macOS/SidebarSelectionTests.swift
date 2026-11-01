import AppKit
import SwiftUI
import Testing

@testable import Berean

/// The selected sidebar row's geometry and the AppKit bridge behind it.
///
/// These tests render real `NSHostingView`s in an off-screen window, because
/// both facts under test only exist once AppKit has built the table behind the
/// `List`: the system highlight's measurements, and whether our bridge actually
/// reaches that table.
@MainActor
@Suite("Sidebar selection")
struct SidebarSelectionTests {
    /// The sidebar's ideal width, which is what the measurements assume.
    private static let sidebarWidth: CGFloat = 220

    // MARK: Hosting

    /// Puts a view in an off-screen window and lets AppKit settle, so the table
    /// behind the `List` exists and has laid its rows out.
    private func host<Content: View>(_ view: Content, width: CGFloat) async throws -> NSView {
        let hosting = NSHostingView(rootView: view)
        let frame = NSRect(x: 0, y: 0, width: width, height: 760)
        hosting.frame = frame
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.contentView = hosting

        for _ in 0..<3 {
            window.layoutIfNeeded()
            hosting.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(200))
        }
        return hosting
    }

    private func firstTable(in view: NSView) -> NSTableView? {
        if let table = view as? NSTableView { return table }
        for subview in view.subviews {
            if let found = firstTable(in: subview) { return found }
        }
        return nil
    }

    private func selectedRowView(of table: NSTableView) -> NSTableRowView? {
        guard table.selectedRow >= 0 else { return nil }
        return table.rowView(atRow: table.selectedRow, makeIfNecessary: false)
    }

    // MARK: The constants themselves

    @Test("The selection shape's constants are the documented values")
    func constants() {
        #expect(SidebarSelectionMetrics.horizontalInset == 10)
        #expect(SidebarSelectionMetrics.cornerRadius == 8)
        #expect(SidebarSelectionMetrics.rowHeight == 32)
    }

    // MARK: Measured against the system

    /// A plain sidebar `List` with the system highlight left alone, purely so
    /// the highlight can be measured.
    private struct NativeProbe: View {
        var body: some View {
            List(selection: .constant("b")) {
                Section {
                    ForEach(["a", "b", "c"], id: \.self) { item in
                        Label(item, systemImage: "book").tag(item)
                    }
                } header: {
                    Text("Berean")
                }
            }
            .listStyle(.sidebar)
        }
    }

    /// The one test that would catch macOS changing the sidebar's selection
    /// shape under us: it measures the view AppKit inserts for the selected row
    /// and compares it with `SidebarSelectionMetrics`.
    @Test("The constants match the live macOS sidebar highlight")
    func matchesTheSystemHighlight() async throws {
        let hosting = try await host(NativeProbe(), width: Self.sidebarWidth)
        let table = try #require(firstTable(in: hosting), "no NSTableView behind the List")
        // Whatever style SwiftUI picks for a sidebar — `.sourceList` today —
        // the probe's point is that it is *not* `.none`, so AppKit is still
        // drawing the highlight being measured.
        #expect(
            table.selectionHighlightStyle != .none,
            "the probe is meant to keep the system highlight on"
        )

        let row = try #require(selectedRowView(of: table), "no selected row view")
        #expect(row.frame.height == SidebarSelectionMetrics.rowHeight)

        let highlight = try #require(
            row.subviews.first { $0 is NSVisualEffectView },
            "AppKit drew no selection highlight for the selected row"
        )

        #expect(
            highlight.frame.minX == SidebarSelectionMetrics.horizontalInset,
            """
            the system highlight starts at x \(highlight.frame.minX), not \
            \(SidebarSelectionMetrics.horizontalInset)
            """
        )
        #expect(
            highlight.frame.width
                == Self.sidebarWidth - 2 * SidebarSelectionMetrics.horizontalInset,
            """
            the system highlight is \(highlight.frame.width) pt wide in a \
            \(Self.sidebarWidth) pt sidebar
            """
        )
        #expect(highlight.frame.height == SidebarSelectionMetrics.rowHeight)

        let layer = try #require(highlight.layer, "the highlight has no layer to measure")
        #expect(
            layer.cornerRadius == SidebarSelectionMetrics.cornerRadius,
            "the system highlight's radius is \(layer.cornerRadius)"
        )
        #expect(layer.cornerCurve == .continuous)
    }

    // MARK: The shell's own sidebar

    /// The root fix, end to end: the shell's sidebar must leave AppKit drawing
    /// no selection of its own, while `List(selection:)` still holds the
    /// selection — which is what keeps arrow keys, type-select, Full Keyboard
    /// Access and the VoiceOver selected trait working.
    @Test("The shell's sidebar turns the system highlight off and keeps selection")
    func shellDisablesTheSystemHighlight() async throws {
        let hosting = try await host(
            ThemedScene { MacRootView() },
            width: 1200
        )
        let table = try #require(firstTable(in: hosting), "no NSTableView behind the sidebar List")

        #expect(
            table.selectionHighlightStyle == .none,
            "the sidebar's table still draws its own selection highlight"
        )

        // Selection semantics are untouched: the table still knows which row is
        // selected, and the row still reports itself selected.
        #expect(table.selectedRow >= 0, "the sidebar lost its selection")
        let row = try #require(selectedRowView(of: table), "no selected row view")
        #expect(row.isSelected)

        // And AppKit inserted no highlight view into it.
        #expect(
            !row.subviews.contains { $0 is NSVisualEffectView },
            "AppKit still inserted a selection highlight view into the selected row"
        )
    }
}
