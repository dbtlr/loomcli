//! Ports `shutdown.test.ts`, the mock half of `shutdown-process.test.ts`, and the mock half of
//! `cancellation.test.ts`: the shutdown an ending signal starts, proven through a mock's signal
//! source, so nothing reaches the process the tests run in.
//!
//! - Listening. A `run()` listens on its handle's signal source from the call, for `SIGINT`,
//!   `SIGTERM`, `SIGHUP`, `SIGQUIT`, and the exit event, and holds nothing before or after. An
//!   `invoke` never starts listening.
//! - The shutdown. An ending signal cancels every live run with its name as the source. It ends at
//!   the first of every run resolved, the budget (the longest among the runs live at the first
//!   signal), or a second ending signal; `SIGQUIT` skips the budget. A run started during it starts
//!   cancelled. At its end each queued region frame reaches the terminal and the cursor shows,
//!   every pending handler runs once, newest first, and the first signal is re-raised on the source,
//!   which ends the mock.
//! - Handlers. A run's handler goes with its run when no shutdown is under way; one registered after
//!   its run is never called; a removed one is not called; a panic is caught and logged naming the
//!   plugin.
//! - Suspend and resume. On `SIGTSTP` the suspend handlers run newest first and `SIGTSTP` is raised
//!   again with core's listener gone; the resume handlers then run in registration order.
//!
//! The last run to resolve during a shutdown ends it as it leaves, before `run()` returns, where the
//! reference ends it on the next turn of the event loop: a recorded deviation, so these tests read
//! `ended_by` once `run()` has returned.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use loomcli_core::{
    Activation, Application, Build, CancellationSource, Command, Context, EndingSignal,
    InvocationOutcome, InvocationValues, InvokeOptions, LogDestination, LogEvent, Plugin,
    ProcessHandle, ProcessSignal, RegionOptions, ReleaseFacts, RunOptions, RunSignal,
    ShutdownCause, ShutdownEvent, SignalEvent, SignalListener, SignalSource, View,
};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use tokio_util::sync::CancellationToken;

type Lines = Arc<Mutex<Vec<String>>>;

fn push(lines: &Lines, line: impl Into<String>) {
    lines.lock().unwrap().push(line.into());
}

fn read(lines: &Lines) -> Vec<String> {
    lines.lock().unwrap().clone()
}

/// The events a lane listens for, in the order a count reads them.
const EVENTS: [SignalEvent; 7] = [
    SignalEvent::Signal(ProcessSignal::Int),
    SignalEvent::Signal(ProcessSignal::Term),
    SignalEvent::Signal(ProcessSignal::Hup),
    SignalEvent::Signal(ProcessSignal::Quit),
    SignalEvent::Exit,
    SignalEvent::Signal(ProcessSignal::Tstp),
    SignalEvent::Signal(ProcessSignal::Cont),
];

/// The listeners core holds on one mock's source, per event.
fn listening(mock: &MockProcess) -> String {
    EVENTS
        .iter()
        .map(|event| mock.listeners(*event).to_string())
        .collect::<Vec<_>>()
        .join(",")
}

const NONE: &str = "0,0,0,0,0,0,0";
const RUNNING: &str = "1,1,1,1,1,0,0";

fn signal_name(signal: EndingSignal) -> &'static str {
    match signal {
        EndingSignal::Hup => "SIGHUP",
        EndingSignal::Int => "SIGINT",
        EndingSignal::Quit => "SIGQUIT",
        EndingSignal::Term => "SIGTERM",
    }
}

/// The text of one shutdown event, as the order tests record it.
fn described(label: &str, event: ShutdownEvent) -> String {
    let cause = match event.cause {
        ShutdownCause::Signal(signal) => signal_name(signal),
        ShutdownCause::Exit => "exit",
    };
    format!("{label}:{cause}:{}", event.code)
}

/// The source a run's signal was cancelled with, or `none`.
fn source_of(signal: &RunSignal) -> String {
    match signal.reason().map(|reason| reason.source) {
        Some(CancellationSource::Signal(signal)) => signal_name(signal).to_owned(),
        Some(CancellationSource::Caller) => "caller".to_owned(),
        Some(CancellationSource::Action) => "action".to_owned(),
        Some(CancellationSource::ClosedPipe) => "closed-pipe".to_owned(),
        Some(_) | None => "none".to_owned(),
    }
}

fn options(mock: &Arc<MockProcess>) -> RunOptions {
    RunOptions::new().process(Arc::clone(mock) as Arc<dyn ProcessHandle>)
}

