#if DEBUG
import AppKit
import SwiftUI

/// In-app window capture, for design review in debug builds only.
///
/// It is inert unless `BEREAN_SNAPSHOT_DIR` is set. When it is:
///
/// - `BEREAN_SNAPSHOT_APPEARANCE` (`light` | `dark`) sets `NSApp.appearance`.
///   That is an in-app override; it never touches a system setting.
/// - `BEREAN_SNAPSHOT_NAME` is the PNG's base name; it defaults to the
///   appearance.
///
/// The window is pinned to a fixed size, brought to the front, given time to
/// settle, then its whole frame view (`contentView?.superview`, so the
/// titlebar and toolbar are in the image) is drawn with
/// `cacheDisplay(in:to:)`. The app prints the file path and quits.
///
/// This renders the app's own view tree. It deliberately does not use
/// `screencapture`, `CGWindowListCreateImage` or ScreenCaptureKit, so it needs
/// no screen-recording permission and can't catch anything but Berean.
@MainActor
enum DebugSnapshot {
    private static let windowSize = CGSize(width: 1200, height: 760)
    private static let settleDelay = Duration.milliseconds(2500)

    static func startIfRequested() {
        let environment = ProcessInfo.processInfo.environment
        guard let directory = environment["BEREAN_SNAPSHOT_DIR"], !directory.isEmpty else {
            return
        }

        let appearanceName = environment["BEREAN_SNAPSHOT_APPEARANCE"]
        let fileName = environment["BEREAN_SNAPSHOT_NAME"] ?? appearanceName ?? "snapshot"

        var observer: NSObjectProtocol?
        observer = NotificationCenter.default.addObserver(
            forName: NSApplication.didFinishLaunchingNotification,
            object: nil,
            queue: .main
        ) { _ in
            if let observer {
                NotificationCenter.default.removeObserver(observer)
            }
            MainActor.assumeIsolated {
                apply(appearanceName: appearanceName)
                Task {
                    try? await Task.sleep(for: settleDelay)
                    capture(
                        into: URL(fileURLWithPath: directory, isDirectory: true),
                        fileName: fileName
                    )
                    NSApp.terminate(nil)
                }
            }
        }
    }

    private static func apply(appearanceName: String?) {
        switch appearanceName {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: break
        }

        NSApp.activate()
        if let window = mainWindow {
            window.setContentSize(windowSize)
            window.center()
            window.makeKeyAndOrderFront(nil)
        }
    }

    private static func capture(into directory: URL, fileName: String) {
        guard let window = mainWindow else {
            FileHandle.standardError.write(Data("snapshot: no window to capture\n".utf8))
            return
        }

        // The frame view, not the content view, so the titlebar and the
        // unified toolbar are included.
        guard let frameView = window.contentView?.superview else {
            FileHandle.standardError.write(Data("snapshot: window has no frame view\n".utf8))
            return
        }

        let bounds = frameView.bounds
        guard let rep = frameView.bitmapImageRepForCachingDisplay(in: bounds) else {
            FileHandle.standardError.write(Data("snapshot: could not allocate a bitmap\n".utf8))
            return
        }
        frameView.cacheDisplay(in: bounds, to: rep)

        guard let png = rep.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write(Data("snapshot: PNG encoding failed\n".utf8))
            return
        }

        let url = directory.appendingPathComponent("\(fileName).png")
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            try png.write(to: url)
            print(url.path)
        } catch {
            FileHandle.standardError.write(Data("snapshot: \(error)\n".utf8))
        }
    }

    /// The document window, ignoring panels and the Settings window.
    private static var mainWindow: NSWindow? {
        if let key = NSApp.keyWindow, key.contentView != nil, !(key is NSPanel) {
            return key
        }
        return NSApp.windows.first { $0.isVisible && $0.contentView != nil && !($0 is NSPanel) }
    }
}
#endif
