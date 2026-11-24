//! Ports the case of `self-update.test.ts` whose run is cancelled after the rename: the record is
//! written, the hook is called with a cancelled signal, and the run exits 130. The cancellation
//! comes from the installed-files module's probe once the record is renamed into place, and the
//! probe is process-wide, so the case runs in a process of its own.

#![cfg(feature = "self-update")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod self_update_support;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use loomcli_plugins::installation_test_support::{Step, set_probe};
use self_update_support::{
    Fixture, Hook, OLD_BYTES, Records, RunFacts, default_github, lines, mock_for, record_line,
    run_on, sandbox_with, script_facts,
};
use serde_json::json;
use tokio_util::sync::CancellationToken;

/// The run the probe cancels once a record is renamed into place.
static CANCELS: Mutex<Option<CancellationToken>> = Mutex::new(None);

fn probe(step: Step<'_>) {
    if let Step::AfterRename { to, .. } = step
        && to.file_name().is_some_and(|name| name == "install.json")
        && let Some(token) = CANCELS.lock().unwrap().as_ref()
    {
        token.cancel();
    }
}

#[tokio::test]
async fn a_run_cancelled_after_the_rename_writes_the_record_calls_the_hook_with_a_cancelled_signal_and_exits_130()
 {
    assert!(set_probe(probe));
    let s = sandbox_with(OLD_BYTES);
    let controller = CancellationToken::new();
    *CANCELS.lock().unwrap() = Some(controller.clone());
    let fixture = Fixture {
        github: default_github(),
        rules: Vec::new(),
        hook: Hook::Record,
        notices: None,
        notice_env: None,
        help: None,
        restyle: false,
        version: "1.4.2".to_owned(),
        records: Records::default(),
        controller,
        locked: None,
        after_replace: None,
        verbose: false,
    };
    let process = mock_for(
        &RunFacts {
            argv: vec!["self-update".to_owned()],
            env: vec![
                ("HOME".to_owned(), s.home.to_string_lossy().into_owned()),
                (
                    "XDG_STATE_HOME".to_owned(),
                    s.state.to_string_lossy().into_owned(),
                ),
            ],
            home: PathBuf::from(&s.home),
            cwd: None,
            release: script_facts(&s, "1.4.2", OLD_BYTES),
            program: None,
            tty: None,
        },
        |fields| fields,
    );
    let ran = run_on(&fixture, "run", &process).await;
    assert_eq!(ran.status, 130, "{}", ran.stderr);
    assert_eq!(
        fs::read_to_string(&s.binary).unwrap(),
        "notes 1.5.0 binary\n"
    );
    assert_eq!(
        fs::read_to_string(&s.record).unwrap(),
        record_line(&s.binary, "notes 1.5.0 binary\n")
    );
    assert_eq!(
        lines(&ran.stderr).last().unwrap(),
        "Updated notes from 1.4.2 to 1.5.0."
    );
    assert_eq!(
        fixture.records.hook_calls(),
        [json!({
            "aborted": true,
            "current": "1.5.0",
            "host": "1.4.2",
            "path": s.binary.to_string_lossy(),
            "previous": "1.4.2",
        })]
    );
}
