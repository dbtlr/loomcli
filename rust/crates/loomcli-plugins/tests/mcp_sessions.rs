//! The MCP sessions of the conformance corpus (`conformance/cases/jsonkit-mcp.json`), replayed on a
//! small application with jsonkit's tool declarations: each case's exact stdin lines, sent one at
//! a time as the corpus harness sends them, answer its exact stdout lines.
//!
//! The corpus captured the reference's jsonkit example, which installs a dozen plugins; this
//! application declares the same tools, the global options a tool leaves out (a control option, a
//! hidden one, and two excluded ones), and the `get` action's reads, so a session that lists or
//! calls tools answers the reference's bytes.

#![cfg(feature = "mcp")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod mcp_support;

use std::path::PathBuf;

use loomcli_core::{
    Application, Arg, Command, Content, ContentOpt, Context, Done, EX_DATAERR, Error, Failure,
    FatalError, NoInputs, NoResult, Opt,
};
use loomcli_plugins::mcp::extension::{
    MCP_COMMAND, MCP_INPUT, McpAnnotations, McpCommandFacts, McpInputFacts,
};
use loomcli_plugins::mcp::mcp;
use loomcli_validators::text;
use mcp_support::{Launch, launch};
use serde_json::Value;

type App = Application<NoInputs, NoResult, Done>;

#[derive(Debug, Failure)]
#[failure(code = "path-not-found", exit_code = EX_DATAERR)]
struct PathNotFoundError {
    #[failure(base)]
    base: FatalError,
}

fn read_only() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::annotations(
        McpAnnotations::new().open_world(false).read_only(true),
    ))
}

fn document() -> ContentOpt {
    Opt::content()
        .description("The document to read. Omit it to read piped text.")
        .short('f')
        .required()
        .stdin()
}

/// The value at a dot path of the document, or the path-not-found failure.
async fn value_at(context: &Context, path: &str) -> Result<Value, Error> {
    let file: Option<Content> = context.option("file")?;
    let text = file.unwrap().text().await?;
    let mut value: Value = serde_json::from_str(&text).unwrap();
    for key in path.split('.').filter(|key| !key.is_empty()) {
        value = match value.get(key) {
            Some(inner) => inner.clone(),
            None => {
                return Err(PathNotFoundError {
                    base: FatalError::new(format!(
                        "Path not found: \"{path}\". Run jsonkit keys to list the keys at the root."
                    )),
                }
                .into());
            }
        };
    }
    Ok(value)
}

/// jsonkit's tools, with `get` reading the document and the rest printing nothing.
fn jsonkit() -> App {
    let get = Command::new("get")
        .description("Read one value at a path.")
        .extend([read_only()])
        .option("file", document())
        .argument(
            "path",
            Arg::string().description("Dot path to read.").required(),
        )
        .action(|ctx: Context| async move {
            let path: Option<String> = ctx.argument("path")?;
            let value = value_at(&ctx, &path.unwrap_or_default()).await?;
            ctx.out
                .print(&serde_json::to_string_pretty(&value).unwrap())
                .await
        });
    let keys = Command::new("keys")
        .description("List the keys at a path.")
        .alias("ls")
        .extend([read_only()])
        .argument(
            "path",
            Arg::string().description("Dot path to list. Omit it for the root."),
        )
        .option("file", document())
        .action(|ctx: Context| async move {
            let path: Option<String> = ctx.argument("path")?;
            let value = match path {
                Some(path) => value_at(&ctx, &path).await?,
                None => value_at(&ctx, "").await?,
            };
            let keys: String = value
                .as_object()
                .map(|object| object.keys().map(|key| format!("{key}\n")).collect())
                .unwrap_or_default();
            ctx.out
                .render(
                    &keys,
                    &loomcli_core::View::new(|text: &String, _| text.clone()),
                )
                .await
        });
    let select = Command::new("select")
        .description("Keep the named fields of the document.")
        .extend([read_only()])
        .option("file", document())
        .option(
            "field",
            Opt::string()
                .description("A field to keep. Repeat it for several.")
                .short('F')
                .validate(text())
                .multiple()
                .required(),
        )
        .action(|_: Context| async { Ok(()) });
    let max = Command::new("max")
        .description("Print the deepest nesting level under a path.")
        .extend([read_only()])
        .argument(
            "path",
            Arg::string().description("Dot path to measure. Omit it for the root."),
        )
        .option("file", document())
        .action(|_: Context| async { Ok(()) });
    let stats = Command::new("stats")
        .description("Measure the document.")
        .command(
            Command::new("depth")
                .description("Measure depth.")
                .command(max),
        );
    let debug = Command::new("debug")
        .description("Print the parsed document.")
        .hidden()
        .option("file", document())
        .action(|_: Context| async { Ok(()) });
    let fetch = Command::new("fetch")
        .description("Read one value at a path.")
        .deprecated("Use get instead.")
        .argument(
            "path",
            Arg::string().description("Dot path to read.").required(),
        )
        .option("file", document())
        .action(|_: Context| async { Ok(()) });
    Application::new("jsonkit")
        .plugins([mcp()])
        .description("Read and reshape one JSON document.")
        .version("0.0.0")
        .extend([read_only()])
        .global_option("help", Opt::boolean().control().description("Show help."))
        .global_option(
            "manifest",
            Opt::boolean().hidden().description("Print the manifest."),
        )
        .global_option(
            "verbose",
            Opt::count()
                .description("Say more.")
                .extend([MCP_INPUT.value(McpInputFacts::excluded())]),
        )
        .global_option(
            "format",
            Opt::string()
                .description("Choose the output format.")
                .extend([MCP_INPUT.value(McpInputFacts::excluded())]),
        )
        .option("file", document())
        .command(get)
        .command(keys)
        .command(select)
        .command(stats)
        .command(debug)
        .command(fetch)
        .action(|_: Context| async { Ok(()) })
}

fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance")
}

/// Whether the harness waits for an answer after sending this line: a raw line that is not blank,
/// or a message with an id and neither a result nor an error.
fn answered(line: &str) -> bool {
    match serde_json::from_str::<Value>(line) {
        Ok(Value::Object(message)) => {
            message.contains_key("id")
                && !message.contains_key("result")
                && !message.contains_key("error")
        }
        Ok(_) => true,
        Err(_) => !line.trim().is_empty(),
    }
}

/// Replays one corpus case: its stdin lines, one at a time, then its stdin's end, and compares
/// stdout, stderr, and the exit code with the captured ones.
async fn replay(id: &str) {
    let expected = corpus().join("expected").join(id);
    let read = |name: &str| std::fs::read_to_string(expected.join(name)).unwrap();
    let stdin = std::fs::read_to_string(expected.join("stdin")).unwrap_or_default();
    let mut session = launch(
        &jsonkit(),
        Launch {
            cwd: Some(corpus().join("fixtures")),
            ..Launch::default()
        },
    );
    let mut lines = Vec::new();
    for line in stdin.lines() {
        session.send_line(line);
        if answered(line) {
            lines.push(session.next_line().await);
        }
    }
    let ending = session.close().await;
    let mut stdout: String = lines.iter().map(|line| format!("{line}\n")).collect();
    for message in ending.messages {
        stdout.push_str(&format!("{}\n", serde_json::to_string(&message).unwrap()));
    }
    assert_eq!(stdout, read("stdout"), "{id}");
    assert_eq!(ending.stderr, read("stderr"), "{id}");
    assert_eq!(format!("{}\n", ending.status), read("exit"), "{id}");
}

macro_rules! sessions {
    ($($name:ident: $id:literal,)*) => {
        $(
            #[tokio::test]
            async fn $name() {
                replay($id).await;
            }
        )*
    };
}

