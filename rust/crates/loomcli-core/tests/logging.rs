//! Ports `logging.test.ts` and `observing-log-events.test.ts` where no plugin but an `on_log` hook
//! is needed: the events a context's `log` publishes, their fields and facts, core's failure
//! events, and the hooks' delivery and failures, end to end through `Application::run` on the mock
//! process. The hidden `__private::install_log_hook` installs a hook for a test; the reach cases
//! log through a plugin's own `on_log`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::future::Future;
use std::io;
use std::sync::{Arc, Mutex};

use loomcli_core::__private::install_log_hook;
use loomcli_core::{
    Application, Build, Command, Context, DiagnosticParts, DiagnosticRule, Done, Error,
    InternalError, LogDestination, LogEvent, LogFields, LogLevel, NoInputs, NoResult, ReleaseFacts,
    RunOptions, State, diagnostic_rule,
};
use loomcli_testing::{MockFields, mock_process};
use serde::Serialize;
use serde_json::json;
use support::streams::{Scripted, Swapped};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Done>;

/// What each observing hook saw: its identity, the destination's `PROBE`, platform, and whether it
/// holds a stderr, and the event's address.
type Sightings = Arc<Mutex<Vec<(String, String, String, bool, usize)>>>;

/// A counter and a list of messages a test reads after the run.
type Counted = (Arc<Mutex<usize>>, Arc<Mutex<Vec<String>>>);

/// The events one hook collected, in the order they arrived.
type Collected = Arc<Mutex<Vec<LogEvent>>>;

/// `application` with a hook that collects every event.
fn collecting<I, R, S>(application: Application<I, R, S>) -> (Application<I, R, S>, Collected) {
    let events: Collected = Arc::default();
    let application = install_log_hook(application, {
        let events = Arc::clone(&events);
        move |event: &LogEvent, _: &LogDestination| events.lock().unwrap().push(event.clone())
    });
    (application, events)
}

/// What one run resolved and wrote, beside the events its hook collected.
struct Logged {
    code: u8,
    stderr: String,
    events: Vec<LogEvent>,
}

/// Runs `application` with a collecting hook on a mock in `build` with `argv`.
async fn logged<I, R, S: State>(
    application: Application<I, R, S>,
    argv: &[&str],
    build: Build,
) -> Logged {
    let (application, events) = collecting(application);
    let mock = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    );
    let code = application
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    let events = events.lock().unwrap().clone();
    Logged {
        code: code.get(),
        stderr: mock.stderr_text(),
        events,
    }
}

fn probe<F, Fut>(action: F) -> App
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    Application::new("probe")
        .description("Probe logging.")
        .action(action)
}

/// Each event's level, message, and plugin.
fn summary(events: &[LogEvent]) -> Vec<(LogLevel, String, Option<String>)> {
    events
        .iter()
        .map(|event| (event.level, event.message.clone(), event.plugin.clone()))
        .collect()
}

/// The one event a list must hold.
fn only(events: &[LogEvent]) -> &LogEvent {
    assert_eq!(events.len(), 1, "{events:?}");
    &events[0]
}

// logging.test.ts

#[tokio::test]
async fn a_call_returns_nothing_and_delivers_one_event_under_no_plugin() {
    let run = logged(
        probe(|ctx: Context| async move {
            ctx.log.info("hello", LogFields::new().field("count", 1));
            Ok(())
        }),
        &[],
        Build::Distributed,
    )
    .await;
    let event = only(&run.events);
    assert_eq!(event.level, LogLevel::Info);
    assert_eq!(event.message, "hello");
    assert_eq!(
        serde_json::Value::Object(event.fields.clone()),
        json!({ "count": 1 })
    );
    assert_eq!(event.plugin, None);
    assert_eq!(event.failure, None);
    assert_eq!(event.defect, None);
}

#[tokio::test]
async fn a_detached_log_keeps_working() {
    let run = logged(
        probe(|ctx: Context| async move {
            let log = ctx.log.clone();
            drop(ctx);
            log.info("detached", ());
            Ok(())
        }),
        &[],
        Build::Distributed,
    )
    .await;
    assert_eq!(
        summary(&run.events),
        [(LogLevel::Info, "detached".to_owned(), None)]
    );
}

