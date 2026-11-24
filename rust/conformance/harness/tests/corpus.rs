//! Runs the whole corpus against the built example binaries.
//!
//! Ignored by default because it needs `cargo build -p jsonkit -p textstat` first:
//! `cargo test -p conformance-harness -- --ignored`.

#![allow(clippy::expect_used)]

use std::{fs, path::Path, process::Command};

use conformance_harness::cases::{check_expected_entries, load_cases};

#[test]
fn a_run_rejects_unexpected_entries_in_the_folders_it_checks() {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join("orphan-expectations");
    let expected = root.join("expected");
    fs::create_dir_all(root.join("cases")).expect("create the case folder");
    for name in ["jsonkit-known", "textstat-old", "jsonkit-old"] {
        fs::create_dir_all(expected.join(name)).expect("create an expected folder");
    }
    fs::write(
        root.join("cases/jsonkit.json"),
        r#"{"cases":[{"app":"jsonkit","argv":[],"id":"jsonkit-known"}]}"#,
    )
    .expect("write the case");
    fs::write(expected.join("META.json"), "{}").expect("write the metadata file");
    fs::write(expected.join("NOTES"), "stray file").expect("write an orphan file");

    let cases = load_cases(&root).expect("load the case");
    let selected: Vec<_> = cases.iter().collect();
    let full = check_expected_entries(&root, &selected, true);
    let filtered = check_expected_entries(&root, &selected, false);
    fs::write(expected.join("jsonkit-known/extra"), "unexpected file")
        .expect("write an extra file");
    fs::write(expected.join("jsonkit-known/stdin"), "unexpected stdin")
        .expect("write unexpected stdin");
    let unexpected = check_expected_entries(&root, &selected, false);
    fs::remove_dir_all(&root).expect("remove the test corpus");

    assert_eq!(
        full.expect_err("a full run rejects orphan expectations"),
        "expected/NOTES: no case owns this entry\nexpected/jsonkit-old: no case owns this entry\nexpected/textstat-old: no case owns this entry"
    );
    filtered.expect("a filtered run ignores orphan expectations");
    assert_eq!(
        unexpected.expect_err("a filtered run rejects unexpected case entries"),
        "expected/jsonkit-known/extra: unexpected entry\nexpected/jsonkit-known/stdin: unexpected entry"
    );
}

#[test]
#[ignore = "needs the built jsonkit and textstat binaries"]
fn the_shared_cases_pass_are_accepted_or_are_behind() {
    let harness = Path::new(env!("CARGO_BIN_EXE_conformance-harness"));
    let bin_dir = harness
        .parent()
        .expect("the harness binary has a parent directory");
    let output = Command::new(harness)
        .arg("--bin-dir")
        .arg(bin_dir)
        .output()
        .expect("run the conformance harness");
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