sessions! {
    discover_without_meta: "jsonkit-mcp-discover-without-meta",
    discover: "jsonkit-mcp-discover",
    initialize_2025_11_25: "jsonkit-mcp-initialize-2025-11-25",
    initialize_2025_06_18: "jsonkit-mcp-initialize-2025-06-18",
    initialize_unlisted_revision: "jsonkit-mcp-initialize-unlisted-revision",
    initialize_twice: "jsonkit-mcp-initialize-twice",
    initialize_bad_params: "jsonkit-mcp-initialize-bad-params",
    initialize_bad_capabilities: "jsonkit-mcp-initialize-bad-capabilities",
    ping_before_initialize: "jsonkit-mcp-ping-before-initialize",
    ping_per_request_revision_is_method_not_found: "jsonkit-mcp-ping-per-request-revision-is-method-not-found",
    tools_list_per_request: "jsonkit-mcp-tools-list-per-request",
    tools_list_2025_11_25: "jsonkit-mcp-tools-list-2025-11-25",
    tools_list_2025_06_18: "jsonkit-mcp-tools-list-2025-06-18",
    tools_list_cursor: "jsonkit-mcp-tools-list-cursor",
    tools_list_before_initialize: "jsonkit-mcp-tools-list-before-initialize",
    call_get: "jsonkit-mcp-call-get",
    call_get_number: "jsonkit-mcp-call-get-number",
    call_get_object: "jsonkit-mcp-call-get-object",
    call_failing_path_not_found: "jsonkit-mcp-call-failing-path-not-found",
    call_failing_missing_required_argument: "jsonkit-mcp-call-failing-missing-required-argument",
    call_failing_missing_required_option: "jsonkit-mcp-call-failing-missing-required-option",
    call_failing_wrong_type: "jsonkit-mcp-call-failing-wrong-type",
    call_failing_missing_file: "jsonkit-mcp-call-failing-missing-file",
    call_failing_empty_field_validation: "jsonkit-mcp-call-failing-empty-field-validation",
    call_failing_empty_field_list: "jsonkit-mcp-call-failing-empty-field-list",
    call_keys: "jsonkit-mcp-call-keys",
    call_unknown_tool: "jsonkit-mcp-call-unknown-tool",
    call_unknown_tool_hidden_command: "jsonkit-mcp-call-unknown-tool-hidden-command",
    call_unknown_tool_deprecated: "jsonkit-mcp-call-unknown-tool-deprecated",
    call_unknown_tool_alias: "jsonkit-mcp-call-unknown-tool-alias",
    call_unknown_argument_key: "jsonkit-mcp-call-unknown-argument-key",
    call_unknown_argument_key_control_option: "jsonkit-mcp-call-unknown-argument-key-control-option",
    call_unknown_argument_key_hidden_global: "jsonkit-mcp-call-unknown-argument-key-hidden-global",
    call_unknown_argument_key_excluded_option: "jsonkit-mcp-call-unknown-argument-key-excluded-option",
    call_root_tool_format_is_not_a_property: "jsonkit-mcp-call-root-tool-format-is-not-a-property",
    call_arguments_not_object: "jsonkit-mcp-call-arguments-not-object",
    call_arguments_omitted: "jsonkit-mcp-call-arguments-omitted",
    call_name_not_string: "jsonkit-mcp-call-name-not-string",
    call_2025_11_25: "jsonkit-mcp-call-2025-11-25",
    call_2025_06_18: "jsonkit-mcp-call-2025-06-18",
    call_2025_06_18_failure: "jsonkit-mcp-call-2025-06-18-failure",
    call_before_initialize_without_meta: "jsonkit-mcp-call-before-initialize-without-meta",
    call_progress_token: "jsonkit-mcp-call-progress-token",
    call_get_stdin_unavailable: "jsonkit-mcp-call-get-stdin-unavailable",
    session_several_calls: "jsonkit-mcp-session-several-calls",
    session_initialize_then_per_request: "jsonkit-mcp-session-initialize-then-per-request",
    protocol_unsupported_revision: "jsonkit-mcp-protocol-unsupported-revision",
    protocol_meta_version_not_string: "jsonkit-mcp-protocol-meta-version-not-string",
    protocol_meta_capabilities_missing: "jsonkit-mcp-protocol-meta-capabilities-missing",
    protocol_unknown_method: "jsonkit-mcp-protocol-unknown-method",
    protocol_unknown_method_initialized: "jsonkit-mcp-protocol-unknown-method-initialized",
    protocol_not_json: "jsonkit-mcp-protocol-not-json",
    protocol_truncated_json: "jsonkit-mcp-protocol-truncated-json",
    protocol_not_a_request: "jsonkit-mcp-protocol-not-a-request",
    protocol_batch: "jsonkit-mcp-protocol-batch",
    protocol_missing_jsonrpc_version: "jsonkit-mcp-protocol-missing-jsonrpc-version",
    protocol_method_not_string: "jsonkit-mcp-protocol-method-not-string",
    protocol_blank_line_ignored: "jsonkit-mcp-protocol-blank-line-ignored",
    protocol_client_response_ignored: "jsonkit-mcp-protocol-client-response-ignored",
    protocol_unknown_notification_ignored: "jsonkit-mcp-protocol-unknown-notification-ignored",
    protocol_duplicate_id_after_settle: "jsonkit-mcp-protocol-duplicate-id-after-settle",
    subscriptions_listen: "jsonkit-mcp-subscriptions-listen",
    stdin_closed_no_input: "jsonkit-mcp-stdin-closed-no-input",
    cancel_settled_request: "jsonkit-mcp-cancel-settled-request",
}

/// The argv a corpus case runs, read from `conformance/cases/jsonkit-mcp.json`.
#[cfg(feature = "help")]
fn argv_of(id: &str) -> Vec<String> {
    let cases: Value = serde_json::from_str(
        &std::fs::read_to_string(corpus().join("cases").join("jsonkit-mcp.json")).unwrap(),
    )
    .unwrap();
    let case = cases["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == id)
        .unwrap();
    serde_json::from_value(case["argv"].clone()).unwrap()
}

/// Runs one corpus argv case on jsonkit's `mcp` Commands with the help plugin installed, whose
/// hint ends each usage failure, and compares stdout, stderr, and the exit code with the captured
/// ones.
#[cfg(feature = "help")]
async fn run_argv(id: &str) {
    use loomcli_core::{ProcessHandle, RunOptions};
    use loomcli_plugins::help::help;
    use loomcli_testing::{MockFields, mock_process};
    use std::sync::Arc;
    let expected = corpus().join("expected").join(id);
    let read = |name: &str| std::fs::read_to_string(expected.join(name)).unwrap();
    let process = mock_process(MockFields::new().argv(argv_of(id)));
    let code = Application::new("jsonkit")
        .plugins((help(), mcp()))
        .description("Read and reshape one JSON document.")
        .version("0.0.0")
        .action(|_: Context| async { Ok(()) })
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(process.stdout_text(), read("stdout"), "{id}");
    assert_eq!(process.stderr_text(), read("stderr"), "{id}");
    assert_eq!(format!("{}\n", code.get()), read("exit"), "{id}");
}

macro_rules! runs {
    ($($name:ident: $id:literal,)*) => {
        $(
            #[cfg(feature = "help")]
            #[tokio::test]
            async fn $name() {
                run_argv($id).await;
            }
        )*
    };
}

runs! {
    install_unknown_agent: "jsonkit-mcp-install-unknown-agent",
    unknown_child: "jsonkit-mcp-unknown-child",
    extra_argument: "jsonkit-mcp-extra-argument",
}
