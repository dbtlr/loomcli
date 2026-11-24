//! The MCP plugin's tool calls, ported from the reference's `mcp.test.ts` (`a completed call`,
//! `a failed call`, `an initialize-era client`, `protocol errors`, `cancellation and
//! concurrency`, `excluded options`) with its `calls`, `columns`, `fitted`, and `excluded`
//! fixture applications.

#![cfg(feature = "mcp")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod mcp_support;

use loomcli_core::{
    Application, Arg, Command, Context, Done, EX_DATAERR, Error, Failure, FailureView, FatalError,
    NoInputs, NoResult, Opt, ResultViews, RowView, RowViews, RowsResult, ValueResult, View,
    ViewContext, failure, override_view,
};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, MCP_INPUT, McpCommandFacts, McpInputFacts};
use loomcli_plugins::mcp::mcp;
use mcp_support::{
    Launch, Observed, call, called, cancelled, handshake_request, initialize, launch, request,
    result_of, serve, tool_named, tools_of,
};
use serde::Serialize;
use serde_json::{Map, Value, json};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Done>;

/// A data failure the action raises, which declares its own failure code and exit code 65.
#[derive(Debug, Failure)]
#[failure(code = "missing", exit_code = EX_DATAERR)]
struct MissingError {
    #[failure(base)]
    base: FatalError,
}

fn missing(message: &str) -> Error {
    MissingError {
        base: FatalError::new(message),
    }
    .into()
}

/// A failure whose view the application overrides with one that renders nothing.
#[derive(Debug, Failure)]
#[failure(code = "silent")]
struct SilentError {
    #[failure(base)]
    base: FatalError,
}

fn opted() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::new())
}

#[derive(Clone, Serialize)]
struct Member {
    key: String,
}

