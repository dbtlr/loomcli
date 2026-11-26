//! The formatter's field selection through argv, invocation by name, and graph projections.

#![cfg(all(feature = "format", feature = "help"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod format_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use loomcli_core::{
    AnyPlugin, Application, Command, Context, Group, InputError, InputKind, InputProblem,
    InvocationOutcome, InvocationValues, InvokeOptions, NoInputs, NoResult, Opt, ResultViews,
    RowViews, RowsResult, ValueResult, View,
};
use loomcli_plugins::{
    format::{format, json as json_view, json_mapped, jsonl},
    help::help,
};
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};

use format_support::{failure_line, ran, run};

type App = Application<NoInputs, NoResult, Group>;
const BOTH: &str = "Option \"--fields\" applies only to the json and jsonl output the formatter provides. Remove the option, or select json or jsonl with \"--format\".";
const NONE: &str = "Option \"--fields\" applies only to output the formatter provides, and the formatter provides none here. Remove the option.";
const UNKNOWN: &str = "Option \"--fields\" names \"color\", which the output does not hold. Supply fields from name, owner, size.";

fn text() -> ResultViews<Value> {
    ResultViews::new().view("text", View::new(|_: &Value, _| "text\n".to_owned()))
}

fn first() -> Value {
    json!({"name":"a","owner":"x","size":1})
}

fn second() -> Value {
    json!({"name":"b","size":2})
}

fn value(name: &str, data: Value) -> Command<NoInputs, ValueResult<Value>> {
    Command::new(name)
        .result(text())
        .action(move |ctx: Context<NoInputs, ValueResult<Value>>| {
            let data = data.clone();
            async move { ctx.out.results(data).await }
        })
}

fn rows(name: &str, data: Vec<Value>) -> Command<NoInputs, RowsResult<Value>> {
    Command::new(name)
        .rows(RowViews::new().view("text", View::new(|_: &[Value], _| "text\n".to_owned())))
        .action(move |ctx: Context<NoInputs, RowsResult<Value>>| {
            let data = data.clone();
            async move { ctx.out.results(data).await }
        })
}

fn app(plugins: Vec<AnyPlugin>) -> App {
    Application::new("app")
        .plugins(plugins)
        .command(value("get", first()))
        .command(value("ls", json!([first(), second()])))
        .command(value("empty", json!({})))
        .command(value("empty-array", json!([])))
        .command(value("scalar", json!("a")))
        .command(value("integer-keys", json!({"200":1,"404":2,"name":"a"})))
        .command(rows("list", vec![first(), second()]))
        .command(rows("mixed", vec![first(), json!(2)]))
        .command(rows("late-key", vec![second(), first()]))
        .command(Command::new("cache").command(value("clear", first())))
}

fn default_app() -> App {
    app(vec![help().into(), format().into()])
}

fn failure(command: &str, sentence: &str) -> String {
    failure_line(
        "invalid-input",
        2,
        sentence,
        &[&format!("Run \"app {command} --help\" to see the usage.")],
    )
}

fn refusal(command: &str) -> String {
    format!("app: {BOTH}\nRun \"app {command} --help\" to see the usage.\n")
}

#[tokio::test]
async fn json_keeps_value_fields_in_request_order() {
    assert_eq!(
        run(
            &default_app(),
            &["get", "--format", "json", "--fields", "size,name"]
        )
        .await,
        ran(0, "{\n  \"size\": 1,\n  \"name\": \"a\"\n}\n", "")
    );
}

#[tokio::test]
async fn field_selection_keeps_each_array_elements_present_keys() {
    let app = default_app();
    assert_eq!(
        run(&app, &["ls", "--format", "jsonl", "--fields", "owner,name"]).await,
        ran(
            0,
            "{\"owner\":\"x\",\"name\":\"a\"}\n{\"name\":\"b\"}\n",
            ""
        )
    );
    assert_eq!(
        run(&app, &["ls", "--format", "json", "--fields", "name"]).await,
        ran(
            0,
            "[\n  {\n    \"name\": \"a\"\n  },\n  {\n    \"name\": \"b\"\n  }\n]\n",
            ""
        )
    );
    assert_eq!(
        run(
            &app,
            &["empty-array", "--format", "json", "--fields", "name"]
        )
        .await,
        ran(0, "[]\n", "")
    );
}

