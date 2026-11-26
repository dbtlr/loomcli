//! The verbose plugin, ported from the reference's `verbose.test.ts`.

#![cfg(feature = "verbose")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{Application, Context, Done, NoInputs, NoResult, ProcessHandle, RunOptions};
use loomcli_plugins::verbose::verbose;
use loomcli_testing::{MockFields, mock_process};

type App = Application<NoInputs, NoResult, Done>;

/// An application whose action names the document it reads on a debug line, then prints a result.
fn reader() -> App {
    Application::new("reader")
        .plugins((verbose(),))
        .action(|ctx: Context| async move {
            ctx.log.debug("Reading doc.json.", ());
            ctx.out.print("a").await
        })
}

async fn run(argv: &[&str]) -> (u8, String, String) {
    let process = mock_process(MockFields::new().argv(argv.iter().copied()));
    let code = reader()
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn verbose_spellings_write_the_debug_line_on_stderr_and_the_result_on_stdout() {
    for argv in [&["-v"][..], &["-vv"], &["--verbose", "-v"]] {
        assert_eq!(
            run(argv).await,
            (0, "a\n".to_owned(), "› Reading doc.json.\n".to_owned()),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn no_flag_or_verbose_with_quiet_writes_no_debug_line() {
    for argv in [&[][..], &["-v", "-q"]] {
        assert_eq!(
            run(argv).await,
            (0, "a\n".to_owned(), String::new()),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn quiet_writes_the_result_on_stdout_and_nothing_on_stderr() {
    assert_eq!(run(&["-q"]).await, (0, "a\n".to_owned(), String::new()));
}

#[tokio::test]
async fn a_value_on_a_counted_option_fails_with_the_counted_unexpected_value_error() {
    let (status, stdout, stderr) = run(&["--verbose=2"]).await;
    assert_eq!(status, 2);
    assert_eq!(stdout, "");
    assert!(
        stderr.contains(
            "reader: Counted option \"--verbose\" does not accept a value. Repeat \"--verbose\" to raise its count.\n"
        ),
        "{stderr:?}"
    );
}

#[tokio::test]
async fn long_quiet_and_trace_depth_follow_the_count() {
    assert_eq!(
        run(&["--quiet"]).await,
        (0, "a\n".to_owned(), String::new())
    );
}
