//! The ordinary failure path through a run: translators, `on_failure` hints, failure views keyed by
//! class along the parent chain, failure encoders by media type, the plain fallback when a view,
//! an encoder, or a hook fails, defects by build, and the precedence of the exit code.
//!
//! Ported from the reference's `failure-hints.test.ts`, `translators.test.ts`,
//! `failure-selection.test.ts`, `failure-encoders.test.ts`, `failures.test.ts` (view part),
//! `views.test.ts` (plugin part), `exit-codes.test.ts` (precedence), and the run parts of
//! `development-builds.test.ts` and `developer-diagnostics.test.ts`, with the selection a middleware
//! makes and the cases run by name.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::io;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, Build, Command, ConfigurationSource, Context, DeclarationError, Done,
    EX_UNAVAILABLE, Error, Extension, Failure, FailureFacts, FailureForm, FailureHookContext,
    FailureView, FatalError, Fresh, InputError, InputProblem, InternalError, Issue, LoomError,
    NoInputs, NoResult, Opt, OptionTarget, Outcome, Plugin, ReleaseFacts, RenderingPolicy,
    ResultViews, RowView, RowViews, RowsResult, RunOptions, State, Switch, UnknownCommandError,
    UnknownOptionError, UsageError, ValidationContext, Validator, ValueResult, View,
    encode_failure, failure, override_view, translate,
};
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};
use support::Ran;
use support::streams::{Scripted, Swapped};
use tokio_util::sync::CancellationToken;

type Calls = Arc<Mutex<Vec<String>>>;
type App = Application<NoInputs, NoResult, Done>;

fn recorded(calls: &Calls) -> Vec<String> {
    calls.lock().unwrap().clone()
}

async fn dispatch(ctx: Context) -> Outcome {
    ctx.out.print("dispatched").await
}

/// One run on the mock in `build`, with the caller's `signal` when given.
async fn ran<I, R, S: State>(
    application: &Application<I, R, S>,
    argv: &[&str],
    build: Build,
    signal: Option<CancellationToken>,
) -> Ran {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    );
    let options = RunOptions::new().process(Arc::clone(&process) as _);
    let options = match signal {
        Some(signal) => options.signal(signal),
        None => options,
    };
    let code = application.run(options).await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

async fn distributed<I, R, S: State>(application: &Application<I, R, S>, argv: &[&str]) -> Ran {
    ran(application, argv, Build::Distributed, None).await
}

async fn developed<I, R, S: State>(application: &Application<I, R, S>, argv: &[&str]) -> Ran {
    ran(application, argv, Build::Development, None).await
}

// failure-hints.test.ts

/// A plugin whose hook records each call and answers with `answer`.
fn hinting(
    identity: &'static str,
    calls: &Calls,
    answer: impl Fn(&dyn Failure, &FailureHookContext) -> Result<Vec<String>, Error>
    + Send
    + Sync
    + 'static,
) -> Plugin {
    let calls = Arc::clone(calls);
    Plugin::new(identity).on_failure(move |failure, context| {
        calls.lock().unwrap().push(format!(
            "hook:{identity}:{}:[{}]",
            failure.class().name(),
            context.path.join(",")
        ));
        answer(failure, context)
    })
}

fn hint(text: &str) -> Result<Vec<String>, Error> {
    Ok(vec![text.to_owned()])
}

fn broken_hint(reason: &str) -> Result<Vec<String>, Error> {
    Err(Error::from_foreign(reason.to_owned().into()))
}

/// The fixture's `store`: globals `file`, a hidden `trace`, a deprecated `legacy`, and a `cache`
/// group whose `clear` has a visible, a hidden, and a deprecated option, a hidden `purge`, and a
/// `list` aliased `ls`.
fn routed(application: Application<NoInputs, NoResult, Fresh>) -> App {
    let clear = Command::new("clear")
        .description("The clear command.")
        .option("keep", Opt::boolean().short('k'))
        .option("secret", Opt::boolean().hidden())
        .option("old", Opt::boolean().deprecated("Use --keep instead."))
        .action(dispatch);
    let cache = Command::new("cache")
        .description("The cache command.")
        .command(clear)
        .command(Command::new("purge").hidden().action(dispatch))
        .command(Command::new("list").alias("ls").action(dispatch));
    application
        .description("Store values.")
        .global_option("file", Opt::string().short('f'))
        .global_option("trace", Opt::boolean().hidden())
        .global_option("legacy", Opt::boolean().deprecated("Use --file instead."))
        .command(cache)
        .action(dispatch)
}

fn store(plugins: Vec<Plugin>) -> Application<NoInputs, NoResult, Fresh> {
    Application::new("store").plugins(plugins)
}

const UNKNOWN_BOGUS: &str = "store: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\n";

/// An override of every class that prints where the run was, as JSON.
fn where_view() -> loomcli_core::ViewOverride {
    override_view(
        failure::<LoomError>(),
        FailureView::new(|_: &LoomError, context| {
            format!(
                "{}\n",
                json!({
                    "application": context.application,
                    "hints": context.hints,
                    "path": context.path,
                })
            )
        }),
    )
}

#[tokio::test]
async fn a_failure_view_reads_the_application_and_the_path_routing_walked() {
    let application = routed(store(Vec::new()).overrides([where_view()]));
    for (argv, path) in [
        (vec!["--file"], json!([])),
        (vec!["cache", "clear", "--bogus"], json!(["cache", "clear"])),
        (vec!["cache", "nope"], json!(["cache"])),
        (vec!["cache", "ls", "--bogus"], json!(["cache", "list"])),
    ] {
        let ran = distributed(&application, &argv).await;
        assert_eq!(
            serde_json::from_str::<Value>(&ran.stderr).unwrap(),
            json!({ "application": "store", "hints": [], "path": path }),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_build_fault_reads_an_empty_path_and_no_hints_and_calls_no_hook() {
    let calls: Calls = Arc::default();
    let application =
        store(vec![hinting("fixture/one", &calls, |_, _| hint("never"))]).overrides([where_view()]);
    let ran = distributed(&application, &[]).await;
    assert_eq!(ran.status, 1);
    assert_eq!(
        serde_json::from_str::<Value>(&ran.stderr).unwrap(),
        json!({ "application": "store", "hints": [], "path": [] })
    );
    assert!(recorded(&calls).is_empty());
}

/// Rejects every value.
#[derive(Clone)]
struct Refuses;

impl Validator for Refuses {
    type Output = String;

    fn validate(&self, _: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        Err(vec![Issue::new("No.")])
    }
}

#[tokio::test]
async fn a_declared_default_its_validator_rejects_calls_the_hook_with_an_empty_path_at_the_root() {
    let calls: Calls = Arc::default();
    let application = Application::new("store")
        .plugins([hinting("fixture/one", &calls, |_, context| {
            hint(&format!("command at [{}]", context.command.path.join(",")))
        })])
        .option("level", Opt::string().default("loud").validate(Refuses))
        .action(dispatch);
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "store: Something went wrong.\ncommand at []\n".to_owned(),
        }
    );
    assert_eq!(recorded(&calls), ["hook:fixture/one:DeclarationError:[]"]);
}

#[tokio::test]
async fn a_fault_reported_after_the_primary_outcome_receives_hook_calls_of_its_own() {
    let calls: Calls = Arc::default();
    let application = Application::new("store")
        .plugins([
            hinting("fixture/one", &calls, |failure, _| {
                hint(&format!("hint for {}", failure.class().name()))
            }),
            Plugin::new("fixture/log").on_log(
                |event: &loomcli_core::LogEvent, _: &loomcli_core::LogDestination| {
                    if event
                        .failure
                        .as_ref()
                        .is_some_and(|form| form.code == "fatal")
                    {
                        return Err(Error::from_foreign("The log hook broke.".into()));
                    }
                    Ok(())
                },
            ),
        ])
        .action(|ctx: Context| async move { Err(ctx.out.fatal("The action failed.")) });
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "The action failed.\nhint for FatalError\nstore: Something went wrong.\nhint for InternalError\n"
                .to_owned(),
        }
    );
    assert_eq!(
        recorded(&calls),
        [
            "hook:fixture/one:FatalError:[]",
            "hook:fixture/one:InternalError:[]"
        ]
    );
}

#[tokio::test]
async fn a_hook_reads_the_graph_and_the_routed_node_the_action_read() {
    let seen: Arc<Mutex<usize>> = Arc::default();
    let application = Application::new("store")
        .plugins([Plugin::new("fixture/one").on_failure({
            let seen = Arc::clone(&seen);
            move |_, context| {
                let same = Arc::as_ptr(&context.graph) as usize == *seen.lock().unwrap();
                format!("same graph: {same}")
            }
        })])
        .action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let seen = Arc::clone(&seen);
                async move {
                    *seen.lock().unwrap() = Arc::as_ptr(&ctx.graph) as usize;
                    Err(ctx.out.fatal("The action failed."))
                }
            }
        });
    assert_eq!(
        distributed(&application, &[]).await.stderr,
        "The action failed.\nsame graph: true\n"
    );
}

