//! Ports `invoke.test.ts`, `invoke-exclude.test.ts`, and the invocation part of
//! `progress-events.test.ts`: a Command run by name through `Application::invoke` and `ctx.invoke`.
//!
//! An invocation by name is a run with no process: its values lower to what argv would give, its
//! problems name inputs by declared name, its output is captured as plain text with stdout as
//! `output` and stderr as `messages`, its failure reaches the caller's mapper after the translators,
//! and it makes no process effect. An action's call reuses its run's graph and preparation, and its
//! signal derives from its run's. The lowering table itself is pinned in `src/invocation/lower.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::__private::{SourceProbe, install_source};
use loomcli_core::{
    Activation, Application, Arg, Build, Command, Context, Error, Extension, Failure, FailureFacts,
    FailureView, FatalError, InvocationOutcome, InvocationValues, InvokeFailure, InvokeOptions,
    InvokedBy, LoomError, NoInputs, Opt, OptionTarget, Plugin, Polarity, ProcessHandle,
    ProgressEvent, ProgressReport, ProgressState, RegionOptions, ReleaseFacts, RenderingPolicy,
    ResultViews, RunOptions, SignalEvent, SourceAnswer, Switch, ValueResult, View, ViewContext,
    failure, override_view, read_extension, translate,
};
use loomcli_testing::{MockFields, MockProcess, mock_process};
use serde::Serialize;
use support::validators::Digits;
use tokio_util::sync::CancellationToken;

type Lines = Arc<Mutex<Vec<String>>>;

/// An Application whose root holds Commands.
type Group = Application<NoInputs, loomcli_core::NoResult, loomcli_core::Group>;

fn push(lines: &Lines, line: impl Into<String>) {
    lines.lock().unwrap().push(line.into());
}

fn read(lines: &Lines) -> Vec<String> {
    lines.lock().unwrap().clone()
}

/// A mock in a distributed build, as the reference's fixture process is.
fn distributed() -> Arc<MockProcess> {
    mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)))
}

fn handle(mock: &Arc<MockProcess>) -> Option<Arc<dyn ProcessHandle>> {
    Some(Arc::clone(mock) as Arc<dyn ProcessHandle>)
}

/// One outcome as a test reads it: its status, the captured text, and the exit code.
#[derive(Debug, PartialEq, Eq)]
enum Read {
    Completed {
        output: String,
        messages: String,
    },
    Failed {
        exit_code: u8,
        output: String,
        messages: String,
    },
    Cancelled {
        exit_code: u8,
    },
}

fn completed(output: &str, messages: &str) -> Read {
    Read::Completed {
        output: output.to_owned(),
        messages: messages.to_owned(),
    }
}

fn failed(exit_code: u8, messages: &str) -> Read {
    Read::Failed {
        exit_code,
        output: String::new(),
        messages: messages.to_owned(),
    }
}

fn read_outcome<M>(outcome: &InvocationOutcome<M>) -> Read {
    match outcome {
        InvocationOutcome::Completed { output, messages } => Read::Completed {
            output: output.clone(),
            messages: messages.clone(),
        },
        InvocationOutcome::Failed {
            exit_code,
            output,
            messages,
            ..
        } => Read::Failed {
            exit_code: exit_code.get(),
            output: output.clone(),
            messages: messages.clone(),
        },
        InvocationOutcome::Cancelled { exit_code } => Read::Cancelled {
            exit_code: exit_code.get(),
        },
        _ => panic!("an outcome this test does not know"),
    }
}

/// Invokes `path` with `values` on a fresh distributed mock.
async fn call<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    path: &[&str],
    values: InvocationValues,
) -> Read {
    let outcome = app
        .invoke(path, values, InvokeOptions::new(), handle(&distributed()))
        .await;
    read_outcome(&outcome)
}

/// An action that prints `text`.
fn printing(
    text: &'static str,
) -> impl Fn(Context) -> loomcli_core::BoxFuture<'static, loomcli_core::Outcome> + Send + Sync {
    move |ctx: Context| Box::pin(async move { ctx.out.print(text).await })
}

// Lowering through a run.

/// The lowering Application: one Command that echoes what it read, and one with a required list.
fn lowering() -> Group {
    Application::new("probe")
        .command(
            Command::new("echo")
                .argument("target", Arg::string().required())
                .option("flag", Opt::boolean().env(["PROBE_FLAG"]))
                .option("name", Opt::string())
                .option("tag", Opt::string().multiple())
                .option("verbose", Opt::count())
                .action(|ctx: Context| async move {
                    let target: Option<String> = ctx.argument("target")?;
                    let target = target.unwrap_or_default();
                    let flag: bool = ctx.option("flag")?;
                    let name: Option<String> = ctx.option("name")?;
                    let tag: Vec<String> = ctx.option("tag")?;
                    let verbose: u32 = ctx.option("verbose")?;
                    ctx.out
                        .print(&format!(
                            "{target} {flag} {} {} {verbose}",
                            name.unwrap_or_default(),
                            tag.join(",")
                        ))
                        .await
                }),
        )
        .command(
            Command::new("need")
                .option("item", Opt::string().multiple().required())
                .action(|_: Context| async { Ok(()) }),
        )
}

#[tokio::test]
async fn each_value_lowers_to_the_tokens_argv_would_give() {
    let app = lowering();
    let values = InvocationValues::new()
        .arg("target", 7)
        .option("flag", true)
        .option("name", 5)
        .option("tag", vec!["a", "2"])
        .option("verbose", 3);
    assert_eq!(
        call(&app, &["echo"], values).await,
        completed("7 true 5 a,2 3\n", "")
    );
}