/// Waits until `done` holds, failing after five seconds.
async fn until(done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !done() {
        assert!(Instant::now() < deadline, "the condition never held");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// A notification an action sends once it reached its wait.
fn reached() -> (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>) {
    let notify = Arc::new(tokio::sync::Notify::new());
    (Arc::clone(&notify), notify)
}

// Listening.

#[tokio::test]
async fn a_run_listens_from_the_moment_run_is_called_and_holds_nothing_before_or_after() {
    let mock = mock_process(MockFields::new());
    let counts: Lines = Arc::default();
    push(&counts, listening(&mock));
    let app = Application::new("app").action({
        let (mock, counts) = (Arc::clone(&mock), Arc::clone(&counts));
        move |_: Context| {
            let (mock, counts) = (Arc::clone(&mock), Arc::clone(&counts));
            async move {
                push(&counts, listening(&mock));
                Ok(())
            }
        }
    });
    let running = app.run(options(&mock));
    push(&counts, listening(&mock));
    assert_eq!(running.await.get(), 0);
    push(&counts, listening(&mock));
    assert_eq!(read(&counts), [NONE, RUNNING, RUNNING, NONE]);
}

#[tokio::test]
async fn a_run_that_ends_any_way_holds_no_listener_after() {
    for (argv, cancels, fails, code) in [
        (vec!["nope"], false, false, 2),
        (vec![], false, true, 1),
        (vec![], true, false, 130),
        (vec!["--nope"], false, false, 2),
    ] {
        let mock = mock_process(MockFields::new().argv(argv));
        let app = Application::new("app").action(move |ctx: Context| async move {
            if cancels {
                ctx.cancel();
            }
            if fails {
                return Err(std::io::Error::other("the action broke").into());
            }
            Ok(())
        });
        assert_eq!(app.run(options(&mock)).await.get(), code);
        assert_eq!(listening(&mock), NONE);
    }
}

#[tokio::test]
async fn a_run_whose_caller_signal_was_cancelled_at_entry_holds_no_listener_after() {
    let mock = mock_process(MockFields::new());
    let token = CancellationToken::new();
    token.cancel();
    let app = Application::new("app").action(|_: Context| async { Ok(()) });
    assert_eq!(app.run(options(&mock).signal(token)).await.get(), 130);
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_signal_raised_right_after_run_is_called_reaches_the_run() {
    let mock = mock_process(MockFields::new());
    let ran: Lines = Arc::default();
    let app = Application::new("app").action({
        let ran = Arc::clone(&ran);
        move |_: Context| {
            let ran = Arc::clone(&ran);
            async move {
                push(&ran, "action");
                Ok(())
            }
        }
    });
    let running = app.run(options(&mock));
    mock.raise(ProcessSignal::Int);
    assert_eq!(running.await.get(), 130);
    assert!(read(&ran).is_empty());
    assert_eq!(mock.exit_code().map(|code| code.get()), Some(130));
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
}

#[tokio::test]
async fn invoke_never_starts_listening_so_a_signal_with_no_run_ends_the_mock_at_once() {
    let mock = mock_process(MockFields::new());
    let during: Lines = Arc::default();
    let app = Application::new("app").action({
        let (mock, during) = (Arc::clone(&mock), Arc::clone(&during));
        move |ctx: Context| {
            let (mock, during) = (Arc::clone(&mock), Arc::clone(&during));
            async move {
                let _kept = ctx.on_shutdown(|_| {});
                push(&during, listening(&mock));
                Ok(())
            }
        }
    });
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(Arc::clone(&mock) as Arc<dyn ProcessHandle>),
        )
        .await;
    assert!(matches!(outcome, InvocationOutcome::Completed { .. }));
    assert_eq!(read(&during), [NONE]);
    assert_eq!(listening(&mock), NONE);
    mock.raise(ProcessSignal::Term);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
}

// The shutdown.

#[tokio::test]
async fn sigterm_cancels_the_run_with_its_name_the_run_unwinds_and_resolves_143() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let watching = Plugin::new("@fixture/watching").middleware(Activation::Always, {
        let lines = Arc::clone(&lines);
        move |_ctx, next| {
            let lines = Arc::clone(&lines);
            async move {
                let outcome = next.run().await;
                push(&lines, "middleware:finally");
                outcome.map(|_| ())
            }
        }
    });
    let app = Application::new("app").plugins([watching]).action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |ctx: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                mock.raise(ProcessSignal::Term);
                ctx.signal.cancelled().await;
                push(&lines, format!("action:{}", source_of(&ctx.signal)));
                Ok(())
            }
        }
    });
    let code = app.run(options(&mock)).await;
    assert_eq!(code.get(), 143);
    assert_eq!(read(&lines), ["action:SIGTERM", "middleware:finally"]);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
    assert_eq!(mock.exit_code().map(|code| code.get()), Some(143));
}

#[tokio::test]
async fn each_ending_signal_resolves_its_code_and_writes_it_to_the_handle() {
    for (signal, status) in [
        (ProcessSignal::Hup, 129),
        (ProcessSignal::Int, 130),
        (ProcessSignal::Term, 143),
    ] {
        let mock = mock_process(MockFields::new());
        let app = Application::new("app").action({
            let mock = Arc::clone(&mock);
            move |ctx: Context| {
                let mock = Arc::clone(&mock);
                async move {
                    mock.raise(signal);
                    ctx.signal.cancelled().await;
                    Ok(())
                }
            }
        });
        assert_eq!(app.run(options(&mock)).await.get(), status);
        assert_eq!(mock.exit_code().map(|code| code.get()), Some(status));
        assert_eq!(mock.ended_by(), Some(signal));
    }
}

#[tokio::test]
async fn a_run_sigquit_ends_resolves_131_and_the_mock_ends_by_it_before_the_status_is_written() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let app = Application::new("app").action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |ctx: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                mock.raise(ProcessSignal::Quit);
                ctx.signal.cancelled().await;
                push(&lines, format!("action:{}", source_of(&ctx.signal)));
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock)).await.get(), 131);
    assert_eq!(read(&lines), ["action:SIGQUIT"]);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Quit));
    // SIGQUIT skips the budget, so the mock ended within the raise and records no later status.
    assert_eq!(mock.exit_code(), None);
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_handle_that_answers_a_new_source_on_each_call_still_has_its_listeners_removed_and_its_signal_reraised()
 {
    let mock = mock_process(MockFields::new());
    let mut handle = support::streams::Swapped::new(Arc::clone(&mock));
    handle.fresh_signals = true;
    let app = Application::new("app").shutdown_timeout(0).action({
        let mock = Arc::clone(&mock);
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                mock.raise(ProcessSignal::Int);
                ctx.signal.cancelled().await;
                Ok(())
            }
        }
    });
    let code = app
        .run(RunOptions::new().process(Arc::new(handle) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 130);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert_eq!(listening(&mock), NONE);
}

/// An application whose action registers a handler recording its event, then never ends.
fn hanging(
    timeout: Option<u32>,
    called: &Lines,
    reached: &Arc<tokio::sync::Notify>,
) -> Application {
    let app = Application::new("app");
    let app = match timeout {
        Some(timeout) => app.shutdown_timeout(timeout),
        None => app,
    };
    let (called, reached) = (Arc::clone(called), Arc::clone(reached));
    app.action(move |ctx: Context| {
        let (called, reached) = (Arc::clone(&called), Arc::clone(&reached));
        async move {
            let _kept = ctx.on_shutdown(move |event| push(&called, described("handler", event)));
            reached.notify_one();
            std::future::pending::<()>().await;
            Ok(())
        }
    })
}

