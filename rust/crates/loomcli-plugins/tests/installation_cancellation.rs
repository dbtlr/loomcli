//! States how a cancelled install, uninstall, or replacement reaches the run, end to end on the
//! mock process: the module returns the run signal's cancellation echo, which `?` hands back to
//! core, so the run ends silently with the cancellation's exit code, as the reference's
//! `request.signal.throwIfAborted()` does (`installation-record.md`, Installed files;
//! `docs/core/signals.md`: "a thrown value that is the reason ... is silent").

#![cfg(feature = "installation")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod installation_support;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use installation_support::{Running, sandbox};
use loomcli_core::{Application, Context, ProcessHandle, RunOptions};
use loomcli_plugins::installation_test_support::{
    InstallRequest, InstalledFile, PluginRecord, ReplaceOptions, replace_file,
};
use loomcli_testing::{MockFields, mock_process};

/// Runs an action that cancels the run and then calls `operation` with the run's signal, and
/// answers the run's exit code, stdout, and stderr.
async fn cancelled_run(
    operation: impl Fn(&loomcli_core::RunSignal) -> Result<(), loomcli_core::Error>
    + Send
    + Sync
    + 'static,
) -> (u8, String, String) {
    let process = mock_process(MockFields::new().home("/home/me").platform("linux"));
    let operation = Arc::new(operation);
    let app = Application::new("notes").action(move |ctx: Context| {
        let operation = Arc::clone(&operation);
        async move {
            ctx.cancel();
            operation(&ctx.signal)?;
            ctx.out.print("not cancelled").await
        }
    });
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

/// The names in `directory`, sorted, or none when it is missing.
fn names(directory: &PathBuf) -> Vec<String> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn a_cancelled_install_ends_the_run_silently_with_130_and_writes_nothing() {
    let s = sandbox();
    let (record, first) = (s.record.clone(), s.first.clone());
    let outcome = cancelled_run(move |signal| {
        PluginRecord::new(&record, "skill")
            .install(
                &InstallRequest::new().files([InstalledFile::new(&first, "test")]),
                signal,
            )
            .map(drop)
            .map_err(Into::into)
    })
    .await;
    assert_eq!(outcome, (130, String::new(), String::new()));
    assert!(!s.record.exists());
    assert!(!s.directory.exists());
}

#[tokio::test]
async fn a_cancelled_uninstall_ends_the_run_silently_with_130_and_removes_nothing() {
    let s = sandbox();
    let installed = PluginRecord::new(&s.record, "skill").install(
        &InstallRequest::new().files([InstalledFile::new(&s.first, "test")]),
        &Running,
    );
    assert!(installed.is_ok());
    let before = fs::read(&s.owner).unwrap();
    let record = s.record.clone();
    let outcome = cancelled_run(move |signal| {
        PluginRecord::new(&record, "skill")
            .uninstall(&[], signal)
            .map(drop)
            .map_err(Into::into)
    })
    .await;
    assert_eq!(outcome, (130, String::new(), String::new()));
    assert_eq!(fs::read_to_string(&s.first).unwrap(), "test");
    assert_eq!(fs::read(&s.owner).unwrap(), before);
}

#[tokio::test]
async fn a_replacement_cancelled_before_its_rename_ends_the_run_silently_and_leaves_no_staging() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    fs::write(&s.first, "abc").unwrap();
    let first = s.first.clone();
    let outcome = cancelled_run(move |signal| {
        replace_file(&first, b"new", ReplaceOptions::new().signal(signal)).map_err(Into::into)
    })
    .await;
    assert_eq!(outcome, (130, String::new(), String::new()));
    assert_eq!(fs::read_to_string(&s.first).unwrap(), "abc");
    assert_eq!(names(&s.directory), ["SKILL.md"]);
}
