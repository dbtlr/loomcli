//! The growth check end to end: `growth::check` against fixed base and head lists and a NUL-ended
//! changed-path file, and the `--check-growth` mode of the binary, whose wiring holds whatever the
//! committed behind list holds.

#![allow(clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use conformance_harness::growth;
use serde_json::{Value, json};

/// The head list every library scenario checks: two cases, one owing two parts.
fn head() -> Value {
    json!({ "behind": [
        { "id": "jsonkit-a", "parts": ["stdout"] },
        { "id": "textstat-b", "parts": ["stderr", "exit"] },
    ] })
}

/// The head list without `jsonkit-a`, the base most scenarios start from.
fn base_without_a() -> Value {
    json!({ "behind": [{ "id": "textstat-b", "parts": ["stderr", "exit"] }] })
}

fn none_accepted() -> Value {
    json!({ "accepted": [] })
}

fn accepting(id: &str, parts: &[&str]) -> Value {
    json!({ "accepted": [{ "id": id, "parts": parts, "row": "r", "reason": "x" }] })
}

/// A fresh folder holding the base lists, a head list, and the NUL-ended changed paths.
struct Scenario {
    base: PathBuf,
    head: PathBuf,
    changed: PathBuf,
}

fn scenario(name: &str, base: &Value, accepted: &Value, changed: &[&str]) -> Scenario {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("growth-check")
        .join(name);
    let _ = fs::remove_dir_all(&root);
    let base_dir = root.join("base");
    fs::create_dir_all(&base_dir).expect("create the base folder");
    fs::write(base_dir.join("behind.json"), base.to_string()).expect("write the base behind list");
    fs::write(base_dir.join("accepted.json"), accepted.to_string())
        .expect("write the base accepted list");
    let head_file = root.join("head.json");
    fs::write(&head_file, head().to_string()).expect("write the head list");
    let mut paths = String::new();
    for path in changed {
        paths.push_str(path);
        paths.push('\0');
    }
    let changed_file = root.join("changed");
    fs::write(&changed_file, paths).expect("write the changed paths");
    Scenario {
        base: base_dir,
        head: head_file,
        changed: changed_file,
    }
}

fn verdict(s: &Scenario) -> (bool, String) {
    growth::check(&s.base, &s.head, &s.changed).expect("the check runs")
}

#[test]
fn an_unchanged_list_passes() {
    let (passed, text) = verdict(&scenario("unchanged", &head(), &none_accepted(), &[]));
    assert!(passed, "{text}");
    assert_eq!(
        text,
        "behind.json grows only where this change explains it.\n"
    );
}

#[test]
fn a_list_that_shrinks_passes() {
    let mut wider = head();
    wider["behind"]
        .as_array_mut()
        .expect("a behind array")
        .push(json!({ "id": "jsonkit-zz-fixed", "parts": ["stdout"] }));
    assert!(verdict(&scenario("shrinks", &wider, &none_accepted(), &[])).0);
}

#[test]
fn growth_with_no_expected_change_fails_naming_the_case_and_part() {
    let (passed, text) = verdict(&scenario(
        "unexplained",
        &base_without_a(),
        &none_accepted(),
        &[
            "rust/crates/loomcli-core/src/lib.rs",
            "rust/conformance/behind.json",
        ],
    ));
    assert!(!passed, "{text}");
    assert!(text.contains("\n  jsonkit-a: stdout\n"), "{text}");
}

#[test]
fn growth_explained_by_the_cases_expected_files_passes_even_for_a_quoted_path() {
    let (passed, text) = verdict(&scenario(
        "explained",
        &base_without_a(),
        &none_accepted(),
        &[
            "rust/conformance/behind.json",
            "conformance/expected/jsonkit-a/files/r\u{e9}sum\u{e9} \"1\".txt",
        ],
    ));
    assert!(passed, "{text}");
}

#[test]
fn a_case_the_base_accepted_may_move_to_the_behind_list_with_its_accepted_parts() {
    let accepted = accepting("jsonkit-a", &["stdout"]);
    let (passed, text) = verdict(&scenario(
        "from-accepted",
        &base_without_a(),
        &accepted,
        &[],
    ));
    assert!(passed, "{text}");
}

#[test]
fn a_case_the_base_accepted_may_not_gain_a_part_it_never_accepted_on_the_move() {
    let accepted = accepting("jsonkit-a", &["exit"]);
    let (passed, text) = verdict(&scenario(
        "from-accepted-wider",
        &base_without_a(),
        &accepted,
        &[],
    ));
    assert!(!passed, "{text}");
    assert!(text.contains("\n  jsonkit-a: stdout\n"), "{text}");
}

#[test]
fn the_first_accepted_entry_for_a_case_decides_as_the_runner_reads_it() {
    let accepted = json!({ "accepted": [
        { "id": "jsonkit-a", "parts": ["exit"], "row": "r", "reason": "x" },
        { "id": "jsonkit-a", "parts": ["stdout"], "row": "r", "reason": "x" },
    ] });
    let (passed, text) = verdict(&scenario(
        "duplicate-accepted",
        &base_without_a(),
        &accepted,
        &[],
    ));
    assert!(!passed, "{text}");
}

/// Runs the binary's growth mode, which reads the committed behind list as its head.
fn binary(args: &[&std::ffi::OsStr]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_conformance-harness"))
        .args(args)
        .output()
        .expect("run the harness")
}

/// A scenario whose base is the committed behind list, so the binary sees no growth.
fn committed_scenario(name: &str) -> Scenario {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../behind.json");
    let committed: Value =
        serde_json::from_str(&fs::read_to_string(path).expect("read behind.json"))
            .expect("parse behind.json");
    scenario(name, &committed, &none_accepted(), &[])
}

#[test]
fn the_binary_passes_an_unchanged_committed_list_and_prints_the_verdict() {
    let s = committed_scenario("binary-unchanged");
    let out = binary(&[
        "--check-growth".as_ref(),
        s.base.as_os_str(),
        "--changed".as_ref(),
        s.changed.as_os_str(),
    ]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{stdout}");
    assert_eq!(
        stdout,
        "behind.json grows only where this change explains it.\n"
    );
}

#[test]
fn the_binary_exits_2_naming_a_malformed_base_list() {
    let s = committed_scenario("binary-malformed");
    fs::write(s.base.join("behind.json"), "{\"behind\": [").expect("truncate the base list");
    let out = binary(&[
        "--check-growth".as_ref(),
        s.base.as_os_str(),
        "--changed".as_ref(),
        s.changed.as_os_str(),
    ]);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(2), "{stderr}");
    assert!(
        stderr.contains(&s.base.join("behind.json").display().to_string()),
        "{stderr}"
    );
}

#[test]
fn check_growth_without_changed_exits_2_and_runs_no_case() {
    let s = committed_scenario("binary-lone-flag");
    let out = binary(&["--check-growth".as_ref(), s.base.as_os_str()]);
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

#[test]
fn check_growth_with_a_selection_exits_2() {
    let s = committed_scenario("binary-with-only");
    let out = binary(&[
        "--check-growth".as_ref(),
        s.base.as_os_str(),
        "--changed".as_ref(),
        s.changed.as_os_str(),
        "--only".as_ref(),
        "jsonkit".as_ref(),
    ]);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(2), "{stderr}");
    assert!(stderr.contains("with no other argument"), "{stderr}");
}