#[tokio::test]
async fn an_action_that_ignores_its_signal_ends_at_the_budget_500_milliseconds_by_default() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let (reached, waiting) = reached();
    let app = hanging(None, &called, &reached);
    let running = tokio::spawn(app.run(options(&mock)));
    waiting.notified().await;
    let sent = Instant::now();
    mock.raise(ProcessSignal::Int);
    assert_eq!(mock.ended_by(), None);
    assert!(read(&called).is_empty());
    until(|| mock.ended_by().is_some()).await;
    assert!(sent.elapsed() >= Duration::from_millis(450));
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert_eq!(read(&called), ["handler:SIGINT:130"]);
    running.abort();
}

#[tokio::test]
async fn the_budget_is_the_longest_timeout_among_the_runs_live_at_the_first_signal() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let (first, first_waiting) = reached();
    let (second, second_waiting) = reached();
    let short = tokio::spawn(hanging(Some(100), &called, &first).run(options(&mock)));
    let long = tokio::spawn(hanging(Some(1000), &called, &second).run(options(&mock)));
    first_waiting.notified().await;
    second_waiting.notified().await;
    let sent = Instant::now();
    mock.raise(ProcessSignal::Term);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(mock.ended_by(), None);
    until(|| mock.ended_by().is_some()).await;
    assert!(sent.elapsed() >= Duration::from_millis(950));
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
    short.abort();
    long.abort();
}

#[tokio::test]
async fn a_timeout_of_0_ends_the_shutdown_at_once_within_the_raise() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let (reached, waiting) = reached();
    let running = tokio::spawn(hanging(Some(0), &called, &reached).run(options(&mock)));
    waiting.notified().await;
    mock.raise(ProcessSignal::Hup);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Hup));
    assert_eq!(read(&called), ["handler:SIGHUP:129"]);
    running.abort();
}

#[tokio::test]
async fn a_run_started_during_the_shutdown_starts_cancelled_and_does_not_extend_the_budget() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let (reached, waiting) = reached();
    let first = tokio::spawn(hanging(Some(200), &called, &reached).run(options(&mock)));
    waiting.notified().await;
    let sent = Instant::now();
    mock.raise(ProcessSignal::Int);
    let sources: Lines = Arc::default();
    let late = Application::new("app").shutdown_timeout(5000).action({
        let sources = Arc::clone(&sources);
        move |ctx: Context| {
            let sources = Arc::clone(&sources);
            async move {
                push(&sources, source_of(&ctx.signal));
                std::future::pending::<()>().await;
                Ok(())
            }
        }
    });
    let late_run = late.run(options(&mock));
    until(|| mock.ended_by().is_some()).await;
    assert!(sent.elapsed() < Duration::from_millis(3000));
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    // The late run was cancelled at its entry, so it never reached its action.
    assert_eq!(late_run.await.get(), 130);
    assert!(read(&sources).is_empty());
    first.abort();
}

#[tokio::test]
async fn a_run_cut_off_by_a_shutdown_keeps_no_listener_and_a_later_run_makes_core_listen_again() {
    let mock = mock_process(MockFields::new());
    let kept: Arc<Mutex<Option<Context>>> = Arc::default();
    let (reached, waiting) = reached();
    let hung = Application::new("app").shutdown_timeout(0).action({
        let (kept, reached) = (Arc::clone(&kept), Arc::clone(&reached));
        move |ctx: Context| {
            let (kept, reached) = (Arc::clone(&kept), Arc::clone(&reached));
            async move {
                *kept.lock().unwrap() = Some(ctx);
                reached.notify_one();
                std::future::pending::<()>().await;
                Ok(())
            }
        }
    });
    let running = tokio::spawn(hung.run(options(&mock)));
    waiting.notified().await;
    mock.raise(ProcessSignal::Int);
    let counts: Lines = Arc::default();
    push(&counts, listening(&mock));
    // The cut-off run is still running, and a handler it registers now starts nothing listening.
    let context = kept.lock().unwrap().take().unwrap();
    let _late = context.on_shutdown(|_| {});
    push(&counts, listening(&mock));
    let later = Application::new("app").action({
        let (mock, counts) = (Arc::clone(&mock), Arc::clone(&counts));
        move |_: Context| {
            let (mock, counts) = (Arc::clone(&mock), Arc::clone(&counts));
            async move {
                push(&counts, listening(&mock));
                Ok(())
            }
        }
    });
    later.run(options(&mock)).await;
    push(&counts, listening(&mock));
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert_eq!(read(&counts), [NONE, NONE, RUNNING, NONE]);
    running.abort();
}

#[tokio::test]
async fn a_second_ending_signal_ends_the_shutdown_at_once_and_reraises_the_first() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let (reached, waiting) = reached();
    let running = tokio::spawn(hanging(None, &called, &reached).run(options(&mock)));
    waiting.notified().await;
    mock.raise(ProcessSignal::Int);
    assert_eq!(mock.ended_by(), None);
    mock.raise(ProcessSignal::Term);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert_eq!(read(&called), ["handler:SIGINT:130"]);
    running.abort();
}

#[tokio::test]
async fn sigquit_skips_the_budget_it_cancels_calls_the_handlers_and_reraises_at_once() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let (reached, waiting) = reached();
    let app = Application::new("app").shutdown_timeout(2000).action({
        let (lines, reached) = (Arc::clone(&lines), Arc::clone(&reached));
        move |ctx: Context| {
            let (lines, reached) = (Arc::clone(&lines), Arc::clone(&reached));
            async move {
                let region = ctx.out.region(RegionOptions::new());
                let signal = ctx.signal.clone();
                let aborted = Arc::clone(&lines);
                region.on_close(move |_| push(&aborted, format!("aborted:{}", source_of(&signal))));
                let _kept = ctx.on_shutdown({
                    let lines = Arc::clone(&lines);
                    move |event| push(&lines, described("handler", event))
                });
                reached.notify_one();
                std::future::pending::<()>().await;
                Ok(())
            }
        }
    });
    let running = tokio::spawn(app.run(options(&mock)));
    waiting.notified().await;
    mock.raise(ProcessSignal::Quit);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Quit));
    assert_eq!(read(&lines), ["aborted:SIGQUIT", "handler:SIGQUIT:131"]);
    running.abort();
}

