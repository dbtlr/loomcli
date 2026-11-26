//! Ports `working-directory.test.ts`'s run-level cases (`host.md`, "An unreadable working
//! directory"): the failure is raised before the graph builds, so no `on_failure` hook runs, no view
//! override applies, and core's default text writes the line, in either build. A supplied `cwd`
//! replaces the capture at both doors, and an action's call reads its run's directory.
//!
//! The process test that removes its real working directory is not ported: the mock's `cwd_with`
//! stands for the capture that fails. The class's statics are in `failures.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Build, Command, Context, Error, Failure, FailureFacts, FailureView,
    InvocationOutcome, InvocationValues, InvokeOptions, LoomError, Plugin, ReleaseFacts,
    RunOptions, WorkingDirectoryError, failure, override_view,
};
use loomcli_testing::{MockFields, MockProcess, mock_process};

type Calls = Arc<Mutex<Vec<String>>>;

const MESSAGE: &str = "The current working directory cannot be read. Change to a directory that exists and run the command again.";

/// The fixture's application: a hinting hook and two view overrides, so a case shows that neither
/// answers, and two Commands that print the working directory, directly and by name.
fn application(
    calls: &Calls,
) -> Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Group> {
    let hook = Arc::clone(calls);
    let where_calls = Arc::clone(calls);
    let nested_calls = Arc::clone(calls);
    Application::new("cwd")
        .plugins([
            Plugin::new("@fixture/hinting").on_failure(move |failure: &dyn Failure, _| {
                hook.lock()
                    .unwrap()
                    .push(format!("hook:{}", failure.class().name()));
                vec!["A hint.".to_owned()]
            }),
        ])
        .overrides([
            override_view(
                failure::<WorkingDirectoryError>(),
                FailureView::new(|_: &WorkingDirectoryError, _| "overridden\n".to_owned()),
            ),
            override_view(
                failure::<LoomError>(),
                FailureView::new(|_: &LoomError, _| "overridden\n".to_owned()),
            ),
        ])
        .command(Command::new("where").action(move |ctx: Context| {
            where_calls.lock().unwrap().push("action:where".to_owned());
            async move { ctx.out.print(&ctx.host.cwd.display().to_string()).await }
        }))
        .command(Command::new("nested").action(move |ctx: Context| {
            nested_calls
                .lock()
                .unwrap()
                .push("action:nested".to_owned());
            async move {
                let outcome = ctx
                    .invoke(&["where"], InvocationValues::new(), InvokeOptions::new())
                    .await;
                let line = match outcome {
                    InvocationOutcome::Completed { output, .. } => format!("completed:{output}"),
                    InvocationOutcome::Failed { .. } => "failed:".to_owned(),
                    _ => "cancelled:".to_owned(),
                };
                ctx.out.print(&line).await
            }
        }))
}

/// A mock in `build` whose working directory read fails as a removed directory's does, counting
/// each read.
fn unreadable(build: Build, argv: &[&str]) -> (Arc<MockProcess>, Arc<AtomicUsize>) {
    let reads = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&reads);
    let mock = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build))
            .cwd_with(move || {
                counted.fetch_add(1, Ordering::SeqCst);
                Err(std::io::Error::from(std::io::ErrorKind::NotFound))
            }),
    );
    (mock, reads)
}

#[tokio::test]
async fn run_in_either_build_writes_the_line_reads_the_directory_once_and_runs_no_hook_override_or_action()
 {
    for build in [Build::Distributed, Build::Development] {
        let calls: Calls = Arc::default();
        let (mock, reads) = unreadable(build, &["where"]);
        let code = application(&calls)
            .run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await;
        assert_eq!(code.get(), 1, "{build:?}");
        assert_eq!(mock.stdout_text(), "", "{build:?}");
        assert_eq!(mock.stderr_text(), format!("cwd: {MESSAGE}\n"), "{build:?}");
        assert_eq!(
            mock.exit_code().map(|code| code.get()),
            Some(1),
            "{build:?}"
        );
        assert_eq!(reads.load(Ordering::SeqCst), 1, "{build:?}");
        assert!(calls.lock().unwrap().is_empty(), "{build:?}");
    }
}

#[tokio::test]
async fn app_invoke_resolves_failed_with_the_failure_its_form_and_the_line_and_reads_once() {
    let calls: Calls = Arc::default();
    let (mock, reads) = unreadable(Build::Distributed, &[]);
    let outcome = application(&calls)
        .invoke(
            &["where"],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock as _),
        )
        .await;
    let InvocationOutcome::Failed {
        failure,
        form,
        exit_code,
        output,
        messages,
    } = outcome
    else {
        panic!("the invocation fails");
    };
    let failure = failure
        .downcast_failure::<WorkingDirectoryError>()
        .expect("a WorkingDirectoryError");
    assert_eq!(failure.message(), MESSAGE);
    let cause = failure
        .cause()
        .and_then(Error::foreign)
        .map(ToString::to_string);
    assert_eq!(cause.as_deref(), Some("entity not found"));
    assert_eq!(exit_code.get(), 1);
    assert_eq!(
        serde_json::to_string(&form).unwrap(),
        format!(
            r#"{{"code":"working-directory-unreadable","exitCode":1,"message":"{MESSAGE}","hints":[]}}"#
        )
    );
    assert_eq!(output, "");
    assert_eq!(messages, format!("cwd: {MESSAGE}\n"));
    assert_eq!(reads.load(Ordering::SeqCst), 1);
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_supplied_cwd_replaces_the_capture_at_both_doors_so_neither_reads_the_directory() {
    let calls: Calls = Arc::default();
    let ran = mock_process(
        MockFields::new()
            .argv(["where"])
            .cwd("/srv/override")
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = application(&calls)
        .run(RunOptions::new().process(Arc::clone(&ran) as _))
        .await;
    assert_eq!(
        (
            code.get(),
            ran.stdout_text().as_str(),
            ran.stderr_text().as_str()
        ),
        (0, "/srv/override\n", "")
    );
    let named = mock_process(
        MockFields::new()
            .cwd("/srv/named")
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let outcome = application(&calls)
        .invoke(
            &["where"],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(named as _),
        )
        .await;
    let InvocationOutcome::Completed { output, messages } = outcome else {
        panic!("the invocation completes");
    };
    assert_eq!((output.as_str(), messages.as_str()), ("/srv/named\n", ""));
    assert_eq!(*calls.lock().unwrap(), ["action:where", "action:where"]);
}

#[tokio::test]
async fn an_actions_invoke_reads_its_runs_working_directory_and_captures_nothing() {
    let calls: Calls = Arc::default();
    let mock = mock_process(
        MockFields::new()
            .argv(["nested"])
            .cwd("/srv/override")
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = application(&calls)
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(mock.stdout_text(), "completed:/srv/override\n");
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(*calls.lock().unwrap(), ["action:nested", "action:where"]);
}