#[tokio::test]
async fn the_five_levels_log_in_call_order() {
    let run = logged(
        probe(|ctx: Context| async move {
            ctx.log.trace("trace message", ());
            ctx.log.debug("debug message", ());
            ctx.log.info("info message", ());
            ctx.log.warn("warn message", ());
            ctx.log.error("error message", ());
            Ok(())
        }),
        &[],
        Build::Distributed,
    )
    .await;
    let levels: Vec<_> = run
        .events
        .iter()
        .map(|event| (event.level, event.message.as_str()))
        .collect();
    assert_eq!(
        levels,
        [
            (LogLevel::Trace, "trace message"),
            (LogLevel::Debug, "debug message"),
            (LogLevel::Info, "info message"),
            (LogLevel::Warn, "warn message"),
            (LogLevel::Error, "error message"),
        ]
    );
}

#[tokio::test]
async fn omitted_fields_read_an_empty_object() {
    let run = logged(
        probe(|ctx: Context| async move {
            ctx.log.info("bare", ());
            Ok(())
        }),
        &[],
        Build::Distributed,
    )
    .await;
    assert!(only(&run.events).fields.is_empty());
}

#[derive(Clone, Serialize)]
struct Position {
    across: u32,
    down: u32,
}

#[tokio::test]
async fn fields_copy_into_the_json_data_serde_writes_at_the_call() {
    let run = logged(
        probe(|ctx: Context| async move {
            let mut nested = json!({ "value": 1 });
            let fields = LogFields::new()
                .field("instance", Position { across: 1, down: 2 })
                .field("array", vec![None, Some("kept")])
                .field("infinite", f64::INFINITY)
                .field("nested", &nested)
                .field("nothing", Option::<u8>::None);
            // A later change to the caller's value leaves the event unchanged.
            nested["value"] = json!(2);
            ctx.log.info("copied", fields);
            Ok(())
        }),
        &[],
        Build::Distributed,
    )
    .await;
    assert_eq!(
        serde_json::Value::Object(only(&run.events).fields.clone()),
        json!({
            "instance": { "across": 1, "down": 2 },
            "array": [null, "kept"],
            "infinite": null,
            "nested": { "value": 1 },
            "nothing": null,
        })
    );
}

/// Whether `text` is ISO 8601 UTC with milliseconds.
fn is_iso_time(text: &str) -> bool {
    let bytes = text.as_bytes();
    let digits = |range: std::ops::Range<usize>| bytes[range].iter().all(u8::is_ascii_digit);
    bytes.len() == 24
        && digits(0..4)
        && bytes[4] == b'-'
        && digits(5..7)
        && bytes[7] == b'-'
        && digits(8..10)
        && bytes[10] == b'T'
        && digits(11..13)
        && bytes[13] == b':'
        && digits(14..16)
        && bytes[16] == b':'
        && digits(17..19)
        && bytes[19] == b'.'
        && digits(20..23)
        && bytes[23] == b'Z'
}