/// Tools whose calls take each path a run can end on. `wait` reports when it starts and when its
/// call's signal aborts.
fn calls(observed: &Observed) -> App {
    let echo = Command::new("echo")
        .description("Echo the inputs.")
        .extend([opted()])
        .argument("word", Arg::string().description("A word.").required())
        .option("times", Opt::string().description("How many times."))
        .option("loud", Opt::boolean().description("Shout."))
        .action(|ctx: Context| async move {
            let mut printed = Map::new();
            let word: Option<String> = ctx.argument("word")?;
            printed.insert("args".into(), json!({ "word": word }));
            if let Some(file) = ctx.option::<Option<String>>("file")? {
                printed.insert("file".into(), json!(file));
            }
            printed.insert("loud".into(), json!(ctx.option::<bool>("loud")?));
            if let Some(times) = ctx.option::<Option<String>>("times")? {
                printed.insert("times".into(), json!(times));
            }
            ctx.out
                .print(&serde_json::to_string(&printed).unwrap())
                .await
        });
    let members = Command::new("members")
        .description("List the members.")
        .extend([opted()])
        .rows(
            RowViews::new()
                .view(
                    "lines",
                    RowView::new(|row: &Member, _, _| {
                        format!("{}\n", serde_json::to_string(row).unwrap())
                    })
                    .media_type("application/jsonl"),
                )
                .view(
                    "text",
                    RowView::new(|row: &Member, _, _| format!("{}\n", row.key)),
                )
                .view(
                    "wire",
                    View::new(|rows: &[Member], _: &ViewContext| {
                        let keys: Vec<&str> = rows.iter().map(|row| row.key.as_str()).collect();
                        format!("{}\n", serde_json::to_string_pretty(&keys).unwrap())
                    })
                    .media_type("application/json"),
                ),
        )
        .action(|ctx: Context<NoInputs, RowsResult<Member>>| async move {
            ctx.out
                .results(vec![Member { key: "a".into() }, Member { key: "b".into() }])
                .await
        });
    let lines = Command::new("lines")
        .description("List lines.")
        .extend([opted()])
        .result(
            ResultViews::new().view(
                "lines",
                View::new(|values: &Vec<u32>, _: &ViewContext| {
                    values
                        .iter()
                        .map(|value| format!("{value}\n"))
                        .collect::<String>()
                })
                .media_type("application/jsonl"),
            ),
        )
        .action(|ctx: Context<NoInputs, ValueResult<Vec<u32>>>| async move {
            ctx.out.results(vec![1, 2]).await
        });
    let lies = Command::new("lies")
        .description("Promise JSON and print text.")
        .extend([opted()])
        .result(
            ResultViews::new().view(
                "lies",
                View::new(|_: &u32, _: &ViewContext| "not json\n".to_owned())
                    .media_type("application/json"),
            ),
        )
        .action(|ctx: Context<NoInputs, ValueResult<u32>>| async move { ctx.out.results(1).await });
    let warned = Command::new("warned")
        .description("Print and warn.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            ctx.out.print("the value").await?;
            ctx.out.warn("a warning").await
        });
    let quiet = Command::new("quiet")
        .description("Print nothing.")
        .extend([opted()])
        .action(|_: Context| async { Ok(()) });
    let failing = Command::new("missing")
        .description("Fail with data.")
        .extend([opted()])
        .action(|_: Context| async { Err(missing("Nothing is at \"x\". Read another path.")) });
    let partial = Command::new("partial")
        .description("Print, then fail.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            ctx.out.print("half").await?;
            Err(missing("The rest is missing."))
        });
    let crash = Command::new("crash")
        .description("Throw a defect.")
        .extend([opted()])
        .action(|_: Context| async {
            Err(Error::from(std::io::Error::other("The fixture broke.")))
        });
    let silent = Command::new("silent")
        .description("Fail with no text.")
        .extend([opted()])
        .action(|_: Context| async {
            Err(SilentError {
                base: FatalError::new("Nothing to say."),
            }
            .into())
        });
    let observed = observed.clone();
    let wait = Command::new("wait")
        .description("Wait for the abort.")
        .extend([opted()])
        .argument(
            "label",
            Arg::string().description("The label to report.").required(),
        )
        .action(move |ctx: Context| {
            let observed = observed.clone();
            async move {
                let label: Option<String> = ctx.argument("label")?;
                let label = label.unwrap_or_default();
                observed.report(format!("started {label}"));
                ctx.signal.cancelled().await;
                observed.report(format!("aborted {label}"));
                Ok(())
            }
        });
    Application::new("calls")
        .plugins([mcp()])
        .version("2.0.0")
        .overrides([override_view(
            failure::<SilentError>(),
            FailureView::new(|_: &SilentError, _| String::new()),
        )])
        .global_option("file", Opt::string().description("The document."))
        .command(echo)
        .command(members)
        .command(lines)
        .command(lies)
        .command(warned)
        .command(quiet)
        .command(failing)
        .command(partial)
        .command(crash)
        .command(silent)
        .command(wait)
        .action(|_: Context| async { Ok(()) })
}

fn app() -> App {
    calls(&Observed::default())
}

/// The calls application's listing reads `listing` and `read` from the listing scenario; this one
/// declares hidden and control inputs of its own.
fn listing() -> App {
    let read = Command::new("read")
        .description("Read one value.")
        .extend([opted()])
        .argument("path", Arg::string().description("The path.").required())
        .option(
            "internal",
            Opt::boolean().description("An internal switch.").hidden(),
        )
        .option(
            "style",
            Opt::string().control().description("Choose how to print."),
        )
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    Application::new("kit")
        .plugins([mcp()])
        .version("1.2.3")
        .global_option(
            "trace",
            Opt::boolean().description("Trace the run.").hidden(),
        )
        .global_option(
            "mode",
            Opt::string().control().description("Choose a mode."),
        )
        .command(read)
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await })
}

#[tokio::test]
async fn runs_the_command_by_name_with_arguments_and_options_split_and_answers_its_output_as_text()
{
    let result = result_of(
        &app(),
        "echo",
        Some(json!({ "file": "doc.json", "loud": true, "times": 3, "word": "hi" })),
    )
    .await;
    assert_eq!(
        serde_json::to_string(&result).unwrap(),
        r#"{"content":[{"type":"text","text":"{\"args\":{\"word\":\"hi\"},\"file\":\"doc.json\",\"loud\":true,\"times\":\"3\"}\n"}],"isError":false}"#
    );
}

