//! Ports `format-failures.test.ts`: the failure encoders that write a failed run as one JSON line
//! when the selected view is a `json()` or `jsonl()` view. The reference installs `help()`, whose
//! failure hint adds `Run "app count --help" to see the usage.` to a usage error; help belongs to
//! another package, so a fixture plugin installed after the formatter writes the same hint.

#![cfg(feature = "format")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    AnyPlugin, Application, Build, Command, Context, Done, Error, FailureHookContext, FatalError,
    InvokedBy, Issue, NoInputs, NoResult, Opt, Plugin, ProcessHandle, ReleaseFacts,
    RenderingPolicy, ResultViews, RowSource, RowView, RowViews, RowsResult, RunOptions,
    SuppliedValue, TerminalControls, UsageError, ValidationContext, Validator, ValueResult, View,
};
use loomcli_plugins::format::{format, json, jsonl};
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};

#[derive(Debug, PartialEq, Eq)]
struct Ran {
    status: u8,
    stderr: String,
    stdout: String,
}

fn ran(status: u8, stdout: &str, stderr: &str) -> Ran {
    Ran {
        status,
        stderr: stderr.to_owned(),
        stdout: stdout.to_owned(),
    }
}

type App = Application<NoInputs, NoResult, Done>;

async fn run(application: &App, argv: &[&str]) -> Ran {
    let process = mock_process(MockFields::new().argv(argv.iter().copied()));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// A validator that accepts decimal digits alone.
struct Digits;

impl Validator for Digits {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if !input.is_empty() && input.chars().all(|c| c.is_ascii_digit()) {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new("Use decimal digits.")])
        }
    }
}

fn table() -> View<Value> {
    View::new(|data: &Value, _| format!("table:{}\n", data["label"].as_str().unwrap()))
}

/// A Command that fails as `--fail` names, after its own options validated.
fn count() -> Command<NoInputs, ValueResult<Value>> {
    Command::new("count")
        .option("depth", Opt::string().validate(Digits))
        .option("fail", Opt::string())
        .result(ResultViews::new().view("table", table()))
        .action(|ctx: Context<NoInputs, ValueResult<Value>>| async move {
            match ctx.supplied.options.get("fail") {
                Some(SuppliedValue::One(name)) if name == "controls" => {
                    Err(FatalError::new("A \u{9b} control and a \"quote\".").into())
                }
                Some(_) => Err(FatalError::new("The count failed.").into()),
                None => ctx.out.results(json!({ "label": "a" })).await,
            }
        })
}

/// A Command with a streaming table and an explicit whole JSON Lines view.
fn walk() -> Command<NoInputs, RowsResult<Value>> {
    Command::new("walk")
        .rows::<Value>(
            RowViews::new()
                .view(
                    "table",
                    RowView::new(|row: &Value, _, _| format!("{}\n", row["key"].as_str().unwrap())),
                )
                .view("jsonl", jsonl::<[Value]>()),
        )
        .action(|ctx: Context<NoInputs, RowsResult<Value>>| async move {
            let rows = std::collections::VecDeque::from([
                Ok(json!({ "key": "a" })),
                Err(Error::from(FatalError::new("The key \"b\" is refused."))),
            ]);
            ctx.out.results(RowSource::stream(Scripted(rows))).await
        })
}

/// Help's failure hint, as a fixture: every usage error from argv points at the routed page.
fn hinting() -> Plugin {
    Plugin::new("@fixture/hint").on_failure(
        |failure: &dyn loomcli_core::Failure, context: &FailureHookContext| {
            (failure.downcast_ref::<UsageError>().is_some()
                && context.invoked_by == InvokedBy::Argv)
                .then(|| {
                    format!(
                        "Run \"{}\" to see the usage.",
                        [context.application.as_str()]
                            .into_iter()
                            .chain(context.path.iter().map(String::as_str))
                            .chain(["--help"])
                            .collect::<Vec<_>>()
                            .join(" ")
                    )
                })
        },
    )
}

fn plain() -> App {
    Application::new("app")
        .plugins(vec![AnyPlugin::from(format()), AnyPlugin::from(hinting())])
        .command(count())
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await })
}

const USAGE_HINT: &str = "\"hints\":[\"Run \\\"app count --help\\\" to see the usage.\"]";

/// A stream that yields these items in order.
struct Scripted(std::collections::VecDeque<Result<Value, Error>>);

impl futures_core::Stream for Scripted {
    type Item = Result<Value, Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::task::Poll::Ready(self.0.pop_front())
    }
}

