//! Berean on Apple: the Contract UI over the Rust data crate (and an empty TypeScript module).

include!(concat!(env!("OUT_DIR"), "/module.rs"));

type ExactEmbeddedData = berean_data::Data<exact_js::Placed<exact_js::Module>>;
fn embedded_data() -> ExactEmbeddedData {
    berean_data::mixed(
        exact_js::Module::new(APP_BYTECODE, APP, GRANTS).placed(TYPESCRIPT_PLACEMENT),
        RUST_PLACEMENT,
    )
}
include!(concat!(env!("OUT_DIR"), "/logic.rs"));
include!(concat!(env!("OUT_DIR"), "/linked.rs"));
// The host app.json's deploy.store names (with an update store, signed updates), and the plan it boots.
include!(concat!(env!("OUT_DIR"), "/host.rs"));