#[tokio::test]
async fn false_on_a_positive_option_is_absence_and_a_bound_variable_still_fills_it() {
    let app = lowering();
    let values = || {
        InvocationValues::new()
            .arg("target", "t")
            .option("flag", false)
    };
    assert_eq!(
        call(&app, &["echo"], values()).await,
        completed("t false   0\n", "")
    );
    let bound = mock_process(
        MockFields::new()
            .env("PROBE_FLAG", "true")
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let outcome = app
        .invoke(&["echo"], values(), InvokeOptions::new(), handle(&bound))
        .await;
    assert_eq!(read_outcome(&outcome), completed("t true   0\n", ""));
}

#[tokio::test]
async fn an_empty_list_on_a_required_multiple_option_is_the_missing_input_problem() {
    let app = lowering();
    let values = InvocationValues::new().option("item", Vec::<String>::new());
    assert_eq!(
        call(&app, &["need"], values).await,
        failed(
            2,
            "probe: Option \"item\" is required. Supply at least one value.\n"
        )
    );
}

#[tokio::test]
async fn each_unlowerable_value_is_an_invalid_problem_whose_issue_says_what_the_input_takes() {
    let app = lowering();
    let values = InvocationValues::new()
        .arg("target", true)
        .option("name", serde_json::Value::Null)
        .option("flag", "yes")
        .option("verbose", 1.5);
    assert_eq!(
        call(&app, &["echo"], values).await,
        failed(
            2,
            "probe: Argument \"target\": Use a string or a number.\n\
             probe: Option \"flag\": Use true or false.\n\
             probe: Option \"name\": Use a string or a number.\n\
             probe: Option \"verbose\": Use a whole number of 0 or more.\n"
        )
    );
}

// Names.

fn names(seen: &Lines) -> Group {
    let seen = Arc::clone(seen);
    Application::new("probe")
        .global_option(
            "min-bytes",
            Opt::string()
                .env(["PROBE_MIN_BYTES"])
                .validate(Digits("Expected a whole number of at least 0.")),
        )
        .command(
            Command::new("pair")
                .argument("first", Arg::string().required())
                .argument("second", Arg::string().required())
                .option("depth", Opt::string().required().short('d'))
                .action(|_: Context| async { Ok(()) }),
        )
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .action(move |ctx: Context| {
                    let seen = Arc::clone(&seen);
                    async move {
                        let path: Option<String> = ctx.argument("path")?;
                        push(&seen, path.unwrap_or_default());
                        Ok(())
                    }
                }),
        )
        .command(
            Command::new("cache")
                .command(Command::new("clear").action(printing("cleared")))
                .command(Command::new("purge").hidden().action(printing("purged"))),
        )
        .command(Command::new("list").alias("ls").action(printing("listed")))
}

#[tokio::test]
async fn an_argument_binds_by_name_and_every_problem_names_its_input_by_declared_name() {
    let app = names(&Lines::default());
    assert_eq!(
        call(&app, &["pair"], InvocationValues::new().arg("second", "x")).await,
        failed(
            2,
            "probe: Argument \"first\" requires a value. Supply a value for \"first\".\n\
             probe: Option \"depth\" is required. Supply a value.\n"
        )
    );
}

#[tokio::test]
async fn a_source_problem_names_the_option_by_its_spelling_under_run_and_its_name_under_invoke() {
    let app = names(&Lines::default());
    let fields = || {
        MockFields::new()
            .env("PROBE_MIN_BYTES", "many")
            .release(ReleaseFacts::new(Build::Distributed))
    };
    let argv = mock_process(fields().argv(["get"]));
    let code = app
        .run(RunOptions::new().process(Arc::clone(&argv) as _))
        .await;
    assert_eq!(code.get(), 2);
    assert_eq!(
        argv.stderr_text(),
        "probe: Option \"--min-bytes\" (from PROBE_MIN_BYTES): Expected a whole number of at least 0.\n"
    );
    let named = mock_process(fields());
    let outcome = app
        .invoke(
            &["get"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&named),
        )
        .await;
    assert_eq!(
        read_outcome(&outcome),
        failed(
            2,
            "probe: Option \"min-bytes\" (from PROBE_MIN_BYTES): Expected a whole number of at least 0.\n"
        )
    );
}

#[tokio::test]
async fn an_unknown_option_name_and_an_unknown_argument_name_report_their_by_name_sentences() {
    let app = names(&Lines::default());
    assert_eq!(
        call(
            &app,
            &["get"],
            InvocationValues::new().option("verbos", true)
        )
        .await,
        failed(
            2,
            "probe: Unknown option \"verbos\". Supply the name of a declared option.\n"
        )
    );
    assert_eq!(
        call(&app, &["get"], InvocationValues::new().arg("pth", "x")).await,
        failed(
            2,
            "probe: Command \"get\" declares no argument \"pth\". Supply the name of a declared argument.\n"
        )
    );
}

#[tokio::test]
async fn an_unknown_path_lists_the_root_children_and_a_path_through_an_alias_or_hidden_command_routes()
 {
    let app = names(&Lines::default());
    assert_eq!(
        call(&app, &["nope"], InvocationValues::new()).await,
        failed(
            2,
            "probe: Unknown command \"nope\". Use one of: pair, get, cache, list.\n"
        )
    );
    assert_eq!(
        call(&app, &["ls"], InvocationValues::new()).await,
        completed("listed\n", "")
    );
    assert_eq!(
        call(&app, &["cache"], InvocationValues::new()).await,
        failed(
            2,
            "probe: Command \"cache\" requires a subcommand. Use one of: clear.\n"
        )
    );
    assert_eq!(
        call(&app, &["cache", "purge"], InvocationValues::new()).await,
        completed("purged\n", "")
    );
}

// Capture.

#[derive(Serialize)]
struct Count {
    count: u32,
}

#[tokio::test]
async fn the_result_reaches_output_every_other_write_reaches_messages_all_plain_on_a_host_with_no_terminal_or_argv()
 {
    let app = Application::new("probe")
        .rendering(RenderingPolicy::new().color(Switch::Always))
        .command(
            Command::new("report")
                .result(ResultViews::new().view(
                    "text",
                    View::new(|value: &Count, context: &ViewContext| {
                        format!("{}\n", context.style.bold().apply(&value.count.to_string()))
                    }),
                ))
                .action(|ctx: Context<NoInputs, ValueResult<Count>>| async move {
                    let red = ctx.style.bold().apply("Command");
                    ctx.out.print(&format!("print on a result {red}")).await?;
                    ctx.out.info(&ctx.style.bold().apply("info")).await?;
                    ctx.out.success("success").await?;
                    ctx.out.warn("warn").await?;
                    ctx.out.error("error").await?;
                    ctx.out.results(Count { count: 3 }).await?;
                    let terminal = &ctx.host.terminal;
                    ctx.out
                        .info(&format!(
                            "argv:{:?} tty:{}{}{}",
                            ctx.host.argv,
                            terminal.stdin().is_tty,
                            terminal.stdout().is_tty,
                            terminal.stderr().is_tty
                        ))
                        .await
                }),
        );
    let mock = mock_process(
        MockFields::new()
            .env("FORCE_COLOR", "1")
            .argv(["report"])
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let outcome = app
        .invoke(
            &["report"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&mock),
        )
        .await;
    assert_eq!(
        read_outcome(&outcome),
        completed(
            "3\n",
            "print on a result Command\nℹ info\n✔ success\n⚠ warn\n✘ error\nℹ argv:[] tty:falsefalsefalse\n"
        )
    );
    // The handle's own streams receive nothing.
    assert_eq!(
        (mock.stdout_text(), mock.stderr_text()),
        (String::new(), String::new())
    );
}

// Failures.

#[derive(Debug)]
struct ForeignError;

impl std::fmt::Display for ForeignError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("raw")
    }
}

impl std::error::Error for ForeignError {}

#[derive(Debug, loomcli_core::Failure)]
struct TranslatedError {
    #[failure(base)]
    base: FatalError,
}