#[tokio::test]
async fn a_hook_reads_the_same_graph_a_middleware_read_built_once_for_the_run() {
    let seen: Arc<Mutex<usize>> = Arc::default();
    let reader = Plugin::new("fixture/reader").middleware(loomcli_core::Activation::Always, {
        let seen = Arc::clone(&seen);
        move |ctx, next: loomcli_core::Next| {
            *seen.lock().unwrap() = Arc::as_ptr(&ctx.graph) as usize;
            async move { next.run().await.map(|_| ()) }
        }
    });
    let application = Application::new("store")
        .description("The store application.")
        .plugins([
            reader,
            Plugin::new("fixture/one").on_failure({
                let seen = Arc::clone(&seen);
                move |_, context| {
                    let same = Arc::as_ptr(&context.graph) as usize == *seen.lock().unwrap();
                    format!("same graph: {same}")
                }
            }),
        ])
        .action(|ctx: Context| async move { Err(ctx.out.fatal("The action failed.")) });
    assert_eq!(
        distributed(&application, &[]).await.stderr,
        "The action failed.\nsame graph: true\n"
    );
}

#[tokio::test]
async fn a_takeover_of_a_held_unknown_option_fault_calls_no_hook() {
    let calls: Calls = Arc::default();
    let help = Plugin::new("fixture/help")
        .option("help", Opt::boolean())
        .middleware(
            loomcli_core::Activation::options(["help"]),
            |ctx, _next: loomcli_core::Next| async move { ctx.out.print("help").await },
        );
    let application = routed(store(vec![
        help,
        hinting("fixture/one", &calls, |_, _| hint("never")),
    ]));
    assert_eq!(
        distributed(&application, &["cache", "clear", "--bogus", "--help"]).await,
        Ran {
            status: 0,
            stdout: "help\n".to_owned(),
            stderr: String::new(),
        }
    );
    assert!(recorded(&calls).is_empty());
}

#[tokio::test]
async fn two_plugins_hints_print_under_core_text_in_installation_order_a_shared_line_twice() {
    let calls: Calls = Arc::default();
    let application = routed(store(vec![
        hinting("fixture/one", &calls, |_, _| {
            Ok(vec!["first".to_owned(), "shared".to_owned()])
        }),
        hinting("fixture/two", &calls, |_, _| hint("shared")),
    ]));
    assert_eq!(
        distributed(&application, &["cache", "clear", "--bogus"]).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: format!("{UNKNOWN_BOGUS}first\nshared\nshared\n"),
        }
    );
    assert_eq!(
        recorded(&calls),
        [
            "hook:fixture/one:UnknownOptionError:[cache,clear]",
            "hook:fixture/two:UnknownOptionError:[cache,clear]"
        ]
    );
}

#[tokio::test]
async fn hints_under_a_failure_of_several_problem_lines_stay_unprefixed() {
    let calls: Calls = Arc::default();
    let application = Application::new("store")
        .plugins([hinting("fixture/one", &calls, |_, _| {
            Ok(vec!["first".to_owned(), "second".to_owned()])
        })])
        .option("left", Opt::string().validate(Refuses))
        .option("right", Opt::string().validate(Refuses))
        .action(dispatch);
    assert_eq!(
        distributed(&application, &["--left", "x", "--right", "y"]).await,
        support::usage(
            "store: Option \"--left\": No.\nstore: Option \"--right\": No.\nfirst\nsecond"
        )
    );
    assert_eq!(recorded(&calls), ["hook:fixture/one:InputError:[]"]);
}

#[tokio::test]
async fn an_override_receives_the_hints_and_prints_them_in_its_own_form() {
    let calls: Calls = Arc::default();
    let application = routed(
        store(vec![hinting("fixture/one", &calls, |_, _| {
            Ok(vec!["first".to_owned(), "second".to_owned()])
        })])
        .overrides([override_view(
            failure::<UsageError>(),
            FailureView::new(|failure: &UsageError, context| {
                std::iter::once(format!("usage: {}", failure.message()))
                    .chain(context.hints.iter().map(|hint| format!("  ({hint})")))
                    .map(|line| format!("{line}\n"))
                    .collect::<String>()
            }),
        )]),
    );
    assert_eq!(
        distributed(&application, &["cache", "clear", "--bogus"])
            .await
            .stderr,
        "usage: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\n  (first)\n  (second)\n"
    );
}

#[tokio::test]
async fn a_hint_is_marked_text_core_resolves_for_stderr() {
    let calls: Calls = Arc::default();
    let application = routed(
        store(vec![hinting("fixture/one", &calls, |_, context| {
            hint(&format!("plain {}", context.style.bold().apply("bold")))
        })])
        .rendering(RenderingPolicy::new().modifiers(Switch::Always)),
    );
    let ran = distributed(&application, &["cache", "clear", "--bogus"]).await;
    assert_eq!(
        ran.stderr.split('\n').nth(1).unwrap(),
        "plain \u{1b}[1mbold\u{1b}[22m"
    );
}

#[tokio::test]
async fn hooks_answering_nothing_leave_the_default_text_unchanged_byte_for_byte() {
    let calls: Calls = Arc::default();
    let plain = distributed(&routed(store(Vec::new())), &["cache", "clear", "--bogus"]).await;
    assert_eq!(plain.stderr, UNKNOWN_BOGUS);
    let none = routed(store(vec![
        Plugin::new("fixture/one").on_failure({
            let calls = Arc::clone(&calls);
            move |_, _| calls.lock().unwrap().push("one".to_owned())
        }),
        hinting("fixture/two", &calls, |_, _| Ok(Vec::new())),
    ]));
    assert_eq!(
        distributed(&none, &["cache", "clear", "--bogus"])
            .await
            .stderr,
        plain.stderr
    );
    assert_eq!(recorded(&calls).len(), 2);
}

/// The fixture's broken hooks: the first fails with `reason`, the second would hint.
fn broken(calls: &Calls, reason: &'static str) -> App {
    routed(store(vec![
        hinting("fixture/broken", calls, move |_, _| broken_hint(reason)),
        hinting("fixture/fine", calls, |_, _| hint("still here")),
    ]))
}

#[tokio::test]
async fn a_hook_that_fails_ends_the_hooks_writes_core_text_without_hints_and_returns_1() {
    let calls: Calls = Arc::default();
    let application = broken(&calls, "Cannot suggest.");
    assert_eq!(
        distributed(&application, &["cache", "clear", "--bogus"]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!("{UNKNOWN_BOGUS}store: Something went wrong.\n"),
        }
    );
    assert_eq!(
        recorded(&calls),
        ["hook:fixture/broken:UnknownOptionError:[cache,clear]"]
    );
    let development = developed(&application, &["cache", "clear", "--bogus"]).await;
    assert!(
        development
            .stderr
            .starts_with(&format!("{UNKNOWN_BOGUS}\n-- UNHANDLED EXCEPTION"))
    );
    assert!(
        development
            .stderr
            .contains(" @loomcli/core/foreign-throw\n\nCannot suggest.\n")
    );
}

#[tokio::test]
async fn a_failing_hooks_reason_with_a_line_break_or_a_control_writes_one_escaped_line() {
    for (reason, escaped) in [
        ("line one\nline two", "line one\\u000aline two"),
        (
            "red\u{1b}\r\u{2028}\u{2029}end",
            "red\\u001b\\u000d\\u2028\\u2029end",
        ),
    ] {
        let calls: Calls = Arc::default();
        let application = broken(&calls, reason);
        assert_eq!(
            distributed(&application, &["cache", "clear", "--bogus"])
                .await
                .stderr,
            format!("{UNKNOWN_BOGUS}store: Something went wrong.\n")
        );
        let development = developed(&application, &["cache", "clear", "--bogus"]).await;
        assert!(
            development
                .stderr
                .contains(&format!(" @loomcli/core/foreign-throw\n\n{escaped}\n")),
            "{}",
            development.stderr
        );
    }
}

#[tokio::test]
async fn a_broken_failure_view_whose_reason_holds_a_line_break_writes_the_generic_line_alone() {
    let application = routed(store(Vec::new()).overrides([override_view(
        failure::<UsageError>(),
        FailureView::new(|_: &UsageError, _| -> Result<String, Error> {
            Err(Error::from_foreign("line one\nline two".into()))
        }),
    )]));
    assert_eq!(
        distributed(&application, &["cache", "clear", "--bogus"]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!("{UNKNOWN_BOGUS}store: Something went wrong.\n"),
        }
    );
}

#[tokio::test]
async fn a_failing_hook_beside_a_view_that_would_break_writes_core_text_and_calls_no_view() {
    let calls: Calls = Arc::default();
    let viewed: Calls = Arc::default();
    let application = routed(
        store(vec![
            hinting("fixture/broken", &calls, |_, _| {
                broken_hint("Cannot suggest.")
            }),
            hinting("fixture/fine", &calls, |_, _| hint("still here")),
        ])
        .overrides([override_view(
            failure::<UsageError>(),
            FailureView::new({
                let viewed = Arc::clone(&viewed);
                move |_: &UsageError, _| -> Result<String, Error> {
                    viewed.lock().unwrap().push("view".to_owned());
                    Err(Error::from_foreign("Cannot render the failure.".into()))
                }
            }),
        )]),
    );
    let ran = distributed(&application, &["cache", "clear", "--bogus"]).await;
    assert_eq!(
        ran.stderr,
        format!("{UNKNOWN_BOGUS}store: Something went wrong.\n")
    );
    assert_eq!(ran.status, 1);
    assert!(recorded(&viewed).is_empty());
}