#[tokio::test]
async fn field_selection_keeps_each_rows_present_keys_in_streaming_and_whole_views() {
    let app = default_app();
    assert_eq!(
        run(
            &app,
            &["list", "--format", "jsonl", "--fields", "owner,name"]
        )
        .await,
        ran(
            0,
            "{\"owner\":\"x\",\"name\":\"a\"}\n{\"name\":\"b\"}\n",
            ""
        )
    );
    assert_eq!(
        run(&app, &["list", "--format", "json", "--fields", "size"]).await,
        ran(
            0,
            "[\n  {\n    \"size\": 1\n  },\n  {\n    \"size\": 2\n  }\n]\n",
            ""
        )
    );
}

#[tokio::test]
async fn repeated_fields_options_keep_each_key_once() {
    assert_eq!(
        run(
            &default_app(),
            &[
                "get",
                "--format",
                "jsonl",
                "--fields",
                "name",
                "--fields",
                "size,name"
            ]
        )
        .await,
        ran(0, "{\"name\":\"a\",\"size\":1}\n", "")
    );
}

#[tokio::test]
async fn an_unknown_field_reports_the_value_keys() {
    assert_eq!(
        run(
            &default_app(),
            &["get", "--format", "json", "--fields", "name,color"]
        )
        .await,
        ran(2, "", &failure("get", UNKNOWN))
    );
}

#[tokio::test]
async fn array_field_validation_uses_every_elements_keys() {
    let app = default_app();
    assert_eq!(
        run(&app, &["ls", "--format", "jsonl", "--fields", "color"]).await,
        ran(2, "", &failure("ls", UNKNOWN))
    );
    assert_eq!(
        run(&app, &["ls", "--format", "jsonl", "--fields", "owner"]).await,
        ran(0, "{\"owner\":\"x\"}\n{}\n", "")
    );
}

#[tokio::test]
async fn stream_field_validation_uses_only_the_first_row() {
    let app = default_app();
    assert_eq!(
        run(&app, &["list", "--format", "jsonl", "--fields", "color"]).await,
        ran(2, "", &failure("list", UNKNOWN))
    );
    assert_eq!(
        run(
            &app,
            &["late-key", "--format", "jsonl", "--fields", "owner"]
        )
        .await,
        ran(
            2,
            "",
            &failure(
                "late-key",
                "Option \"--fields\" names \"owner\", which the output does not hold. Supply fields from name, size."
            )
        )
    );
}

#[tokio::test]
async fn an_empty_object_reports_that_the_output_holds_no_fields() {
    assert_eq!(
        run(
            &default_app(),
            &["empty", "--format", "json", "--fields", "name"]
        )
        .await,
        ran(
            2,
            "",
            &failure(
                "empty",
                "Option \"--fields\" names \"name\", but the output holds no fields. Remove the option."
            )
        )
    );
}

#[tokio::test]
async fn a_scalar_value_reports_its_kind() {
    assert_eq!(
        run(
            &default_app(),
            &["scalar", "--format", "json", "--fields", "name"]
        )
        .await,
        ran(
            2,
            "",
            &failure(
                "scalar",
                "Option \"--fields\" selects fields of objects, but the output holds a string. Remove the option."
            )
        )
    );
}

#[tokio::test]
async fn a_non_object_row_leaves_the_previous_json_line_on_stdout() {
    assert_eq!(
        run(
            &default_app(),
            &["mixed", "--format", "jsonl", "--fields", "name"]
        )
        .await,
        ran(
            2,
            "{\"name\":\"a\"}\n",
            &failure(
                "mixed",
                "Option \"--fields\" selects fields of objects, but the output holds a number. Remove the option."
            )
        )
    );
}

#[tokio::test]
async fn a_text_view_refuses_fields_for_value_and_rows_results() {
    let app = default_app();
    for command in ["get", "list"] {
        assert_eq!(
            run(&app, &[command, "--fields", "name"]).await,
            ran(2, "", &refusal(command))
        );
    }
}

#[tokio::test]
async fn refusal_precedes_help_installed_after_the_formatter() {
    let app = app(vec![format().into(), help().into()]);
    assert_eq!(
        run(&app, &["get", "--fields", "name", "--help"]).await,
        ran(2, "", &refusal("get"))
    );
}