#[tokio::test]
async fn a_sigquit_during_a_shutdown_ends_it_by_sigquit() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let (reached, waiting) = reached();
    let running = tokio::spawn(hanging(None, &called, &reached).run(options(&mock)));
    waiting.notified().await;
    mock.raise(ProcessSignal::Term);
    mock.raise(ProcessSignal::Quit);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Quit));
    assert_eq!(read(&called), ["handler:SIGQUIT:131"]);
    running.abort();
}

#[tokio::test]
async fn a_run_a_close_handler_starts_as_the_shutdown_begins_joins_it_cancelled() {
    let mock = mock_process(MockFields::new());
    let sources: Lines = Arc::default();
    let second = Arc::new(Application::new("app").action({
        let sources = Arc::clone(&sources);
        move |_: Context| {
            let sources = Arc::clone(&sources);
            async move {
                push(&sources, "second:action");
                Ok(())
            }
        }
    }));
    let started: Arc<Mutex<Option<loomcli_core::BoxFuture<'static, loomcli_core::ExitCode>>>> =
        Arc::default();
    let (reached, waiting) = reached();
    let first = Application::new("app").action({
        let (second, started, mock, reached) = (
            Arc::clone(&second),
            Arc::clone(&started),
            Arc::clone(&mock),
            Arc::clone(&reached),
        );
        move |ctx: Context| {
            let (second, started, mock, reached) = (
                Arc::clone(&second),
                Arc::clone(&started),
                Arc::clone(&mock),
                Arc::clone(&reached),
            );
            async move {
                // A close handler runs synchronously as the shutdown cancels the run.
                ctx.out.region(RegionOptions::new()).on_close(move |_| {
                    *started.lock().unwrap() = Some(second.run(options(&mock)));
                });
                reached.notify_one();
                ctx.signal.cancelled().await;
                Ok(())
            }
        }
    });
    let first_run = tokio::spawn(first.run(options(&mock)));
    waiting.notified().await;
    mock.raise(ProcessSignal::Int);
    let second_run = started.lock().unwrap().take().unwrap();
    assert_eq!(second_run.await.get(), 130);
    assert_eq!(first_run.await.unwrap().get(), 130);
    assert!(read(&sources).is_empty());
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
}

#[tokio::test]
async fn a_shutdown_cancels_a_live_invoke_which_resolves_cancelled_with_the_signals_code() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let (reached, waiting) = reached();
    let holder = Application::new("holder").action(|ctx: Context| async move {
        ctx.signal.cancelled().await;
        Ok(())
    });
    let invoked = Application::new("invoked").action({
        let (called, reached) = (Arc::clone(&called), Arc::clone(&reached));
        move |ctx: Context| {
            let (called, reached) = (Arc::clone(&called), Arc::clone(&reached));
            async move {
                let _kept =
                    ctx.on_shutdown(move |event| push(&called, described("invoked", event)));
                reached.notify_one();
                ctx.signal.cancelled().await;
                Ok(())
            }
        }
    });
    let holding = tokio::spawn(holder.run(options(&mock)));
    let call = tokio::spawn({
        let mock = Arc::clone(&mock);
        async move {
            invoked
                .invoke(
                    &[],
                    InvocationValues::new(),
                    InvokeOptions::new(),
                    Some(mock as Arc<dyn ProcessHandle>),
                )
                .await
        }
    });
    waiting.notified().await;
    mock.raise(ProcessSignal::Hup);
    let outcome = call.await.unwrap();
    assert!(
        matches!(outcome, InvocationOutcome::Cancelled { exit_code } if exit_code.get() == 129)
    );
    assert_eq!(holding.await.unwrap().get(), 129);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Hup));
    assert_eq!(read(&called), ["invoked:SIGHUP:129"]);
}

#[tokio::test]
async fn an_actions_own_call_is_cancelled_with_its_runs_signal_code() {
    let mock = mock_process(MockFields::new().argv(["parent"]));
    let outcomes: Lines = Arc::default();
    let app = Application::new("app")
        .command(Command::new("child").action({
            let mock = Arc::clone(&mock);
            move |ctx: Context| {
                let mock = Arc::clone(&mock);
                async move {
                    mock.raise(ProcessSignal::Term);
                    ctx.signal.cancelled().await;
                    Ok(())
                }
            }
        }))
        .command(Command::new("parent").action({
            let outcomes = Arc::clone(&outcomes);
            move |ctx: Context| {
                let outcomes = Arc::clone(&outcomes);
                async move {
                    let outcome = ctx
                        .invoke(&["child"], InvocationValues::new(), InvokeOptions::new())
                        .await;
                    if let InvocationOutcome::Cancelled { exit_code } = outcome {
                        push(&outcomes, format!("cancelled:{}", exit_code.get()));
                    }
                    Ok(())
                }
            }
        }));
    assert_eq!(app.run(options(&mock)).await.get(), 143);
    assert_eq!(read(&outcomes), ["cancelled:143"]);
}

// The end of a shutdown.

fn terminal_mock() -> Arc<MockProcess> {
    mock_process(
        MockFields::new()
            .terminal(MockTerminal::new(80, 24).streams([StreamName::Stdout, StreamName::Stderr])),
    )
}

fn plain() -> View<str> {
    View::new(|text: &str, _| text.to_owned())
}

#[tokio::test]
async fn a_regions_cancelled_line_reaches_the_terminal_at_a_budget_of_0_and_the_cursor_shows() {
    let mock = terminal_mock();
    let (reached, waiting) = reached();
    let app = Application::new("app").shutdown_timeout(0).action({
        let reached = Arc::clone(&reached);
        move |ctx: Context| {
            let reached = Arc::clone(&reached);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.on_close(|region| drop(region.draw("CANCELLED-LINE", &plain())));
                region.draw("WORKING-FRAME", &plain()).await?;
                reached.notify_one();
                std::future::pending::<()>().await;
                Ok(())
            }
        }
    });
    let running = tokio::spawn(app.run(options(&mock)));
    waiting.notified().await;
    mock.raise(ProcessSignal::Term);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
    let text = mock.stderr_text();
    assert!(text.contains("CANCELLED-LINE"), "{text:?}");
    assert!(text.ends_with("\u{1b}[?25h"), "{text:?}");
    running.abort();
}

