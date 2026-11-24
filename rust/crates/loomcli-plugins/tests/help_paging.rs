//! Help paging, ported from the reference's `help-paging.test.ts` and `help-pager.test.ts`, on a
//! mock whose terminal reports rows, with `/bin/sh` scripted as the pager's shell.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use std::sync::{Arc, Mutex};

use help_support::{noop, run_with};
use loomcli_core::{
    Application, Command, NoInputs, NoResult, ProcessHandle, ProcessSignal, RunOptions,
};
use loomcli_plugins::help::{Help, help};
use loomcli_testing::{MockFields, MockTerminal, ProgramAnswer, ProgramCall, mock_process};
use tokio_util::sync::CancellationToken;

type App = loomcli_core::GroupApplication<NoInputs, NoResult>;

/// An application whose extended page runs to more than ten lines.
fn notes(settings: Help) -> App {
    let mut application = Application::new("notes")
        .plugins((settings,))
        .description("Keep notes in a folder.")
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

/// A terminal of ten rows and eighty columns, with `env` and a `TERM` that draws.
fn terminal(argv: &[&str]) -> MockFields {
    MockFields::new()
        .argv(argv.iter().copied())
        .env("TERM", "xterm-256color")
        .terminal(MockTerminal::new(80, 10))
}

/// The page one run prints to stdout with paging off.
async fn unpaged(fields: MockFields) -> String {
    let (outcome, _) = run_with(&notes(help()), fields, None).await;
    assert_eq!(outcome.status, 0);
    outcome.stdout
}

/// Builds the mock fields of one case afresh for each run.
type FieldsOf = Box<dyn Fn() -> MockFields>;

/// One paged run, with `/bin/sh` answering `code` and each call it received recorded.
async fn paged(fields: MockFields, code: i32) -> (u8, Vec<ProgramCall>, String) {
    let calls: Arc<Mutex<Vec<ProgramCall>>> = Arc::default();
    let recorded = Arc::clone(&calls);
    let fields = fields.script("/bin/sh", move |call| {
        recorded.lock().unwrap().push(call);
        async move { Ok(ProgramAnswer::new().code(code)) }
    });
    let (outcome, _) = run_with(&notes(help().paging(true)), fields, None).await;
    let calls = calls.lock().unwrap().clone();
    (outcome.status, calls, outcome.stdout)
}

#[tokio::test]
async fn with_paging_on_a_page_longer_than_the_terminal_goes_to_less() {
    for flag in ["--help", "-h"] {
        let page = unpaged(terminal(&[flag])).await;
        assert!(page.matches('\n').count() >= 10);
        let (code, calls, stdout) = paged(terminal(&[flag]), 0).await;
        assert_eq!(code, 0);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].command, "/bin/sh");
        assert_eq!(calls[0].args, ["-c", "exec less"]);
        assert_eq!(calls[0].input, page);
        assert_eq!(calls[0].env.get("LESS").map(String::as_str), Some("FRX"));
        assert_eq!(stdout, "");
    }
}

#[tokio::test]
async fn with_paging_off_by_default_a_long_page_prints_to_stdout_and_starts_no_program() {
    let page = unpaged(terminal(&["--help"])).await;
    let (outcome, _) = run_with(&notes(help()), terminal(&["--help"]), None).await;
    assert_eq!(outcome.stdout, page);
    let (outcome, _) = run_with(&notes(help().paging(false)), terminal(&["--help"]), None).await;
    assert_eq!(outcome.status, 0);
    assert_eq!(outcome.stdout, page);
}

