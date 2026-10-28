//! Helpers shared by the integration tests.

use std::path::PathBuf;

/// The path of a real JWPUB fixture. The fixtures are not committed: run
/// `core/scripts/fetch-fixtures.sh` to download them into `core/fixtures/`.
pub fn fixture(name: &str) -> PathBuf {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures")
        .join(name);
    assert!(
        path.is_file(),
        "fixture missing: run core/scripts/fetch-fixtures.sh ({})",
        path.display()
    );
    path
}
