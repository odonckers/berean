// Thin conveniences over the generated UniFFI bindings (see Generated/).
//
// The generated `berean_ffi.swift` lives in this same module, so its public
// API — `coreVersion()`, the `Core` object, and `CoreError` — is already
// re-exported by `CupertinoCore`. This file adds a small, Swift-friendly
// façade on top.

/// Entry points into the Berean Rust core.
public enum BereanCore {
    /// The core library version.
    public static var version: String {
        coreVersion()
    }
}
