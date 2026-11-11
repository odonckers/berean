fn main() {
    exact_js_bake::build_mixed_with(
        std::path::Path::new(".."),
        "linux",
        &berean_data::Berean::default(),
        berean_data::RUST_SOURCES,
        |javascript| Box::new(berean_data::mixed(javascript, berean_data::Placement::Main)),
    )
    .unwrap_or_else(|error| {
        // What the bake found (tsc's and the compiler's diagnostics), as it is: no panic around it.
        eprintln!("{error}");
        std::process::exit(1);
    });
}