#[tokio::test]
async fn a_run_that_resolved_during_the_shutdown_has_its_cursor_shown_once_at_the_end() {
    let mock = terminal_mock();
    let app = Application::new("app").action({
        let mock = Arc::clone(&mock);
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.on_close(|region| drop(region.draw("CANCELLED-LINE", &plain())));
                region.draw("WORKING-FRAME", &plain()).await?;
                mock.raise(ProcessSignal::Term);
                ctx.signal.cancelled().await;
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock)).await.get(), 143);
    let text = mock.stderr_text();
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
    assert_eq!(text.matches("\u{1b}[?25h").count(), 1, "{text:?}");
    assert!(
        text.find("\u{1b}[?25h") > text.find("CANCELLED-LINE"),
        "{text:?}"
    );
}

/// A middleware that registers a handler writing its event to `lines`, then continues the chain.
fn registering(lines: &Lines) -> Plugin {
    let lines = Arc::clone(lines);
    Plugin::new("@fixture/registering").middleware(Activation::Always, move |ctx, next| {
        let lines = Arc::clone(&lines);
        async move {
            let _kept = ctx.on_shutdown(move |event| push(&lines, described("middleware", event)));
            next.run().await.map(|_| ())
        }
    })
}

#[tokio::test]
async fn every_pending_handler_runs_once_newest_first_from_the_action_and_its_middleware() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let app = Application::new("app")
        .plugins([registering(&lines)])
        .action({
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            move |ctx: Context| {
                let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
                async move {
                    let first = Arc::clone(&lines);
                    let _first =
                        ctx.on_shutdown(move |event| push(&first, described("first", event)));
                    let second = Arc::clone(&lines);
                    let _second =
                        ctx.on_shutdown(move |event| push(&second, described("second", event)));
                    mock.raise(ProcessSignal::Int);
                    ctx.signal.cancelled().await;
                    push(&lines, "unwound");
                    Ok(())
                }
            }
        });
    app.run(options(&mock)).await;
    // A second signal after the end finds nothing listening, and no handler runs twice.
    mock.raise(ProcessSignal::Int);
    assert_eq!(
        read(&lines),
        [
            "unwound",
            "second:SIGINT:130",
            "first:SIGINT:130",
            "middleware:SIGINT:130"
        ]
    );
}

/// A plugin that records each log event's level, message, and plugin, and whose middleware
/// registers `handler` through `register`, then continues the chain.
fn logging(
    lines: &Lines,
    register: fn(&loomcli_core::MiddlewareContext<loomcli_core::NoInputs>),
) -> Plugin {
    let seen = Arc::clone(lines);
    Plugin::new("@fixture/registering")
        .middleware(Activation::Always, move |ctx, next| async move {
            register(&ctx);
            next.run().await.map(|_| ())
        })
        .on_log(move |event: &LogEvent, _: &LogDestination| {
            let error = event
                .fields
                .get("error")
                .and_then(|error| error.as_str())
                .unwrap_or_default()
                .to_owned();
            push(
                &seen,
                format!(
                    "log:{:?}:{}:{}:{error}",
                    event.level,
                    event.message,
                    event.plugin.as_deref().unwrap_or("null")
                ),
            );
        })
}

#[tokio::test]
async fn a_panicking_shutdown_handler_is_caught_logged_naming_its_plugin_and_the_rest_still_run() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let plugin = logging(&lines, |ctx| {
        let _kept = ctx.on_shutdown(|_| panic!("the middleware handler broke"));
    });
    let app = Application::new("app").plugins([plugin]).action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |ctx: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                let _older = ctx.on_shutdown(move |_| push(&lines, "older"));
                let _newer = ctx.on_shutdown(|_| panic!("the action handler broke"));
                mock.raise(ProcessSignal::Int);
                ctx.signal.cancelled().await;
                Ok(())
            }
        }
    });
    app.run(options(&mock)).await;
    assert_eq!(
        read(&lines),
        [
            "log:Error:A shutdown handler failed.:null:the action handler broke",
            "older",
            "log:Error:A shutdown handler failed.:@fixture/registering:the middleware handler broke",
        ]
    );
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
}

#[tokio::test]
async fn a_runs_handler_goes_with_its_run_when_no_shutdown_is_under_way() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let kept: Arc<Mutex<Option<Context>>> = Arc::default();
    let app = Application::new("app").action({
        let (called, kept) = (Arc::clone(&called), Arc::clone(&kept));
        move |ctx: Context| {
            let (called, kept) = (Arc::clone(&called), Arc::clone(&kept));
            async move {
                let _during = ctx.on_shutdown(move |_| push(&called, "during"));
                *kept.lock().unwrap() = Some(ctx);
                Ok(())
            }
        }
    });
    app.run(options(&mock)).await;
    // A handler registered after its run ended is never called, and starts nothing listening.
    let context = kept.lock().unwrap().take().unwrap();
    let late = Arc::clone(&called);
    let _after = context.on_shutdown(move |_| push(&late, "after"));
    assert_eq!(listening(&mock), NONE);
    mock.raise(ProcessSignal::Int);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert!(read(&called).is_empty());
}

#[tokio::test]
async fn a_removed_handler_is_not_called_at_the_end() {
    let mock = mock_process(MockFields::new());
    let called: Lines = Arc::default();
    let app = Application::new("app").action({
        let (mock, called) = (Arc::clone(&mock), Arc::clone(&called));
        move |ctx: Context| {
            let (mock, called) = (Arc::clone(&mock), Arc::clone(&called));
            async move {
                let removed = Arc::clone(&called);
                let remove = ctx.on_shutdown(move |_| push(&removed, "removed"));
                let _kept = ctx.on_shutdown(move |_| push(&called, "kept"));
                remove.remove();
                mock.raise(ProcessSignal::Term);
                ctx.signal.cancelled().await;
                Ok(())
            }
        }
    });
    app.run(options(&mock)).await;
    assert_eq!(read(&called), ["kept"]);
}

// Suspend and resume.

