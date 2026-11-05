// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Cupertino",
    platforms: [
        .iOS(.v26),
        .macOS(.v26),
    ],
    products: [
        // Thin wrapper over the generated UniFFI bindings.
        .library(name: "CupertinoCore", targets: ["CupertinoCore"]),
        // Shared SwiftUI views for the iOS and macOS apps.
        .library(name: "CupertinoUI", targets: ["CupertinoUI"]),
    ],
    targets: [
        // The Rust core, packaged as a binary framework. Built by
        // scripts/build-xcframework.sh; not committed.
        .binaryTarget(
            name: "CupertinoCoreFFI",
            path: "BereanCoreFFI.xcframework"
        ),
        .target(
            name: "CupertinoCore",
            dependencies: ["CupertinoCoreFFI"]
        ),
        .target(
            name: "CupertinoUI",
            dependencies: ["CupertinoCore"]
        ),
        .testTarget(
            name: "CupertinoCoreTests",
            dependencies: ["CupertinoCore"]
        ),
    ]
)