fn failures(broken_view: bool) -> Group {
    let app = Application::new("probe").translators([translate(|_: ForeignError| {
        Ok(TranslatedError {
            base: FatalError::new("The foreign call failed."),
        })
    })]);
    let app = if broken_view {
        app.overrides([override_view(
            failure::<TranslatedError>(),
            FailureView::new(|_: &TranslatedError, _| -> Result<String, Error> {
                Err(Error::from_foreign("the view broke".into()))
            }),
        )])
    } else {
        app
    };
    app.command(Command::new("foreign").action(|_: Context| async { Err(ForeignError.into()) }))
        .command(
            Command::new("defect").action(|_: Context| async {
                Err(std::io::Error::other("the action broke").into())
            }),
        )
}

#[tokio::test]
async fn the_mapper_receives_the_translated_failure_and_its_context_and_maps_it_into_the_outcome() {
    let received: Lines = Arc::default();
    let options = InvokeOptions::new().failure({
        let received = Arc::clone(&received);
        move |failure: &dyn Failure, context: &InvokeFailure| {
            push(
                &received,
                format!(
                    "{}:{}:{:?}:{}:{}",
                    failure.class().name(),
                    context.application,
                    context.path,
                    context.exit_code.get(),
                    serde_json::to_string(&context.form).unwrap()
                ),
            );
            format!("mapped:{}", failure.message())
        }
    });
    let outcome = failures(false)
        .invoke(
            &["foreign"],
            InvocationValues::new(),
            options,
            handle(&distributed()),
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
        panic!("the call failed");
    };
    assert_eq!(failure, "mapped:The foreign call failed.");
    assert_eq!(exit_code.get(), 1);
    assert_eq!(
        (output.as_str(), messages.as_str()),
        ("", "The foreign call failed.\n")
    );
    let form_json =
        r#"{"code":"fatal","exitCode":1,"message":"The foreign call failed.","hints":[]}"#;
    assert_eq!(serde_json::to_string(&form).unwrap(), form_json);
    assert_eq!(
        read(&received),
        [format!("TranslatedError:probe:[\"foreign\"]:1:{form_json}")]
    );
}

#[tokio::test]
async fn with_no_mapper_the_outcome_holds_the_failure_itself() {
    let outcome = failures(false)
        .invoke(
            &["foreign"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&distributed()),
        )
        .await;
    let InvocationOutcome::Failed { failure, .. } = outcome else {
        panic!("the call failed");
    };
    let failure = failure.failure().unwrap();
    assert!(failure.is::<TranslatedError>());
    assert_eq!(failure.message(), "The foreign call failed.");
}

#[tokio::test]
async fn a_defect_writes_the_generic_message_in_a_distributed_build_and_the_mapper_receives_the_internal_error()
 {
    let names: Lines = Arc::default();
    let options = InvokeOptions::new().failure({
        let names = Arc::clone(&names);
        move |failure: &dyn Failure, _: &InvokeFailure| {
            push(&names, failure.class().name());
        }
    });
    let outcome = failures(false)
        .invoke(
            &["defect"],
            InvocationValues::new(),
            options,
            handle(&distributed()),
        )
        .await;
    assert_eq!(
        read_outcome(&outcome),
        failed(1, "probe: Something went wrong.\n")
    );
    assert_eq!(read(&names), ["InternalError"]);
    // A development build writes the Developer Diagnostic instead.
    let development =
        mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
    let outcome = failures(false)
        .invoke(
            &["defect"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&development),
        )
        .await;
    let Read::Failed { messages, .. } = read_outcome(&outcome) else {
        panic!("the call failed");
    };
    assert!(
        messages.starts_with("-- UNHANDLED EXCEPTION -")
            && messages.contains("@loomcli/core/foreign-throw"),
        "{messages}"
    );
}

#[tokio::test]
async fn a_broken_failure_view_resolves_failed_with_exit_1() {
    let outcome = failures(true)
        .invoke(
            &["foreign"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&distributed()),
        )
        .await;
    assert_eq!(
        read_outcome(&outcome),
        failed(
            1,
            "The foreign call failed.\nprobe: Something went wrong.\n"
        )
    );
}

// The view.

fn counting(plugins: Vec<Plugin>) -> Group {
    Application::new("probe")
        .plugins(plugins)
        .command(
            Command::new("count")
                .result(
                    ResultViews::new()
                        .view(
                            "text",
                            View::new(|value: &Count, _: &ViewContext| {
                                format!("count {}\n", value.count)
                            }),
                        )
                        .view(
                            "json",
                            View::new(|value: &Count, _: &ViewContext| {
                                format!("{}\n", serde_json::to_string(value).unwrap())
                            })
                            .media_type("application/json"),
                        ),
                )
                .action(|ctx: Context<NoInputs, ValueResult<Count>>| async move {
                    ctx.out.results(Count { count: 2 }).await
                }),
        )
        .command(Command::new("get").action(|_: Context| async { Ok(()) }))
}

#[tokio::test]
async fn view_selects_the_starting_view_and_a_middleware_assignment_after_it_wins() {
    let json = counting(Vec::new())
        .invoke(
            &["count"],
            InvocationValues::new(),
            InvokeOptions::new().view("json"),
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&json), completed("{\"count\":2}\n", ""));
    let assigning =
        Plugin::new("@fixture/assign").middleware(Activation::Always, |ctx, next| async move {
            ctx.select_view("text");
            next.run().await.map(|_| ())
        });
    let assigned = counting(vec![assigning])
        .invoke(
            &["count"],
            InvocationValues::new(),
            InvokeOptions::new().view("json"),
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&assigned), completed("count 2\n", ""));
}

#[tokio::test]
async fn an_unknown_view_and_a_view_on_a_command_with_no_result_are_the_view_selection_defect_named_for_invoke()
 {
    for (path, sentence) in [
        (
            "count",
            "invoke() selected view \"yaml\", which Command \"count\" does not name.",
        ),
        (
            "get",
            "invoke() selected view \"yaml\" on Command \"get\", which declares no result.",
        ),
    ] {
        let development =
            mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
        let outcome = counting(Vec::new())
            .invoke(
                &[path],
                InvocationValues::new(),
                InvokeOptions::new().view("yaml"),
                handle(&development),
            )
            .await;
        let Read::Failed {
            exit_code,
            messages,
            ..
        } = read_outcome(&outcome)
        else {
            panic!("the call failed");
        };
        assert_eq!(exit_code, 1);
        assert!(
            messages.starts_with("-- INVALID VIEW SELECTION -"),
            "{messages}"
        );
        assert!(
            messages.contains(&format!("\n\n{sentence}\n")),
            "{messages}"
        );
        assert!(
            messages.contains("\nSupply a view name the Command's result declares.\n"),
            "{messages}"
        );
    }
}

// Process isolation, cancellation, and nesting.

