//! Runs the whole corpus against the built example binaries.
//!
//! Ignored by default because it needs `cargo build -p jsonkit -p textstat` first:
//! `cargo test -p conformance-harness -- --ignored`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

use conformance_harness::runner::{Context, Status, check_binaries, run_cases};
use conformance_harness::{accepted, cases, report};

#[test]
#[ignore = "needs the built jsonkit and textstat binaries"]
fn the_whole_corpus_passes_or_is_accepted() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let root = root.canonicalize().unwrap();
    let conformance_dir = root.join("conformance");
    let bin_dir = std::env::var_os("CARGO_TARGET_DIR")
        .map_or_else(|| root.join("target"), PathBuf::from)
        .join("debug");
    check_binaries(&bin_dir, &["jsonkit", "textstat"]).unwrap();
    let all = cases::load_cases(&conformance_dir).unwrap();
    let ctx = Context {
        accepted: accepted::load(&conformance_dir, &root.join("docs/deviations.md")).unwrap(),
        scratch_dir: root.join(".scratch/conformance-harness-test"),
        bin_dir,
        path_var: std::env::var("PATH").unwrap_or_default(),
        jobs: 4,
        conformance_dir,
    };
    let refs: Vec<&cases::Case> = all.iter().collect();
    let results = run_cases(&ctx, &refs);
    let bad: Vec<_> = results
        .iter()
        .filter(|r| matches!(r.status, Status::Failed | Status::Stale))
        .collect();
    assert!(bad.is_empty(), "{}", report::render(&results));
}