#[tokio::test]
async fn a_failing_hook_in_a_cancelled_run_whose_failure_still_renders_returns_130() {
    let calls: Calls = Arc::default();
    let signal = CancellationToken::new();
    let application = Application::new("store")
        .plugins([
            hinting("fixture/broken", &calls, |_, _| {
                broken_hint("Cannot suggest.")
            }),
            hinting("fixture/fine", &calls, |_, _| hint("still here")),
        ])
        .action({
            let signal = signal.clone();
            move |_: Context| {
                let signal = signal.clone();
                async move {
                    signal.cancel();
                    Err(FatalError::new("The action failed.").into())
                }
            }
        });
    assert_eq!(
        ran(&application, &[], Build::Distributed, Some(signal)).await,
        Ran {
            status: 130,
            stdout: String::new(),
            stderr: "The action failed.\nstore: Something went wrong.\n".to_owned(),
        }
    );
    assert_eq!(recorded(&calls), ["hook:fixture/broken:FatalError:[]"]);
}

#[tokio::test]
async fn a_cancelled_run_that_reports_its_cancellation_silently_calls_no_hook() {
    let calls: Calls = Arc::default();
    let signal = CancellationToken::new();
    let application = Application::new("store")
        .plugins([hinting("fixture/one", &calls, |_, _| hint("never"))])
        .action({
            let signal = signal.clone();
            move |ctx: Context| {
                let signal = signal.clone();
                async move {
                    signal.cancel();
                    ctx.signal.cancelled().await;
                    Ok(())
                }
            }
        });
    assert_eq!(
        ran(&application, &[], Build::Distributed, Some(signal)).await,
        Ran {
            status: 130,
            stdout: String::new(),
            stderr: String::new(),
        }
    );
    assert!(recorded(&calls).is_empty());
}

/// Rejects `bad` with an issue that carries a code.
#[derive(Clone)]
struct Coded;

impl Validator for Coded {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if input == "bad" {
            Err(vec![
                Issue::new("Too short.").code("too_short", Value::Null),
            ])
        } else {
            Ok(input.to_owned())
        }
    }
}

#[tokio::test]
async fn an_issue_on_the_second_value_keeps_its_own_fields_and_its_position() {
    let application = Application::new("store")
        .overrides([override_view(
            failure::<InputError>(),
            FailureView::new(|failure: &InputError, _| {
                let issues: Vec<Value> = failure
                    .problems()
                    .iter()
                    .flat_map(|problem| match problem {
                        InputProblem::Invalid { issues, .. } => issues.clone(),
                        _ => Vec::new(),
                    })
                    .map(|issue| {
                        json!({
                            "code": issue.code,
                            "message": issue.message,
                            "path": loomcli_core::issue_path(&issue),
                        })
                    })
                    .collect();
                format!("{}\n", Value::Array(issues))
            }),
        )])
        .command(
            Command::new("tag")
                .argument("names", Arg::string().validate(Coded).variadic())
                .action(dispatch),
        )
        .command(
            Command::new("label")
                .option("name", Opt::string().validate(Coded).multiple())
                .action(dispatch),
        );
    for argv in [
        vec!["tag", "good", "bad"],
        vec!["label", "--name", "good", "--name", "bad"],
    ] {
        let ran = distributed(&application, &argv).await;
        assert_eq!(
            serde_json::from_str::<Value>(&ran.stderr).unwrap(),
            json!([{ "code": "too_short", "message": "Too short.", "path": "1" }]),
            "{argv:?}"
        );
    }
}

/// The fixture's suggesting hook: visible spellings for an unknown option, visible children by
/// their canonical names for an unknown Command.
fn suggest(failure: &dyn Failure, context: &FailureHookContext) -> Option<String> {
    if failure.is::<UnknownOptionError>() {
        let spellings: Vec<String> = context
            .graph
            .globals
            .iter()
            .chain(&context.command.options)
            .filter(|option| !option.hidden() && option.deprecated().is_none())
            .flat_map(|option| {
                [option.long(), option.short()]
                    .into_iter()
                    .flatten()
                    .map(str::to_owned)
            })
            .collect();
        return Some(format!("options: {}", spellings.join(" ")));
    }
    if failure.is::<UnknownCommandError>() {
        let children: Vec<String> = context
            .command
            .children
            .iter()
            .filter(|child| !child.hidden && child.deprecated.is_none())
            .map(|child| child.name.clone().unwrap_or_default())
            .collect();
        return Some(format!("children: {}", children.join(" ")));
    }
    None
}

#[tokio::test]
async fn a_hook_suggests_visible_spellings_and_children_never_hidden_deprecated_or_aliases() {
    let application = routed(store(vec![
        Plugin::new("fixture/suggest").on_failure(suggest),
    ]));
    assert_eq!(
        distributed(&application, &["cache", "clear", "--bogus"])
            .await
            .stderr,
        format!("{UNKNOWN_BOGUS}options: --file -f --keep -k\n")
    );
    assert_eq!(
        distributed(&application, &["cache", "nope"]).await.stderr,
        "store: Unknown command \"nope\". Use one of: clear, list.\nchildren: clear list\n"
    );
}

// translators.test.ts

/// A library's parse error, the fixture's `SyntaxError`.
#[derive(Debug)]
struct SyntaxError(&'static str);

impl std::fmt::Display for SyntaxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for SyntaxError {}

/// A write that fails for want of space, the fixture's `DiskError`.
#[derive(Debug)]
struct OtherError;

impl std::fmt::Display for OtherError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("The value is not a function.")
    }
}

impl std::error::Error for OtherError {}

#[derive(Debug, loomcli_core::Failure)]
#[failure(exit_code = EX_UNAVAILABLE)]
struct UnavailableError {
    #[failure(base)]
    base: FatalError,
}

impl UnavailableError {
    fn new(from: &str) -> Self {
        Self {
            base: FatalError::new(format!("Unavailable from {from}.")),
        }
    }

    fn caused(from: &str, cause: impl Into<Error>) -> Self {
        Self {
            base: FatalError::with_cause(format!("Unavailable from {from}."), cause),
        }
    }
}

/// A translation of `SyntaxError` that records its call and answers from `from`.
fn answering(calls: &Calls, from: &'static str) -> loomcli_core::Translation {
    let calls = Arc::clone(calls);
    translate(move |_: SyntaxError| {
        calls.lock().unwrap().push(format!("{from}:SyntaxError"));
        Ok(UnavailableError::new(from))
    })
}

/// A translation of `SyntaxError` that records its call and hands the error back.
fn passing(calls: &Calls, from: &'static str) -> loomcli_core::Translation {
    let calls = Arc::clone(calls);
    translate(
        move |error: SyntaxError| -> Result<UnavailableError, SyntaxError> {
            calls.lock().unwrap().push(format!("{from}:pass"));
            Err(error)
        },
    )
}

/// The fixture's application whose action fails with `fail`.
fn ending(application: Application<NoInputs, NoResult, Fresh>, fail: fn() -> Error) -> App {
    application
        .description("The translators application.")
        .action(move |_: Context| async move { Err(fail()) })
}

fn foreign() -> Error {
    SyntaxError("Unexpected token.").into()
}

fn translators() -> Application<NoInputs, NoResult, Configuring> {
    Application::new("translators")
}

use loomcli_core::Configuring;

const GENERIC: &str = "translators: Something went wrong.\n";

fn translated(from: &str) -> Ran {
    Ran {
        status: 69,
        stdout: String::new(),
        stderr: format!("Unavailable from {from}.\n"),
    }
}

#[tokio::test]
async fn a_foreign_error_from_an_action_exits_with_the_translated_class_code() {
    let calls: Calls = Arc::default();
    let application = ending(
        translators()
            .plugins(Vec::<Plugin>::new())
            .translators([answering(&calls, "application")]),
        foreign,
    );
    assert_eq!(
        distributed(&application, &[]).await,
        translated("application")
    );
    assert_eq!(recorded(&calls), ["application:SyntaxError"]);
    let untranslated = ending(
        translators()
            .plugins(Vec::<Plugin>::new())
            .translators([answering(&calls, "application")]),
        || OtherError.into(),
    );
    assert_eq!(
        distributed(&untranslated, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: GENERIC.to_owned(),
        }
    );
}

#[tokio::test]
async fn translations_resolve_the_application_first_then_each_plugin_in_installation_order() {
    let calls: Calls = Arc::default();
    let shared = ending(
        translators()
            .plugins([Plugin::new("@fixture/plugin").translators([answering(&calls, "plugin")])])
            .translators([answering(&calls, "application")]),
        foreign,
    );
    assert_eq!(distributed(&shared, &[]).await, translated("application"));
    let calls: Calls = Arc::default();
    let plugins = ending(
        translators().plugins([
            Plugin::new("@fixture/first").translators([answering(&calls, "first")]),
            Plugin::new("@fixture/second").translators([answering(&calls, "second")]),
        ]),
        foreign,
    );
    assert_eq!(distributed(&plugins, &[]).await, translated("first"));
    assert_eq!(recorded(&calls), ["first:SyntaxError"]);
    let calls: Calls = Arc::default();
    let listed = ending(
        translators().plugins(Vec::<Plugin>::new()).translators([
            passing(&calls, "derived-one"),
            answering(&calls, "derived-two"),
        ]),
        foreign,
    );
    assert_eq!(distributed(&listed, &[]).await, translated("derived-two"));
    assert_eq!(
        recorded(&calls),
        ["derived-one:pass", "derived-two:SyntaxError"]
    );
    let calls: Calls = Arc::default();
    let next = ending(
        translators()
            .plugins([Plugin::new("@fixture/plugin").translators([answering(&calls, "plugin")])])
            .translators([passing(&calls, "application")]),
        foreign,
    );
    assert_eq!(distributed(&next, &[]).await, translated("plugin"));
    assert_eq!(recorded(&calls), ["application:pass", "plugin:SyntaxError"]);
}