fn is_trace_id(text: &str) -> bool {
    text.len() == 32
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[tokio::test]
async fn time_run_and_application_are_read_at_the_call_in_the_pinned_forms() {
    let versioned = logged(
        Application::new("probe")
            .version("1.2.3")
            .action(|ctx: Context| async move {
                ctx.log.info("versioned", ());
                Ok(())
            }),
        &[],
        Build::Distributed,
    )
    .await;
    let event = only(&versioned.events);
    assert!(is_iso_time(&event.time), "{}", event.time);
    assert!(is_trace_id(&event.run), "{}", event.run);
    assert_eq!(
        serde_json::to_value(&event.application).unwrap(),
        json!({ "name": "probe", "version": "1.2.3" })
    );
    let unversioned = logged(
        probe(|ctx: Context| async move {
            ctx.log.info("unversioned", ());
            Ok(())
        }),
        &[],
        Build::Distributed,
    )
    .await;
    assert_eq!(
        serde_json::to_value(&only(&unversioned.events).application).unwrap(),
        json!({ "name": "probe", "version": "0.0.0" })
    );
}

#[tokio::test]
async fn run_is_equal_across_one_run_and_different_for_another_run() {
    let app = || {
        probe(|ctx: Context| async move {
            ctx.log.info("outer", ());
            ctx.log.info("outer again", ());
            Ok(())
        })
    };
    let first = logged(app(), &[], Build::Distributed).await;
    let second = logged(app(), &[], Build::Distributed).await;
    assert_eq!(first.events[0].run, first.events[1].run);
    assert_ne!(first.events[0].run, second.events[0].run);
}

/// An application with a `cache clear` Command whose action logs.
fn routed() -> Application<NoInputs, NoResult, loomcli_core::Group> {
    Application::new("probe")
        .description("Probe paths.")
        .command(
            Command::new("cache")
                .description("Manage the cache.")
                .command(
                    Command::new("clear")
                        .description("Clear the cache.")
                        .action(|ctx: Context| async move {
                            ctx.log.info("cleared", ());
                            Ok(())
                        }),
                ),
        )
}

#[tokio::test]
async fn path_reads_empty_before_routing_partial_for_an_unknown_command_and_routed_in_an_action() {
    let routed_run = logged(routed(), &["cache", "clear"], Build::Distributed).await;
    let paths: Vec<_> = routed_run
        .events
        .iter()
        .map(|event| event.path.clone())
        .collect();
    assert_eq!(paths, [vec!["cache".to_owned(), "clear".to_owned()]]);
    let structural = logged(routed(), &["--file"], Build::Distributed).await;
    let event = only(&structural.events);
    assert_eq!(
        (event.level, event.path.clone()),
        (LogLevel::Error, Vec::new())
    );
    let unknown = logged(routed(), &["cache", "nope"], Build::Distributed).await;
    let event = only(&unknown.events);
    assert_eq!(
        (event.level, event.path.clone()),
        (LogLevel::Error, vec!["cache".to_owned()])
    );
}

#[tokio::test]
async fn an_input_error_logs_at_error_with_its_failure_form_and_exit_code_2() {
    let run = logged(
        probe(|_: Context| async { Ok(()) }),
        &["--bogus"],
        Build::Distributed,
    )
    .await;
    assert_eq!(run.code, 2);
    let event = only(&run.events);
    assert_eq!(event.level, LogLevel::Error);
    assert_eq!(event.plugin, None);
    assert_eq!(
        serde_json::to_value(&event.failure).unwrap(),
        json!({
            "code": "unknown-option",
            "exitCode": 2,
            "message": "Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".",
            "hints": [],
        })
    );
    assert_eq!(event.message, event.failure.as_ref().unwrap().message);
    assert_eq!(event.defect, None);
}

/// The error a probe's action fails with.
#[derive(Debug)]
struct ProbeError;

impl std::fmt::Display for ProbeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("The probe failed.")
    }
}

impl std::error::Error for ProbeError {}

fn failing() -> App {
    probe(|_: Context| async { Err(ProbeError.into()) })
}

#[tokio::test]
async fn a_foreign_error_logs_at_fatal_with_its_type_name_and_message() {
    let run = logged(failing(), &[], Build::Development).await;
    let event = only(&run.events);
    assert_eq!(event.level, LogLevel::Fatal);
    let defect = event.defect.as_ref().unwrap();
    assert_eq!(defect.name, std::any::type_name::<ProbeError>());
    assert_eq!(defect.message, "The probe failed.");
    let failure = event.failure.as_ref().unwrap();
    assert_eq!(
        (failure.code.as_str(), failure.exit_code.get()),
        ("internal", 1)
    );
    assert!(run.stderr.contains("The probe failed."), "{}", run.stderr);
}

#[tokio::test]
async fn a_distributed_build_logs_the_defect_while_stderr_holds_the_generic_sentence() {
    let run = logged(failing(), &[], Build::Distributed).await;
    let event = only(&run.events);
    assert_eq!(event.level, LogLevel::Fatal);
    assert_eq!(event.message, "Something went wrong.");
    assert_eq!(
        event.failure.as_ref().unwrap().message,
        "Something went wrong."
    );
    let defect = event.defect.as_ref().unwrap();
    assert_eq!(defect.name, std::any::type_name::<ProbeError>());
    assert_eq!(defect.message, "The probe failed.");
    assert_eq!(run.stderr, "probe: Something went wrong.\n");
}

const PROBE_DEFECT: DiagnosticRule = diagnostic_rule(
    "@probe/core/reported-defect",
    "REPORTED DEFECT",
    "The probe reports a defect it found itself.",
);