#[tokio::test]
async fn answers_the_first_application_json_view_as_text_and_as_structured_content() {
    assert_eq!(
        result_of(&app(), "members", None).await,
        json!({
            "content": [{ "type": "text", "text": "[\n  \"a\",\n  \"b\"\n]\n" }],
            "isError": false,
            "structuredContent": ["a", "b"],
        })
    );
}

#[tokio::test]
async fn a_jsonl_view_stays_text() {
    assert_eq!(
        result_of(&app(), "lines", None).await,
        json!({ "content": [{ "type": "text", "text": "1\n2\n" }], "isError": false })
    );
}

#[tokio::test]
async fn a_view_whose_application_json_text_does_not_parse_answers_the_text_alone() {
    assert_eq!(
        result_of(&app(), "lies", None).await,
        json!({ "content": [{ "type": "text", "text": "not json\n" }], "isError": false })
    );
}

#[tokio::test]
async fn answers_the_output_then_the_messages_as_two_text_items() {
    assert_eq!(
        result_of(&app(), "warned", None).await,
        json!({
            "content": [
                { "type": "text", "text": "the value\n" },
                { "type": "text", "text": "⚠ a warning\n" },
            ],
            "isError": false,
        })
    );
}

/// One tool that reports the columns its views read and warns at length, served from a process
/// whose environment holds a narrow COLUMNS. A tool call is an invocation by name, with no
/// terminal.
fn columns() -> App {
    Application::new("columns")
        .plugins([mcp()])
        .description("Report columns.")
        .command(
            Command::new("measure")
                .description("Report the columns.")
                .extend([opted()])
                .action(|ctx: Context| async move {
                    let view = View::new(|_: &(), context: &ViewContext| match context.columns {
                        None => "undefined\n".to_owned(),
                        Some(columns) => format!("{columns}\n"),
                    });
                    ctx.out.render(&(), &view).await?;
                    ctx.out
                        .warn("a warning long enough to wrap at twenty columns")
                        .await
                }),
        )
        .action(|_: Context| async { Ok(()) })
}

#[tokio::test]
async fn reads_no_columns_and_leaves_a_lane_unwrapped_with_columns_set() {
    let mut session = launch(
        &columns(),
        Launch {
            env: vec![("COLUMNS".into(), "20".into())],
            ..Launch::default()
        },
    );
    session.send(&call(1, "measure", None));
    let answer = session.next().await;
    session.close().await;
    assert_eq!(
        answer["result"]["content"],
        json!([
            { "type": "text", "text": "undefined\n" },
            { "type": "text", "text": "⚠ a warning long enough to wrap at twenty columns\n" },
        ])
    );
}

#[cfg(all(feature = "table", feature = "records"))]
#[tokio::test]
async fn answers_a_table_and_records_byte_for_byte_at_their_natural_width_with_columns_set() {
    use loomcli_plugins::records::{RecordsConfig, records};
    use loomcli_plugins::table::{Alignment, Column, TableConfig, table};
    #[derive(Clone, Serialize)]
    struct Pair {
        left: String,
        right: String,
    }
    #[derive(Clone, Serialize)]
    struct Record {
        key: String,
        kind: String,
    }
    let grid = Command::new("grid")
        .description("Render a table and records.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            let rows = vec![
                Pair {
                    left: "x y z".into(),
                    right: "hello world".into(),
                },
                Pair {
                    left: "q".into(),
                    right: "zz".into(),
                },
            ];
            let view = table(TableConfig::new().columns(vec![
                Column::new("left").header("A"),
                Column::new("right").align(Alignment::Right).format(
                    |value: &Value, _: &Pair, _: &ViewContext| {
                        format!("{}\nsecond line", value.as_str().unwrap())
                    },
                ),
            ]));
            ctx.out.render(&rows, &view).await?;
            let records_view = records(RecordsConfig::new("key"));
            ctx.out
                .render(
                    vec![Record {
                        key: "one".into(),
                        kind: "first\nsecond words here".into(),
                    }],
                    &records_view,
                )
                .await
        });
    let fitted = Application::new("fitted")
        .plugins([mcp()])
        .description("Render fitted views.")
        .command(grid)
        .action(|_: Context| async { Ok(()) });
    let mut session = launch(
        &fitted,
        Launch {
            env: vec![("COLUMNS".into(), "10".into())],
            ..Launch::default()
        },
    );
    session.send(&call(1, "grid", None));
    let answer = session.next().await;
    session.close().await;
    let text: String = answer["result"]["content"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["text"].as_str().unwrap())
        .collect();
    assert_eq!(
        text,
        [
            "A            right",
            "x y z  hello world",
            "second line",
            "q               zz",
            "second line",
            "key   one",
            "kind  first",
            "second words here",
            "",
            "1 record",
            "",
        ]
        .join("\n")
    );
}