#[tokio::test]
async fn a_foreign_error_from_a_configuration_source_reaches_the_translators() {
    const KEY: Extension<OptionTarget, String> = Extension::new("@fixture/translators/key");
    let calls: Calls = Arc::default();
    let source = Plugin::new("@fixture/source")
        .extensions([KEY])
        .source(ConfigurationSource::new(
            &KEY,
            |_: loomcli_core::SourceContext<NoInputs>| async { Err(foreign()) },
        ));
    let application = translators()
        .plugins([source])
        .translators([answering(&calls, "application")])
        .global_option(
            "limit",
            Opt::string().extend([KEY.value("limit".to_owned())]),
        )
        .action(dispatch);
    assert_eq!(
        distributed(&application, &[]).await,
        translated("application")
    );
    assert_eq!(recorded(&calls), ["application:SyntaxError"]);
}

#[tokio::test]
async fn a_translated_failure_carries_the_foreign_error_as_its_cause_only_when_given() {
    let calls: Calls = Arc::default();
    let reader = Plugin::new("@fixture/cause").on_failure({
        let calls = Arc::clone(&calls);
        move |failure: &dyn Failure, _: &FailureHookContext| {
            calls.lock().unwrap().push(match failure.cause() {
                Some(cause) => format!(
                    "cause:{}",
                    cause.foreign().map(ToString::to_string).unwrap_or_default()
                ),
                None => "cause:none".to_owned(),
            });
        }
    });
    let caused = ending(
        translators()
            .plugins([reader])
            .translators([translate(|error: SyntaxError| {
                Ok(UnavailableError::caused("cause", error))
            })]),
        foreign,
    );
    assert_eq!(distributed(&caused, &[]).await, translated("cause"));
    assert_eq!(recorded(&calls), ["cause:Unexpected token."]);
}

#[tokio::test]
async fn a_failure_a_hooks_error_and_a_views_error_are_never_offered() {
    let calls: Calls = Arc::default();
    let catch_all = || {
        let calls = Arc::clone(&calls);
        translate(move |_: OtherError| {
            calls.lock().unwrap().push("catch-all".to_owned());
            Ok(UnavailableError::new("catch-all"))
        })
    };
    let fatal = ending(
        translators()
            .plugins(Vec::<Plugin>::new())
            .translators([catch_all()]),
        || FatalError::new("Fatal.").into(),
    );
    assert_eq!(distributed(&fatal, &[]).await.status, 1);
    let hook = ending(
        translators()
            .plugins([Plugin::new("@fixture/hook")
                .on_failure(|_, _| -> Result<(), Error> { Err(OtherError.into()) })])
            .translators([catch_all()]),
        || FatalError::new("Fatal.").into(),
    );
    assert_eq!(distributed(&hook, &[]).await.status, 1);
    let view = ending(
        translators()
            .plugins(Vec::<Plugin>::new())
            .translators([catch_all()])
            .overrides([override_view(
                failure::<FatalError>(),
                FailureView::new(|_: &FatalError, _| -> Result<String, Error> {
                    Err(OtherError.into())
                }),
            )]),
        || FatalError::new("Fatal.").into(),
    );
    assert_eq!(distributed(&view, &[]).await.status, 1);
    assert!(recorded(&calls).is_empty());
    // A foreign error of a cancelled run is translated, and the signal's code still outranks it.
    let signal = CancellationToken::new();
    let cancelled = translators()
        .plugins(Vec::<Plugin>::new())
        .translators([catch_all()])
        .action({
            let signal = signal.clone();
            move |_: Context| {
                let signal = signal.clone();
                async move {
                    signal.cancel();
                    Err(OtherError.into())
                }
            }
        });
    assert_eq!(
        ran(&cancelled, &[], Build::Distributed, Some(signal))
            .await
            .status,
        130
    );
    assert_eq!(recorded(&calls), ["catch-all"]);
}

#[tokio::test]
async fn a_row_source_the_action_let_propagate_reports_once_as_the_translated_failure() {
    let calls: Calls = Arc::default();
    let application = translators()
        .plugins(Vec::<Plugin>::new())
        .translators([answering(&calls, "application")])
        .description("The translators application.")
        .rows(RowViews::new().view(
            "lines",
            RowView::new(|row: &String, _, _| format!("{row}\n")),
        ))
        .action(|ctx: Context<NoInputs, RowsResult<String>>| async move {
            let rows = futures_util_stream(vec![Ok("one".to_owned()), Err(foreign())]);
            ctx.out.results(rows).await
        });
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 69,
            stdout: "one\n".to_owned(),
            stderr: "Output is incomplete: the root Command stopped after 1 rows, 1 written.\nUnavailable from application.\n"
                .to_owned(),
        }
    );
    let caught = translators()
        .plugins(Vec::<Plugin>::new())
        .translators([answering(&calls, "application")])
        .rows(RowViews::new().view(
            "lines",
            RowView::new(|row: &String, _, _| format!("{row}\n")),
        ))
        .action(|ctx: Context<NoInputs, RowsResult<String>>| async move {
            let rows = futures_util_stream(vec![Ok("one".to_owned()), Err(foreign())]);
            if ctx.out.results(rows).await.is_err() {
                ctx.out.info("caught").await?;
            }
            Ok(())
        });
    let ran = distributed(&caught, &[]).await;
    assert_eq!(ran.status, 0);
    assert_eq!(ran.stdout, "one\n");
}

/// A row stream over these items.
fn futures_util_stream<R: Send + Unpin + 'static>(
    items: Vec<Result<R, Error>>,
) -> loomcli_core::RowSource<R> {
    loomcli_core::RowSource::stream(Iter(items.into_iter()))
}

struct Iter<I>(I);

impl<I: Iterator + Unpin> futures_core::Stream for Iter<I> {
    type Item = I::Item;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::task::Poll::Ready(self.0.next())
    }
}

#[tokio::test]
async fn a_destination_write_failure_the_action_lets_propagate_is_answered_by_its_translator() {
    let calls: Calls = Arc::default();
    let application = translators()
        .plugins(Vec::<Plugin>::new())
        .translators([{
            let calls = Arc::clone(&calls);
            translate(move |_: io::Error| {
                calls
                    .lock()
                    .unwrap()
                    .push("application:DiskError".to_owned());
                Ok(UnavailableError::new("application"))
            })
        }])
        .action(|ctx: Context| async move { ctx.out.print("lost").await });
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdout = Some(Scripted::refusing(
        0,
        io::ErrorKind::StorageFull,
        Arc::default(),
    ));
    let code = application
        .run(RunOptions::new().process(Arc::new(handle)))
        .await;
    assert_eq!(code.get(), 69);
    assert_eq!(mock.stderr_text(), "Unavailable from application.\n");
    assert_eq!(recorded(&calls), ["application:DiskError"]);
}

#[tokio::test]
async fn a_translated_error_other_than_an_ignored_write_failure_leaves_the_destination_fault() {
    let calls: Calls = Arc::default();
    let application = translators()
        .plugins(Vec::<Plugin>::new())
        .translators([answering(&calls, "application")])
        .action(|ctx: Context| async move {
            let _ = ctx.out.print("lost").await;
            Err(foreign())
        });
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdout = Some(Scripted::refusing(
        0,
        io::ErrorKind::StorageFull,
        Arc::default(),
    ));
    let code = application
        .run(RunOptions::new().process(Arc::new(handle)))
        .await;
    assert_eq!((code.get(), mock.stderr_text().as_str()), (1, GENERIC));
    assert_eq!(recorded(&calls), ["application:SyntaxError"]);
}

// failure-selection.test.ts: the selection a failure view and a hook read, with no middleware.

fn pass_through(value: &String, _: &loomcli_core::ViewContext) -> String {
    format!("{value}\n")
}