#[tokio::test]
async fn a_defect_without_a_cause_reads_the_failure_itself() {
    let run = logged(
        probe(|_: Context| async {
            Err(InternalError::without_cause(
                PROBE_DEFECT,
                DiagnosticParts::new("The action reported a defect."),
            )
            .into())
        }),
        &[],
        Build::Distributed,
    )
    .await;
    let event = only(&run.events);
    assert_eq!(event.level, LogLevel::Fatal);
    let defect = event.defect.as_ref().unwrap();
    assert_eq!(
        (defect.name.as_str(), defect.message.as_str()),
        ("InternalError", "The action reported a defect.")
    );
}

/// Runs `application` on a mock whose stdout refuses every write, with a collecting hook.
async fn broken_stdout(application: App, build: Build) -> Logged {
    let (application, events) = collecting(application);
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(build)));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdout = Some(Scripted::refusing(
        0,
        io::ErrorKind::StorageFull,
        Arc::default(),
    ));
    let code = application
        .run(RunOptions::new().process(Arc::new(handle)))
        .await;
    let events = events.lock().unwrap().clone();
    Logged {
        code: code.get(),
        stderr: mock.stderr_text(),
        events,
    }
}

fn printing() -> App {
    probe(|ctx: Context| async move {
        let _ = ctx.out.print("rows").await;
        Ok(())
    })
}

#[tokio::test]
async fn a_stdout_that_fails_a_write_logs_the_destination_defect_at_fatal_with_the_write_error() {
    let run = broken_stdout(printing(), Build::Development).await;
    assert_eq!(run.code, 1);
    let event = only(&run.events);
    assert_eq!(event.level, LogLevel::Fatal);
    assert_eq!(event.message, "Could not write invocation output.");
    let defect = event.defect.as_ref().unwrap();
    assert_eq!(defect.message, "write StorageFull");
    assert_eq!(defect.name, std::any::type_name::<io::Error>());
    let failure = event.failure.as_ref().unwrap();
    assert_eq!(
        (failure.code.as_str(), failure.exit_code.get()),
        ("internal", 1)
    );
}

#[tokio::test]
async fn a_distributed_build_logs_the_destination_defect_while_stderr_holds_the_generic_sentence() {
    let run = broken_stdout(printing(), Build::Distributed).await;
    let event = only(&run.events);
    assert_eq!(event.level, LogLevel::Fatal);
    assert_eq!(event.message, "Something went wrong.");
    assert_eq!(event.defect.as_ref().unwrap().message, "write StorageFull");
    assert_eq!(run.stderr, "probe: Something went wrong.\n");
}

#[tokio::test]
async fn a_run_whose_stdout_failed_before_its_own_failure_logs_the_destination_defect_alone() {
    let run = broken_stdout(
        probe(|ctx: Context| async move {
            let _ = ctx.out.print("rows").await;
            Err(ctx.out.fatal("The action failed."))
        }),
        Build::Distributed,
    )
    .await;
    assert_eq!(
        summary(&run.events),
        [(LogLevel::Fatal, "Something went wrong.".to_owned(), None)]
    );
}

