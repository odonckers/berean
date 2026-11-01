import SwiftUI

@main
struct BereanMacApp: App {
    init() {
        #if DEBUG
        DebugLaunch.startIfRequested()
        #endif
    }

    var body: some Scene {
        WindowGroup(id: "main") {
            ThemedScene {
                MacRootView()
            }
        }
        // The proof size for design review; BEREAN_DEBUG_WINDOW_SIZE overrides
        // it at launch in debug builds.
        .defaultSize(width: 1200, height: 760)
        .commands {
            MacCommands()
        }

        Settings {
            ThemedScene {
                MacSettingsView()
            }
        }
    }
}