/// The fixture's `picks`: `list` (rows, default `table`, a JSON view), `wire` (a value, default
/// `json`), and `get` (no result), each failing; an override and a hook that print the selection.
fn selection_app(extra: Vec<Plugin>, limit: bool) -> App {
    let reporting = override_view(
        failure::<LoomError>(),
        FailureView::new(|_: &LoomError, context| {
            std::iter::once(format!(
                "view:{}:{}",
                context.view.as_deref().unwrap_or("undefined"),
                context.media_type.as_deref().unwrap_or("undefined")
            ))
            .chain(context.hints.iter().cloned())
            .map(|line| format!("{line}\n"))
            .collect::<String>()
        }),
    );
    let hooking = Plugin::new("@fixture/selecting").on_failure(|_, context| {
        format!(
            "hook:{}:{}",
            context.view.as_deref().unwrap_or("undefined"),
            context.media_type.as_deref().unwrap_or("undefined")
        )
    });
    let list = Command::new("list")
        .option(
            "depth",
            Opt::string().validate(support::validators::Digits("Use decimal digits.")),
        )
        .rows(
            RowViews::new()
                .view(
                    "json",
                    RowView::new(|row: &String, _, _| format!("{row}\n"))
                        .media_type("application/json"),
                )
                .view(
                    "table",
                    RowView::new(|row: &String, _, _| format!("{row}\n")),
                )
                .default_view("table"),
        )
        .action(|_: Context<NoInputs, RowsResult<String>>| async {
            Err(FatalError::new("Refused.").into())
        });
    let wire = Command::new("wire")
        .result(
            ResultViews::new()
                .view(
                    "json",
                    View::new(pass_through).media_type("application/json"),
                )
                .view("text", View::new(pass_through))
                .default_view("json"),
        )
        .action(|_: Context<NoInputs, ValueResult<String>>| async {
            Err(FatalError::new("Refused.").into())
        });
    let get =
        Command::new("get").action(|_: Context| async { Err(FatalError::new("Refused.").into()) });
    let mut plugins = vec![hooking];
    plugins.extend(extra);
    let application = Application::new("picks")
        .plugins(plugins)
        .overrides([reporting]);
    let application = if limit {
        application.global_option(
            "limit",
            Opt::string()
                .default("x")
                .validate(support::validators::Digits("Use decimal digits.")),
        )
    } else {
        application
    };
    application
        .command(list)
        .command(wire)
        .command(get)
        .action(dispatch)
}

fn read(view: &str, media_type: &str) -> String {
    format!("view:{view}:{media_type}\nhook:{view}:{media_type}\n")
}

#[tokio::test]
async fn a_failure_reads_the_default_view_of_its_routed_commands_result() {
    let application = selection_app(Vec::new(), false);
    assert_eq!(
        distributed(&application, &["list"]).await.stderr,
        read("table", "undefined")
    );
    assert_eq!(
        distributed(&application, &["list", "--depth", "x"])
            .await
            .stderr,
        read("table", "undefined")
    );
    assert_eq!(
        distributed(&application, &["wire"]).await.stderr,
        read("json", "application/json")
    );
}

#[tokio::test]
async fn an_unknown_command_or_a_command_with_no_result_reads_no_selection() {
    let application = selection_app(Vec::new(), false);
    assert_eq!(
        distributed(&application, &["nope"]).await.stderr,
        read("undefined", "undefined")
    );
    assert_eq!(
        distributed(&application, &["get"]).await.stderr,
        read("undefined", "undefined")
    );
}

#[tokio::test]
async fn a_rejected_default_reads_no_selection() {
    let application = selection_app(Vec::new(), true);
    assert_eq!(
        distributed(&application, &["wire"]).await.stderr,
        read("undefined", "undefined")
    );
}

#[tokio::test]
async fn a_run_by_name_reads_the_view_it_started_with() {
    let application = selection_app(Vec::new(), false);
    let process = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let outcome = application
        .invoke(
            &["list"],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<Error>::new().view("json"),
            Some(Arc::clone(&process) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Failed { messages, .. } = outcome else {
        panic!("the call fails");
    };
    assert_eq!(messages, read("json", "application/json"));
}

#[tokio::test]
async fn a_build_fault_reads_no_selection_and_calls_no_hook() {
    let application = selection_app(
        vec![Plugin::new("@fixture/judging").on_graph_built(|_| {
            Err(DeclarationError::sentence_only("The graph is rejected.").into())
        })],
        false,
    );
    assert_eq!(
        distributed(&application, &["wire"]).await.stderr,
        "view:undefined:undefined\n"
    );
}

// failure-encoders.test.ts: the selection is the routed Command's default view, or the view the
// `--pick` middleware selects.

const ENC_HINT: &str = "Run \"enc --help\" to see the usage.";

/// The line the fixture's encoder writes for one form.
fn error_line(form: &FailureForm) -> String {
    format!(
        "{}\n",
        json!({ "error": serde_json::to_value(form).unwrap() })
    )
}

/// The line the fixture's encoder writes for these facts, with the fixture's hint.
fn line(code: &str, exit_code: u8, message: &str) -> String {
    format!(
        "{}\n",
        json!({ "error": { "code": code, "exitCode": exit_code, "message": message, "hints": [ENC_HINT] } })
    )
}

#[derive(Clone, Copy)]
enum Encoder {
    Line,
    Throws,
}

/// The fixture's `enc`: an encoding plugin with a hint, a `FatalError` override, and Commands whose
/// default view declares `application/json`, beside one whose default is a text view.
fn encoding_app(encoder: Encoder, signal: &CancellationToken, extra: Vec<Plugin>) -> App {
    let encoding = Plugin::new("@fixture/encoding")
        .failure_encoders([encode_failure(
            "application/json",
            move |form: &FailureForm| match encoder {
                Encoder::Line => Ok(error_line(form)),
                Encoder::Throws => Err(Error::from_foreign("The encoder broke.".into())),
            },
        )])
        .on_failure(|_, _| ENC_HINT.to_owned());
    let branded = override_view(
        failure::<FatalError>(),
        FailureView::new(|failure: &FatalError, _| format!("branded: {}\n", failure.message())),
    );
    let rows = |default: &'static str| {
        RowViews::new()
            .view(
                "json",
                RowView::new(|row: &Value, _, _| format!("{row}\n")).media_type("application/json"),
            )
            .view(
                "table",
                RowView::new(|row: &Value, _, _| format!("{row}\n")),
            )
            .default_view(default)
    };
    let listing = |name: &'static str, default: &'static str| {
        let signal = signal.clone();
        Command::new(name)
            .option(
                "depth",
                Opt::string().validate(support::validators::Digits("Use decimal digits.")),
            )
            .option("how", Opt::string())
            .rows(rows(default))
            .action(move |ctx: Context<NoInputs, RowsResult<Value>>| {
                let signal = signal.clone();
                async move {
                    match ctx.option::<Option<String>>("how")?.as_deref() {
                        Some("cancel") => {
                            signal.cancel();
                            return Err(FatalError::new("Refused after the abort.").into());
                        }
                        Some("stream-cancel") => {
                            let rows = Iter(vec![Ok(json!({ "key": "a" }))].into_iter());
                            let cancelling = Cancelling(rows, Some(signal), false);
                            return ctx
                                .out
                                .results(loomcli_core::RowSource::stream(cancelling))
                                .await;
                        }
                        Some("defect") => return Err(ValueError.into()),
                        Some("fatal") => {
                            return Err(FatalError::new(format!(
                                "The {} is down.",
                                loomcli_core::style().bold().apply("registry")
                            ))
                            .into());
                        }
                        _ => {}
                    }
                    let rows = futures_util_stream(vec![
                        Ok(json!({ "key": "a" })),
                        Err(FatalError::new("The key \"b\" is refused.").into()),
                    ]);
                    ctx.out.results(rows).await
                }
            })
    };
    let wire = Command::new("wire")
        .result(
            ResultViews::new()
                .view(
                    "json",
                    View::new(pass_through).media_type("application/json"),
                )
                .view("text", View::new(pass_through))
                .default_view("json"),
        )
        .action(|_: Context<NoInputs, ValueResult<String>>| async {
            Err(FatalError::new("Refused.").into())
        });
    let flags = Command::new("flags")
        .option("count", Opt::boolean())
        .option("tag", Opt::string())
        .result(ResultViews::new().view(
            "json",
            View::new(pass_through).media_type("application/json"),
        ))
        .command(
            Command::new("inner")
                .option("deep", Opt::string())
                .action(|_: Context| async { Ok(()) }),
        )
        .action(|ctx: Context<NoInputs, ValueResult<String>>| async move {
            ctx.out.results("{}".to_owned()).await
        });
    let extra_command = Command::new("extra")
        .result(ResultViews::new().view(
            "json",
            View::new(pass_through).media_type("application/json"),
        ))
        .action(|ctx: Context<NoInputs, ValueResult<String>>| async move {
            ctx.out.results("{}".to_owned()).await
        });
    let mut plugins = vec![encoding];
    plugins.extend(extra);
    Application::new("enc")
        .plugins(plugins)
        .overrides([branded])
        // The failing source's binding, inert unless the source is installed.
        .global_option(
            "fed",
            Opt::string().extend([SETTINGS_KEY.value("fed".to_owned())]),
        )
        .command(listing("list", "json"))
        .command(wire)
        .command(flags)
        .command(extra_command)
        .command(listing("tabled", "table"))
        .action(dispatch)
}

/// A row stream that cancels the caller's signal once its rows are taken, waiting one turn before
/// each step as an asynchronous source does.
struct Cancelling<S>(S, Option<CancellationToken>, bool);

impl<S: futures_core::Stream + Unpin> futures_core::Stream for Cancelling<S> {
    type Item = S::Item;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        if !self.2 {
            self.2 = true;
            context.waker().wake_by_ref();
            return std::task::Poll::Pending;
        }
        self.2 = false;
        match std::pin::Pin::new(&mut self.0).poll_next(context) {
            std::task::Poll::Ready(None) => {
                if let Some(signal) = self.1.take() {
                    signal.cancel();
                }
                std::task::Poll::Ready(None)
            }
            other => other,
        }
    }
}

#[derive(Debug)]
struct ValueError;

impl std::fmt::Display for ValueError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Cannot read the value.")
    }
}

impl std::error::Error for ValueError {}

