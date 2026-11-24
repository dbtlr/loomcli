//! Bakes a build's release facts.
//!
//! `cargo loom build` sets `LOOM_RELEASE` to the release facts as one line of JSON for the cargo
//! invocation. This script validates the value and hands its known members to the crate as
//! `LOOM_RELEASE_BUILD`, `LOOM_RELEASE_VERSION`, `LOOM_RELEASE_REPOSITORY`, and
//! `LOOM_RELEASE_ASSET` (its UTF-8 bytes in hexadecimal, so no character of it can end the directive
//! line), which `ReleaseFacts::baked` reads; an unset or empty value is a `source`
//! build. Malformed facts fail the build with the sentence that names the member at fault.

#[allow(dead_code)]
#[path = "src/shipping/baked.rs"]
mod baked;

fn main() {
    println!("cargo:rerun-if-env-changed=LOOM_RELEASE");
    let value = std::env::var("LOOM_RELEASE").unwrap_or_default();
    let facts = if value.is_empty() {
        baked::BakedFacts {
            build: "source",
            release: None,
        }
    } else {
        match baked::read_facts(&value) {
            Ok(facts) => facts,
            Err(sentence) => {
                eprintln!("{sentence} Rebuild with cargo loom build.");
                std::process::exit(1);
            }
        }
    };
    let release = facts.release.as_ref();
    let version = release.map_or("", |release| release.version.as_str());
    let repository = release.map_or("", |release| release.repository.as_str());
    let asset: String = release
        .and_then(|release| release.asset.as_deref())
        .unwrap_or("")
        .bytes()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    println!("cargo:rustc-env=LOOM_RELEASE_BUILD={}", facts.build);
    println!("cargo:rustc-env=LOOM_RELEASE_VERSION={version}");
    println!("cargo:rustc-env=LOOM_RELEASE_REPOSITORY={repository}");
    println!("cargo:rustc-env=LOOM_RELEASE_ASSET={asset}");
}
