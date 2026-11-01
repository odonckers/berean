import SwiftUI

@main
struct BereanMacApp: App {
    init() {
        #if DEBUG
        DebugSnapshot.startIfRequested()
        #endif
    }

    var body: some Scene {
        // The default File › New Window (⌘N) is left in place.
        WindowGroup(id: "main") {
            MacRootView()
        }
        .commands {
            MacCommands()
        }

        Settings {
            MacSettingsView()
        }
    }
}