async fn encoded(encoder: Encoder, argv: &[&str], build: Build) -> Ran {
    let signal = CancellationToken::new();
    let application = encoding_app(encoder, &signal, Vec::new());
    ran(&application, argv, build, Some(signal)).await
}

#[tokio::test]
async fn a_held_fault_under_an_encoded_selection_writes_the_encoded_line_alone() {
    assert_eq!(
        encoded(Encoder::Line, &["list", "--depth", "x"], Build::Distributed).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "{\"error\":{\"code\":\"invalid-input\",\"exitCode\":2,\"message\":\"Option \\\"--depth\\\": Use decimal digits.\",\"hints\":[\"Run \\\"enc --help\\\" to see the usage.\"]}}\n"
                .to_owned(),
        }
    );
    assert_eq!(
        encoded(Encoder::Line, &["list", "--bogus"], Build::Distributed)
            .await
            .stderr,
        line(
            "unknown-option",
            2,
            "Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
}

/// The fixture's `--pick`: a global option whose middleware selects the view it names, as the
/// formatter selects one, on a Command with a result.
fn picking() -> Plugin {
    Plugin::new("@fixture/picking")
        .option(
            "pick",
            Opt::string().validate(support::validators::OneOf(
                &["table", "json"],
                "Use table or json.",
            )),
        )
        .middleware(
            loomcli_core::Activation::Always,
            |ctx, next: loomcli_core::Next| async move {
                if ctx.view().is_some()
                    && let Ok(Some(picked)) = ctx.own_options.option::<Option<String>>("pick")
                {
                    ctx.select_view(&picked);
                }
                next.run().await.map(|_| ())
            },
        )
}

/// The binding the failing source answers for, carried by the application's `fed` option.
const SETTINGS_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/settings/key");

/// A configuration source that cannot read its settings.
fn failing_settings() -> Plugin {
    Plugin::new("@fixture/settings")
        .extensions([loomcli_core::AnyExtension::from(SETTINGS_KEY)])
        .source(ConfigurationSource::new(
            &SETTINGS_KEY,
            |_: loomcli_core::SourceContext<NoInputs>| async {
                Err(InputError::new("The settings file cannot be read.", Vec::new()).into())
            },
        ))
}

#[tokio::test]
async fn a_held_fault_under_a_selection_a_middleware_made_writes_the_encoded_line_alone() {
    let signal = CancellationToken::new();
    let application = encoding_app(Encoder::Line, &signal, vec![picking()]);
    assert_eq!(
        distributed(&application, &["tabled", "--pick", "json", "--depth", "x"]).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: line(
                "invalid-input",
                2,
                "Option \"--depth\": Use decimal digits."
            ),
        }
    );
    assert_eq!(
        distributed(&application, &["tabled", "--pick", "json", "--bogus"])
            .await
            .stderr,
        line(
            "unknown-option",
            2,
            "Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
    assert_eq!(
        distributed(&application, &["tabled", "--depth", "x"])
            .await
            .stderr,
        format!("enc: Option \"--depth\": Use decimal digits.\n{ENC_HINT}\n")
    );
}

#[tokio::test]
async fn an_input_source_fault_under_a_selected_encoding_writes_the_encoded_line() {
    let signal = CancellationToken::new();
    let application = encoding_app(Encoder::Line, &signal, vec![picking(), failing_settings()]);
    assert_eq!(
        distributed(&application, &["tabled", "--pick", "json"]).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: line("invalid-input", 2, "The settings file cannot be read."),
        }
    );
    assert_eq!(
        distributed(&application, &["tabled"]).await.stderr,
        format!("enc: The settings file cannot be read.\n{ENC_HINT}\n")
    );
}

#[tokio::test]
async fn a_run_by_name_calls_no_encoder_and_carries_the_form_on_its_outcome() {
    let encoded: Arc<Mutex<usize>> = Arc::default();
    let counting =
        Plugin::new("@fixture/counting").failure_encoders([encode_failure("application/json", {
            let encoded = Arc::clone(&encoded);
            move |form: &FailureForm| {
                *encoded.lock().unwrap() += 1;
                error_line(form)
            }
        })]);
    let application = Application::new("enc").plugins([counting]).command(
        Command::new("list")
            .option(
                "depth",
                Opt::string().validate(support::validators::Digits("Use decimal digits.")),
            )
            .rows(
                RowViews::new()
                    .view(
                        "json",
                        RowView::new(|row: &Value, _, _| format!("{row}\n"))
                            .media_type("application/json"),
                    )
                    .view(
                        "table",
                        RowView::new(|row: &Value, _, _| format!("{row}\n")),
                    )
                    .default_view("table"),
            )
            .action(|ctx: Context<NoInputs, RowsResult<Value>>| async move {
                ctx.out.results(Vec::<Value>::new()).await
            }),
    );
    let process = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let outcome = application
        .invoke(
            &["list"],
            loomcli_core::InvocationValues::new().option("depth", "x"),
            loomcli_core::InvokeOptions::<Error>::new().view("json"),
            Some(Arc::clone(&process) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Failed { form, messages, .. } = outcome else {
        panic!("the call fails");
    };
    assert_eq!(*encoded.lock().unwrap(), 0);
    assert_eq!(
        serde_json::to_string(&form).unwrap(),
        r#"{"code":"invalid-input","exitCode":2,"message":"Option \"depth\": Use decimal digits.","hints":[]}"#
    );
    assert_eq!(messages, "enc: Option \"depth\": Use decimal digits.\n");
}

#[tokio::test]
async fn an_action_failure_after_rows_writes_the_rows_and_the_line_alone() {
    assert_eq!(
        encoded(Encoder::Line, &["list"], Build::Distributed).await,
        Ran {
            status: 1,
            stdout: "{\"key\":\"a\"}\n".to_owned(),
            stderr: line("fatal", 1, "The key \"b\" is refused."),
        }
    );
}

fn incomplete(command: &str, yielded: u32, written: u32) -> String {
    format!(
        "Output is incomplete: Command \"{command}\" stopped after {yielded} rows, {written} written.\n"
    )
}

#[tokio::test]
async fn a_stream_cancelled_mid_sequence_writes_the_incomplete_line_because_no_encoder_writes() {
    assert_eq!(
        encoded(
            Encoder::Line,
            &["list", "--how", "stream-cancel"],
            Build::Distributed
        )
        .await,
        Ran {
            status: 130,
            stdout: "{\"key\":\"a\"}\n".to_owned(),
            stderr: incomplete("list", 1, 1),
        }
    );
}

#[tokio::test]
async fn a_stdout_that_fails_a_write_writes_the_incomplete_line_beside_its_plain_report() {
    let signal = CancellationToken::new();
    let application = encoding_app(Encoder::Line, &signal, Vec::new());
    let mock = mock_process(
        MockFields::new()
            .argv(["list"])
            .release(ReleaseFacts::new(Build::Distributed)),
    );
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
    assert_eq!(
        mock.stderr_text(),
        format!("{}enc: Something went wrong.\n", incomplete("list", 1, 0))
    );
}

#[tokio::test]
async fn a_broken_encoder_after_rows_writes_the_incomplete_line_ahead_of_the_default_text() {
    assert_eq!(
        encoded(Encoder::Throws, &["list"], Build::Distributed).await,
        Ran {
            status: 1,
            stdout: "{\"key\":\"a\"}\n".to_owned(),
            stderr: format!(
                "{}The key \"b\" is refused.\nenc: Something went wrong.\n",
                incomplete("list", 1, 1)
            ),
        }
    );
}

#[tokio::test]
async fn a_selection_that_declares_no_encoded_media_type_writes_its_text() {
    let table = encoded(Encoder::Line, &["tabled"], Build::Distributed).await;
    assert_eq!(table.stdout, "{\"key\":\"a\"}\n");
    assert_eq!(
        table.stderr,
        format!(
            "{}branded: The key \"b\" is refused.\n",
            incomplete("tabled", 1, 1)
        )
    );
    assert_eq!(
        encoded(
            Encoder::Line,
            &["tabled", "--depth", "x"],
            Build::Distributed
        )
        .await
        .stderr,
        format!("enc: Option \"--depth\": Use decimal digits.\n{ENC_HINT}\n")
    );
    assert_eq!(
        encoded(Encoder::Line, &["nope"], Build::Distributed)
            .await
            .stderr,
        format!(
            "enc: Unknown command \"nope\". Use one of: list, wire, flags, extra, tabled.\n{ENC_HINT}\n"
        )
    );
    let signal = CancellationToken::new();
    let judged = encoding_app(
        Encoder::Line,
        &signal,
        vec![Plugin::new("@fixture/judging").on_graph_built(|_| {
            Err(DeclarationError::sentence_only("The graph is rejected.").into())
        })],
    );
    assert_eq!(
        distributed(&judged, &["list"]).await.stderr,
        "enc: Something went wrong.\n"
    );
}

#[tokio::test]
async fn a_default_view_that_declares_the_media_type_writes_the_line() {
    assert_eq!(
        encoded(Encoder::Line, &["wire"], Build::Distributed).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: line("fatal", 1, "Refused."),
        }
    );
}

#[tokio::test]
async fn the_encoder_answers_ahead_of_the_applications_override_in_plain_text() {
    let signal = CancellationToken::new();
    let application = encoding_app(Encoder::Line, &signal, Vec::new());
    let forced = run_with_env(
        &application,
        &["list", "--how", "fatal"],
        ("FORCE_COLOR", "1"),
    )
    .await;
    assert_eq!(forced.stderr, line("fatal", 1, "The registry is down."));
    let text = encoded(
        Encoder::Line,
        &["tabled", "--how", "fatal"],
        Build::Distributed,
    )
    .await;
    assert!(text.stderr.starts_with("branded: The "), "{}", text.stderr);
    assert!(text.stderr.contains("registry"));
    assert!(text.stderr.ends_with(" is down.\n"));
}

async fn run_with_env(application: &App, argv: &[&str], (name, value): (&str, &str)) -> Ran {
    support::run_with(
        application,
        MockFields::new()
            .argv(argv.iter().copied())
            .env(name, value)
            .release(ReleaseFacts::new(Build::Distributed)),
    )
    .await
}

#[tokio::test]
async fn a_defect_writes_the_generic_line_distributed_and_its_diagnostic_then_the_line_in_development()
 {
    assert_eq!(
        encoded(
            Encoder::Line,
            &["list", "--how", "defect"],
            Build::Distributed
        )
        .await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: line("internal", 1, "Something went wrong."),
        }
    );
    let development = encoded(
        Encoder::Line,
        &["list", "--how", "defect"],
        Build::Development,
    )
    .await;
    assert_eq!(development.status, 1);
    assert!(development.stderr.starts_with("-- UNHANDLED EXCEPTION -"));
    assert!(
        development.stderr.ends_with(&format!(
            "\n{ENC_HINT}\n\n{}",
            line("internal", 1, "Cannot read the value.")
        )),
        "{}",
        development.stderr
    );
}

#[tokio::test]
async fn a_structural_fault_reaches_the_line_with_its_classs_code() {
    for (code, argv) in [
        ("misplaced-option", vec!["flags", "--deep", "x"]),
        ("missing-value", vec!["flags", "--tag"]),
        ("repeated-option", vec!["flags", "--tag", "a", "--tag", "b"]),
        ("unexpected-argument", vec!["extra", "a"]),
        ("unexpected-value", vec!["flags", "--count=yes"]),
        ("unknown-option", vec!["flags", "--bogus"]),
    ] {
        let ran = encoded(Encoder::Line, &argv, Build::Distributed).await;
        let line: Value = serde_json::from_str(&ran.stderr).unwrap_or(Value::Null);
        assert_eq!(
            line["error"]["code"],
            json!(code),
            "{argv:?}: {}",
            ran.stderr
        );
    }
}

#[tokio::test]
async fn an_encoder_that_fails_writes_the_default_text_then_the_defect_by_build() {
    assert_eq!(
        encoded(Encoder::Throws, &["wire"], Build::Distributed).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "Refused.\nenc: Something went wrong.\n".to_owned(),
        }
    );
    let development = encoded(Encoder::Throws, &["wire"], Build::Development).await;
    assert_eq!(development.status, 1);
    assert!(
        development
            .stderr
            .starts_with("Refused.\n\n-- BROKEN FAILURE ENCODER ")
    );
    assert!(development.stderr.contains(
        "\n\nPlugin \"@fixture/encoding\" failed to encode the failure as \"application/json\": The encoder broke.\n"
    ));
    assert!(development.stderr.contains(
        "\n\nReturn the encoded failure as a string, and throw nothing from the encoder.\n"
    ));
}

