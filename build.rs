//! Compiles src/cinder.rc into cinder.exe when building for Windows: the icon and the version
//! details. embed-resource does nothing for other targets.
//!
//! src/cinder.ico is ui/logo.svg rendered by resvg at 16, 20, 24, 32, 40, 48, 64 and 256 px and
//! packed with Pillow. Regenerate it the same way if the logo changes.

fn main() {
    let var = |k: &str| std::env::var(k).unwrap();
    let version = format!(
        "CINDER_VERSION={},{},{},0",
        var("CARGO_PKG_VERSION_MAJOR"),
        var("CARGO_PKG_VERSION_MINOR"),
        var("CARGO_PKG_VERSION_PATCH")
    );
    let version_str = format!("CINDER_VERSION_STR=\"{}\"", var("CARGO_PKG_VERSION"));
    println!("cargo:rerun-if-changed=src/cinder.rc");
    println!("cargo:rerun-if-changed=src/cinder.ico");
    // Required, not optional: a Windows build without its icon should fail rather than ship blank.
    embed_resource::compile("src/cinder.rc", [version.as_str(), version_str.as_str()])
        .manifest_required()
        .unwrap_or_else(|e| panic!("couldn't compile src/cinder.rc: {e}"));
}