/// A signal source over a mock's that records each raise with the listeners held at that moment,
/// then delivers it.
struct Recording {
    mock: Arc<MockProcess>,
    lines: Lines,
}

impl SignalSource for Recording {
    fn on(&self, event: SignalEvent, listener: SignalListener) -> u64 {
        self.mock.signals().on(event, listener)
    }
    fn off(&self, id: u64) {
        self.mock.signals().off(id);
    }
    fn raise(&self, signal: ProcessSignal) {
        push(
            &self.lines,
            format!("raise:{signal:?}:{}", listening(&self.mock)),
        );
        self.mock.signals().raise(signal);
    }
    fn terminal(&self) -> Option<Arc<dyn loomcli_core::InputStream>> {
        self.mock.signals().terminal()
    }
}

#[tokio::test]
async fn sigtstp_calls_suspend_handlers_newest_first_reraises_with_no_listener_then_resumes_in_order()
 {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let source: Arc<dyn SignalSource> = Arc::new(Recording {
        mock: Arc::clone(&mock),
        lines: Arc::clone(&lines),
    });
    let mut handle = support::streams::Swapped::new(Arc::clone(&mock));
    handle.signals = Some(Arc::clone(&source));
    let app = Application::new("app").action({
        let (lines, source) = (Arc::clone(&lines), Arc::clone(&source));
        move |ctx: Context| {
            let (lines, source) = (Arc::clone(&lines), Arc::clone(&source));
            async move {
                let mut registrations = Vec::new();
                for label in ["first", "second"] {
                    let suspended = Arc::clone(&lines);
                    registrations
                        .push(ctx.on_suspend(move || push(&suspended, format!("suspend:{label}"))));
                    let resumed = Arc::clone(&lines);
                    registrations
                        .push(ctx.on_resume(move || push(&resumed, format!("resume:{label}"))));
                }
                // A SIGCONT with no suspend before it calls none.
                source.raise(ProcessSignal::Cont);
                // A mock's raise returns at once, so each suspend runs its resume handlers back to
                // back.
                source.raise(ProcessSignal::Tstp);
                source.raise(ProcessSignal::Tstp);
                // The resume already ran, so a SIGCONT now calls none.
                source.raise(ProcessSignal::Cont);
                for registration in registrations {
                    registration.remove();
                }
                Ok(())
            }
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(Arc::new(handle)))
            .await
            .get(),
        0
    );
    let suspend = [
        "raise:Tstp:1,1,1,1,1,1,1",
        "suspend:second",
        "suspend:first",
        "raise:Tstp:1,1,1,1,1,0,1",
        "resume:first",
        "resume:second",
    ];
    let mut expected = vec!["raise:Cont:1,1,1,1,1,1,1"];
    expected.extend(suspend);
    expected.extend(suspend);
    expected.push("raise:Cont:1,1,1,1,1,1,1");
    assert_eq!(read(&lines), expected);
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_contexts_suspend_and_resume_handlers_run_on_its_runs_source_and_go_when_the_run_ends() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let counts: Lines = Arc::default();
    let watching = Plugin::new("@fixture/watching").middleware(Activation::Always, {
        let lines = Arc::clone(&lines);
        move |ctx, next| {
            let lines = Arc::clone(&lines);
            async move {
                let suspended = Arc::clone(&lines);
                let _suspend = ctx.on_suspend(move || push(&suspended, "suspend:middleware"));
                let _resume = ctx.on_resume(move || push(&lines, "resume:middleware"));
                next.run().await.map(|_| ())
            }
        }
    });
    let app = Application::new("app").plugins([watching]).action({
        let (mock, lines, counts) = (Arc::clone(&mock), Arc::clone(&lines), Arc::clone(&counts));
        move |ctx: Context| {
            let (mock, lines, counts) =
                (Arc::clone(&mock), Arc::clone(&lines), Arc::clone(&counts));
            async move {
                let suspended = Arc::clone(&lines);
                let _suspend = ctx.on_suspend(move || push(&suspended, "suspend:action"));
                let resumed = Arc::clone(&lines);
                let remove = ctx.on_resume(move || push(&resumed, "resume:action"));
                push(&counts, listening(&mock));
                mock.raise(ProcessSignal::Tstp);
                remove.remove();
                mock.raise(ProcessSignal::Tstp);
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock)).await.get(), 0);
    // A suspend after the run ended reaches no handler of the run's.
    mock.raise(ProcessSignal::Tstp);
    assert_eq!(
        read(&lines),
        [
            "suspend:action",
            "suspend:middleware",
            "resume:middleware",
            "resume:action",
            "suspend:action",
            "suspend:middleware",
            "resume:middleware",
        ]
    );
    assert_eq!(read(&counts), ["1,1,1,1,1,1,1"]);
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_panicking_suspend_or_resume_handler_is_caught_logged_naming_its_plugin_and_the_rest_run()
{
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let plugin = logging(&lines, |ctx| {
        let _kept = ctx.on_resume(|| panic!("the middleware handler broke"));
    });
    let app = Application::new("app").plugins([plugin]).action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |ctx: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                let older = Arc::clone(&lines);
                let _older = ctx.on_suspend(move || push(&older, "suspend:older"));
                let _broken = ctx.on_suspend(|| panic!("the action handler broke"));
                let _newer = ctx.on_resume(move || push(&lines, "resume:newer"));
                mock.raise(ProcessSignal::Tstp);
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock)).await.get(), 0);
    let lines: Vec<String> = read(&lines)
        .into_iter()
        .map(|line| {
            line.rsplit_once(':')
                .map_or(line.clone(), |(head, _)| head.to_owned())
        })
        .collect();
    assert_eq!(
        lines,
        [
            "log:Error:A suspend handler failed.:null",
            "suspend",
            "log:Error:A resume handler failed.:@fixture/registering",
            "resume",
        ]
    );
}