#[tokio::test]
async fn a_broken_encoder_in_a_cancelled_run_keeps_the_signal_code() {
    assert_eq!(
        encoded(
            Encoder::Throws,
            &["list", "--how", "cancel"],
            Build::Distributed
        )
        .await,
        Ran {
            status: 130,
            stdout: String::new(),
            stderr: "Refused after the abort.\nenc: Something went wrong.\n".to_owned(),
        }
    );
}

// failures.test.ts and views.test.ts: override resolution along the class chain and across
// contributors.

fn labelled<F: Failure>(label: &'static str) -> loomcli_core::ViewOverride {
    override_view(
        failure::<F>(),
        FailureView::new(move |failure: &F, _| format!("{label}: {}\n", failure.message())),
    )
}

/// A Command with a required argument, a validated option, and an action that fails as asked.
fn resolving(application: Application<NoInputs, NoResult, Fresh>) -> App {
    application
        .option(
            "depth",
            Opt::string().validate(support::validators::Digits("Use digits.")),
        )
        .option("how", Opt::string())
        .action(|ctx: Context| async move {
            match ctx.option::<Option<String>>("how")?.as_deref() {
                Some("unavailable") => Err(UnavailableError::new("the registry").into()),
                _ => Err(FatalError::new("Fatal.").into()),
            }
        })
}

fn plain_app() -> Application<NoInputs, NoResult, Fresh> {
    Application::new("app").plugins(Vec::<Plugin>::new())
}

#[tokio::test]
async fn resolution_takes_the_most_derived_override_and_falls_back_to_the_base_one() {
    let application = resolving(plain_app().overrides([
        labelled::<UsageError>("usage"),
        labelled::<InputError>("input"),
    ]));
    assert_eq!(
        distributed(&application, &["--depth", "x"]).await.stderr,
        "input: Option \"--depth\": Use digits.\n"
    );
    assert_eq!(
        distributed(&application, &["--bogus"]).await.stderr,
        "usage: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
    );
}

#[tokio::test]
async fn an_override_for_a_fatal_subclass_answers_it_without_answering_the_base() {
    let application =
        resolving(plain_app().overrides([labelled::<UnavailableError>("unavailable")]));
    assert_eq!(
        distributed(&application, &["--how", "unavailable"]).await,
        Ran {
            status: 69,
            stdout: String::new(),
            stderr: "unavailable: Unavailable from the registry.\n".to_owned(),
        }
    );
    assert_eq!(distributed(&application, &[]).await.stderr, "Fatal.\n");
}

#[tokio::test]
async fn two_overrides_for_one_class_in_one_contributor_resolve_to_the_first() {
    let application = resolving(plain_app().overrides([
        labelled::<FatalError>("first"),
        labelled::<FatalError>("second"),
    ]));
    assert_eq!(
        distributed(&application, &[]).await.stderr,
        "first: Fatal.\n"
    );
}

#[tokio::test]
async fn an_applications_usage_override_beats_a_plugins_input_override() {
    let application = resolving(
        Application::new("app")
            .plugins([Plugin::new("@acme/input").views([labelled::<InputError>("plugin input")])])
            .overrides([labelled::<UsageError>("app usage")]),
    );
    assert_eq!(
        distributed(&application, &["--depth", "x"]).await.stderr,
        "app usage: Option \"--depth\": Use digits.\n"
    );
}

#[tokio::test]
async fn an_earlier_plugins_usage_override_beats_a_later_plugins_input_override() {
    let application = resolving(Application::new("app").plugins([
        Plugin::new("@acme/usage").views([labelled::<UsageError>("first usage")]),
        Plugin::new("@acme/input").views([labelled::<InputError>("second input")]),
    ]));
    assert_eq!(
        distributed(&application, &["--depth", "x"]).await.stderr,
        "first usage: Option \"--depth\": Use digits.\n"
    );
}

#[tokio::test]
async fn a_build_fault_reaches_the_applications_overrides_and_never_a_plugins() {
    let application = Application::new("app")
        .plugins([Plugin::new("@acme/brand").views([labelled::<DeclarationError>("plugin")])])
        .overrides([labelled::<LoomError>("application")]);
    let ran = distributed(&application, &[]).await;
    assert_eq!(ran.status, 1);
    assert!(ran.stderr.starts_with("application: "), "{}", ran.stderr);
    let plugin_only = Application::new("app")
        .plugins([Plugin::new("@acme/brand").views([labelled::<DeclarationError>("plugin")])]);
    assert_eq!(
        distributed(&plugin_only, &[]).await.stderr,
        "app: Something went wrong.\n"
    );
}

#[tokio::test]
async fn a_plugins_declared_view_resolves_through_its_override_and_the_applications_first() {
    let page = loomcli_core::view(
        "@acme/page",
        View::new(|text: &String, _| format!("page: {text}\n")),
    );
    let printing = |page: loomcli_core::DeclaredView<String>| {
        move |ctx: Context| {
            let page = page.clone();
            async move { ctx.out.render(&"hello".to_owned(), &page).await }
        }
    };
    let declared = Application::new("app")
        .plugins([Plugin::new("@acme/pages").views([page.clone()])])
        .action(printing(page.clone()));
    assert_eq!(support::run(&declared, &[]).await.stdout, "page: hello\n");
    let own = Application::new("app")
        .plugins([Plugin::new("@acme/pages").views((
            page.clone(),
            override_view(
                page.clone(),
                View::new(|text: &String, _| format!("plugin: {text}\n")),
            ),
        ))])
        .action(printing(page.clone()));
    assert_eq!(support::run(&own, &[]).await.stdout, "plugin: hello\n");
    let both = Application::new("app")
        .plugins([Plugin::new("@acme/pages").views((
            page.clone(),
            override_view(
                page.clone(),
                View::new(|text: &String, _| format!("plugin: {text}\n")),
            ),
        ))])
        .overrides([override_view(
            page.clone(),
            View::new(|text: &String, _| format!("application: {text}\n")),
        )])
        .action(printing(page));
    assert_eq!(
        support::run(&both, &[]).await.stdout,
        "application: hello\n"
    );
}

// exit-codes.test.ts: the precedence of the code.