fn rows_app() -> App {
    Application::new("app")
        .plugins(vec![AnyPlugin::from(format())])
        .command(walk())
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await })
}

#[tokio::test]
async fn a_held_fault_under_format_json_writes_one_json_line_to_stderr_and_jsonl_the_same_bytes() {
    let line = format!(
        "{{\"error\":{{\"code\":\"invalid-input\",\"exitCode\":2,\"message\":\"Option \\\"--depth\\\": Use decimal digits.\",{USAGE_HINT}}}}}\n"
    );
    for selected in ["json", "jsonl"] {
        assert_eq!(
            run(&plain(), &["count", "--format", selected, "--depth", "x"]).await,
            ran(2, "", &line)
        );
    }
}

#[tokio::test]
async fn a_held_structural_fault_still_selects_the_formatters_view() {
    assert_eq!(
        run(&plain(), &["count", "--format", "json", "--bogus"]).await,
        ran(
            2,
            "",
            &format!(
                "{{\"error\":{{\"code\":\"unknown-option\",\"exitCode\":2,\"message\":\"Unknown option \\\"--bogus\\\". Supply a declared option; prefix a hyphenated path with \\\"./\\\".\",{USAGE_HINT}}}}}\n"
            )
        )
    );
}

#[tokio::test]
async fn an_action_failure_under_format_json_writes_the_fatal_line_with_c1_controls_escaped() {
    assert_eq!(
        run(&plain(), &["count", "--format", "json", "--fail", "yes"]).await,
        ran(
            1,
            "",
            "{\"error\":{\"code\":\"fatal\",\"exitCode\":1,\"message\":\"The count failed.\",\"hints\":[]}}\n"
        )
    );
    let preserve = Application::new("app")
        .plugins(vec![AnyPlugin::from(format())])
        .rendering(RenderingPolicy::new().terminal_controls(TerminalControls::Preserve))
        .command(count())
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    assert_eq!(
        run(
            &preserve,
            &["count", "--format", "json", "--fail", "controls"]
        )
        .await
        .stderr,
        "{\"error\":{\"code\":\"fatal\",\"exitCode\":1,\"message\":\"A \\u009b control and a \\\"quote\\\".\",\"hints\":[]}}\n"
    );
}

#[tokio::test]
async fn a_rejected_or_omitted_format_writes_the_text_diagnostic_because_the_default_view_declares_no_media_type()
 {
    assert_eq!(
        run(&plain(), &["count", "--format", "yaml"]).await,
        ran(
            2,
            "",
            "app: Option \"--format\": Supply one of table, json, jsonl.\nRun \"app count --help\" to see the usage.\n"
        )
    );
    assert_eq!(
        run(&plain(), &["count", "--depth", "x"]).await,
        ran(
            2,
            "",
            "app: Option \"--depth\": Use decimal digits.\nRun \"app count --help\" to see the usage.\n"
        )
    );
}

#[tokio::test]
async fn a_default_view_that_is_json_writes_the_json_line_with_no_format() {
    let application = Application::new("app")
        .plugins(vec![AnyPlugin::from(format())])
        .command(
            Command::new("count")
                .result(
                    ResultViews::<Value>::new()
                        .view("json", json::<Value>())
                        .view("table", table()),
                )
                .action(|_: Context<NoInputs, ValueResult<Value>>| async {
                    Err(FatalError::new("The count failed.").into())
                }),
        )
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    assert_eq!(
        run(&application, &["count"]).await,
        ran(
            1,
            "",
            "{\"error\":{\"code\":\"fatal\",\"exitCode\":1,\"message\":\"The count failed.\",\"hints\":[]}}\n"
        )
    );
}

#[tokio::test]
async fn a_failure_after_rows_under_the_whole_view_jsonl_writes_the_fatal_line_alone() {
    assert_eq!(
        run(&rows_app(), &["walk", "--format", "jsonl"]).await,
        ran(
            1,
            "",
            "{\"error\":{\"code\":\"fatal\",\"exitCode\":1,\"message\":\"The key \\\"b\\\" is refused.\",\"hints\":[]}}\n"
        )
    );
}

#[tokio::test]
async fn a_failure_after_rows_under_the_row_view_writes_the_rows_then_the_incomplete_result_line() {
    assert_eq!(
        run(&rows_app(), &["walk", "--format", "table"]).await,
        ran(
            1,
            "a\n",
            "Output is incomplete: Command \"walk\" stopped after 1 rows, 1 written.\nThe key \"b\" is refused.\n"
        )
    );
}