#[tokio::test]
async fn a_run_that_writes_nothing_answers_one_empty_text_item() {
    assert_eq!(
        result_of(&app(), "quiet", None).await,
        json!({ "content": [{ "type": "text", "text": "" }], "isError": false })
    );
}

#[tokio::test]
async fn answers_the_failures_report_as_text_and_its_form_as_structured_content() {
    let result = result_of(&app(), "missing", None).await;
    assert_eq!(
        serde_json::to_string(&result).unwrap(),
        r#"{"content":[{"type":"text","text":"Nothing is at \"x\". Read another path.\n"}],"isError":true,"structuredContent":{"exitCode":65,"failure":{"code":"missing","exitCode":65,"message":"Nothing is at \"x\". Read another path.","hints":[]}}}"#
    );
}

#[tokio::test]
async fn answers_the_messages_then_any_partial_output() {
    assert_eq!(
        result_of(&app(), "partial", None).await["content"],
        json!([
            { "type": "text", "text": "The rest is missing.\n" },
            { "type": "text", "text": "half\n" },
        ])
    );
}

#[tokio::test]
async fn a_defect_reads_the_generic_defect_message_from_a_distributed_build() {
    assert_eq!(
        result_of(&app(), "crash", None).await,
        json!({
            "content": [{ "type": "text", "text": "calls: Something went wrong.\n" }],
            "isError": true,
            "structuredContent": {
                "exitCode": 1,
                "failure": { "code": "internal", "exitCode": 1, "hints": [], "message": "Something went wrong." },
            },
        })
    );
}

#[tokio::test]
async fn a_failure_whose_view_renders_nothing_answers_one_empty_text_item() {
    assert_eq!(
        result_of(&app(), "silent", None).await,
        json!({
            "content": [{ "type": "text", "text": "" }],
            "isError": true,
            "structuredContent": {
                "exitCode": 1,
                "failure": { "code": "silent", "exitCode": 1, "hints": [], "message": "Nothing to say." },
            },
        })
    );
}

#[tokio::test]
async fn a_missing_required_argument_reports_by_name_with_an_invalid_input_form() {
    assert_eq!(
        result_of(&app(), "echo", Some(json!({}))).await,
        json!({
            "content": [{
                "type": "text",
                "text": "calls: Argument \"word\" requires a value. Supply a value for \"word\".\n",
            }],
            "isError": true,
            "structuredContent": {
                "exitCode": 2,
                "failure": {
                    "code": "invalid-input",
                    "exitCode": 2,
                    "hints": [],
                    "message": "Argument \"word\" requires a value. Supply a value for \"word\".",
                },
            },
        })
    );
}

#[tokio::test]
async fn a_value_of_the_wrong_shape_reaches_invoke_which_reports_it_by_name() {
    let result = result_of(&app(), "echo", Some(json!({ "word": { "nested": true } }))).await;
    assert_eq!(
        result["content"],
        json!([{ "type": "text", "text": "calls: Argument \"word\": Use a string or a number.\n" }])
    );
    assert_eq!(result["isError"], true);
    assert_eq!(result["structuredContent"]["exitCode"], 2);
    assert_eq!(
        result["structuredContent"]["failure"]["code"],
        "invalid-input"
    );
}

#[tokio::test]
async fn a_key_outside_the_input_schema_is_a_tool_execution_error_and_no_run_starts() {
    assert_eq!(
        result_of(&app(), "echo", Some(json!({ "extra": 1, "word": "hi" }))).await,
        json!({
            "content": [{
                "type": "text",
                "text": "Tool \"echo\" takes no argument \"extra\". Use a property its input schema lists.",
            }],
            "isError": true,
        })
    );
}

