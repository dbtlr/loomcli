//! Ports `closed-pipe.test.ts`: a reader that closes the run's stdout cancels the run with the
//! reason `ClosedPipe`, stops a streaming row source, writes nothing to stderr, and resolves 141,
//! while any other failed write, and a closed stderr, is a broken destination that resolves 1.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Build, CancellationSource, Context, NoInputs, ReleaseFacts, RowSource, RowView,
    RowViews, RowsResult, RunOptions, RunSignal, ViewContext,
};
use loomcli_testing::{MockFields, mock_process};
use support::streams::{Scripted, Seen, Swapped};
use tokio_util::sync::CancellationToken;

/// What one probe run did: its code, its stderr, what reached stdout, and what the action saw.
#[derive(Debug, PartialEq)]
struct Probe {
    code: u8,
    stderr: String,
    stdout: Vec<String>,
    printed: Vec<String>,
}

/// The reason the run's signal carries, as one line a test reads.
fn describe(signal: &RunSignal) -> String {
    match signal.reason() {
        Some(reason) => format!(
            "reason:{:?}:{}",
            reason.source,
            reason.cause.as_deref().unwrap_or("none")
        ),
        None => "reason:none".to_owned(),
    }
}

/// Runs `app` with stdout, or stderr when `stderr` is true, refusing from write `accepted + 1` on.
async fn probe<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    kind: io::ErrorKind,
    accepted: usize,
    stderr: bool,
    token: CancellationToken,
    printed: &Arc<Mutex<Vec<String>>>,
) -> Probe {
    let log = Arc::new(Mutex::new(Vec::new()));
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let mut handle = Swapped::new(Arc::clone(&mock));
    let refusing = Scripted::refusing(accepted, kind, Arc::clone(&log));
    if stderr {
        handle.stderr = Some(refusing);
    } else {
        handle.stdout = Some(refusing);
    }
    let code = app
        .run(RunOptions::new().process(Arc::new(handle)).signal(token))
        .await;
    let stdout = log
        .lock()
        .unwrap()
        .iter()
        .filter_map(|seen| match seen {
            Seen::Wrote(text) => Some(text.clone()),
            Seen::Refused(_) => None,
        })
        .collect();
    Probe {
        code: code.get(),
        stderr: mock.stderr_text(),
        stdout,
        printed: printed.lock().unwrap().clone(),
    }
}

/// An action that prints until a write is refused, then records what it saw and returns the error.
fn printing(
    printed: Arc<Mutex<Vec<String>>>,
) -> Application<NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Application::new("probe")
        .description("Probe a closed pipe.")
        .action(move |ctx: Context| {
            let printed = Arc::clone(&printed);
            async move {
                let mut line = 0;
                let error = loop {
                    if let Err(error) = ctx.out.print(&format!("line {line}")).await {
                        break error;
                    }
                    line += 1;
                };
                printed.lock().unwrap().push(format!(
                    "rejected:{}:aborted:{}",
                    error
                        .foreign()
                        .is_some_and(|foreign| foreign.to_string() == "The run was cancelled."),
                    ctx.signal.is_cancelled()
                ));
                printed.lock().unwrap().push(describe(&ctx.signal));
                Err(error)
            }
        })
}

#[tokio::test]
async fn an_action_awaiting_a_refused_print_sees_the_echo_and_propagating_it_is_silent() {
    for (kind, cause) in [
        (io::ErrorKind::BrokenPipe, "write BrokenPipe"),
        (io::ErrorKind::NotConnected, "write NotConnected"),
    ] {
        let printed = Arc::new(Mutex::new(Vec::new()));
        let app = printing(Arc::clone(&printed));
        assert_eq!(
            probe(&app, kind, 1, false, CancellationToken::new(), &printed).await,
            Probe {
                code: 141,
                stderr: String::new(),
                stdout: vec!["line 0\n".to_owned()],
                printed: vec![
                    "rejected:true:aborted:true".to_owned(),
                    format!("reason:{:?}:{cause}", CancellationSource::ClosedPipe),
                ],
            }
        );
    }
}

/// A row source that never ends, counting the rows pulled and noting when it is dropped.
struct Endless {
    pulled: Arc<AtomicUsize>,
    ended: Arc<AtomicBool>,
}

impl Iterator for Endless {
    type Item = usize;
    fn next(&mut self) -> Option<usize> {
        Some(self.pulled.fetch_add(1, Ordering::SeqCst) + 1)
    }
}

