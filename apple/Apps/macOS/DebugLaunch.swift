#if DEBUG
import AppKit
import SwiftUI

/// Launch overrides for design proofs, in debug builds only.
///
/// Every hook is inert unless its environment variable is set, and each one
/// only overrides state *at launch*, so `@SceneStorage` restoration is
/// untouched otherwise. Nothing here reads or writes a system setting, asks for
/// a permission, or uses Accessibility, Automation, AppleScript or `CGEvent` —
/// it is all in-process AppKit and SwiftUI.
///
/// | Variable | Effect |
/// | --- | --- |
/// | `BEREAN_DEBUG_SECTION=read\|studyspace\|notes\|library` | selects that section |
/// | `BEREAN_DEBUG_SIDEBAR_COLLAPSED=1` | starts with the sidebar collapsed |
/// | `BEREAN_DEBUG_WINDOW_SIZE=WxH` | sets the main window's content size |
/// | `BEREAN_DEBUG_OPEN_SETTINGS=1` | opens Settings after launch |
/// | `BEREAN_DEBUG_OPEN_MENU=File\|Go` | pops that menu-bar menu open |
///
/// `BEREAN_FORCE_REDUCE_TRANSPARENCY=1` is the sixth hook; it lives in
/// `ThemedScene` next to the setting it stands in for.
@MainActor
enum DebugLaunch {
    private static var environment: [String: String] {
        ProcessInfo.processInfo.environment
    }

    /// The section to land on, overriding whatever was restored.
    static var section: SidebarItem? {
        guard let raw = environment["BEREAN_DEBUG_SECTION"] else { return nil }
        return SidebarItem(rawValue: raw.lowercased())
    }

    static var startsSidebarCollapsed: Bool {
        environment["BEREAN_DEBUG_SIDEBAR_COLLAPSED"] == "1"
    }

    static var opensSettings: Bool {
        environment["BEREAN_DEBUG_OPEN_SETTINGS"] == "1"
    }

    /// `WxH`, e.g. `640x600`.
    static var windowSize: CGSize? {
        guard let raw = environment["BEREAN_DEBUG_WINDOW_SIZE"] else { return nil }
        let parts = raw.lowercased().split(separator: "x")
        guard parts.count == 2,
              let width = Double(parts[0]), let height = Double(parts[1]),
              width > 0, height > 0
        else {
            warn("BEREAN_DEBUG_WINDOW_SIZE=\(raw) is not WxH; ignoring it")
            return nil
        }
        return CGSize(width: width, height: height)
    }

    /// A top-level menu title, e.g. `File` or `Go`.
    static var menuTitle: String? {
        guard let raw = environment["BEREAN_DEBUG_OPEN_MENU"], !raw.isEmpty else {
            return nil
        }
        return raw
    }

    /// How long to wait after launch before acting, so the window, the toolbar
    /// and the menu bar have all settled.
    private static let settleDelay = Duration.seconds(2)

    // MARK: AppKit hooks

    /// The two hooks that need `NSApplication` rather than a view: the window
    /// size and the menu pop-up. Called from `BereanMacApp.init`.
    static func startIfRequested() {
        guard windowSize != nil || menuTitle != nil else { return }

        launchObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didFinishLaunchingNotification,
            object: nil,
            queue: .main
        ) { _ in
            MainActor.assumeIsolated {
                if let observer = launchObserver {
                    NotificationCenter.default.removeObserver(observer)
                    launchObserver = nil
                }
                applyWindowSize()
                openMenuIfRequested()
            }
        }
    }

    /// The one-shot launch observer, held here (main actor) rather than
    /// captured by the `@Sendable` notification closure.
    private static var launchObserver: NSObjectProtocol?

    private static func applyWindowSize() {
        guard let size = windowSize else { return }
        guard let window = mainWindow else {
            warn("no window to resize")
            return
        }
        window.setContentSize(size)
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    private static func openMenuIfRequested() {
        guard let title = menuTitle else { return }
        Task { @MainActor in
            try? await Task.sleep(for: settleDelay)
            popUpMenu(titled: title)
        }
    }

    /// Opens a top-level menu by asking its own `NSMenu` to pop up under its
    /// menu-bar title, so it draws with the real items and key equivalents.
    ///
    /// `NSMenuItem` exposes no frame, so the title's x is estimated from the
    /// widths of the titles ahead of it in the menu-bar font. That is accurate
    /// to a few points, which is all a screenshot needs.
    private static func popUpMenu(titled title: String) {
        NSApp.activate()

        guard let mainMenu = NSApp.mainMenu else {
            warn("the app has no main menu yet")
            return
        }
        guard let item = mainMenu.items.first(where: {
            $0.title.caseInsensitiveCompare(title) == .orderedSame
        }) else {
            let titles = mainMenu.items.map(\.title).filter { !$0.isEmpty }
            warn("no menu titled \(title). Menus: \(titles.joined(separator: ", "))")
            return
        }
        guard let submenu = item.submenu else {
            warn("the \(title) menu has no submenu")
            return
        }
        guard let screen = NSApp.mainWindow?.screen ?? NSScreen.main else {
            warn("no screen to position the menu on")
            return
        }

        let font = NSFont.menuBarFont(ofSize: 0)
        // The Apple menu, which is not one of `mainMenu`'s titled items.
        var x = screen.frame.minX + 40
        for candidate in mainMenu.items {
            if candidate === item { break }
            guard !candidate.title.isEmpty else { continue }
            x += candidate.title.size(withAttributes: [.font: font]).width + 20
        }
        let y = screen.frame.maxY - NSStatusBar.system.thickness

        submenu.popUp(positioning: nil, at: CGPoint(x: x, y: y), in: nil)
    }

    /// The document window, ignoring panels and the Settings window.
    private static var mainWindow: NSWindow? {
        if let key = NSApp.keyWindow, key.contentView != nil, !(key is NSPanel) {
            return key
        }
        return NSApp.windows.first {
            $0.isVisible && $0.contentView != nil && !($0 is NSPanel)
        }
    }

    // MARK: View hooks

    /// The hooks that belong to the scene: opening Settings. Called from
    /// `MacRootView`'s `.task`, which is a no-op when nothing is requested.
    static func runSceneActions(openSettings: @escaping () -> Void) async {
        guard opensSettings else { return }
        try? await Task.sleep(for: settleDelay)
        openSettings()
    }

    private static func warn(_ message: String) {
        FileHandle.standardError.write(Data("debug-launch: \(message)\n".utf8))
    }
}
#endif