#[tokio::test]
async fn a_cancelled_run_resolves_the_signal_code_over_the_declared_one() {
    let signal = CancellationToken::new();
    let application = Application::new("app").action({
        let signal = signal.clone();
        move |_: Context| {
            let signal = signal.clone();
            async move {
                signal.cancel();
                Err(UnavailableError::new("the registry").into())
            }
        }
    });
    assert_eq!(
        ran(&application, &[], Build::Distributed, Some(signal))
            .await
            .status,
        130
    );
}

#[tokio::test]
async fn a_broken_view_of_the_class_falls_back_to_the_default_text_and_returns_1() {
    let application = Application::new("app")
        .overrides([override_view(
            failure::<UnavailableError>(),
            FailureView::new(|_: &UnavailableError, _| -> Result<String, Error> {
                Err(Error::from_foreign("View broke.".into()))
            }),
        )])
        .action(|_: Context| async { Err(UnavailableError::new("the registry").into()) });
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "Unavailable from the registry.\napp: Something went wrong.\n".to_owned(),
        }
    );
}

// development-builds.test.ts and developer-diagnostics.test.ts: the run part.

const MISSING_NAME: &str =
    "probe: Argument \"name\" requires a value. Supply a value for \"name\".\n";

fn probe(
    plugins: Vec<Plugin>,
    overrides: Vec<loomcli_core::ViewOverride>,
) -> loomcli_core::Application<NoInputs, NoResult, loomcli_core::Fresh> {
    Application::new("probe")
        .plugins(plugins)
        .overrides(overrides)
        .argument("name", Arg::string().required())
}

fn defect_app(plugins: Vec<Plugin>, overrides: Vec<loomcli_core::ViewOverride>) -> App {
    Application::new("probe")
        .plugins(plugins)
        .overrides(overrides)
        .action(|_: Context| async { Err(ValueError.into()) })
}

#[tokio::test]
async fn an_override_of_internal_error_renders_a_defect_distributed_and_is_passed_over_in_development()
 {
    let application = defect_app(
        Vec::new(),
        vec![labelled::<InternalError>("application override")],
    );
    assert_eq!(
        distributed(&application, &[]).await.stderr,
        "application override: Cannot read the value.\n"
    );
    let plugin = defect_app(
        vec![Plugin::new("@acme/brand").views([labelled::<InternalError>("plugin override")])],
        Vec::new(),
    );
    assert_eq!(
        distributed(&plugin, &[]).await.stderr,
        "plugin override: Cannot read the value.\n"
    );
    for application in [application, plugin] {
        let development = developed(&application, &[]).await;
        assert_eq!(development.status, 1);
        assert!(development.stderr.starts_with("-- UNHANDLED EXCEPTION -"));
        assert!(!development.stderr.contains("override"));
    }
}

#[tokio::test]
async fn a_hint_prints_under_the_generic_message_and_under_the_developer_diagnostic() {
    let application = defect_app(
        vec![
            Plugin::new("@acme/report")
                .on_failure(|_, _| "Report this at https://example.com/issues.".to_owned()),
        ],
        Vec::new(),
    );
    assert_eq!(
        distributed(&application, &[]).await.stderr,
        "probe: Something went wrong.\nReport this at https://example.com/issues.\n"
    );
    let development = developed(&application, &[]).await.stderr;
    assert!(
        development.ends_with("act on.\n\nReport this at https://example.com/issues.\n"),
        "{development}"
    );
}

#[tokio::test]
async fn a_build_fault_writes_the_generic_message_distributed_and_its_diagnostic_in_development() {
    let application = Application::new("probe").plugins(Vec::<Plugin>::new());
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "probe: Something went wrong.\n".to_owned(),
        }
    );
    let development = developed(&application, &[]).await;
    assert_eq!(development.status, 1);
    assert!(
        development
            .stderr
            .contains(" @loomcli/core/command-without-action\n\nThe root Command has no action.\n")
    );
    assert!(development.stderr.ends_with("\n\nRegister an action.\n"));
}

#[tokio::test]
async fn a_broken_failure_view_writes_the_failures_text_then_the_generic_message_or_its_diagnostic()
{
    let breaking = || {
        override_view(
            failure::<InputError>(),
            FailureView::new(|_: &InputError, _| -> Result<String, Error> {
                Err(Error::from_foreign("View broke.".into()))
            }),
        )
    };
    let application = probe(Vec::new(), vec![breaking()]).action(dispatch);
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!("{MISSING_NAME}probe: Something went wrong.\n"),
        }
    );
    let development = developed(&application, &[]).await;
    assert_eq!(development.status, 1);
    assert!(
        development
            .stderr
            .starts_with(&format!("{MISSING_NAME}\n-- BROKEN FAILURE VIEW -"))
    );
    assert!(development.stderr.contains(
        " @loomcli/core/broken-failure-view\n\nRendering the failure failed: View broke.\n"
    ));
}

/// The fixture's broken hook beside a working one that would hint.
fn broken_hooks() -> Vec<Plugin> {
    vec![
        Plugin::new("@acme/broken").on_failure(|_, _| -> Result<(), Error> {
            Err(Error::from_foreign("Hook broke.".into()))
        }),
        Plugin::new("@acme/report")
            .on_failure(|_, _| "Report this at https://example.com/issues.".to_owned()),
    ]
}

#[tokio::test]
async fn a_failing_hook_writes_the_failures_text_with_no_hints_then_a_foreign_throw() {
    let application = probe(broken_hooks(), Vec::new()).action(dispatch);
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!("{MISSING_NAME}probe: Something went wrong.\n"),
        }
    );
    let development = developed(&application, &[]).await;
    assert_eq!(development.status, 1);
    assert!(
        development
            .stderr
            .starts_with(&format!("{MISSING_NAME}\n-- UNHANDLED EXCEPTION -"))
    );
    assert!(
        development
            .stderr
            .contains(" @loomcli/core/foreign-throw\n\nHook broke.\n")
    );
    assert!(!development.stderr.contains("Report this at"));
    let both = probe(
        broken_hooks(),
        vec![override_view(
            failure::<InputError>(),
            FailureView::new(|_: &InputError, _| -> Result<String, Error> {
                Err(Error::from_foreign("View broke.".into()))
            }),
        )],
    )
    .action(dispatch);
    let development = developed(&both, &[]).await;
    assert!(
        development
            .stderr
            .starts_with(&format!("{MISSING_NAME}\n-- UNHANDLED EXCEPTION -"))
    );
    assert!(!development.stderr.contains("-- BROKEN FAILURE VIEW"));
}

#[tokio::test]
async fn a_failing_hook_in_a_cancelled_run_keeps_the_signal_code_in_both_builds() {
    for build in [Build::Distributed, Build::Development] {
        let signal = CancellationToken::new();
        let application = Application::new("probe").plugins(broken_hooks()).action({
            let signal = signal.clone();
            move |_: Context| {
                let signal = signal.clone();
                async move {
                    signal.cancel();
                    Err(ValueError.into())
                }
            }
        });
        let ran = ran(&application, &[], build, Some(signal)).await;
        assert_eq!(ran.status, 130);
        if build == Build::Distributed {
            assert_eq!(ran.stderr, "probe: Something went wrong.\n");
        } else {
            assert!(ran.stderr.contains("\n\n-- UNHANDLED EXCEPTION -"));
            assert!(
                ran.stderr
                    .contains(" @loomcli/core/foreign-throw\n\nHook broke.\n")
            );
        }
    }
}

#[tokio::test]
async fn two_defects_in_one_run_write_the_generic_message_once_or_two_diagnostics_apart() {
    let application = defect_app(
        vec![Plugin::new("@acme/log").on_log(
            |_: &loomcli_core::LogEvent, _: &loomcli_core::LogDestination| {
                Err::<(), Error>(Error::from_foreign("The log hook broke.".into()))
            },
        )],
        Vec::new(),
    );
    assert_eq!(
        distributed(&application, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "probe: Something went wrong.\n".to_owned(),
        }
    );
    let development = developed(&application, &[]).await.stderr;
    let banners: Vec<usize> = development
        .match_indices("-- UNHANDLED EXCEPTION -")
        .map(|(index, _)| index)
        .collect();
    assert_eq!(banners.len(), 2, "{development}");
    assert_eq!(banners[0], 0);
    assert!(development[..banners[1]].ends_with(".\n\n"));
}

#[tokio::test]
async fn a_destination_that_fails_a_write_is_a_defect_by_build() {
    for build in [Build::Distributed, Build::Development] {
        let application = Application::new("probe")
            .action(|ctx: Context| async move { ctx.out.print("lost").await });
        let mock = mock_process(MockFields::new().release(ReleaseFacts::new(build)));
        let mut handle = Swapped::new(Arc::clone(&mock));
        handle.stdout = Some(Scripted::refusing(0, io::ErrorKind::Other, Arc::default()));
        let code = application
            .run(RunOptions::new().process(Arc::new(handle)))
            .await;
        assert_eq!(code.get(), 1);
        if build == Build::Distributed {
            assert_eq!(mock.stderr_text(), "probe: Something went wrong.\n");
        } else {
            assert!(mock.stderr_text().starts_with("-- BROKEN DESTINATION -"));
            assert!(mock.stderr_text().contains(
                " @loomcli/core/broken-destination\n\nCould not write invocation output.\n"
            ));
        }
    }
}