impl Drop for Endless {
    fn drop(&mut self) {
        self.ended.store(true, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn a_closed_reader_stops_a_streaming_row_source() {
    let pulled = Arc::new(AtomicUsize::new(0));
    let ended = Arc::new(AtomicBool::new(false));
    let printed = Arc::new(Mutex::new(Vec::new()));
    let (count, done, seen) = (
        Arc::clone(&pulled),
        Arc::clone(&ended),
        Arc::clone(&printed),
    );
    let app = Application::new("probe")
        .description("Probe a closed pipe.")
        .rows(RowViews::new().view(
            "lines",
            RowView::new(|row: &usize, _, _: &ViewContext| format!("{row}\n")),
        ))
        .action(move |ctx: Context<NoInputs, RowsResult<usize>>| {
            let source = Endless {
                pulled: Arc::clone(&count),
                ended: Arc::clone(&done),
            };
            let seen = Arc::clone(&seen);
            async move {
                let outcome = ctx.out.results(RowSource::Iter(Box::new(source))).await;
                seen.lock().unwrap().push(describe(&ctx.signal));
                outcome
            }
        });
    let ran = probe(
        &app,
        io::ErrorKind::BrokenPipe,
        1,
        false,
        CancellationToken::new(),
        &printed,
    )
    .await;
    assert_eq!(
        ran,
        Probe {
            code: 141,
            stderr: String::new(),
            stdout: vec!["1\n".to_owned()],
            printed: vec![format!(
                "reason:{:?}:write BrokenPipe",
                CancellationSource::ClosedPipe
            )],
        }
    );
    assert_eq!(pulled.load(Ordering::SeqCst), 2);
    assert!(ended.load(Ordering::SeqCst));
}

#[tokio::test]
async fn the_first_cause_to_cancel_the_run_fixes_its_code() {
    let printed = Arc::new(Mutex::new(Vec::new()));
    let caller = CancellationToken::new();
    let cancel = caller.clone();
    let seen = Arc::clone(&printed);
    let caller_first = Application::new("probe").action(move |ctx: Context| {
        let cancel = cancel.clone();
        let seen = Arc::clone(&seen);
        async move {
            cancel.cancel();
            let outcome = ctx.out.print("lost").await;
            seen.lock().unwrap().push(describe(&ctx.signal));
            outcome
        }
    });
    let ran = probe(
        &caller_first,
        io::ErrorKind::BrokenPipe,
        0,
        false,
        caller,
        &printed,
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (130, ""));
    assert_eq!(
        printed.lock().unwrap().drain(..).collect::<Vec<_>>(),
        [format!("reason:{:?}:none", CancellationSource::Caller)]
    );
    let caller = CancellationToken::new();
    let cancel = caller.clone();
    let seen = Arc::clone(&printed);
    let pipe_first = Application::new("probe").action(move |ctx: Context| {
        let cancel = cancel.clone();
        let seen = Arc::clone(&seen);
        async move {
            let _ = ctx.out.print("lost").await;
            cancel.cancel();
            seen.lock().unwrap().push(describe(&ctx.signal));
            Ok(())
        }
    });
    let ran = probe(
        &pipe_first,
        io::ErrorKind::BrokenPipe,
        0,
        false,
        caller,
        &printed,
    )
    .await;
    assert_eq!(
        ran,
        Probe {
            code: 141,
            stderr: String::new(),
            stdout: Vec::new(),
            printed: vec![format!(
                "reason:{:?}:write BrokenPipe",
                CancellationSource::ClosedPipe
            )],
        }
    );
}

#[tokio::test]
async fn a_closed_stderr_is_a_broken_destination_and_returns_1() {
    let printed = Arc::new(Mutex::new(Vec::new()));
    let app =
        Application::new("probe").action(|ctx: Context| async move { ctx.out.info("lost").await });
    let ran = probe(
        &app,
        io::ErrorKind::BrokenPipe,
        0,
        true,
        CancellationToken::new(),
        &printed,
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (1, ""));
}

#[tokio::test]
async fn a_stdout_write_that_fails_otherwise_is_a_broken_destination() {
    let printed = Arc::new(Mutex::new(Vec::new()));
    let app =
        Application::new("probe").action(|ctx: Context| async move { ctx.out.print("lost").await });
    let ran = probe(
        &app,
        io::ErrorKind::StorageFull,
        0,
        false,
        CancellationToken::new(),
        &printed,
    )
    .await;
    assert_eq!(
        (ran.code, ran.stderr.as_str()),
        (1, "probe: Something went wrong.\n")
    );
}

/// Runs `app` on a distributed mock built from `fields`, with the caller's token already
/// cancelled.
async fn cancelled_before_entry<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    fields: MockFields,
) -> (u8, String) {
    let process = mock_process(fields.release(ReleaseFacts::new(Build::Distributed)));
    let token = CancellationToken::new();
    token.cancel();
    let code = app
        .run(
            RunOptions::new()
                .process(Arc::clone(&process) as _)
                .signal(token),
        )
        .await;
    (code.get(), process.stderr_text())
}

#[tokio::test]
async fn a_cancelled_run_that_fails_before_graph_build_resolves_the_failures_own_code() {
    let app = Application::new("probe").action(|_: Context| async { Ok(()) });
    let unreadable = MockFields::new().cwd_with(|| Err(io::Error::from(io::ErrorKind::NotFound)));
    assert_eq!(
        cancelled_before_entry(&app, unreadable).await,
        (
            1,
            "probe: The current working directory cannot be read. Change to a directory that exists and run the command again.\n"
                .to_owned()
        )
    );
    let actionless = Application::new("probe");
    assert_eq!(
        cancelled_before_entry(&actionless, MockFields::new()).await,
        (1, "probe: Something went wrong.\n".to_owned())
    );
}
