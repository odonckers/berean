import AppKit
import Combine
import CupertinoCore
import SwiftUI

/// The Mac window: a standard `NavigationSplitView` under the unified window
/// toolbar.
///
/// Materials follow the design guide: Liquid Glass is **system only** here.
/// The sidebar and toolbar get no custom background and no accent tint, so
/// they are whatever macOS 26 draws. Content sits on an opaque Paper surface.
/// The one exception is Reduce Transparency / Increase Contrast, where the
/// chrome becomes solid `surfaceRaised` with a 1 pt `outline` — same shape,
/// same position, just not translucent.
struct MacRootView: View {
    @State private var model = WindowModel()
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var increaseContrast = false

    @SceneStorage("sidebar.selection") private var storedSelection: String?
    @SceneStorage("search.text") private var storedSearchText: String?
    @SceneStorage("sidebar.columnVisibility") private var storedColumnVisibility: String?

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
        } detail: {
            DetailPlaceholder(item: model.selection)
        }
        .searchable(text: $model.searchText, placement: .toolbar, prompt: "Search")
        .toolbar { historyButtons }
        .modifier(SolidToolbarChrome(isActive: wantsSolidChrome))
        .overlay(alignment: .top) { chromeOutline }
        .overlay { palette }
        .focusedSceneValue(\.windowModel, model)
        .onAppear(perform: restoreScene)
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(
            for: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification
        )) { _ in
            increaseContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        }
        .onChange(of: model.selection) { _, item in storedSelection = item.rawValue }
        .onChange(of: model.searchText) { _, text in storedSearchText = text }
        .onChange(of: columnVisibility) { _, visibility in
            storedColumnVisibility = ColumnVisibilityCode.code(for: visibility)
        }
    }

    // MARK: Sidebar

    private var sidebar: some View {
        List(selection: sidebarSelection) {
            Section("Berean") {
                ForEach(SidebarItem.allCases) { item in
                    Label(item.title, systemImage: item.symbolName)
                        .tag(item)
                }
            }
            Section("Recent") {
                Text("Nothing yet")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 320)
        .modifier(SolidSidebarChrome(isActive: wantsSolidChrome))
    }

    /// Selecting in the sidebar goes through the model, so it records history.
    private var sidebarSelection: Binding<SidebarItem?> {
        Binding {
            model.selection
        } set: { item in
            guard let item else { return }
            model.select(item)
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder private var historyButtons: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button {
                model.goBack()
            } label: {
                Label("Back", systemImage: "chevron.backward")
                    .symbolRenderingMode(.monochrome)
            }
            .disabled(!model.canGoBack)
            .help("Back")

            Button {
                model.goForward()
            } label: {
                Label("Forward", systemImage: "chevron.forward")
                    .symbolRenderingMode(.monochrome)
            }
            .disabled(!model.canGoForward)
            .help("Forward")
        }
    }

    // MARK: Overlays

    /// The hairline that stands in for the glass toolbar's edge. It sits at the
    /// very top of the window's content, directly under the toolbar.
    @ViewBuilder private var chromeOutline: some View {
        if wantsSolidChrome {
            Rectangle()
                .fill(SolidChrome.outline)
                .frame(height: 1)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder private var palette: some View {
        if model.isPaletteOpen {
            OmnisearchPalette(query: $model.searchText) {
                model.closePalette()
            }
        }
    }

    // MARK: Accessibility materials

    /// True when the chrome must be opaque rather than glass.
    private var wantsSolidChrome: Bool {
        #if DEBUG
        // Debug-only override for snapshots and manual checks. It reads an env
        // var and nothing else — it never touches a system setting.
        if ProcessInfo.processInfo.environment["BEREAN_FORCE_REDUCE_TRANSPARENCY"] == "1" {
            return true
        }
        #endif
        return reduceTransparency || increaseContrast
    }

    // MARK: Restoration

    private func restoreScene() {
        increaseContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast

        if let raw = storedSelection, let item = SidebarItem(rawValue: raw) {
            model.restore(item)
        }
        if let text = storedSearchText {
            model.searchText = text
        }
        if let code = storedColumnVisibility {
            columnVisibility = ColumnVisibilityCode.visibility(for: code)
        }
    }
}

/// `NavigationSplitViewVisibility` isn't `RawRepresentable`, so `@SceneStorage`
/// holds these codes instead.
private enum ColumnVisibilityCode {
    static func code(for visibility: NavigationSplitViewVisibility) -> String {
        switch visibility {
        case .detailOnly: "detailOnly"
        case .doubleColumn: "doubleColumn"
        case .all: "all"
        default: "automatic"
        }
    }

    static func visibility(for code: String) -> NavigationSplitViewVisibility {
        switch code {
        case "detailOnly": .detailOnly
        case "doubleColumn": .doubleColumn
        case "all": .all
        default: .automatic
        }
    }
}

/// Every detail pane for now: the item's name, proof the Rust core is linked,
/// and one scripture line in New York so the reading serif is visible early.
private struct DetailPlaceholder: View {
    let item: SidebarItem

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(item.title)
                .font(.largeTitle.weight(.semibold))

            Text("Core version \(BereanCore.version)")
                .font(.callout)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 6) {
                Text(
                    "In the beginning was the Word, and the Word was with God, "
                        + "and the Word was God."
                )
                .font(.system(.title3, design: .serif))
                Text("— John 1:1")
                    .font(.system(.subheadline, design: .serif))
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 8)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: 680, alignment: .leading)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Content is never glass. This is the Paper background, opaque.
        .background(SolidChrome.background)
    }
}

/// Reduce Transparency / Increase Contrast: an opaque toolbar.
private struct SolidToolbarChrome: ViewModifier {
    let isActive: Bool

    func body(content: Content) -> some View {
        if isActive {
            content
                .toolbarBackground(SolidChrome.surfaceRaised, for: .windowToolbar)
                .toolbarBackgroundVisibility(.visible, for: .windowToolbar)
        } else {
            content
        }
    }
}

/// Reduce Transparency / Increase Contrast: an opaque sidebar with a 1 pt
/// outline on its trailing edge, in place of the glass separator.
private struct SolidSidebarChrome: ViewModifier {
    let isActive: Bool

    func body(content: Content) -> some View {
        if isActive {
            content
                .scrollContentBackground(.hidden)
                .background(SolidChrome.surfaceRaised)
                .overlay(alignment: .trailing) {
                    Rectangle()
                        .fill(SolidChrome.outline)
                        .frame(width: 1)
                        .allowsHitTesting(false)
                }
        } else {
            content
        }
    }
}