#[tokio::test]
async fn a_suspend_erases_the_open_regions_and_shows_the_cursor_and_the_resume_redraws_them() {
    let mock = terminal_mock();
    let raised: Lines = Arc::default();
    let counts: Lines = Arc::default();
    let app = Application::new("app").action({
        let (mock, raised, counts) = (Arc::clone(&mock), Arc::clone(&raised), Arc::clone(&counts));
        move |ctx: Context| {
            let (mock, raised, counts) =
                (Arc::clone(&mock), Arc::clone(&raised), Arc::clone(&counts));
            async move {
                push(&counts, listening(&mock));
                let region = ctx.out.region(RegionOptions::new());
                region.draw("WORKING-FRAME\n", &plain()).await?;
                push(&counts, listening(&mock));
                let before = mock.stderr_text().len();
                mock.raise(ProcessSignal::Tstp);
                push(
                    &raised,
                    format!("suspended:{:?}", &mock.stderr_text()[before..]),
                );
                for _ in 0..10 {
                    tokio::task::yield_now().await;
                }
                push(
                    &raised,
                    format!("resumed:{:?}", &mock.stderr_text()[before..]),
                );
                region.end(loomcli_core::EndState::Ended, None).await?;
                push(&counts, listening(&mock));
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock)).await.get(), 0);
    assert_eq!(
        read(&raised),
        [
            format!("suspended:{:?}", "\r\u{1b}[1A\u{1b}[J\u{1b}[?25h"),
            format!(
                "resumed:{:?}",
                "\r\u{1b}[1A\u{1b}[J\u{1b}[?25hWORKING-FRAME\n"
            ),
        ]
    );
    assert_eq!(read(&counts), [RUNNING, "1,1,1,1,1,1,1", RUNNING]);
}

#[tokio::test]
async fn an_invoke_never_starts_listening_for_its_suspend_handlers_which_run_while_a_run_listens() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let during: Lines = Arc::default();
    let invoked = Application::new("invoked").action({
        let (mock, lines, during) = (Arc::clone(&mock), Arc::clone(&lines), Arc::clone(&during));
        move |ctx: Context| {
            let (mock, lines, during) =
                (Arc::clone(&mock), Arc::clone(&lines), Arc::clone(&during));
            async move {
                let suspended = Arc::clone(&lines);
                let _suspend = ctx.on_suspend(move || push(&suspended, "suspend:invoked"));
                let _resume = ctx.on_resume(move || push(&lines, "resume:invoked"));
                push(&during, listening(&mock));
                mock.raise(ProcessSignal::Tstp);
                Ok(())
            }
        }
    });
    let process = || Some(Arc::clone(&mock) as Arc<dyn ProcessHandle>);
    let outcome = invoked
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            process(),
        )
        .await;
    assert!(matches!(outcome, InvocationOutcome::Completed { .. }));
    let (reached, waiting) = reached();
    let release = Arc::new(tokio::sync::Notify::new());
    let holder = Application::new("holder").action({
        let (lines, reached, release) = (
            Arc::clone(&lines),
            Arc::clone(&reached),
            Arc::clone(&release),
        );
        move |ctx: Context| {
            let (lines, reached, release) = (
                Arc::clone(&lines),
                Arc::clone(&reached),
                Arc::clone(&release),
            );
            async move {
                let _suspend = ctx.on_suspend(move || push(&lines, "suspend:holder"));
                reached.notify_one();
                release.notified().await;
                Ok(())
            }
        }
    });
    let holding = tokio::spawn(holder.run(options(&mock)));
    waiting.notified().await;
    let called = Application::new("called").action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |ctx: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                let _suspend = ctx.on_suspend(move || push(&lines, "suspend:called"));
                mock.raise(ProcessSignal::Tstp);
                Ok(())
            }
        }
    });
    let _ = called
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            process(),
        )
        .await;
    release.notify_one();
    assert_eq!(holding.await.unwrap().get(), 0);
    assert_eq!(read(&during), [NONE]);
    assert_eq!(read(&lines), ["suspend:called", "suspend:holder"]);
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_handler_a_context_registers_after_its_run_ended_holds_nothing() {
    let mock = mock_process(MockFields::new());
    let kept: Arc<Mutex<Option<Context>>> = Arc::default();
    let app = Application::new("app").action({
        let kept = Arc::clone(&kept);
        move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                *kept.lock().unwrap() = Some(ctx);
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock)).await.get(), 0);
    let lines: Lines = Arc::default();
    let context = kept.lock().unwrap().take().unwrap();
    let suspended = Arc::clone(&lines);
    let _late = context.on_suspend(move || push(&suspended, "suspend"));
    mock.raise(ProcessSignal::Tstp);
    assert!(read(&lines).is_empty());
    assert_eq!(listening(&mock), NONE);
}

// cancellation.test.ts, through the mock.

#[tokio::test]
async fn a_caller_cancellation_during_a_run_resolves_130_with_the_caller_as_its_source() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let token = CancellationToken::new();
    let app = Application::new("app").action({
        let (lines, token, mock) = (Arc::clone(&lines), token.clone(), Arc::clone(&mock));
        move |ctx: Context| {
            let (lines, token, mock) = (Arc::clone(&lines), token.clone(), Arc::clone(&mock));
            async move {
                push(&lines, format!("during:{}", listening(&mock)));
                token.cancel();
                ctx.signal.cancelled().await;
                push(&lines, format!("action:{}", source_of(&ctx.signal)));
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock).signal(token)).await.get(), 130);
    push(&lines, format!("after:{}", listening(&mock)));
    assert_eq!(
        read(&lines),
        [
            format!("during:{RUNNING}"),
            "action:caller".to_owned(),
            format!("after:{NONE}")
        ]
    );
    assert_eq!(mock.stderr_text(), "");
    // A run its caller cancelled ends no process.
    assert_eq!(mock.ended_by(), None);
}

#[tokio::test]
async fn an_action_that_cancels_resolves_130_and_a_failure_it_returns_after_is_rendered() {
    for returns_error in [false, true] {
        let mock = mock_process(MockFields::new());
        let app = Application::new("app").action(move |ctx: Context| async move {
            ctx.cancel();
            assert_eq!(source_of(&ctx.signal), "action");
            if returns_error {
                return Err(ctx.out.fatal("the action stopped the invocation"));
            }
            Ok(())
        });
        let code = app.run(options(&mock)).await.get();
        assert_eq!(code, 130);
        // A failure after cancellation is rendered, and the code stays the signal's; a plain
        // return reports nothing.
        let expected = if returns_error {
            "the action stopped the invocation\n"
        } else {
            ""
        };
        assert_eq!(mock.stderr_text(), expected);
        assert_eq!(listening(&mock), NONE);
    }
}

