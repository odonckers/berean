import AppKit
import CupertinoCore
import CupertinoUI
import SwiftUI

/// The Mac window: a standard `NavigationSplitView` under the unified window
/// toolbar.
///
/// Materials follow the design guide: Liquid Glass is **system only** here.
/// The sidebar and toolbar get no custom background, so they are whatever
/// macOS 26 draws, and content sits on an opaque Paper surface. The one
/// exception is Reduce Transparency / Increase Contrast, where the chrome
/// becomes solid `surfaceRaised` with a 1 pt `outline` — same shape, same
/// position, just not translucent (themes-spec.md §3 rule 5).
///
/// Colours come from `\.macTheme`, which `ThemedScene` resolves out of the
/// generated `ThemeTokens`. No `Text` in the shell uses `.secondary` or
/// `.tertiary`: those are system greys, and §3 rule 7 keeps the system palette
/// off Berean's text.
struct MacRootView: View {
    @State private var model = WindowModel()
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    @SceneStorage("sidebar.selection") private var storedSelection: String?
    @SceneStorage("search.text") private var storedSearchText: String?
    @SceneStorage("sidebar.columnVisibility") private var storedColumnVisibility: String?

    @Environment(\.macTheme) private var theme
    @Environment(\.macSolidChrome) private var solidChrome
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
        } detail: {
            detail
        }
        .searchable(text: $model.searchText, placement: .toolbar, prompt: "Search")
        .toolbar { historyButtons }
        .modifier(SolidToolbarChrome(isActive: solidChrome, surface: theme.surfaceRaised))
        .overlay { palette }
        .focusedSceneValue(\.windowModel, model)
        .onAppear(perform: restoreScene)
        .task {
            #if DEBUG
            await DebugLaunch.runSceneActions { openSettings() }
            #endif
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
            Section {
                ForEach(SidebarItem.allCases) { item in
                    Label(item.title, systemImage: item.symbolName)
                        .foregroundStyle(rowForeground(for: item))
                        .tag(item)
                        .listRowBackground(rowBackground(for: item))
                }
            } header: {
                sectionHeader("Berean")
            }

            Section {
                Text("Nothing yet")
                    .font(.callout)
                    .foregroundStyle(theme.textSecondary)
            } header: {
                sectionHeader("Recent")
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 320)
        .modifier(
            SolidSidebarChrome(
                isActive: solidChrome,
                surface: theme.surfaceRaised,
                outline: theme.outline
            )
        )
    }

    private func sectionHeader(_ title: String) -> some View {
        // `textSecondary`, not `.secondary`: a header is content, and
        // `textTertiary` is placeholders only (§3 rule 10).
        Text(title).foregroundStyle(theme.textSecondary)
    }

    /// The selected row is drawn from the theme, not from the Mac's accent.
    ///
    /// `.tint` alone is not enough on macOS: when the Mac accent is anything
    /// other than Multicolor — Owen's is Graphite — AppKit draws the sidebar's
    /// selection highlight in *that* colour, and SwiftUI's `List` gives no hook
    /// to recolour it. So the row paints its own `accent` background through
    /// `.listRowBackground`, which sits above the system highlight, and its
    /// label switches to `onAccent` (4.5:1 or better in every set, §15).
    /// Selection itself still goes through `List(selection:)`, so arrow keys,
    /// Full Keyboard Access and VoiceOver behave exactly as before.
    @ViewBuilder private func rowBackground(for item: SidebarItem) -> some View {
        if item == model.selection {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(theme.accent)
        } else {
            Color.clear
        }
    }

    private func rowForeground(for item: SidebarItem) -> Color {
        item == model.selection ? theme.onAccent : theme.textPrimary
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

    // MARK: Detail

    /// The detail column carries the window title and the toolbar hairline, so
    /// the line stops at the sidebar's trailing edge instead of crossing it.
    private var detail: some View {
        DetailPlaceholder(item: model.selection)
            .overlay(alignment: .top) { chromeOutline }
            .navigationTitle(model.selection.title)
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

    /// The hairline that stands in for the glass toolbar's edge. It sits flush
    /// under the toolbar at the top of the detail column; the sidebar has its
    /// own trailing outline instead.
    @ViewBuilder private var chromeOutline: some View {
        if solidChrome {
            Rectangle()
                .fill(theme.outline)
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

    // MARK: Restoration

    private func restoreScene() {
        if let raw = storedSelection, let item = SidebarItem(rawValue: raw) {
            model.restore(item)
        }
        if let text = storedSearchText {
            model.searchText = text
        }
        if let code = storedColumnVisibility {
            columnVisibility = ColumnVisibilityCode.visibility(for: code)
        }

        #if DEBUG
        // Debug proof hooks override whatever was restored, at launch only.
        if let item = DebugLaunch.section {
            model.restore(item)
        }
        if DebugLaunch.startsSidebarCollapsed {
            columnVisibility = .detailOnly
        }
        #endif
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

    @Environment(\.macTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(item.title)
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(theme.textPrimary)

            Text("Core version \(BereanCore.version)")
                .font(.callout)
                .foregroundStyle(theme.textSecondary)

            VStack(alignment: .leading, spacing: 6) {
                Text(
                    "In the beginning was the Word, and the Word was with God, "
                        + "and the Word was God."
                )
                .font(.system(.title3, design: .serif))
                .foregroundStyle(theme.textPrimary)

                Text("— John 1:1")
                    .font(.system(.subheadline, design: .serif))
                    .foregroundStyle(theme.textSecondary)
            }
            .padding(.top, 8)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: 680, alignment: .leading)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Content is never glass. This is the Paper background, opaque.
        .background(theme.background)
    }
}

/// Reduce Transparency / Increase Contrast: an opaque toolbar.
private struct SolidToolbarChrome: ViewModifier {
    let isActive: Bool
    let surface: Color

    func body(content: Content) -> some View {
        if isActive {
            content
                .toolbarBackground(surface, for: .windowToolbar)
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
    let surface: Color
    let outline: Color

    func body(content: Content) -> some View {
        if isActive {
            content
                .scrollContentBackground(.hidden)
                .background(surface)
                .overlay(alignment: .trailing) {
                    Rectangle()
                        .fill(outline)
                        .frame(width: 1)
                        .allowsHitTesting(false)
                }
        } else {
            content
        }
    }
}