#[tokio::test]
async fn a_run_a_closed_pipe_cancelled_whose_action_returns_the_echo_logs_no_failure_event() {
    let (application, events) =
        collecting(probe(
            |ctx: Context| async move { ctx.out.print("rows").await },
        ));
    let mock = mock_process(MockFields::new());
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdout = Some(Scripted::refusing(
        0,
        io::ErrorKind::BrokenPipe,
        Arc::default(),
    ));
    let code = application
        .run(RunOptions::new().process(Arc::new(handle)))
        .await;
    assert_eq!(code.get(), 141);
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failure_a_cancelled_run_still_renders_logs_one_event_and_the_run_keeps_130() {
    let caller = CancellationToken::new();
    let (application, events) = collecting(probe({
        let caller = caller.clone();
        move |ctx: Context| {
            let caller = caller.clone();
            async move {
                caller.cancel();
                Err(ctx.out.fatal("The action failed."))
            }
        }
    }));
    let mock = mock_process(MockFields::new());
    let code = application
        .run(
            RunOptions::new()
                .process(Arc::clone(&mock) as _)
                .signal(caller),
        )
        .await;
    assert_eq!(code.get(), 130);
    assert_eq!(
        summary(&events.lock().unwrap()),
        [(LogLevel::Error, "The action failed.".to_owned(), None)]
    );
}

#[tokio::test]
async fn a_build_fault_logs_no_event() {
    // A root with neither children nor an action fails graph build.
    let run = logged(Application::new("probe"), &[], Build::Distributed).await;
    assert_eq!(run.code, 1);
    assert!(run.events.is_empty());
}

// observing-log-events.test.ts

#[tokio::test]
async fn two_hooks_receive_each_event_in_installation_order_the_same_event_with_the_runs_destination()
 {
    let seen = Arc::new(Mutex::new(
        Vec::<(String, String, String, bool, usize)>::new(),
    ));
    let observing = |identity: &'static str, seen: &Sightings| {
        let seen = Arc::clone(seen);
        move |event: &LogEvent, destination: &LogDestination| {
            seen.lock().unwrap().push((
                identity.to_owned(),
                destination.env.get("PROBE").cloned().unwrap_or_default(),
                destination.platform.clone(),
                destination.stderr.is_some(),
                std::ptr::from_ref(event) as usize,
            ));
            if let Some(stderr) = &destination.stderr {
                let line = format!("{identity}:{}\n", event.message);
                drop(stderr.write(line.as_bytes()));
            }
        }
    };
    let application = probe(|ctx: Context| async move {
        ctx.log.info("one", ());
        Ok(())
    });
    let application = install_log_hook(application, observing("fixture/first", &seen));
    let application = install_log_hook(application, observing("fixture/second", &seen));
    let mock = mock_process(MockFields::new().env("PROBE", "run").platform("probe-os"));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 0);
    let seen = seen.lock().unwrap().clone();
    let facts: Vec<_> = seen
        .iter()
        .map(|(identity, env, platform, stderr, _)| {
            (identity.as_str(), env.as_str(), platform.as_str(), *stderr)
        })
        .collect();
    assert_eq!(
        facts,
        [
            ("fixture/first", "run", "probe-os", true),
            ("fixture/second", "run", "probe-os", true),
        ]
    );
    assert_eq!(seen[0].4, seen[1].4, "one event reaches both hooks");
    assert_eq!(
        mock.stderr_text(),
        "fixture/first:one\nfixture/second:one\n"
    );
}

/// A hook that fails on every event, or on `only`'s level, counting its calls, and one that keeps
/// every message it receives.
fn breaking(application: App, only: Option<LogLevel>) -> (App, Counted) {
    let calls = Arc::new(Mutex::new(0));
    let fine = Arc::new(Mutex::new(Vec::new()));
    let application = install_log_hook(application, {
        let calls = Arc::clone(&calls);
        move |event: &LogEvent, _: &LogDestination| -> Result<(), Error> {
            if only.is_some_and(|level| event.level != level) {
                return Ok(());
            }
            *calls.lock().unwrap() += 1;
            Err(Error::from_foreign("Cannot observe.".into()))
        }
    });
    let application = install_log_hook(application, {
        let fine = Arc::clone(&fine);
        move |event: &LogEvent, _: &LogDestination| fine.lock().unwrap().push(event.message.clone())
    });
    (application, (calls, fine))
}

fn two_logs() -> App {
    probe(|ctx: Context| async move {
        ctx.log.info("one", ());
        ctx.log.info("two", ());
        Ok(())
    })
}

/// The opening of the Developer Diagnostic a hook's first failure reports.
fn opens_with_hook_throw(text: &str) -> bool {
    text.starts_with("-- UNHANDLED EXCEPTION ")
        && text.contains(" @loomcli/core/foreign-throw\n\nCannot observe.\n")
}

async fn run_on(
    application: &App,
    mock: &Arc<loomcli_testing::MockProcess>,
    caller: Option<CancellationToken>,
) -> u8 {
    let mut options = RunOptions::new().process(Arc::clone(mock) as _);
    if let Some(caller) = caller {
        options = options.signal(caller);
    }
    application.run(options).await.get()
}