#[tokio::test]
async fn a_hidden_or_control_options_name_is_outside_the_input_schema() {
    for key in ["internal", "style", "trace", "mode"] {
        let mut arguments = json!({ "path": "a" });
        arguments[key] = json!(true);
        assert_eq!(
            result_of(&listing(), "read", Some(arguments)).await,
            json!({
                "content": [{
                    "type": "text",
                    "text": format!("Tool \"read\" takes no argument \"{key}\". Use a property its input schema lists."),
                }],
                "isError": true,
            }),
            "{key}"
        );
    }
}

#[tokio::test]
async fn opens_with_initialize_then_lists_and_calls_tools_in_the_shape_of_2025_06_18() {
    let mut session = serve(&app());
    session.send(&initialize(0, "2025-06-18"));
    assert_eq!(
        session.next_line().await,
        r#"{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"calls","version":"2.0.0"}}}"#
    );
    session.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    session.send(&handshake_request(1, "tools/list", json!({})));
    let listing = session.next().await;
    let result = listing["result"].as_object().unwrap();
    assert_eq!(result.keys().collect::<Vec<_>>(), ["tools"]);
    assert!(tool_named(result["tools"].as_array().unwrap(), "members").is_some());
    session.send(&handshake_request(
        2,
        "tools/call",
        json!({ "name": "missing" }),
    ));
    let answer = session.next().await;
    assert_eq!(answer["result"]["isError"], true);
    assert_eq!(answer["result"]["structuredContent"]["exitCode"], 65);
    let ending = session.close().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
}

#[tokio::test]
async fn answers_a_json_view_that_prints_an_array_as_text_alone() {
    let mut session = serve(&app());
    session.send(&initialize(0, "2025-11-25"));
    session.next().await;
    session.send(&handshake_request(
        1,
        "tools/call",
        json!({ "name": "members" }),
    ));
    assert_eq!(
        session.next_line().await,
        r#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"[\n  \"a\",\n  \"b\"\n]\n"}],"isError":false}}"#
    );
    session.close().await;
}

#[tokio::test]
async fn an_unknown_tool_is_invalid_params() {
    let answer = called(&app(), "ehco", None).await;
    assert_eq!(
        answer["error"],
        json!({ "code": -32602, "message": "Unknown tool \"ehco\". Call tools/list for the tool names." })
    );
}

#[tokio::test]
async fn arguments_that_are_not_an_object_are_invalid_params() {
    for arguments in [json!(["hi"]), json!("hi"), Value::Null] {
        let answer = called(&app(), "echo", Some(arguments.clone())).await;
        assert_eq!(
            answer["error"],
            json!({
                "code": -32602,
                "message": "Tool \"echo\" arguments must be an object. Supply a JSON object of named inputs.",
            }),
            "{arguments}"
        );
    }
}

#[tokio::test]
async fn a_cursor_is_invalid_params() {
    let mut session = serve(&app());
    session.send(&request(1, "tools/list", json!({ "cursor": "next" })));
    let answer = session.next().await;
    session.close().await;
    assert_eq!(
        answer["error"],
        json!({
            "code": -32602,
            "message": "The cursor is not one this server issued. Call tools/list without a cursor.",
        })
    );
}

#[tokio::test]
async fn notifications_cancelled_aborts_a_call_which_answers_nothing_while_a_second_call_answers() {
    let observed = Observed::default();
    let mut session = serve(&calls(&observed));
    session.send(&call(1, "wait", Some(json!({ "label": "one" }))));
    observed.wait_for("started one").await;
    session.send(&cancelled(1));
    observed.wait_for("aborted one").await;
    session.send(&call(2, "echo", Some(json!({ "word": "two" }))));
    assert_eq!(session.next().await["id"], 2);
    let ending = session.close().await;
    assert_eq!(ending.messages, Vec::<Value>::new());
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
    assert_eq!(observed.lines(), ["started one", "aborted one"]);
}