#[tokio::test]
async fn with_paging_on_the_page_prints_as_paging_off_prints_it_when_paging_does_not_apply() {
    let on_terminal = |pairs: &[(&str, &str)], rows: u16| {
        let mut fields = MockFields::new()
            .argv(["--help"])
            .terminal(MockTerminal::new(80, rows));
        for (name, value) in pairs {
            fields = fields.env(name, value);
        }
        fields
    };
    let cases: Vec<(&str, FieldsOf)> = vec![
        (
            "stdout is a pipe",
            Box::new(|| {
                MockFields::new()
                    .argv(["--help"])
                    .env("TERM", "xterm-256color")
            }),
        ),
        ("TERM is unset", Box::new(move || on_terminal(&[], 10))),
        (
            "TERM is empty",
            Box::new(move || on_terminal(&[("TERM", "")], 10)),
        ),
        (
            "TERM is dumb",
            Box::new(move || on_terminal(&[("TERM", "dumb")], 10)),
        ),
        (
            "the run is under CI",
            Box::new(move || on_terminal(&[("CI", "true"), ("TERM", "xterm-256color")], 10)),
        ),
        (
            "the page is shorter than the rows",
            Box::new(move || on_terminal(&[("TERM", "xterm-256color")], 60)),
        ),
        (
            "PAGER is empty",
            Box::new(move || on_terminal(&[("PAGER", ""), ("TERM", "xterm-256color")], 10)),
        ),
        (
            "PAGER is blank",
            Box::new(move || on_terminal(&[("PAGER", "  "), ("TERM", "xterm-256color")], 10)),
        ),
        (
            "PAGER is cat",
            Box::new(move || on_terminal(&[("PAGER", "cat"), ("TERM", "xterm-256color")], 10)),
        ),
        (
            "PAGER is cat with spaces",
            Box::new(move || on_terminal(&[("PAGER", " cat "), ("TERM", "xterm-256color")], 10)),
        ),
    ];
    for (name, fields) in cases {
        let page = unpaged(fields()).await;
        // No /bin/sh script, so a pager start would fail the run with the mock's sentence.
        let (outcome, _) = run_with(&notes(help().paging(true)), fields(), None).await;
        assert_eq!(outcome.status, 0, "{name}");
        assert_eq!(outcome.stdout, page, "{name}");
    }
}

#[tokio::test]
async fn ci_false_lets_help_page_again() {
    let (code, calls, _) = paged(terminal(&["--help"]).env("CI", "false"), 0).await;
    assert_eq!(code, 0);
    assert_eq!(calls.len(), 1);
}

#[tokio::test]
async fn a_page_with_exactly_as_many_lines_as_the_rows_is_paged() {
    let page = unpaged(terminal(&["--help"])).await;
    let rows = u16::try_from(page.matches('\n').count()).unwrap();
    let fields = MockFields::new()
        .argv(["--help"])
        .env("TERM", "xterm-256color")
        .terminal(MockTerminal::new(80, rows));
    let (_, calls, _) = paged(fields, 0).await;
    assert_eq!(calls.len(), 1);
}

#[tokio::test]
async fn the_operators_less_reaches_the_pager_as_it_is() {
    for less in ["-R", ""] {
        let (_, calls, _) = paged(terminal(&["--help"]).env("LESS", less), 0).await;
        assert_eq!(calls[0].env.get("LESS").map(String::as_str), Some(less));
    }
}

#[tokio::test]
async fn a_pager_with_arguments_reaches_the_shell_behind_exec_as_the_operator_wrote_it() {
    let (_, calls, _) = paged(
        terminal(&["--help"]).env("PAGER", "'/opt/my pager/most' -s"),
        0,
    )
    .await;
    assert_eq!(calls[0].args, ["-c", "exec '/opt/my pager/most' -s"]);
}

#[tokio::test]
async fn a_shell_that_exits_126_or_127_could_not_run_the_pager_so_the_page_prints_unpaged() {
    let page = unpaged(terminal(&["--help"])).await;
    for status in [126, 127] {
        let (code, _, stdout) = paged(terminal(&["--help"]), status).await;
        assert_eq!(code, 0);
        assert_eq!(stdout, page);
    }
}

#[tokio::test]
async fn a_shell_that_cannot_start_leaves_the_page_unpaged() {
    let page = unpaged(terminal(&["--help"])).await;
    let fields = terminal(&["--help"]).script("/bin/sh", |_call| async {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "spawn /bin/sh ENOENT",
        ))
    });
    let (outcome, _) = run_with(&notes(help().paging(true)), fields, None).await;
    assert_eq!(outcome.status, 0);
    assert_eq!(outcome.stdout, page);
}