/// An action that prints four lines under its label, yielding between them.
fn chatty(
    label: &'static str,
) -> impl Fn(Context) -> loomcli_core::BoxFuture<'static, loomcli_core::Outcome> + Send + Sync {
    move |ctx: Context| {
        Box::pin(async move {
            for index in 0..4 {
                ctx.out.print(&format!("{label} {index}")).await?;
                tokio::task::yield_now().await;
            }
            Ok(())
        })
    }
}

fn lines(label: &str) -> String {
    (0..4).map(|index| format!("{label} {index}\n")).collect()
}

/// The outcome's captured output, or a mark for any other outcome.
fn output_of<M>(outcome: &InvocationOutcome<M>) -> String {
    match outcome {
        InvocationOutcome::Completed { output, .. } => output.clone(),
        _ => "not completed".to_owned(),
    }
}

#[tokio::test]
async fn a_call_from_an_action_touches_no_listener_exit_code_or_handle_stream_and_its_writes_stay_in_the_outcome()
 {
    let mock = mock_process(MockFields::new().cwd("/sentinel").argv(["parent"]));
    let seen: Lines = Arc::default();
    let app = Application::new("probe")
        .command(Command::new("child").action(|ctx: Context| async move {
            ctx.out.print("child output").await?;
            ctx.out.warn("child message").await?;
            ctx.out
                .print(&format!(
                    "argv:{:?} cwd:{}",
                    ctx.host.argv,
                    ctx.host.cwd.display()
                ))
                .await
        }))
        .command(Command::new("parent").action({
            let (mock, seen) = (Arc::clone(&mock), Arc::clone(&seen));
            move |ctx: Context| {
                let (mock, seen) = (Arc::clone(&mock), Arc::clone(&seen));
                async move {
                    let before = mock.listeners(SignalEvent::Exit);
                    let outcome = ctx
                        .invoke(&["child"], InvocationValues::new(), InvokeOptions::new())
                        .await;
                    push(&seen, format!("{:?}", read_outcome(&outcome)));
                    push(
                        &seen,
                        format!(
                            "listeners:{before}:{} exit:{:?} stdout:{:?}",
                            mock.listeners(SignalEvent::Exit),
                            mock.exit_code(),
                            mock.stdout_text()
                        ),
                    );
                    Ok(())
                }
            }
        }));
    assert_eq!(
        app.run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await
            .get(),
        0
    );
    assert_eq!(
        read(&seen),
        [
            format!(
                "{:?}",
                completed("child output\nargv:[] cwd:/sentinel\n", "⚠ child message\n")
            ),
            "listeners:1:1 exit:None stdout:\"\"".to_owned(),
        ]
    );
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn a_cancellation_of_the_calls_own_signal_resolves_cancelled_with_130_and_never_reaches_the_mapper()
 {
    let mapped: Lines = Arc::default();
    let token = CancellationToken::new();
    let app = Application::new("probe").action({
        let token = token.clone();
        move |ctx: Context| {
            let token = token.clone();
            async move {
                token.cancel();
                ctx.signal.cancelled().await;
                Ok(())
            }
        }
    });
    let options = InvokeOptions::new().signal(token).failure({
        let mapped = Arc::clone(&mapped);
        move |_: &dyn Failure, _: &InvokeFailure| push(&mapped, "mapped")
    });
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            options,
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&outcome), Read::Cancelled { exit_code: 130 });
    assert!(read(&mapped).is_empty());
}

#[tokio::test]
async fn a_signal_already_cancelled_at_the_call_runs_no_middleware_and_no_action() {
    let marks: Lines = Arc::default();
    let marking = Plugin::new("@fixture/mark").middleware(Activation::Always, {
        let marks = Arc::clone(&marks);
        move |_ctx, next| {
            let marks = Arc::clone(&marks);
            async move {
                push(&marks, "middleware");
                next.run().await.map(|_| ())
            }
        }
    });
    let app = Application::new("probe").plugins([marking]).action({
        let marks = Arc::clone(&marks);
        move |_: Context| {
            let marks = Arc::clone(&marks);
            async move {
                push(&marks, "action");
                Ok(())
            }
        }
    });
    let token = CancellationToken::new();
    token.cancel();
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new().signal(token),
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&outcome), Read::Cancelled { exit_code: 130 });
    assert!(read(&marks).is_empty());
}

#[tokio::test]
async fn an_actions_cancel_under_a_call_cancels_the_call_alone_and_its_run_goes_on() {
    let seen: Lines = Arc::default();
    let app = Application::new("probe")
        .command(Command::new("child").action(|ctx: Context| async move {
            ctx.cancel();
            Ok(())
        }))
        .command(Command::new("parent").action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let seen = Arc::clone(&seen);
                async move {
                    let outcome = ctx
                        .invoke(&["child"], InvocationValues::new(), InvokeOptions::new())
                        .await;
                    push(&seen, format!("{:?}", read_outcome(&outcome)));
                    push(&seen, format!("parent:{}", ctx.signal.is_cancelled()));
                    Ok(())
                }
            }
        }));
    let mock = mock_process(MockFields::new().argv(["parent"]));
    assert_eq!(app.run(RunOptions::new().process(mock as _)).await.get(), 0);
    assert_eq!(
        read(&seen),
        [
            format!("{:?}", Read::Cancelled { exit_code: 130 }),
            "parent:false".to_owned()
        ]
    );
}

/// An Application whose `inner` action fails and whose `on_failure` hook cancels `token`, so the
/// caller's cancellation lands while core reports the failure, after the chain settled.
fn cancelling_on_failure(token: &CancellationToken) -> Group {
    let hook = token.clone();
    Application::new("probe")
        .plugins([
            Plugin::new("@fixture/late").on_failure(move |_: &dyn Failure, _| {
                hook.cancel();
                Vec::<String>::new()
            }),
        ])
        .command(
            Command::new("inner")
                .action(|_: Context| async { Err(std::io::Error::other("broke").into()) }),
        )
}