#[tokio::test]
async fn two_overlapping_calls_answer_by_their_own_ids() {
    let mut session = serve(&app());
    session.send(&call("a", "echo", Some(json!({ "word": "one" }))));
    session.send(&call("b", "echo", Some(json!({ "word": "two" }))));
    let answers = [session.next().await, session.next().await];
    session.close().await;
    let content_of = |id: &str| {
        answers
            .iter()
            .find(|answer| answer["id"] == id)
            .map(|answer| answer["result"]["content"].clone())
            .unwrap()
    };
    assert_eq!(
        content_of("a"),
        json!([{ "type": "text", "text": "{\"args\":{\"word\":\"one\"},\"loud\":false}\n" }])
    );
    assert_eq!(
        content_of("b"),
        json!([{ "type": "text", "text": "{\"args\":{\"word\":\"two\"},\"loud\":false}\n" }])
    );
}

#[tokio::test]
async fn closing_stdin_aborts_every_call_in_flight_answers_none_of_them_and_exits_0() {
    let observed = Observed::default();
    let session = serve(&calls(&observed));
    session.send(&call(1, "wait", Some(json!({ "label": "one" }))));
    observed.wait_for("started one").await;
    let ending = session.close().await;
    assert_eq!(ending.messages, Vec::<Value>::new());
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
    assert_eq!(observed.lines(), ["started one", "aborted one"]);
}

#[tokio::test]
async fn a_run_cancelled_through_its_callers_signal_aborts_every_call_in_flight_and_resolves_130() {
    let observed = Observed::default();
    let caller = CancellationToken::new();
    let session = launch(
        &calls(&observed),
        Launch {
            signal: Some(caller.clone()),
            ..Launch::default()
        },
    );
    session.send(&call(1, "wait", Some(json!({ "label": "one" }))));
    session.send(&call(2, "wait", Some(json!({ "label": "two" }))));
    observed.wait_for("started one").await;
    observed.wait_for("started two").await;
    caller.cancel();
    let ending = session.finish().await;
    assert_eq!(ending.messages, Vec::<Value>::new());
    assert_eq!(ending.status, 130);
    let mut lines = observed.lines();
    lines.sort();
    assert_eq!(
        lines,
        ["aborted one", "aborted two", "started one", "started two"]
    );
}

#[tokio::test]
async fn a_client_that_stops_reading_leaves_the_server_to_exit_0_with_nothing_on_stderr() {
    let session = serve(&app());
    session.send(&request(1, "tools/list", json!({})));
    let ending = session.hang_up().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
}

/// One tool with a local and a global option the author excluded, both bound to a variable and
/// declaring a default, and a group of two options that carry only an `MCP_INPUT` description.
fn excluded() -> App {
    let show = Command::new("show")
        .description("Show the values the action read.")
        .extend([opted()])
        .option(
            "secret",
            Opt::string()
                .default("default-secret")
                .description("A local option the tool leaves out.")
                .env(["FIXTURE_SECRET"])
                .extend([MCP_INPUT.value(McpInputFacts::excluded())]),
        )
        .option(
            "plain",
            Opt::string().description("An option the tool lists."),
        )
        .option(
            "left",
            Opt::string()
                .description("The left choice.")
                .extend([MCP_INPUT.value(McpInputFacts::described("Choose left."))]),
        )
        .option(
            "right",
            Opt::string()
                .description("The right choice.")
                .extend([MCP_INPUT.value(McpInputFacts::described("Choose right."))]),
        )
        .one_required(&["left", "right"])
        .action(|ctx: Context| async move {
            let mut printed = Map::new();
            for name in ["secret", "plain", "left", "right", "region"] {
                if let Some(value) = ctx.option::<Option<String>>(name)? {
                    printed.insert(name.into(), json!(value));
                }
            }
            ctx.out
                .print(&serde_json::to_string(&printed).unwrap())
                .await
        });
    excluded_application(show)
}

#[cfg(not(all(feature = "help", feature = "manifest")))]
fn excluded_application(show: loomcli_core::Command<NoInputs, NoResult, Done>) -> App {
    Application::new("excl")
        .plugins([mcp()])
        .description("Exclude options.")
        .version("1.0.0")
        .global_option(
            "region",
            Opt::string()
                .default("default-region")
                .description("A global option the tool leaves out.")
                .env(["FIXTURE_REGION"])
                .extend([MCP_INPUT.value(McpInputFacts::excluded())]),
        )
        .command(show)
        .action(|_: Context| async { Ok(()) })
}

