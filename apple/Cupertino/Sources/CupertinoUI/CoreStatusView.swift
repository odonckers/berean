import CupertinoCore
import SwiftUI

/// A smoke-test screen shared by the iOS and macOS apps: it opens the Rust
/// core in the app's own directories and reports what it found, proving the
/// whole binding chain is wired up.
public struct CoreStatusView: View {
    /// What opening the core told us.
    private enum Database {
        case opening
        case opened(version: UInt32, installedPublications: Int)
        case failed(message: String)
    }

    @State private var database: Database = .opening

    public init() {}

    public var body: some View {
        NavigationStack {
            List {
                Section("Core") {
                    LabeledContent("Version", value: BereanCore.version)
                    LabeledContent("User DB schema", value: BereanCore.userDbSchema.formatted())
                }

                Section("Database") {
                    switch database {
                    case .opening:
                        LabeledContent("Status", value: "Opening…")
                    case let .opened(version, installedPublications):
                        LabeledContent("Version", value: version.formatted())
                        LabeledContent(
                            "Installed publications",
                            value: installedPublications.formatted()
                        )
                    case let .failed(message):
                        LabeledContent("Could not open the core", value: message)
                    }
                }
            }
            .navigationTitle("Berean")
        }
        .task { database = Self.openCore() }
    }

    /// Open the core and read the two values the screen shows. Any failure —
    /// a `CoreError` or a file-system error — becomes the error row.
    private static func openCore() -> Database {
        do {
            let core = try BereanCore.open()
            return .opened(
                version: try core.dbVersion(),
                installedPublications: try core.installedPublicationCount()
            )
        } catch {
            return .failed(message: (error as? CoreError)?.description ?? error.localizedDescription)
        }
    }
}

#Preview {
    CoreStatusView()
}