#[tokio::test]
async fn a_caller_cancellation_that_lands_in_the_failure_path_decides_the_calls_code() {
    // `app.invoke`: the call's own signal cancelled by the failure hook resolves cancelled.
    let token = CancellationToken::new();
    let outcome = cancelling_on_failure(&token)
        .invoke(
            &["inner"],
            InvocationValues::new(),
            InvokeOptions::new().signal(token),
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&outcome), Read::Cancelled { exit_code: 130 });
    // An action's call: the same, and the run that made it goes on.
    let token = CancellationToken::new();
    let seen: Lines = Arc::default();
    let app = cancelling_on_failure(&token).command(Command::new("outer").action({
        let (seen, token) = (Arc::clone(&seen), token.clone());
        move |ctx: Context| {
            let (seen, token) = (Arc::clone(&seen), token.clone());
            async move {
                let outcome = ctx
                    .invoke(
                        &["inner"],
                        InvocationValues::new(),
                        InvokeOptions::new().signal(token),
                    )
                    .await;
                push(&seen, format!("{:?}", read_outcome(&outcome)));
                push(&seen, format!("parent:{}", ctx.signal.is_cancelled()));
                Ok(())
            }
        }
    }));
    let mock = mock_process(
        MockFields::new()
            .argv(["outer"])
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        read(&seen),
        [
            format!("{:?}", Read::Cancelled { exit_code: 130 }),
            "parent:false".to_owned()
        ]
    );
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn app_invoke_with_a_process_handle_reads_its_facts_and_nothing_of_the_process() {
    let app = Application::new("probe").action(|ctx: Context| async move {
        let env: Vec<String> = ctx
            .host
            .env
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect();
        ctx.out
            .print(&format!(
                "argv:{:?} cwd:{} env:{} platform:{}",
                ctx.host.argv,
                ctx.host.cwd.display(),
                env.join(","),
                ctx.host.platform
            ))
            .await
    });
    let mock = mock_process(
        MockFields::new()
            .argv(["ignored"])
            .cwd("/virtual")
            .env("ONLY", "x")
            .platform("plan9"),
    );
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&mock),
        )
        .await;
    assert_eq!(
        read_outcome(&outcome),
        completed("argv:[] cwd:/virtual env:ONLY=x platform:plan9\n", "")
    );
}

#[tokio::test]
async fn two_overlapping_calls_capture_their_own_bytes_and_an_invoked_action_resolves_its_nested_call()
 {
    let seen: Lines = Arc::default();
    let app = Application::new("probe")
        .command(Command::new("left").action(chatty("left")))
        .command(Command::new("right").action(chatty("right")))
        .command(Command::new("both").action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let seen = Arc::clone(&seen);
                async move {
                    let (left, right) = tokio::join!(
                        ctx.invoke(&["left"], InvocationValues::new(), InvokeOptions::new()),
                        ctx.invoke(&["right"], InvocationValues::new(), InvokeOptions::new()),
                    );
                    push(&seen, output_of(&left));
                    push(&seen, output_of(&right));
                    Ok(())
                }
            }
        }))
        .command(Command::new("inner").action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let seen = Arc::clone(&seen);
                async move {
                    let outer = ctx
                        .invoke(&["left"], InvocationValues::new(), InvokeOptions::new())
                        .await;
                    push(&seen, output_of(&outer));
                    Ok(())
                }
            }
        }));
    let both = app
        .invoke(
            &["both"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&both), completed("", ""));
    let inner = app
        .invoke(
            &["inner"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&inner), completed("", ""));
    assert_eq!(read(&seen), [lines("left"), lines("right"), lines("left")]);
}

#[tokio::test]
async fn an_actions_call_runs_no_lifecycle_hook_again_and_each_invoke_runs_every_hook_once() {
    let attached = Arc::new(AtomicUsize::new(0));
    let built = Arc::new(AtomicUsize::new(0));
    let counting = Plugin::new("@fixture/count")
        .on_command_attach({
            let attached = Arc::clone(&attached);
            move |_| {
                attached.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        })
        .on_graph_built({
            let built = Arc::clone(&built);
            move |_| {
                built.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        });
    let seen: Lines = Arc::default();
    let app = Application::new("probe")
        .plugins([counting])
        .command(Command::new("leaf").action(printing("leaf")))
        .command(Command::new("caller").action({
            let (attached, built, seen) =
                (Arc::clone(&attached), Arc::clone(&built), Arc::clone(&seen));
            move |ctx: Context| {
                let (attached, built, seen) =
                    (Arc::clone(&attached), Arc::clone(&built), Arc::clone(&seen));
                async move {
                    let before = (
                        attached.load(Ordering::SeqCst),
                        built.load(Ordering::SeqCst),
                    );
                    let _ = ctx
                        .invoke(&["leaf"], InvocationValues::new(), InvokeOptions::new())
                        .await;
                    let after = (
                        attached.load(Ordering::SeqCst),
                        built.load(Ordering::SeqCst),
                    );
                    push(
                        &seen,
                        format!("{} {}", after.0 - before.0, after.1 - before.1),
                    );
                    Ok(())
                }
            }
        }));
    let _ = app
        .invoke(
            &["caller"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&distributed()),
        )
        .await;
    // One build: the root and its two Commands attach, and the graph is built once.
    assert_eq!(
        (
            attached.load(Ordering::SeqCst),
            built.load(Ordering::SeqCst)
        ),
        (3, 1)
    );
    assert_eq!(read(&seen), ["0 0"]);
}

#[tokio::test]
async fn invoke_reports_a_build_fault_as_a_failed_outcome_with_exit_1() {
    let app = Application::new("probe")
        .plugins([Plugin::new("@fixture/broken")
            .on_graph_built(|_| Err(std::io::Error::other("the hook broke").into()))])
        .action(|_: Context| async { Ok(()) });
    assert_eq!(
        call(&app, &[], InvocationValues::new()).await,
        failed(1, "probe: Something went wrong.\n")
    );
}

#[tokio::test]
async fn the_failure_view_and_the_failure_hook_read_invoked_by_argv_under_run_and_name_under_invoke()
 {
    let hooks: Lines = Arc::default();
    let reading = Plugin::new("@fixture/hook").on_failure({
        let hooks = Arc::clone(&hooks);
        move |_: &dyn Failure, context: &loomcli_core::FailureHookContext| {
            push(&hooks, format!("{:?}", context.invoked_by));
        }
    });
    let app = Application::new("probe")
        .plugins([reading])
        .overrides([override_view(
            failure::<LoomError>(),
            FailureView::new(|_: &LoomError, context| {
                let by = match context.invoked_by {
                    InvokedBy::Argv => "argv",
                    InvokedBy::Name => "name",
                };
                format!("Stopped. ({by})\n")
            }),
        )])
        .action(|_: Context| async { Err(FatalError::new("Stopped.").into()) });
    let argv = distributed();
    app.run(RunOptions::new().process(Arc::clone(&argv) as _))
        .await;
    let named = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&distributed()),
        )
        .await;
    assert_eq!(argv.stderr_text(), "Stopped. (argv)\n");
    assert_eq!(read_outcome(&named), failed(1, "Stopped. (name)\n"));
    assert_eq!(read(&hooks), ["Argv", "Name"]);
}

// The equivalence wedge.

#[derive(Debug, loomcli_core::Failure)]
#[failure(exit_code = loomcli_core::EX_DATAERR)]
struct DataError {
    #[failure(base)]
    base: FatalError,
}

