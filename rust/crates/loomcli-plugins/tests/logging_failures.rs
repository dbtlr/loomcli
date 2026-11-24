//! A failed write of the logging plugin, ported from the reference's `logging.test.ts`: the
//! `on_error` hook, the unresolved directory, a failed rotation, and the run's own exit code.

#![cfg(all(feature = "logging", unix))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod logging_support;

use std::fs;

use logging_support::{
    Facts, OnError, Outcome, Sandbox, lines, names, read_only, record, run, run_default,
    unprivileged,
};
use loomcli_plugins::logging::logging;

fn failure(cause: &str, kind: &str, path: &std::path::Path) -> String {
    format!(
        "onError:{}",
        serde_json::json!({ "cause": cause, "kind": kind, "path": path, "variable": null })
    )
}

#[tokio::test]
async fn a_read_only_log_directory_reports_an_append_failure_for_each_record() {
    if !unprivileged() {
        return;
    }
    let sandbox = Sandbox::new();
    read_only(&sandbox.directory());
    let ran = run(
        &sandbox,
        &["burst", "2", "0", "m"],
        Facts::default().on_error(OnError::Print),
        logging(),
    )
    .await;
    let line = failure("EACCES", "append", &sandbox.file);
    assert_eq!(
        ran,
        Outcome {
            status: 0,
            stderr: String::new(),
            stdout: String::new(),
            reports: vec![line.clone(), line],
        }
    );
}

#[tokio::test]
async fn a_state_directory_that_cannot_hold_the_log_directory_reports_a_create_directory_failure_for_each_record()
 {
    if !unprivileged() {
        return;
    }
    let sandbox = Sandbox::new();
    read_only(&sandbox.state);
    let ran = run(
        &sandbox,
        &["burst", "2", "0", "m"],
        Facts::default().on_error(OnError::Print),
        logging(),
    )
    .await;
    let line = failure("EACCES", "create-directory", &sandbox.directory());
    assert_eq!(ran.reports, [line.clone(), line]);
    assert_eq!(ran.stderr, "");
}

#[tokio::test]
async fn an_unset_home_reports_an_unresolved_directory_that_names_the_variable() {
    let sandbox = Sandbox::new();
    let ran = run(
        &sandbox,
        &["burst", "2", "0", "m"],
        Facts::env(&[]).on_error(OnError::Print).platform("linux"),
        logging(),
    )
    .await;
    let line =
        r#"onError:{"cause":null,"kind":"unresolved-directory","path":null,"variable":"HOME"}"#;
    assert_eq!(
        ran,
        Outcome {
            status: 0,
            stderr: String::new(),
            stdout: String::new(),
            reports: vec![line.to_owned(), line.to_owned()],
        }
    );
}

#[tokio::test]
async fn a_relative_home_reports_an_unresolved_directory_for_the_default_directory_and_for_tilde() {
    for file in [None, Some("~/x.jsonl")] {
        let sandbox = Sandbox::new();
        let settings = file.map_or_else(logging, |file| logging().file(file));
        let ran = run(
            &sandbox,
            &["burst", "1", "0", "m"],
            Facts::env(&[("HOME", "home")]).on_error(OnError::Print),
            settings,
        )
        .await;
        let line =
            r#"onError:{"cause":null,"kind":"unresolved-directory","path":null,"variable":"HOME"}"#;
        assert_eq!(ran.reports, [line], "{file:?}");
        assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
        assert_eq!(names(&sandbox.work), Vec::<String>::new());
    }
}

#[tokio::test]
async fn a_rotation_that_fails_reports_it_and_the_record_is_still_written() {
    let sandbox = Sandbox::new();
    // A copy that is a directory cannot be deleted as the copy past keep.
    fs::create_dir_all(sandbox.directory().join("heimdall.1.jsonl").join("inside")).unwrap();
    let ran = run(
        &sandbox,
        &["burst", "2", "0", "m"],
        Facts::default().on_error(OnError::Print),
        logging().keep(1).max_bytes(200),
    )
    .await;
    assert_eq!(ran.reports.len(), 1);
    let report: serde_json::Value =
        serde_json::from_str(ran.reports[0].strip_prefix("onError:").unwrap()).unwrap();
    assert_eq!(report["kind"], "rotate");
    assert_eq!(report["path"], serde_json::json!(sandbox.file));
    assert_eq!(lines(&sandbox.file).len(), 2);
}

#[tokio::test]
async fn with_no_on_error_a_failed_write_leaves_the_run_its_own_exit_code_and_writes_nothing_to_stderr()
 {
    if !unprivileged() {
        return;
    }
    let sandbox = Sandbox::new();
    let writable = Sandbox::new();
    read_only(&sandbox.directory());
    assert_eq!(
        run_default(&sandbox, &["log"]).await,
        Outcome {
            status: 0,
            stderr: String::new(),
            stdout: String::new(),
            reports: Vec::new(),
        }
    );
    let failed = run_default(&sandbox, &["fail"]).await;
    assert_eq!(failed.status, 1);
    let reference = run_default(&writable, &["fail"]).await;
    assert_eq!(failed.stderr, reference.stderr);
    assert_ne!(failed.stderr, "");
}

#[tokio::test]
async fn a_later_record_lands_once_the_directory_is_writable() {
    if !unprivileged() {
        return;
    }
    let sandbox = Sandbox::new();
    let directory = sandbox.directory();
    read_only(&directory);
    let ran = run(
        &sandbox,
        &["heal", &directory.display().to_string()],
        Facts::default().on_error(OnError::Print),
        logging(),
    )
    .await;
    assert_eq!(ran.reports, [failure("EACCES", "append", &sandbox.file)]);
    assert_eq!(
        lines(&sandbox.file),
        [record(
            "info",
            "After healing.",
            serde_json::json!({}),
            &["heal"]
        )]
    );
}

#[tokio::test]
async fn an_on_error_that_fails_is_reported_as_a_foreign_throw_from_the_hook_and_the_run_exits_1() {
    if !unprivileged() {
        return;
    }
    let sandbox = Sandbox::new();
    read_only(&sandbox.directory());
    let ran = run(
        &sandbox,
        &["log"],
        Facts::default().on_error(OnError::Throw),
        logging(),
    )
    .await;
    assert_eq!(ran.status, 1);
    assert_eq!(ran.stdout, "");
    assert!(
        ran.stderr.starts_with("-- UNHANDLED EXCEPTION -"),
        "{}",
        ran.stderr
    );
    let header_end = ran.stderr.find('\n').unwrap();
    assert!(
        ran.stderr[..header_end].ends_with(" @loomcli/core/foreign-throw"),
        "{}",
        ran.stderr
    );
    assert!(
        ran.stderr[header_end..].starts_with("\n\nThe callback broke.\n"),
        "{}",
        ran.stderr
    );
}