#[tokio::test]
async fn a_hook_that_fails_is_still_called_for_every_later_event_and_its_first_failure_turns_exit_0_into_1()
 {
    let (application, (calls, fine)) = breaking(two_logs(), None);
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
    assert_eq!(run_on(&application, &mock, None).await, 1);
    // The hook receives both events and the fatal event its own report logs.
    assert_eq!(*calls.lock().unwrap(), 3);
    assert_eq!(*fine.lock().unwrap(), ["one", "two", "Cannot observe."]);
    let written = mock.stderr_text();
    assert!(opens_with_hook_throw(&written), "{written}");
    assert_eq!(written.matches("\n-- ").count() + 1, 1, "{written}");

    let (application, (calls, _)) = breaking(two_logs(), None);
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    assert_eq!(run_on(&application, &mock, None).await, 1);
    assert_eq!(*calls.lock().unwrap(), 3);
    assert_eq!(mock.stderr_text(), "probe: Something went wrong.\n");
}

#[tokio::test]
async fn a_stdout_that_fails_and_a_hook_that_fails_write_two_diagnostics_with_one_blank_line_between()
 {
    let (application, _) = breaking(
        probe(|ctx: Context| async move {
            ctx.log.info("one", ());
            let _ = ctx.out.print("rows").await;
            Ok(())
        }),
        None,
    );
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdout = Some(Scripted::refusing(
        0,
        io::ErrorKind::StorageFull,
        Arc::default(),
    ));
    let code = application
        .run(RunOptions::new().process(Arc::new(handle)))
        .await;
    assert_eq!(code.get(), 1);
    let written = mock.stderr_text();
    assert!(opens_with_hook_throw(&written), "{written}");
    assert!(
        written.contains("\n\n-- BROKEN DESTINATION ")
            && written.contains(" @loomcli/core/broken-destination\n"),
        "{written}"
    );
}

#[tokio::test]
async fn a_failing_hook_in_a_run_a_caller_cancelled_keeps_130_and_still_writes_the_report() {
    let caller = CancellationToken::new();
    let (application, (_, fine)) = breaking(
        probe({
            let caller = caller.clone();
            move |ctx: Context| {
                let caller = caller.clone();
                async move {
                    caller.cancel();
                    ctx.log.info("one", ());
                    ctx.log.info("two", ());
                    Ok(())
                }
            }
        }),
        None,
    );
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
    assert_eq!(run_on(&application, &mock, Some(caller)).await, 130);
    assert_eq!(*fine.lock().unwrap(), ["one", "two", "Cannot observe."]);
    assert!(
        opens_with_hook_throw(&mock.stderr_text()),
        "{}",
        mock.stderr_text()
    );
}

#[tokio::test]
async fn a_hook_that_fails_on_the_fatal_event_is_reported_once_and_its_failure_on_its_own_reports_event_is_not()
 {
    let (application, (calls, fine)) = breaking(failing(), Some(LogLevel::Fatal));
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
    assert_eq!(run_on(&application, &mock, None).await, 1);
    assert_eq!(*calls.lock().unwrap(), 2);
    assert_eq!(
        *fine.lock().unwrap(),
        ["The probe failed.", "Cannot observe."]
    );
    let written = mock.stderr_text();
    assert_eq!(
        written.matches("-- UNHANDLED EXCEPTION").count(),
        2,
        "{written}"
    );
    assert!(written.contains("\n\nCannot observe.\n"), "{written}");

    let (application, (calls, _)) = breaking(failing(), Some(LogLevel::Fatal));
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    assert_eq!(run_on(&application, &mock, None).await, 1);
    assert_eq!(*calls.lock().unwrap(), 2);
    assert_eq!(mock.stderr_text(), "probe: Something went wrong.\n");
}

// home-folders.test.ts

#[tokio::test]
async fn an_on_log_hooks_destination_carries_the_runs_home() {
    let homes = Arc::new(Mutex::new(Vec::new()));
    let application = install_log_hook(
        probe(|ctx: Context| async move {
            ctx.log.info("hello", ());
            Ok(())
        }),
        {
            let homes = Arc::clone(&homes);
            move |_: &LogEvent, destination: &LogDestination| {
                homes.lock().unwrap().push(destination.home.clone());
            }
        },
    );
    let mock = mock_process(MockFields::new().env("HOME", "/ignored").home("/home/me"));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        *homes.lock().unwrap(),
        [std::path::PathBuf::from("/home/me")]
    );
}