fn wedge() -> Group {
    Application::new("probe")
        .command(
            Command::new("say")
                .option(
                    "times",
                    Opt::string().validate(Digits("Expected a whole number of at least 0.")),
                )
                .action(|ctx: Context| async move {
                    let times: Option<String> = ctx.option("times")?;
                    let times: usize = times.as_deref().unwrap_or("1").parse().unwrap_or(1);
                    ctx.out.print(&"hi".repeat(times)).await?;
                    ctx.out.info("said").await
                }),
        )
        .command(Command::new("fail").action(|_: Context| async {
            Err(DataError {
                base: FatalError::new("The data is bad."),
            }
            .into())
        }))
}

#[tokio::test]
async fn run_with_argv_and_invoke_with_the_same_path_and_values_write_the_same_bytes_and_code() {
    let cases: [(&[&str], &[&str], InvocationValues); 3] = [
        (&["say"], &["say"], InvocationValues::new()),
        (
            &["say", "--times", "2"],
            &["say"],
            InvocationValues::new().option("times", 2),
        ),
        (&["fail"], &["fail"], InvocationValues::new()),
    ];
    for (argv, path, values) in cases {
        let ran = support::run(&wedge(), argv).await;
        let named = call(&wedge(), path, values).await;
        let (code, stdout, stderr) = match named {
            Read::Completed { output, messages } => (0, output, messages),
            Read::Failed {
                exit_code,
                output,
                messages,
            } => (exit_code, output, messages),
            Read::Cancelled { exit_code } => (exit_code, String::new(), String::new()),
        };
        assert_eq!((ran.status, ran.stdout, ran.stderr), (code, stdout, stderr));
    }
    assert_eq!(support::run(&wedge(), &["fail"]).await.status, 65);
}

#[tokio::test]
async fn an_input_problem_names_the_option_by_spelling_under_run_and_by_declared_name_under_invoke()
{
    let ran = support::run(&wedge(), &["say", "--times", "many"]).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "probe: Option \"--times\": Expected a whole number of at least 0.\n"
        )
    );
    assert_eq!(
        call(
            &wedge(),
            &["say"],
            InvocationValues::new().option("times", "many")
        )
        .await,
        failed(
            2,
            "probe: Option \"times\": Expected a whole number of at least 0.\n"
        )
    );
}

#[tokio::test]
async fn a_value_lowered_by_name_is_recorded_in_a_middlewares_spellings_under_its_reported_spelling()
 {
    let seen: Lines = Arc::default();
    let spelling = Plugin::new("@fixture/spell")
        .option("loud", Opt::boolean())
        .option("quiet", Opt::boolean().polarity(Polarity::Negative))
        .option("tiny", Opt::boolean().short('t').short_only())
        .middleware(Activation::Always, {
            let seen = Arc::clone(&seen);
            move |ctx, next| {
                let seen = Arc::clone(&seen);
                async move {
                    for (name, spelling) in ctx.spellings.iter() {
                        push(&seen, format!("{name}={spelling}"));
                    }
                    next.run().await.map(|_| ())
                }
            }
        });
    let app = Application::new("probe")
        .plugins([spelling])
        .action(|_: Context| async { Ok(()) });
    let values = InvocationValues::new()
        .option("loud", true)
        .option("quiet", false)
        .option("tiny", true);
    assert_eq!(call(&app, &[], values).await, completed("", ""));
    assert_eq!(read(&seen), ["loud=--loud", "quiet=--no-quiet", "tiny=-t"]);
}

// Progress (progress-events.test.ts, the invocation part).

fn reporting() -> Application {
    Application::new("probe").action(|ctx: Context| async move {
        let region = ctx.out.region(RegionOptions::new());
        region.report(
            ProgressReport::new()
                .completed(1.0)
                .total(3.0)
                .label("Fetching"),
        );
        region.report(ProgressReport::new().completed(2.0));
        region.report(ProgressReport::new().completed(3.0));
        region
            .end(loomcli_core::EndState::Ended, Some("Fetched"))
            .await
    })
}

fn states(events: &Lines) -> Vec<String> {
    read(events)
}

#[tokio::test]
async fn on_progress_receives_a_regions_events_in_order_and_messages_hold_no_frame() {
    let events: Lines = Arc::default();
    let options = InvokeOptions::new().on_progress({
        let events = Arc::clone(&events);
        move |event: &ProgressEvent| {
            push(
                &events,
                format!(
                    "{}:{:?}:{}:{:?}:{:?}",
                    event.id, event.state, event.label, event.completed, event.total
                ),
            );
        }
    });
    let outcome = reporting()
        .invoke(
            &[],
            InvocationValues::new(),
            options,
            handle(&distributed()),
        )
        .await;
    assert_eq!(read_outcome(&outcome), completed("", ""));
    assert_eq!(
        states(&events),
        [
            "1:Started:Fetching:Some(1.0):Some(3.0)",
            "1:Updated:Fetching:Some(2.0):Some(3.0)",
            "1:Updated:Fetching:Some(3.0):Some(3.0)",
            "1:Ended:Fetched:Some(3.0):Some(3.0)",
        ]
    );
    let _ = ProgressState::Ended;
}

#[tokio::test]
async fn an_actions_call_delivers_its_events_to_its_own_observer_alone_and_inherits_none() {
    let outer: Lines = Arc::default();
    let inner: Lines = Arc::default();
    let app = Application::new("probe")
        .command(Command::new("work").action(|ctx: Context| async move {
            let region = ctx.out.region(RegionOptions::new());
            region.report(ProgressReport::new().label("inner"));
            region.end(loomcli_core::EndState::Ended, None).await
        }))
        .command(Command::new("parent").action({
            let inner = Arc::clone(&inner);
            move |ctx: Context| {
                let inner = Arc::clone(&inner);
                async move {
                    let observed =
                        InvokeOptions::new().on_progress(move |event: &ProgressEvent| {
                            push(&inner, format!("{:?}:{}", event.state, event.label));
                        });
                    let _ = ctx
                        .invoke(&["work"], InvocationValues::new(), observed)
                        .await;
                    let _ = ctx
                        .invoke(&["work"], InvocationValues::new(), InvokeOptions::new())
                        .await;
                    Ok(())
                }
            }
        }));
    let options = InvokeOptions::new().on_progress({
        let outer = Arc::clone(&outer);
        move |event: &ProgressEvent| push(&outer, format!("{:?}", event.state))
    });
    let _ = app
        .invoke(
            &["parent"],
            InvocationValues::new(),
            options,
            handle(&distributed()),
        )
        .await;
    assert_eq!(read(&inner), ["Started:inner", "Ended:inner"]);
    assert!(read(&outer).is_empty());
}