#[tokio::test]
async fn invocation_by_name_uses_declared_option_names_and_reports_the_problem() {
    let app = default_app();
    let process = mock_process(MockFields::new());
    let invocation = |values| {
        app.invoke(
            &["get"],
            values,
            InvokeOptions::new(),
            Some(Arc::clone(&process) as _),
        )
    };
    let refused = invocation(InvocationValues::new().option("fields", json!(["name"]))).await;
    let InvocationOutcome::Failed {
        exit_code,
        messages,
        ..
    } = refused
    else {
        panic!("expected refusal");
    };
    assert_eq!(exit_code.get(), 2);
    assert_eq!(
        messages,
        "app: Option \"fields\" applies only to the json and jsonl output the formatter provides. Remove the option, or select json or jsonl with \"format\".\n"
    );
    let invalid = invocation(
        InvocationValues::new()
            .option("fields", json!(["color"]))
            .option("format", "json"),
    )
    .await;
    let InvocationOutcome::Failed {
        exit_code,
        messages,
        failure,
        ..
    } = invalid
    else {
        panic!("expected input failure");
    };
    assert_eq!(exit_code.get(), 2);
    assert_eq!(
        messages,
        "app: Option \"fields\" names \"color\", which the output does not hold. Supply fields from name, owner, size.\n"
    );
    let input = failure.downcast_failure::<InputError>().unwrap();
    assert!(
        matches!(input.problems(), [InputProblem::Invalid { input, spelling, .. }]
        if input.kind == InputKind::Option && input.name == "fields" && spelling == "fields")
    );
}

#[tokio::test]
async fn an_empty_field_name_fails_input_validation() {
    assert_eq!(
        run(
            &default_app(),
            &["get", "--format", "json", "--fields", "name,"]
        )
        .await,
        ran(
            2,
            "",
            &failure(
                "get",
                "Option \"--fields\" at 0: Supply field names separated by commas, such as name,size."
            )
        )
    );
}

#[tokio::test]
async fn no_fields_option_leaves_the_output_bytes_unchanged() {
    assert_eq!(
        run(&default_app(), &["get", "--format", "jsonl"]).await,
        ran(0, "{\"name\":\"a\",\"owner\":\"x\",\"size\":1}\n", "")
    );
}

#[tokio::test]
async fn fields_appears_in_help_and_the_graph_as_a_control_option() {
    let app = default_app();
    let page = run(&app, &["get", "--help"]).await;
    assert_eq!((page.status, page.stderr.as_str()), (0, ""));
    assert!(page.stdout.contains(
        "--fields <fields>  Select top-level fields of json and jsonl output, as a comma list."
    ));
    let tree = app.inspect().unwrap();
    let node = tree.command(&["get"]).unwrap();
    let fields = node
        .options
        .iter()
        .find(|option| option.name() == "fields")
        .unwrap();
    let fields = serde_json::to_value(fields).unwrap();
    assert_eq!(
        (fields["control"].as_bool(), fields["hidden"].as_bool()),
        (Some(true), Some(false))
    );
}

#[tokio::test]
async fn a_group_hides_fields_and_keeps_the_missing_subcommand_failure() {
    let app = default_app();
    let tree = app.inspect().unwrap();
    let node = tree.command(&["cache"]).unwrap();
    let fields = node
        .options
        .iter()
        .find(|option| option.name() == "fields")
        .unwrap();
    let fields = serde_json::to_value(fields).unwrap();
    assert_eq!(
        (fields["control"].as_bool(), fields["hidden"].as_bool()),
        (Some(true), Some(true))
    );
    assert_eq!(
        run(&app, &["cache", "--fields", "name"]).await,
        run(&app, &["cache"]).await
    );
    assert_eq!(
        run(
            &app,
            &["cache", "clear", "--format", "jsonl", "--fields", "name"]
        )
        .await,
        ran(0, "{\"name\":\"a\"}\n", "")
    );
}

#[test]
fn a_local_fields_option_collides_with_the_formatters_option() {
    let app = Application::new("app").plugins([format()]).command(
        Command::new("count")
            .option("fields", Opt::string())
            .result(text())
            .action(|ctx: Context<NoInputs, ValueResult<Value>>| async move {
                ctx.out.results(first()).await
            }),
    );
    let error = app.inspect().unwrap_err();
    assert_eq!(
        error.rule().unwrap().identity(),
        "@loomcli/core/option-declared-twice"
    );
    assert_eq!(
        error.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"fields\" on Command \"count\", which is already declared as a local option."
    );
}