#[tokio::test]
async fn the_failure_line_escapes_del_and_the_c1_controls_in_every_field() {
    let application = Application::new("app")
        .plugins(vec![AnyPlugin::from(format())])
        .rendering(RenderingPolicy::new().terminal_controls(TerminalControls::Preserve))
        .command(
            Command::new("count")
                .result(ResultViews::<Value>::new().view("json", json::<Value>()))
                .action(|_: Context<NoInputs, ValueResult<Value>>| async {
                    Err(FatalError::new("a\u{7f}b\u{80}c\u{81}d").into())
                }),
        )
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    assert_eq!(
        run(&application, &["count"]).await.stderr,
        "{\"error\":{\"code\":\"fatal\",\"exitCode\":1,\"message\":\"a\\u007fb\\u0080c\\u0081d\",\"hints\":[]}}\n"
    );
}

/// A value that serializes with an error, as a value no JSON text can hold would.
#[derive(Clone)]
struct Unencodable;

impl serde::Serialize for Unencodable {
    fn serialize<S: serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
        Err(serde::ser::Error::custom("a secret engine reason"))
    }
}

/// A value that serializes to an integer beyond 64 bits, which a JSON value cannot hold.
#[derive(Clone)]
struct Wide;

impl serde::Serialize for Wide {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u128(u128::MAX)
    }
}

fn value_app<V: serde::Serialize + Clone + Send + Sync + 'static>(value: V) -> App {
    Application::new("app")
        .plugins(vec![AnyPlugin::from(format())])
        .command(
            Command::new("count")
                .result(
                    ResultViews::<V>::new()
                        .view("table", View::new(|_: &V, _| "table\n".to_owned())),
                )
                .action(move |ctx: Context<NoInputs, ValueResult<V>>| {
                    let value = value.clone();
                    async move { ctx.out.results(value).await }
                }),
        )
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await })
}

async fn run_in(build: Build, application: &App, argv: &[&str]) -> Ran {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    );
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

const ENCODE_SENTENCE: &str =
    "The value cannot be encoded as JSON. Emit plain JSON data from the action.";

#[tokio::test]
async fn a_value_the_hook_added_views_cannot_encode_is_the_fixed_sentence_in_both_builds() {
    for selected in ["json", "jsonl"] {
        for (name, application) in [
            ("engine", value_app(Unencodable)),
            ("wide", value_app(Wide)),
        ] {
            let dev = run_in(
                Build::Development,
                &application,
                &["count", "--format", selected],
            )
            .await;
            assert_eq!(dev.status, 1, "{name} {selected}");
            assert_eq!(dev.stdout, "", "{name} {selected}");
            assert!(
                dev.stderr.ends_with(&format!(
                    "{{\"error\":{{\"code\":\"internal\",\"exitCode\":1,\"message\":\"{ENCODE_SENTENCE}\",\"hints\":[]}}}}\n"
                )),
                "{name} {selected}: {}",
                dev.stderr
            );
            assert!(
                dev.stderr.contains(&format!("\n\n{ENCODE_SENTENCE}\n")),
                "{name} {selected}: {}",
                dev.stderr
            );
        }
    }
}

#[tokio::test]
async fn a_row_the_hook_added_views_cannot_encode_is_the_fixed_sentence() {
    let application = Application::new("app")
        .plugins(vec![AnyPlugin::from(format())])
        .command(
            Command::new("walk")
                .rows::<Unencodable>(RowViews::new().view(
                    "table",
                    RowView::new(|_: &Unencodable, _, _| "row\n".to_owned()),
                ))
                .action(
                    |ctx: Context<NoInputs, RowsResult<Unencodable>>| async move {
                        ctx.out.results(RowSource::from(vec![Unencodable])).await
                    },
                ),
        )
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    let dev = run_in(
        Build::Development,
        &application,
        &["walk", "--format", "jsonl"],
    )
    .await;
    assert_eq!(dev.status, 1);
    assert_eq!(dev.stdout, "");
    let line = dev.stderr.lines().last().unwrap();
    assert_eq!(
        line,
        format!(
            "{{\"error\":{{\"code\":\"internal\",\"exitCode\":1,\"message\":\"{ENCODE_SENTENCE}\",\"hints\":[]}}}}"
        )
    );
    assert!(
        dev.stderr.contains(&format!("\n\n{ENCODE_SENTENCE}\n")),
        "{}",
        dev.stderr
    );
}