#[tokio::test]
async fn an_observer_that_panics_is_called_no_more_the_run_settles_and_the_call_panics_with_its_payload()
 {
    let calls = Arc::new(AtomicUsize::new(0));
    let settled: Lines = Arc::default();
    let app = Application::new("probe").action({
        let settled = Arc::clone(&settled);
        move |ctx: Context| {
            let settled = Arc::clone(&settled);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.report(ProgressReport::new().label("one"));
                region.report(ProgressReport::new().label("two"));
                region.end(loomcli_core::EndState::Ended, None).await?;
                push(&settled, "action:returned");
                Ok(())
            }
        }
    });
    let options = InvokeOptions::new().on_progress({
        let calls = Arc::clone(&calls);
        move |_: &ProgressEvent| {
            calls.fetch_add(1, Ordering::SeqCst);
            panic!("the observer broke");
        }
    });
    let mock = distributed();
    let call = tokio::spawn(async move {
        app.invoke(&[], InvocationValues::new(), options, handle(&mock))
            .await
    });
    let panicked = call.await.unwrap_err().into_panic();
    assert_eq!(panicked.downcast_ref::<&str>(), Some(&"the observer broke"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(read(&settled), ["action:returned"]);
}

// invoke-exclude.test.ts.

static CONFIG_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/key");

/// The `show` Command reads its local `mode` and the global `zone`; `zone` is bound to a
/// configuration key, and both have a variable. The source records what it was asked.
fn excluding(asked: &Lines) -> Group {
    let app = Application::new("probe")
        .global_option(
            "zone",
            Opt::string()
                .default("default-zone")
                .env(["APP_ZONE"])
                .extend([CONFIG_KEY.value("app.zone".to_owned())]),
        )
        .command(
            Command::new("show")
                .option(
                    "mode",
                    Opt::string().default("default-mode").env(["APP_MODE"]),
                )
                .option("need", Opt::string())
                .action(|ctx: Context| async move {
                    let mode: Option<String> = ctx.option("mode")?;
                    let zone: Option<String> = ctx.option("zone")?;
                    let (mode, zone) = (mode.unwrap_or_default(), zone.unwrap_or_default());
                    ctx.out.print(&format!("mode={mode} zone={zone}")).await
                }),
        )
        .command(
            Command::new("require")
                .option("token", Opt::string().required())
                .action(|_: Context| async { Ok(()) }),
        );
    let asked = Arc::clone(asked);
    install_source(
        app,
        "@fixture/config",
        &CONFIG_KEY,
        &[],
        move |probe: SourceProbe| {
            let asked = Arc::clone(&asked);
            async move {
                let names: Vec<String> = probe
                    .requests
                    .iter()
                    .map(|request| request.name().to_owned())
                    .collect();
                push(&asked, names.join(","));
                let mut answers = BTreeMap::new();
                for request in &probe.requests {
                    if read_extension(request, &CONFIG_KEY)
                        .ok()
                        .flatten()
                        .is_some()
                    {
                        answers.insert(
                            request.name().to_owned(),
                            SourceAnswer::new(
                                loomcli_core::SourceValue::String("from-config".to_owned()),
                                "the fixture settings",
                            ),
                        );
                    }
                }
                Ok(answers)
            }
        },
    )
}

fn variables() -> Arc<MockProcess> {
    mock_process(
        MockFields::new()
            .env("APP_MODE", "from-env")
            .release(ReleaseFacts::new(Build::Distributed)),
    )
}

#[tokio::test]
async fn an_excluded_option_reads_its_default_although_its_variable_and_source_hold_values() {
    let asked: Lines = Arc::default();
    let app = excluding(&asked);
    let plain = app
        .invoke(
            &["show"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&variables()),
        )
        .await;
    assert_eq!(
        read_outcome(&plain),
        completed("mode=from-env zone=from-config\n", "")
    );
    let excluded = app
        .invoke(
            &["show"],
            InvocationValues::new(),
            InvokeOptions::new().exclude(["mode", "zone"]),
            handle(&variables()),
        )
        .await;
    assert_eq!(
        read_outcome(&excluded),
        completed("mode=default-mode zone=default-zone\n", "")
    );
    // The source was asked for `zone` by the first call alone.
    assert_eq!(read(&asked), ["zone"]);
}

#[tokio::test]
async fn a_key_naming_an_excluded_option_and_an_exclude_name_the_table_lacks_are_the_unknown_option()
 {
    let app = excluding(&Lines::default());
    let named = app
        .invoke(
            &["show"],
            InvocationValues::new().option("mode", "x"),
            InvokeOptions::new().exclude(["mode"]),
            handle(&variables()),
        )
        .await;
    assert_eq!(
        read_outcome(&named),
        failed(
            2,
            "probe: Unknown option \"mode\". Supply the name of a declared option.\n"
        )
    );
    let unknown = app
        .invoke(
            &["show"],
            InvocationValues::new(),
            InvokeOptions::new().exclude(["nope"]),
            handle(&variables()),
        )
        .await;
    assert_eq!(
        read_outcome(&unknown),
        failed(
            2,
            "probe: Unknown option \"nope\". Supply the name of a declared option.\n"
        )
    );
}

#[tokio::test]
async fn an_excluded_required_option_reports_the_missing_input_problem_by_name() {
    let app = excluding(&Lines::default());
    let outcome = app
        .invoke(
            &["require"],
            InvocationValues::new(),
            InvokeOptions::new().exclude(["token"]),
            handle(&variables()),
        )
        .await;
    assert_eq!(
        read_outcome(&outcome),
        failed(2, "probe: Option \"token\" is required. Supply a value.\n")
    );
}

#[tokio::test]
async fn a_nested_call_excludes_only_what_its_own_exclude_names() {
    let seen: Lines = Arc::default();
    let app = excluding(&Lines::default()).command(Command::new("nest").action({
        let seen = Arc::clone(&seen);
        move |ctx: Context| {
            let seen = Arc::clone(&seen);
            async move {
                let outcome = ctx
                    .invoke(&["show"], InvocationValues::new(), InvokeOptions::new())
                    .await;
                push(&seen, output_of(&outcome));
                Ok(())
            }
        }
    }));
    let _ = app
        .invoke(
            &["nest"],
            InvocationValues::new(),
            InvokeOptions::new().exclude(["zone"]),
            handle(&variables()),
        )
        .await;
    assert_eq!(read(&seen), ["mode=from-env zone=from-config\n"]);
}

#[tokio::test]
async fn an_excluded_plugin_option_reads_its_default_although_its_variable_holds_a_value() {
    let app = Application::new("probe")
        .plugins([Plugin::new("@fixture/region").option(
            "region",
            Opt::string().default("default-region").env(["APP_REGION"]),
        )])
        .action(|ctx: Context| async move {
            let region: Option<String> = ctx.option("region")?;
            ctx.out
                .print(&format!("region={}", region.unwrap_or_default()))
                .await
        });
    let mock = || {
        mock_process(
            MockFields::new()
                .env("APP_REGION", "from-env")
                .release(ReleaseFacts::new(Build::Distributed)),
        )
    };
    let plain = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&mock()),
        )
        .await;
    assert_eq!(read_outcome(&plain), completed("region=from-env\n", ""));
    let excluded = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new().exclude(["region"]),
            handle(&mock()),
        )
        .await;
    assert_eq!(
        read_outcome(&excluded),
        completed("region=default-region\n", "")
    );
}

