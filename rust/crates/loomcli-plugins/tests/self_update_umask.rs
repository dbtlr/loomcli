//! Ports the umask row of the first case of `self-update.test.ts`: under umask 077, an update keeps
//! the replaced binary's mode 755 and writes the installation record with mode 600, whatever the
//! umask. The umask is process-wide, so the case runs in a process of its own.

#![cfg(feature = "self-update")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod self_update_support;

use std::fs;
use std::path::PathBuf;

use rustix::fs::Mode;
use rustix::process::umask;
use self_update_support::{
    Fixture, Hook, OLD_BYTES, Records, RunFacts, default_github, lines, mock_for, mode_of,
    record_line, run_on, sandbox_with, script_facts, staging_files,
};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn under_umask_077_the_binary_keeps_mode_755_and_the_record_takes_mode_600() {
    let s = sandbox_with(OLD_BYTES);
    let fixture = Fixture {
        github: default_github(),
        rules: Vec::new(),
        hook: Hook::None,
        notices: None,
        notice_env: None,
        help: None,
        restyle: false,
        version: "1.4.2".to_owned(),
        records: Records::default(),
        controller: CancellationToken::new(),
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
    let previous = umask(Mode::from_raw_mode(0o077));
    let ran = run_on(&fixture, "run", &process).await;
    umask(previous);
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert_eq!(
        lines(&ran.stderr),
        [
            "Downloading notes-linux-x64 from v1.5.0 of acme/notes.",
            "Updated notes from 1.4.2 to 1.5.0.",
        ]
    );
    assert_eq!(mode_of(&s.binary), 0o755);
    assert_eq!(mode_of(&s.record), 0o600);
    assert_eq!(
        fs::read_to_string(&s.record).unwrap(),
        record_line(&s.binary, "notes 1.5.0 binary\n")
    );
    assert_eq!(staging_files(&s.bin), Vec::<String>::new());
}