#[tokio::test]
async fn a_cancelled_run_with_an_unemitted_result_resolves_130_and_reports_nothing() {
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let app = Application::new("app")
        .result(loomcli_core::ResultViews::new().view(
            "text",
            View::new(|_: &u32, _: &loomcli_core::ViewContext| "emitted\n".to_owned()),
        ))
        .action(
            |ctx: Context<loomcli_core::NoInputs, loomcli_core::ValueResult<u32>>| async move {
                ctx.cancel();
                ctx.signal.cancelled().await;
                Ok(())
            },
        );
    assert_eq!(app.run(options(&mock)).await.get(), 130);
    assert_eq!(
        (mock.stdout_text(), mock.stderr_text()),
        (String::new(), String::new())
    );
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_run_that_fails_to_build_or_rejects_a_default_leaves_no_listener_and_resolves_1() {
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let broken = Application::new("app")
        .plugins([Plugin::new("@fixture/broken")
            .on_graph_built(|_| Err(std::io::Error::other("the hook broke").into()))])
        .action(|_: Context| async { Ok(()) });
    assert_eq!(broken.run(options(&mock)).await.get(), 1);
    assert_eq!(mock.stderr_text(), "app: Something went wrong.\n");
    assert_eq!(listening(&mock), NONE);
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let rejecting = Application::new("app")
        .option(
            "level",
            loomcli_core::Opt::string()
                .default("loud")
                .validate(support::validators::Rejecting(vec![
                    loomcli_core::Issue::new("Supply a level the schema accepts."),
                ])),
        )
        .action(|_: Context| async { Ok(()) });
    assert_eq!(rejecting.run(options(&mock)).await.get(), 1);
    assert_eq!(mock.stderr_text(), "app: Something went wrong.\n");
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_host_stderr_that_refuses_every_write_leaves_no_listener_behind() {
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let mut handle = support::streams::Swapped::new(Arc::clone(&mock));
    handle.stderr = Some(support::streams::Scripted::refusing(
        0,
        std::io::ErrorKind::Other,
        Arc::default(),
    ));
    let lines: Lines = Arc::default();
    let app = Application::new("app").action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |ctx: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                push(&lines, format!("during:{}", listening(&mock)));
                Err(ctx.out.fatal("the action stopped the invocation"))
            }
        }
    });
    let code = app
        .run(RunOptions::new().process(Arc::new(handle) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 1);
    assert_eq!(read(&lines), [format!("during:{RUNNING}")]);
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn a_first_signal_after_the_chain_settled_still_cancels_the_run_and_decides_its_code() {
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let raising = Arc::clone(&mock);
    let app = Application::new("app")
        .plugins([Plugin::new("@fixture/late").on_failure(
            move |_: &dyn loomcli_core::Failure, _| {
                raising.raise(ProcessSignal::Int);
                Vec::<String>::new()
            },
        )])
        .action(
            |ctx: Context| async move { Err(ctx.out.fatal("the action stopped the invocation")) },
        );
    assert_eq!(app.run(options(&mock)).await.get(), 130);
    assert_eq!(mock.stderr_text(), "the action stopped the invocation\n");
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert_eq!(listening(&mock), NONE);
}

#[tokio::test]
async fn the_first_cause_fixes_the_reason_and_a_later_signal_changes_neither() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let app = Application::new("app").action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |ctx: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                mock.raise(ProcessSignal::Term);
                ctx.cancel();
                push(&lines, format!("action:{}", source_of(&ctx.signal)));
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock)).await.get(), 143);
    assert_eq!(read(&lines), ["action:SIGTERM"]);
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
}

#[tokio::test]
async fn a_caller_cancellation_holds_its_reason_against_a_later_signal_and_a_hosts_own_listener_keeps_the_process()
 {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    // The embedding host's own listener: it hears the signal and core's re-raise, so the mock is
    // never ended by the signal.
    let heard = Arc::clone(&lines);
    let own = mock.signals().on(
        SignalEvent::Signal(ProcessSignal::Int),
        Arc::new(move |_| push(&heard, "host:SIGINT")),
    );
    let token = CancellationToken::new();
    let app = Application::new("app").action({
        let (mock, lines, token) = (Arc::clone(&mock), Arc::clone(&lines), token.clone());
        move |ctx: Context| {
            let (mock, lines, token) = (Arc::clone(&mock), Arc::clone(&lines), token.clone());
            async move {
                token.cancel();
                mock.raise(ProcessSignal::Int);
                push(&lines, format!("action:{}", source_of(&ctx.signal)));
                Ok(())
            }
        }
    });
    assert_eq!(app.run(options(&mock).signal(token)).await.get(), 130);
    mock.signals().off(own);
    assert_eq!(
        read(&lines),
        ["host:SIGINT", "action:caller", "host:SIGINT"]
    );
    assert_eq!(mock.ended_by(), None);
}

#[tokio::test]
async fn two_runs_of_one_application_each_install_and_remove_their_own_listeners() {
    let mock = mock_process(MockFields::new());
    let lines: Lines = Arc::default();
    let app = Application::new("app").action({
        let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
        move |_: Context| {
            let (mock, lines) = (Arc::clone(&mock), Arc::clone(&lines));
            async move {
                push(&lines, format!("during:{}", listening(&mock)));
                Ok(())
            }
        }
    });
    push(&lines, format!("before:{}", listening(&mock)));
    assert_eq!(app.run(options(&mock)).await.get(), 0);
    push(&lines, format!("between:{}", listening(&mock)));
    assert_eq!(app.run(options(&mock)).await.get(), 0);
    push(&lines, format!("after:{}", listening(&mock)));
    assert_eq!(
        read(&lines),
        [
            format!("before:{NONE}"),
            format!("during:{RUNNING}"),
            format!("between:{NONE}"),
            format!("during:{RUNNING}"),
            format!("after:{NONE}"),
        ]
    );
}