#[tokio::test]
async fn an_excluded_source_option_reads_no_variable_so_the_source_reads_its_declared_default() {
    let read_by_source: Lines = Arc::default();
    let app = Application::new("probe")
        .global_option(
            "settings",
            Opt::string().default("default.json").env(["APP_SETTINGS"]),
        )
        .global_option(
            "zone",
            Opt::string().extend([CONFIG_KEY.value("app.zone".to_owned())]),
        )
        .action(|_: Context| async { Ok(()) });
    let app = install_source(app, "@fixture/config", &CONFIG_KEY, &["settings"], {
        let read_by_source = Arc::clone(&read_by_source);
        move |probe: SourceProbe| {
            let settings: Option<String> = probe.options.option("settings").unwrap_or_default();
            push(&read_by_source, settings.unwrap_or_default());
            std::future::ready(Ok(BTreeMap::new()))
        }
    });
    let mock = || {
        mock_process(
            MockFields::new()
                .env("APP_SETTINGS", "env.json")
                .release(ReleaseFacts::new(Build::Distributed)),
        )
    };
    for exclude in [vec![], vec!["settings"]] {
        let outcome = app
            .invoke(
                &[],
                InvocationValues::new(),
                InvokeOptions::new().exclude(exclude),
                handle(&mock()),
            )
            .await;
        assert_eq!(read_outcome(&outcome), completed("", ""));
    }
    assert_eq!(read(&read_by_source), ["env.json", "default.json"]);
}

// observing-log-events.test.ts, logging.test.ts, and environment-hooks.test.ts: the invocation
// parts.

/// A plugin whose `on_log` hook records each event's message and run id, and its destination.
fn observer(seen: &Lines) -> Plugin {
    let seen = Arc::clone(seen);
    Plugin::new("@fixture/observer").on_log(
        move |event: &loomcli_core::LogEvent, destination: &loomcli_core::LogDestination| {
            push(
                &seen,
                format!(
                    "{:?}:{}:{}:{}:{}",
                    event.level,
                    event.message,
                    event.run,
                    destination.platform,
                    if destination.stderr.is_some() {
                        "stream"
                    } else {
                        "null"
                    }
                ),
            );
        },
    )
}

/// Each recorded event without its run id, and the run ids in order.
fn split_runs(seen: &Lines) -> (Vec<String>, Vec<String>) {
    read(seen)
        .into_iter()
        .map(|line| {
            let parts: Vec<&str> = line.splitn(4, ':').collect();
            (
                format!("{}:{}:{}", parts[0], parts[1], parts[3]),
                parts[2].to_owned(),
            )
        })
        .unzip()
}

#[tokio::test]
async fn an_actions_invoke_delivers_to_its_runs_destination_and_app_invoke_passes_no_stderr() {
    let seen: Lines = Arc::default();
    let app = Application::new("probe")
        .plugins([observer(&seen)])
        .command(Command::new("inner").action(|ctx: Context| async move {
            ctx.log.info("inner", ());
            Ok(())
        }))
        .command(Command::new("outer").action(|ctx: Context| async move {
            ctx.log.info("outer", ());
            let _ = ctx
                .invoke(&["inner"], InvocationValues::new(), InvokeOptions::new())
                .await;
            ctx.log.info("outer again", ());
            Ok(())
        }));
    let mock = mock_process(MockFields::new().platform("probe-os").argv(["outer"]));
    assert_eq!(
        app.run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await
            .get(),
        0
    );
    let named = mock_process(MockFields::new().platform("named-os"));
    let outcome = app
        .invoke(
            &["inner"],
            InvocationValues::new(),
            InvokeOptions::new(),
            handle(&named),
        )
        .await;
    assert_eq!(read_outcome(&outcome), completed("", ""));
    let (events, runs) = split_runs(&seen);
    assert_eq!(
        events,
        [
            "Info:outer:probe-os:stream",
            "Info:inner:probe-os:stream",
            "Info:outer again:probe-os:stream",
            "Info:inner:named-os:null",
        ]
    );
    // One run id per run: the outer run's twice, and its call's and the app.invoke's own.
    assert_eq!(runs[0], runs[2]);
    assert_ne!(runs[1], runs[0]);
    assert_ne!(runs[3], runs[0]);
    assert_ne!(runs[3], runs[1]);
}

#[tokio::test]
async fn a_failed_action_invoke_logs_its_failure_event_under_the_nested_run() {
    let seen: Lines = Arc::default();
    let app = Application::new("probe")
        .plugins([observer(&seen)])
        .command(
            Command::new("inner")
                .action(|_: Context| async { Err(FatalError::new("The inner failed.").into()) }),
        )
        .command(Command::new("outer").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(&["inner"], InvocationValues::new(), InvokeOptions::new())
                .await;
            assert!(matches!(outcome, InvocationOutcome::Failed { .. }));
            ctx.log.info("after inner", ());
            Ok(())
        }));
    assert_eq!(support::run(&app, &["outer"]).await.status, 0);
    let (events, runs) = split_runs(&seen);
    assert_eq!(
        events,
        [
            "Error:The inner failed.:linux:stream",
            "Info:after inner:linux:stream"
        ]
    );
    assert_ne!(runs[0], runs[1]);
}

#[tokio::test]
async fn an_actions_invoke_inherits_the_environment_without_repeating_preparation() {
    let prepared = Arc::new(AtomicUsize::new(0));
    let dotenv = Plugin::new("@fixture/dotenv").on_environment({
        let prepared = Arc::clone(&prepared);
        move |_| {
            let prepared = Arc::clone(&prepared);
            async move {
                prepared.fetch_add(1, Ordering::SeqCst);
                Ok(BTreeMap::from([(
                    "LOOM_DOTENV_TOKEN".to_owned(),
                    "imported".to_owned(),
                )]))
            }
        }
    });
    let seen: Lines = Arc::default();
    let app = Application::new("probe")
        .plugins([dotenv])
        .command(Command::new("read").action(|ctx: Context| async move {
            let token = ctx
                .host
                .env
                .get("LOOM_DOTENV_TOKEN")
                .cloned()
                .unwrap_or_default();
            ctx.out.print(&token).await
        }))
        .command(Command::new("outer").action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let seen = Arc::clone(&seen);
                async move {
                    let outcome = ctx
                        .invoke(&["read"], InvocationValues::new(), InvokeOptions::new())
                        .await;
                    push(&seen, format!("{:?}", read_outcome(&outcome)));
                    Ok(())
                }
            }
        }));
    assert_eq!(support::run(&app, &["outer"]).await.status, 0);
    assert_eq!(read(&seen), [format!("{:?}", completed("imported\n", ""))]);
    assert_eq!(prepared.load(Ordering::SeqCst), 1);
}