/// With help and the manifest installed, which still show the excluded options.
#[cfg(all(feature = "help", feature = "manifest"))]
fn excluded_application(show: loomcli_core::Command<NoInputs, NoResult, Done>) -> App {
    use loomcli_plugins::help::help;
    use loomcli_plugins::manifest::manifest;
    Application::new("excl")
        .plugins((help(), manifest(), mcp()))
        .description("Exclude options.")
        .version("1.0.0")
        .global_option(
            "region",
            Opt::string()
                .default("default-region")
                .description("A global option the tool leaves out.")
                .env(["FIXTURE_REGION"])
                .extend([MCP_INPUT.value(McpInputFacts::excluded())]),
        )
        .command(show)
        .action(|_: Context| async { Ok(()) })
}

/// One call of the excluded scenario's tool on a server whose environment binds both excluded
/// options.
async fn shown(arguments: Value) -> Value {
    let mut session = launch(
        &excluded(),
        Launch {
            env: vec![
                ("FIXTURE_REGION".into(), "from-env".into()),
                ("FIXTURE_SECRET".into(), "from-env".into()),
            ],
            ..Launch::default()
        },
    );
    session.send(&call(1, "show", Some(arguments)));
    let answer = session.next().await;
    session.close().await;
    answer
}

#[tokio::test]
async fn an_excluded_local_option_and_an_excluded_global_option_leave_properties_and_required() {
    let tools = tools_of(&excluded()).await;
    let tool = tool_named(&tools, "show").unwrap();
    let keys: Vec<&String> = tool["inputSchema"]["properties"]
        .as_object()
        .unwrap()
        .keys()
        .collect();
    assert_eq!(keys, ["plain", "left", "right"]);
    assert!(tool["inputSchema"].get("required").is_none());
}

#[tokio::test]
async fn an_option_that_carries_only_an_mcp_input_description_keeps_its_group_constraints() {
    let tools = tools_of(&excluded()).await;
    let tool = tool_named(&tools, "show").unwrap();
    assert_eq!(
        tool["inputSchema"]["allOf"],
        json!([{ "anyOf": [{ "required": ["left"] }, { "required": ["right"] }] }])
    );
}

#[cfg(all(feature = "help", feature = "manifest"))]
#[tokio::test]
async fn help_and_the_manifest_still_show_the_excluded_options() {
    use loomcli_core::{ProcessHandle, RunOptions};
    use loomcli_testing::{MockFields, mock_process};
    use std::sync::Arc;
    for (argv, needles) in [
        (vec!["show", "--help"], vec!["--secret"]),
        (vec!["--manifest"], vec!["\"secret\"", "\"region\""]),
    ] {
        let process = mock_process(MockFields::new().argv(argv.clone()));
        let code = excluded()
            .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
            .await;
        assert_eq!((code.get(), process.stderr_text()), (0, String::new()));
        for needle in needles {
            assert!(process.stdout_text().contains(needle), "{argv:?} {needle}");
        }
    }
}

#[tokio::test]
async fn a_call_naming_an_excluded_option_is_the_takes_no_argument_error() {
    for key in ["secret", "region"] {
        let mut arguments = json!({ "left": "a" });
        arguments[key] = json!("x");
        let answer = shown(arguments).await;
        assert_eq!(
            answer["result"]["content"],
            json!([{
                "type": "text",
                "text": format!("Tool \"show\" takes no argument \"{key}\". Use a property its input schema lists."),
            }]),
            "{key}"
        );
        assert_eq!(answer["result"]["isError"], true);
    }
}

#[tokio::test]
async fn a_call_reads_the_declared_default_although_the_server_environment_binds_the_option() {
    let answer = shown(json!({ "left": "a" })).await;
    let text = answer["result"]["content"][0]["text"].as_str().unwrap();
    let printed: Value = serde_json::from_str(text).unwrap();
    assert_eq!(printed["left"], "a");
    assert_eq!(printed["region"], "default-region");
    assert_eq!(printed["secret"], "default-secret");
}