#[tokio::test]
async fn author_views_are_refused_before_the_action_or_mapping_runs() {
    for (kind, available) in [
        ("mapped", "jsonl"),
        ("unmapped", "jsonl"),
        ("jsonl", "json"),
    ] {
        let mapped = Arc::new(AtomicBool::new(false));
        let acted = Arc::new(AtomicBool::new(false));
        let mapper = Arc::clone(&mapped);
        let action = Arc::clone(&acted);
        let (provided, views) = match kind {
            "mapped" => (
                "json",
                text().view(
                    "json",
                    json_mapped(move |_: &Value| {
                        mapper.store(true, Ordering::SeqCst);
                        json!({"title":"A"})
                    }),
                ),
            ),
            "unmapped" => ("json", text().view("json", json_view())),
            _ => ("jsonl", text().view("jsonl", jsonl())),
        };
        let app = Application::new("app").plugins([format()]).command(
            Command::new("get").result(views).action(
                move |ctx: Context<NoInputs, ValueResult<Value>>| {
                    action.store(true, Ordering::SeqCst);
                    async move { ctx.out.results(first()).await }
                },
            ),
        );
        let refusal = format!(
            "Option \"--fields\" applies only to the {available} output the formatter provides. Remove the option, or select {available} with \"--format\"."
        );
        assert_eq!(
            run(&app, &["get", "--format", provided, "--fields", "name"]).await,
            ran(2, "", &failure_line("invalid-input", 2, &refusal, &[]))
        );
        assert!(!acted.load(Ordering::SeqCst));
        assert!(!mapped.load(Ordering::SeqCst));
        let stdout = if available == "json" {
            "{\n  \"name\": \"a\"\n}\n"
        } else {
            "{\"name\":\"a\"}\n"
        };
        assert_eq!(
            run(&app, &["get", "--format", available, "--fields", "name"]).await,
            ran(0, stdout, "")
        );
    }
}

#[tokio::test]
async fn both_author_views_leave_only_the_remove_option_refusal() {
    let app = Application::new("app").plugins([format()]).command(
        Command::new("get")
            .result(text().view("json", json_view()).view("jsonl", jsonl()))
            .action(|ctx: Context<NoInputs, ValueResult<Value>>| async move {
                ctx.out.results(first()).await
            }),
    );
    for selected in ["json", "jsonl"] {
        assert_eq!(
            run(&app, &["get", "--format", selected, "--fields", "name"]).await,
            ran(2, "", &failure_line("invalid-input", 2, NONE, &[]))
        );
    }
}

#[tokio::test]
async fn a_held_input_failure_outranks_a_fields_refusal() {
    let app = Application::new("app").plugins([format()]).command(
        Command::new("get")
            .option("file", Opt::string().required())
            .result(text())
            .action(|ctx: Context<NoInputs, ValueResult<Value>>| async move {
                ctx.out.results(first()).await
            }),
    );
    assert_eq!(
        run(&app, &["get", "--fields", "name"]).await,
        ran(
            2,
            "",
            "app: Option \"--file\" is required. Supply a value.\n"
        )
    );
}

#[tokio::test]
async fn integer_like_keys_keep_request_order() {
    assert_eq!(
        run(
            &default_app(),
            &[
                "integer-keys",
                "--format",
                "jsonl",
                "--fields",
                "404,name,200"
            ]
        )
        .await,
        ran(0, "{\"404\":2,\"name\":\"a\",\"200\":1}\n", "")
    );
}

#[cfg(feature = "manifest")]
#[tokio::test]
async fn the_manifest_publishes_both_formatter_control_options() {
    let app = app(vec![
        format().into(),
        loomcli_plugins::manifest::manifest().into(),
    ]);
    let result = run(&app, &["get", "--manifest"]).await;
    assert_eq!((result.status, result.stderr.as_str()), (0, ""));
    let document: Value = serde_json::from_str(&result.stdout).unwrap();
    let command = &document["command"];
    assert_eq!(
        command["result"],
        json!({
            "default":"text", "kind":"value",
            "mediaTypes":{"text":null,"json":"application/json","jsonl":"application/jsonl"},
            "views":["text","json","jsonl"]
        })
    );
    let options = command["options"].as_array().unwrap();
    assert_eq!(options.len(), 2);
    assert_eq!(options[0]["name"], json!("format"));
    assert_eq!(options[0]["control"], json!(true));
    assert_eq!(
        options[0]["schema"]["enum"],
        json!(["text", "json", "jsonl"])
    );
    assert_eq!(
        options[1],
        json!({
            "background": false, "control": true, "default": null,
            "deprecated": null, "description": "Select top-level fields of json and jsonl output, as a comma list.",
            "env": [], "envAllowEmpty": false, "envDelimiter": null, "implied": null,
            "long": "--fields", "multiple": true, "name": "fields", "required": false,
            "arity": null, "lastWins": false,
            "requiredWhen": null, "schema": {"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"},
            "short": null, "type": "string"
        })
    );
}
