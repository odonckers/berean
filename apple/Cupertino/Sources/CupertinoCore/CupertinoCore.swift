// Thin conveniences over the generated UniFFI bindings (see Generated/).
//
// The generated `berean_ffi.swift` lives in this same module, so its public
// API — `coreVersion()`, the `Core` object, and `CoreError` — is already
// re-exported by `CupertinoCore`. This file adds a small, Swift-friendly
// façade on top.

import Foundation

/// Entry points into the Berean Rust core.
public enum BereanCore {
    /// The core library version.
    public static var version: String {
        CupertinoCore.coreVersion()
    }

    /// The user DB schema version this build of the core targets.
    public static var userDbSchema: UInt32 {
        CupertinoCore.userDbSchema()
    }

    /// Open the core in this app's own directories: data under Application
    /// Support, cache under Caches, each in a subdirectory named `name`.
    /// Both are created if missing.
    ///
    /// Throws a `CoreError` from the core itself, or a file-system error if a
    /// directory could not be created.
    public static func open(name: String = "Berean") throws -> Core {
        try open(
            dataDirectory: appDirectory(.applicationSupportDirectory, named: name),
            cacheDirectory: appDirectory(.cachesDirectory, named: name)
        )
    }

    /// Open the core in explicit directories, creating them if missing. The
    /// app uses ``open(name:)``; this overload exists for tests and tools that
    /// need a core somewhere specific.
    public static func open(dataDirectory: URL, cacheDirectory: URL) throws -> Core {
        for directory in [dataDirectory, cacheDirectory] {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        }
        return try Core.open(dataDir: dataDirectory.path, cacheDir: cacheDirectory.path)
    }

    /// `name` inside one of the app's standard directories.
    private static func appDirectory(
        _ searchPath: FileManager.SearchPathDirectory,
        named name: String
    ) throws -> URL {
        let base = try FileManager.default.url(
            for: searchPath,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return base.appendingPathComponent(name, isDirectory: true)
    }
}

public extension Core {
    /// How many publications are installed.
    func installedPublicationCount() throws -> Int {
        try library().installed().count
    }
}
