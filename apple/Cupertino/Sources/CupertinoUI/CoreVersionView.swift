import CupertinoCore
import SwiftUI

/// A tiny smoke-test view: it reads the version string straight out of the
/// Rust core, proving the whole binding chain is wired up.
public struct CoreVersionView: View {
    public init() {}

    public var body: some View {
        Text("Core version: \(BereanCore.version)")
    }
}