// verbosity.test.ts

#[tokio::test]
async fn under_vv_an_on_log_hook_receives_the_events_that_show_as_log_lines() {
    let application = Application::new("probe")
        .global_option(
            "verbose",
            loomcli_core::Opt::count()
                .description("Show more detail.")
                .short('v')
                .verbose(),
        )
        .action(|ctx: Context| async move {
            ctx.log.debug("debug line", ());
            ctx.log.trace("trace line", ());
            Ok(())
        });
    let run = logged(application, &["-vv"], Build::Distributed).await;
    assert_eq!(run.code, 0);
    assert!(run.stderr.contains("debug line") && run.stderr.contains("trace line"));
    assert_eq!(run.events.len(), 2);
    assert_eq!(run.events[0].message, "debug line");
    assert_eq!(run.events[1].message, "trace line");
}

// The reach of log: a middleware, a source, an `on_failure` hook, and a plugin's Command.

/// The key the reaching plugin's source binds.
const REACH_KEY: loomcli_core::Extension<loomcli_core::OptionTarget, String> =
    loomcli_core::Extension::new("@fixture/logging/key");

/// `probe` under a plugin that logs from its middleware, its source, and its `on_failure` hook and
/// collects every event, beside a plugin whose Command logs.
fn reaching() -> (Application<NoInputs, NoResult, Done>, Collected) {
    let events: Collected = Arc::default();
    let reaching = loomcli_core::Plugin::new("fixture/reaching")
        .extensions([loomcli_core::AnyExtension::from(REACH_KEY)])
        .middleware(
            loomcli_core::Activation::Always,
            |ctx, next: loomcli_core::Next| async move {
                ctx.log.info("from middleware", ());
                next.run().await.map(|_| ())
            },
        )
        .on_failure(|_, context| {
            context.log.info("from hook", ());
        })
        .on_log({
            let events = Arc::clone(&events);
            move |event: &LogEvent, _: &LogDestination| events.lock().unwrap().push(event.clone())
        })
        .source(loomcli_core::ConfigurationSource::new(
            &REACH_KEY,
            |context: loomcli_core::SourceContext<NoInputs>| async move {
                context.log.info("from source", ());
                Ok(std::collections::BTreeMap::new())
            },
        ));
    let commands = loomcli_core::Plugin::new("fixture/commands").commands([Command::new("plug")
        .description("The plugin command.")
        .action(|ctx: Context| async move {
            ctx.log.info("from plugin command", ());
            Ok(())
        })]);
    let application = Application::new("probe")
        .description("Probe the reach of log.")
        .plugins((reaching, commands))
        .global_option(
            "limit",
            loomcli_core::Opt::string().extend([REACH_KEY.value("limit".to_owned())]),
        )
        .action(|ctx: Context| async move {
            ctx.log.info("from action", ());
            Err(ctx.out.fatal("The action failed."))
        });
    (application, events)
}

async fn reached(argv: &[&str]) -> Vec<(LogLevel, String, Option<String>)> {
    let (application, events) = reaching();
    let mock = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let _ = application
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    summary(&events.lock().unwrap())
}

#[tokio::test]
async fn an_action_a_middleware_a_source_and_an_on_failure_hook_each_log_one_event_in_call_order() {
    let reaching = Some("fixture/reaching".to_owned());
    assert_eq!(
        reached(&[]).await,
        [
            (LogLevel::Info, "from source".to_owned(), reaching.clone()),
            (
                LogLevel::Info,
                "from middleware".to_owned(),
                reaching.clone()
            ),
            (LogLevel::Info, "from action".to_owned(), None),
            (LogLevel::Error, "The action failed.".to_owned(), None),
            (LogLevel::Info, "from hook".to_owned(), reaching),
        ]
    );
}

#[tokio::test]
async fn a_plugin_commands_action_logs_under_its_plugin() {
    let reaching = Some("fixture/reaching".to_owned());
    assert_eq!(
        reached(&["plug"]).await,
        [
            (LogLevel::Info, "from source".to_owned(), reaching.clone()),
            (LogLevel::Info, "from middleware".to_owned(), reaching),
            (
                LogLevel::Info,
                "from plugin command".to_owned(),
                Some("fixture/commands".to_owned()),
            ),
        ]
    );
}
