import CupertinoCore
import Foundation
import Testing

@Suite("Core bindings")
struct CoreBindingTests {
    @Test("The core reports a version")
    func coreVersionIsNotEmpty() {
        #expect(!coreVersion().isEmpty)
        #expect(BereanCore.version == coreVersion())
    }

    @Test("Opening a fresh directory creates and migrates the store")
    func openSucceedsInAFreshDirectory() throws {
        // TMPDIR points inside the checkout, so this stays in the worktree.
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("berean-core-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let dataDir = root.appendingPathComponent("data", isDirectory: true)
        let cacheDir = root.appendingPathComponent("cache", isDirectory: true)

        let core = try Core.open(dataDir: dataDir.path, cacheDir: cacheDir.path)

        let dbVersion = try core.dbVersion()
        #expect(dbVersion > 0)
        #expect(FileManager.default.fileExists(atPath: dataDir.path))
        #expect(FileManager.default.fileExists(atPath: cacheDir.path))
    }
}
