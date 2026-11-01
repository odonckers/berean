import CupertinoCore
import Foundation
import Testing

@Suite struct BereanCoreTests {
    @Test func versionIsNotEmpty() {
        #expect(!BereanCore.version.isEmpty)
    }

    @Test func userDbSchemaIsPositive() {
        #expect(BereanCore.userDbSchema > 0)
    }

    @Test func opensInAFreshDirectory() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let core = try BereanCore.open(
            dataDirectory: root.appendingPathComponent("data", isDirectory: true),
            cacheDirectory: root.appendingPathComponent("cache", isDirectory: true)
        )

        #expect(try core.dbVersion() > 0)
        #expect(try core.installedPublicationCount() == 0)
    }
}
