//! Runs `--check-growth` through the binary against the committed behind list, with a base folder
//! and a changed-path list written for each case.

#![allow(clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::{Value, json};

/// The committed behind list, which every run compares with its base.
fn committed() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../behind.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read behind.json"))
        .expect("parse behind.json")
}

/// The committed list's first entry: its id and the list without it.
fn without_first() -> (String, Value) {
    let mut list = committed();
    let entries = list["behind"].as_array_mut().expect("a behind array");
    let first = entries.remove(0);
    (first["id"].as_str().expect("an id").to_owned(), list)
}

/// A fresh folder holding the base lists and the NUL-separated changed paths.
fn scenario(name: &str, behind: &Value, accepted: &Value, changed: &[&str]) -> (PathBuf, PathBuf) {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("growth-check")
        .join(name);
    let _ = fs::remove_dir_all(&root);
    let base = root.join("base");
    fs::create_dir_all(&base).expect("create the base folder");
    fs::write(base.join("behind.json"), behind.to_string()).expect("write the base behind list");
    fs::write(base.join("accepted.json"), accepted.to_string())
        .expect("write the base accepted list");
    let mut paths = String::new();
    for path in changed {
        paths.push_str(path);
        paths.push('\0');
    }
    let changed_file = root.join("changed");
    fs::write(&changed_file, paths).expect("write the changed paths");
    (base, changed_file)
}

fn check(base: &Path, changed: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_conformance-harness"))
        .arg("--check-growth")
        .arg(base)
        .arg("--changed")
        .arg(changed)
        .output()
        .expect("run the harness")
}

fn none_accepted() -> Value {
    json!({ "accepted": [] })
}

#[test]
fn an_unchanged_list_passes() {
    let (base, changed) = scenario("unchanged", &committed(), &none_accepted(), &[]);
    let out = check(&base, &changed);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
}

#[test]
fn a_list_that_shrinks_passes() {
    let mut grown = committed();
    grown["behind"]
        .as_array_mut()
        .expect("a behind array")
        .push(json!({ "id": "jsonkit-zz-fixed", "parts": ["stdout"] }));
    let (base, changed) = scenario("shrinks", &grown, &none_accepted(), &[]);
    assert_eq!(check(&base, &changed).status.code(), Some(0));
}

#[test]
fn growth_with_no_expected_change_fails_naming_the_case_and_part() {
    let (id, base_list) = without_first();
    let (base, changed) = scenario(
        "unexplained",
        &base_list,
        &none_accepted(),
        &[
            "rust/crates/loomcli-core/src/lib.rs",
            "rust/conformance/behind.json",
        ],
    );
    let out = check(&base, &changed);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{stdout}");
    assert!(stdout.contains(&format!("  {id}: ")), "{stdout}");
}

#[test]
fn growth_explained_by_the_cases_expected_files_passes_even_for_a_quoted_path() {
    let (id, base_list) = without_first();
    let file = format!("conformance/expected/{id}/files/r\u{e9}sum\u{e9} \"1\".txt");
    let (base, changed) = scenario(
        "explained",
        &base_list,
        &none_accepted(),
        &["rust/conformance/behind.json", &file],
    );
    assert_eq!(check(&base, &changed).status.code(), Some(0));
}

#[test]
fn a_case_the_base_accepted_may_move_to_the_behind_list() {
    let (id, base_list) = without_first();
    let accepted =
        json!({ "accepted": [{ "id": id, "parts": ["stdout"], "row": "r", "reason": "x" }] });
    let (base, changed) = scenario("from-accepted", &base_list, &accepted, &[]);
    assert_eq!(check(&base, &changed).status.code(), Some(0));
}

#[test]
fn a_malformed_base_list_exits_2_naming_the_file() {
    let (base, changed) = scenario("malformed", &committed(), &none_accepted(), &[]);
    fs::write(base.join("behind.json"), "{\"behind\": [").expect("truncate the base list");
    let out = check(&base, &changed);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(2), "{stderr}");
    assert!(
        stderr.contains(&base.join("behind.json").display().to_string()),
        "{stderr}"
    );
}

#[test]
fn check_growth_without_changed_exits_2_and_runs_no_case() {
    let (base, _) = scenario("lone-flag", &committed(), &none_accepted(), &[]);
    let out = Command::new(env!("CARGO_BIN_EXE_conformance-harness"))
        .arg("--check-growth")
        .arg(&base)
        .output()
        .expect("run the harness");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(2), "{stderr}");
    assert!(
        stderr.contains("--check-growth and --changed go together"),
        "{stderr}"
    );
    assert!(
        out.stdout.is_empty(),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
}