#[tokio::test]
async fn a_pager_that_exits_with_another_code_leaves_the_run_at_0_and_prints_nothing() {
    for status in [1, 3, 141] {
        let (code, _, stdout) = paged(terminal(&["--help"]), status).await;
        assert_eq!(code, 0);
        assert_eq!(stdout, "");
    }
}

#[tokio::test]
async fn a_run_cancelled_while_the_pager_is_open_ends_the_pager_and_resolves_130() {
    let controller = CancellationToken::new();
    let ended: Arc<Mutex<Option<CancellationToken>>> = Arc::default();
    let (cancel, mark) = (controller.clone(), Arc::clone(&ended));
    let fields = terminal(&["--help"]).script("/bin/sh", move |call| {
        let (cancel, mark) = (cancel.clone(), Arc::clone(&mark));
        async move {
            cancel.cancel();
            // The pager's own signal is cancelled when the run ends it.
            *mark.lock().unwrap() = Some(call.signal.clone());
            call.signal.cancelled().await;
            Ok(ProgramAnswer::new().code(143))
        }
    });
    let process = mock_process(fields);
    let code = notes(help().paging(true))
        .run(
            RunOptions::new()
                .process(Arc::clone(&process) as Arc<dyn ProcessHandle>)
                .signal(controller),
        )
        .await;
    assert_eq!(code.get(), 130);
    assert!(
        ended
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
    );
    assert_eq!(process.stdout_text(), "");
}

#[tokio::test]
async fn sigint_while_the_pager_is_open_ends_the_pager_and_resolves_130() {
    let ended: Arc<Mutex<Option<CancellationToken>>> = Arc::default();
    let raised: Arc<Mutex<Option<Arc<loomcli_testing::MockProcess>>>> = Arc::default();
    let (mark, handle) = (Arc::clone(&ended), Arc::clone(&raised));
    let fields = terminal(&["--help"]).script("/bin/sh", move |call| {
        let (mark, handle) = (Arc::clone(&mark), Arc::clone(&handle));
        async move {
            let process = handle.lock().unwrap().clone();
            if let Some(process) = process {
                process.raise(ProcessSignal::Int);
            }
            // The pager's own signal is cancelled when the run ends it.
            *mark.lock().unwrap() = Some(call.signal.clone());
            call.signal.cancelled().await;
            Ok(ProgramAnswer::new().code(143))
        }
    });
    let process = mock_process(fields);
    *raised.lock().unwrap() = Some(Arc::clone(&process));
    let code = notes(help().paging(true))
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 130);
    assert!(
        ended
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
    );
    assert_eq!(process.stdout_text(), "");
}

#[tokio::test]
async fn while_the_pager_is_open_a_shutdown_sends_it_sigterm() {
    // `help-pager.test.ts` drives the shutdown handler with stand-ins for the spawn and the lane.
    // Here the run's own shutdown does: SIGTERM raised while the pager is open runs the handler,
    // which ends the pager, and the run resolves the signal's code.
    let ended: Arc<Mutex<Option<CancellationToken>>> = Arc::default();
    let raised: Arc<Mutex<Option<Arc<loomcli_testing::MockProcess>>>> = Arc::default();
    let (mark, handle) = (Arc::clone(&ended), Arc::clone(&raised));
    let fields = terminal(&["--help"]).script("/bin/sh", move |call| {
        let (mark, handle) = (Arc::clone(&mark), Arc::clone(&handle));
        async move {
            let process = handle.lock().unwrap().clone();
            if let Some(process) = process {
                process.raise(ProcessSignal::Term);
            }
            // The pager's own signal is cancelled when the run ends it.
            *mark.lock().unwrap() = Some(call.signal.clone());
            call.signal.cancelled().await;
            Ok(ProgramAnswer::new().code(143))
        }
    });
    let process = mock_process(fields);
    *raised.lock().unwrap() = Some(Arc::clone(&process));
    let code = notes(help().paging(true))
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 143);
    assert!(
        ended
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
    );
    assert_eq!(process.stdout_text(), "");
}
