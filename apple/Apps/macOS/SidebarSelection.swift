import AppKit
import CupertinoUI
import SwiftUI

/// The selected sidebar row: Berean's own fill, in the system's shape, with the
/// system's own highlight switched off underneath it.
///
/// ## Which fill
///
/// Two states, both from the theme (`SidebarRowStyle`): `accent` with `onAccent`
/// text and icon while the window is key, and the theme's `selection` token with
/// `textPrimary` text and icon while it is not. That second state is the HIG's
/// rule — a selection in a non-key window reads unemphasised — kept inside
/// Berean's palette: macOS would dim it to a system grey, and §3 rule 7 keeps the
/// system palette off Berean's chrome, so the unemphasised fill is the token the
/// themes already ship for exactly this (themes-spec.md §2, role `selection`).
///
/// ## Why a custom fill at all
///
/// themes-spec.md §3 rule 7 and §10 keep the Mac's accent colour out of Berean
/// until the user opts in (Moss 2). AppKit draws the sidebar selection in the
/// Mac's accent — Graphite on Owen's Mac — and SwiftUI's `List` exposes no way
/// to recolour it, so the row paints `theme.accent` itself.
///
/// ## Why an AppKit bridge for the system highlight
///
/// There is no public SwiftUI API that turns a `List` row's system selection
/// highlight off while keeping `List(selection:)` semantics. Checked against
/// the macOS 27.0 SDK's `SwiftUI.swiftinterface`: `listRowBackground`,
/// `listItemTint`, `listRowHoverEffect(Disabled)` and `containerBackground`
/// exist, but nothing named `listRowSelection`, `selectionHighlight` or
/// `ListRowSelection`; `selectionDisabled(_:)` removes the row's *selectability*
/// (and so the arrow keys and the VoiceOver selected trait), not its highlight.
/// `SwiftUICore`'s `backgroundProminence` only *reports* a selected row, it
/// can't suppress one.
///
/// So the root fix is AppKit's own switch. On macOS 26/27 a sidebar `List` is
/// backed by a `SwiftUIOutlineListView` (an `NSOutlineView`) inside a
/// `ListCoreScrollView`, and the selected row's highlight is a child
/// `NSVisualEffectView` that AppKit inserts into the `NSTableRowView`. Setting
/// `selectionHighlightStyle = .none` on that table stops AppKit creating that
/// view at all — and, per `NSTableView`'s documentation, also stops AppKit
/// putting the row into the emphasised background style, which is what was
/// forcing the row's SF Symbol to white. Selection itself is untouched:
/// `selectedRow` and `NSTableRowView.isSelected` keep tracking, so arrow keys,
/// type-select, Full Keyboard Access and the VoiceOver selected trait all still
/// come from `List(selection:)`.
///
/// The alternative — drawing a full-bleed fill *on top of* the system
/// highlight, which is what the first pass did — only hid the Graphite
/// highlight by covering it. Inset the fill to the native shape and the grey
/// reappears around it, so covering it was never the fix.
///
/// `SidebarSelectionMetrics` carries the shape, and `SystemRowHighlight.off()`
/// carries the bridge.

// MARK: - Which colours a row draws with

/// The three token roles one sidebar row draws with. `fill` is `nil` when the
/// row paints no background at all.
struct SidebarRowColors: Equatable {
    let fill: ThemeRole?
    let text: ThemeRole
    let icon: ThemeRole
}

/// The row's colours, as a pure function of its two bits of state.
///
/// Kept separate from the view so the rule itself is unit-testable
/// (`SidebarSelectionTests.rowColors`): the view only turns these roles into
/// `Color`s through `MacTheme`.
enum SidebarRowStyle {
    /// - Parameters:
    ///   - isSelected: whether this row is `List`'s selection.
    ///   - appearsActive: `@Environment(\.appearsActive)` — false when the
    ///     window is not key, including while another app is in front.
    static func colors(isSelected: Bool, appearsActive: Bool) -> SidebarRowColors {
        guard isSelected else {
            // §3 rule 6: icons are monochrome in textPrimary or textSecondary,
            // never the system grey.
            return SidebarRowColors(fill: nil, text: .textPrimary, icon: .textSecondary)
        }

        // Key window: the emphasised selection, Berean's accent.
        // Non-key window: unemphasised, the theme's `selection` token, with
        // text *and* icon in textPrimary — `onAccent` is only guaranteed to
        // read on the accent.
        return appearsActive
            ? SidebarRowColors(fill: .accent, text: .onAccent, icon: .onAccent)
            : SidebarRowColors(fill: .selection, text: .textPrimary, icon: .textPrimary)
    }
}

// MARK: - Geometry

/// The macOS 26 sidebar selection shape, in one place.
///
/// These are not taste: they are what AppKit draws. In a 220 pt sidebar the
/// system highlight view measures exactly `(10, 0, 200, 32)` inside its row,
/// with `layer.cornerRadius` 8 and `cornerCurve` `.continuous`.
/// `SidebarSelectionGeometryTests` re-measures the live system highlight and
/// fails if these drift from it.
enum SidebarSelectionMetrics {
    /// Inset on each side, so the fill is 200 pt wide in a 220 pt sidebar.
    static let horizontalInset: CGFloat = 10

    /// Continuous corner radius, matching the system highlight's layer.
    static let cornerRadius: CGFloat = 8

    /// The sidebar row height AppKit uses, and therefore the fill's height: the
    /// fill takes the row's height rather than setting its own, so the two can
    /// never disagree. Recorded here only so the geometry test can name it.
    static let rowHeight: CGFloat = 32

    /// The fill's shape.
    static var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }
}

// MARK: - Turning the system highlight off

/// Switches the enclosing `List`'s system selection highlight off.
///
/// Drop it anywhere inside a row — the row background is the natural place —
/// and it walks up to the `NSTableView` backing the `List` and sets
/// `selectionHighlightStyle = .none`.
///
/// It is applied every time the view lands in a superview or a window and on
/// every SwiftUI update, and the assignment is guarded by an equality check, so
/// it is idempotent and it re-applies itself if SwiftUI throws the table away
/// and builds a new one.
struct SystemRowHighlight: View {
    /// The modifier form: `.background { }` would be ambiguous inside a row, so
    /// callers compose this view directly into the row background.
    static func off() -> some View {
        SystemRowHighlight()
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }

    var body: some View {
        Bridge()
    }

    private struct Bridge: NSViewRepresentable {
        func makeNSView(context: Context) -> Disabler { Disabler() }

        func updateNSView(_ view: Disabler, context: Context) {
            view.disableEnclosingTableHighlight()
        }
    }

    /// A zero-sized view whose only job is to reach the table above it.
    final class Disabler: NSView {
        override func viewDidMoveToSuperview() {
            super.viewDidMoveToSuperview()
            disableEnclosingTableHighlight()
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            disableEnclosingTableHighlight()
        }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        /// Walks up to the `NSTableView` backing the `List` and stops it drawing
        /// its own selection. Idempotent: the assignment only happens when the
        /// style is not already `.none`, so repeated calls cost nothing and
        /// never trigger a redraw.
        func disableEnclosingTableHighlight() {
            var next: NSView? = superview
            while let view = next {
                if let table = view as? NSTableView {
                    if table.selectionHighlightStyle != .none {
                        table.selectionHighlightStyle = .none
                    }
                    return
                }
                next = view.superview
            }
        }
    }
}
