//! Help paging on the real process handle, ported from the reference's
//! `help-paging-process.test.ts`: the real `/bin/sh`, real pipes, and a fixture pager script in a
//! folder whose name holds a space. The handle reports a terminal stdout of ten rows and eighty
//! columns, and its stdout and stderr are streams the test reads; a pager's inherited streams pipe
//! into them. The Ctrl-C case needs a pseudo-terminal and is not ported (see the test map).

#![cfg(all(feature = "help", unix))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use help_support::noop;
use loomcli_core::{
    Application, BoxFuture, Command, Env, GroupApplication, InputTerminal, NoInputs, NoResult,
    OutputStream, OutputTerminal, ProcessFields, ProcessHandle, ProcessTerminal, RunOptions,
    process_handle,
};
use loomcli_plugins::help::help;

/// A stream that keeps the bytes written to it.
#[derive(Default)]
struct Sink(Mutex<Vec<u8>>);

impl Sink {
    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

impl OutputStream for Sink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(async { Ok(()) })
    }
}

/// A terminal stdout of ten rows and eighty columns; stdin and stderr are not terminals.
struct TenRows;

impl ProcessTerminal for TenRows {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::default()
    }

    fn stdout(&self) -> OutputTerminal {
        OutputTerminal::new(true, Some(80), Some(10))
    }

    fn stderr(&self) -> OutputTerminal {
        OutputTerminal::new(false, None, None)
    }
}

/// The reference fixture's `notes` application: about twenty lines, or with `large` a description
/// larger than a pipe's buffer.
fn notes(large: bool, paging: bool) -> GroupApplication<NoInputs, NoResult> {
    let description = if large {
        "Keep notes in a folder. ".repeat(8000).trim().to_owned()
    } else {
        "Keep notes in a folder.".to_owned()
    };
    let mut application = Application::new("notes")
        .plugins((help().paging(paging),))
        .description(description)
        .command(note("add"));
    for name in ["edit", "list", "move", "remove", "show", "sync", "tag"] {
        application = application.command(note(name));
    }
    application
}

fn note(name: &str) -> Command {
    Command::new(name)
        .description(format!("Run {name} on the notes."))
        .action(noop)
}

/// The environment of one run: the test's `PATH`, a `TERM` that draws, no `LESS`, and `pager`.
fn environment(pager: &str) -> Env {
    let mut env = Env::new();
    env.insert("PATH".to_owned(), std::env::var("PATH").unwrap_or_default());
    env.insert("TERM".to_owned(), "xterm-256color".to_owned());
    env.insert("PAGER".to_owned(), pager.to_owned());
    env
}

/// What one `--help` run on the real handle ended with: its code, stdout, and stderr. With
/// `together`, stdout and stderr are one stream, read as stdout.
async fn run(
    application: &GroupApplication<NoInputs, NoResult>,
    pager: &str,
    together: bool,
) -> (u8, String, String) {
    let stdout = Arc::new(Sink::default());
    let stderr = if together {
        Arc::clone(&stdout)
    } else {
        Arc::new(Sink::default())
    };
    let handle = process_handle(
        ProcessFields::new()
            .argv(["--help"])
            .env(environment(pager))
            .terminal(Arc::new(TenRows))
            .stdout(Arc::clone(&stdout) as Arc<dyn OutputStream>)
            .stderr(Arc::clone(&stderr) as Arc<dyn OutputStream>),
    );
    let code = application
        .run(RunOptions::new().process(handle as Arc<dyn ProcessHandle>))
        .await;
    let stderr = if together {
        String::new()
    } else {
        stderr.text()
    };
    (code.get(), stdout.text(), stderr)
}

/// A new folder for one case, holding `my pager/`, under the target's temporary folder.
fn folder(case: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join("help-paging-process")
        .join(case);
    if root.exists() {
        std::fs::remove_dir_all(&root).unwrap();
    }
    let folder = root.join("my pager");
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

/// A pager that records the page it reads and announces itself with the `LESS` it received.
fn pager_in(folder: &Path) -> (PathBuf, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let pager = folder.join("pager.sh");
    let recorded = folder.join("page.txt");
    std::fs::write(
        &pager,
        format!(
            "#!/bin/sh\ncat > '{}'\necho \"pager-ready:$LESS:\"\n",
            recorded.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&pager, std::fs::Permissions::from_mode(0o755)).unwrap();
    (pager, recorded)
}

/// The page `--help` prints with paging off on the same handle.
async fn unpaged(large: bool) -> String {
    let (code, stdout, stderr) = run(&notes(large, false), "", false).await;
    assert_eq!((code, stderr.as_str()), (0, ""));
    assert!(stdout.matches('\n').count() >= 10);
    stdout
}

#[tokio::test]
async fn a_pager_path_holding_a_space_runs_with_less_frx_and_reads_the_page() {
    let (pager, recorded) = pager_in(&folder("quoted"));
    let page = unpaged(false).await;
    let (code, stdout, stderr) = run(
        &notes(false, true),
        &format!("'{}'", pager.display()),
        false,
    )
    .await;
    assert_eq!(
        (code, stdout.as_str(), stderr.as_str()),
        (0, "pager-ready:FRX:\n", "")
    );
    assert_eq!(std::fs::read_to_string(recorded).unwrap(), page);
}

#[tokio::test]
async fn a_pager_that_pipes_through_tr_hands_the_pager_the_page_in_capitals() {
    let (pager, recorded) = pager_in(&folder("piped"));
    let page = unpaged(false).await;
    assert!(page.contains("Run add on the notes."));
    let (code, stdout, stderr) = run(
        &notes(false, true),
        &format!("tr a-z A-Z | '{}'", pager.display()),
        false,
    )
    .await;
    assert_eq!(
        (code, stdout.as_str(), stderr.as_str()),
        (0, "pager-ready:FRX:\n", "")
    );
    assert_eq!(
        std::fs::read_to_string(recorded).unwrap(),
        page.to_ascii_uppercase()
    );
}

#[tokio::test]
async fn a_pager_that_names_no_program_prints_the_shells_line_then_the_page_and_exits_0() {
    let page = unpaged(false).await;
    // The line this system's shell writes for the command it cannot find, read from the shell.
    let shell = std::process::Command::new("/bin/sh")
        .args(["-c", "exec loom-no-such-pager"])
        .env_clear()
        .envs(environment("loom-no-such-pager"))
        .env("LESS", "FRX")
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    assert_eq!(shell.status.code(), Some(127));
    let line = String::from_utf8(shell.stderr).unwrap();
    assert!(line.contains("loom-no-such-pager: not found"), "{line}");
    let (code, written, _) = run(&notes(false, true), "loom-no-such-pager", true).await;
    assert_eq!(code, 0);
    assert_eq!(written, format!("{line}{page}"));
}

#[tokio::test]
async fn a_pager_that_quits_before_reading_a_page_larger_than_a_pipe_leaves_the_run_at_0() {
    let page = unpaged(true).await;
    assert!(page.len() > 1 << 17);
    assert_eq!(
        run(&notes(true, true), "true", false).await,
        (0, String::new(), String::new())
    );
}
