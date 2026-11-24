//! The MCP plugin's discovery and tool listing, ported from the reference's `mcp.test.ts`
//! (`discovery`, `the listing`) with its `listing` and `multiline` fixture applications.

#![cfg(feature = "mcp")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod mcp_support;

use loomcli_core::{
    Application, Arg, Command, Context, Done, InputSchema, Issue, NoInputs, NoResult, Opt,
    ValidationContext, Validator,
};
use loomcli_plugins::mcp::extension::{
    MCP_ARGUMENT, MCP_COMMAND, MCP_INPUT, McpAnnotations, McpArgumentFacts, McpCommandFacts,
    McpInputFacts,
};
use loomcli_plugins::mcp::mcp;
use mcp_support::{request, serve, tool_named, tools_of};
use serde_json::{Map, Value, json};

type App = Application<NoInputs, NoResult, Done>;

/// A validator that accepts any value and publishes exactly the given input-side JSON Schema.
struct Shaped(Value);

impl Validator for Shaped {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> InputSchema {
        match &self.0 {
            Value::Object(map) => Some(map.clone()),
            _ => Some(Map::new()),
        }
    }
}

const DIALECT: &str = "https://json-schema.org/draft/2020-12/schema";

async fn dispatch(context: Context) -> Result<(), loomcli_core::Error> {
    context.out.print("dispatched").await
}

fn opted() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::new())
}

/// Every opted-in shape the listing projects, beside Commands that never become tools.
fn listing() -> App {
    let read = Command::new("read")
        .description("Read one value.")
        .extend([MCP_COMMAND.value(McpCommandFacts::annotations(
            McpAnnotations::new().open_world(false).read_only(true),
        ))])
        .alias("r")
        .argument(
            "path",
            Arg::string()
                .description("The path to read.")
                .extend([
                    MCP_ARGUMENT.value(McpArgumentFacts::new("A dot path from the document root."))
                ])
                .required(),
        )
        .option(
            "depth",
            Opt::string()
                .default("1")
                .description("How deep to read.")
                .validate(Shaped(json!({
                    "$schema": DIALECT,
                    "description": "The schema says.",
                    "minimum": 1,
                    "type": "integer",
                }))),
        )
        .option(
            "quiet",
            Opt::boolean()
                .description("Say less.")
                .extend([MCP_INPUT.value(McpInputFacts::described("Print the value alone."))]),
        )
        .option(
            "old-depth",
            Opt::string()
                .deprecated("Use depth instead.")
                .description("The former depth."),
        )
        .option(
            "internal",
            Opt::boolean().description("An internal switch.").hidden(),
        )
        .option(
            "style",
            Opt::string().control().description("Choose how to print."),
        )
        .action(dispatch);
    let kinds = Command::new("kinds")
        .description("Take every kind of input.")
        .extend([opted()])
        .argument(
            "first",
            Arg::string().description("One open word.").required(),
        )
        .argument(
            "rest",
            Arg::string().description("More open words.").variadic(),
        )
        .option(
            "name",
            Opt::string().default("anon").description("An open string."),
        )
        .option("flag", Opt::boolean().description("A flag."))
        .option("level", Opt::count().description("A count."))
        .option(
            "tag",
            Opt::string().description("A tag.").multiple().required(),
        )
        .option(
            "topic",
            Opt::string()
                .description("A topic.")
                .multiple()
                .required_when_non_interactive(),
        )
        .option(
            "label",
            Opt::string()
                .default(["a", "b"])
                .description("A label.")
                .multiple(),
        )
        .option(
            "size",
            Opt::string()
                .description("A size.")
                .multiple()
                .validate(Shaped(json!({
                    "$schema": DIALECT,
                    "enum": ["s", "m"],
                    "type": "string",
                }))),
        )
        .option(
            "unset",
            Opt::string()
                .description("No default to publish.")
                .validate(Shaped(json!({ "type": "string" }))),
        )
        .action(dispatch);
    let clear_all = Command::new("clear-all")
        .description("Clear every entry.")
        .extend([MCP_COMMAND.value(McpCommandFacts::annotations(
            McpAnnotations::new().destructive(true),
        ))])
        .action(dispatch);
    let cache = Command::new("cache")
        .description("Manage the cache.")
        .command(clear_all);
    let secret = Command::new("secret")
        .description("A hidden tool.")
        .extend([opted()])
        .hidden()
        .action(dispatch);
    let old = Command::new("old")
        .deprecated("Use read instead.")
        .description("Read one value the old way.")
        .extend([opted()])
        .action(dispatch);
    let worded = Command::new("worded")
        .description("A core description.")
        .extend([MCP_COMMAND.value(
            McpCommandFacts::new().description("An agent description.\nIt keeps its line break."),
        )])
        .action(dispatch);
    let bare = Command::new("bare").extend([opted()]).action(dispatch);
    let plain = Command::new("plain")
        .description("Never a tool.")
        .action(dispatch);
    Application::new("kit")
        .plugins([mcp()])
        .description("A fixture kit.")
        .version("1.2.3")
        .extend([MCP_COMMAND.value(McpCommandFacts::annotations(
            McpAnnotations::new().destructive(false).idempotent(true),
        ))])
        .global_option("file", Opt::string().description("The document."))
        .global_option("verbose", Opt::count().description("Say more."))
        .global_option(
            "trace",
            Opt::boolean().description("Trace the run.").hidden(),
        )
        .global_option(
            "mode",
            Opt::string().control().description("Choose a mode."),
        )
        .command(read)
        .command(kinds)
        .command(cache)
        .command(secret)
        .command(old)
        .command(worded)
        .command(bare)
        .command(plain)
        .action(dispatch)
}

/// Descriptions and deprecation messages an author wrote across several lines.
fn multiline() -> App {
    let fetch = Command::new("fetch")
        .deprecated("Use get\ninstead.")
        .description("Read one value\r\nat a path.")
        .extend([opted()])
        .argument("path", Arg::string().description("The\npath."))
        .option(
            "depth",
            Opt::string()
                .deprecated("Use\n--level.")
                .description("How deep\nto walk."),
        )
        .action(dispatch);
    Application::new("kit")
        .plugins([mcp()])
        .description("A fixture\nkit.")
        .version("1.2.3")
        .command(fetch)
        .action(dispatch)
}

/// An application with no description and one tool.
fn undescribed() -> App {
    Application::new("calls")
        .plugins([mcp()])
        .version("2.0.0")
        .command(
            Command::new("echo")
                .description("Echo.")
                .extend([opted()])
                .action(dispatch),
        )
        .action(dispatch)
}

fn keys(value: &Value) -> Vec<&str> {
    value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect()
}

#[tokio::test]
async fn server_discover_names_the_application_as_the_server_and_offers_tools_alone() {
    let mut session = serve(&listing());
    session.send(&request(1, "server/discover", json!({})));
    let answer = session.next_line().await;
    let ending = session.close().await;
    assert_eq!(
        answer,
        r#"{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","supportedVersions":["2026-07-28","2025-11-25","2025-06-18"],"capabilities":{"tools":{}},"ttlMs":0,"cacheScope":"private","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"kit","version":"1.2.3","description":"A fixture kit."}}}}"#
    );
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
}

#[tokio::test]
async fn an_application_with_no_description_leaves_it_out_of_the_identity() {
    let mut session = serve(&undescribed());
    session.send(&request(1, "tools/list", json!({})));
    let answer = session.next().await;
    session.close().await;
    assert_eq!(
        answer["result"]["_meta"],
        json!({ "io.modelcontextprotocol/serverInfo": { "name": "calls", "version": "2.0.0" } })
    );
}

#[tokio::test]
async fn tools_list_lists_every_opted_in_command_in_graph_order_the_root_first_in_one_page() {
    let mut session = serve(&listing());
    session.send(&request(1, "tools/list", json!({})));
    let answer = session.next().await;
    session.close().await;
    let result = &answer["result"];
    assert_eq!(result["cacheScope"], "private");
    assert_eq!(result["resultType"], "complete");
    assert_eq!(result["ttlMs"], 0);
    assert!(result.get("nextCursor").is_none());
    let names: Vec<&str> = result["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "kit",
            "read",
            "kinds",
            "cache_clear_all",
            "secret",
            "old",
            "worded",
            "bare"
        ]
    );
}

#[tokio::test]
async fn the_root_tool_lists_the_global_options_it_can_take_minus_hidden_and_control_options() {
    let tools = tools_of(&listing()).await;
    assert_eq!(
        serde_json::to_string(tool_named(&tools, "kit").unwrap()).unwrap(),
        r#"{"name":"kit","description":"A fixture kit.","inputSchema":{"type":"object","properties":{"file":{"type":"string","description":"The document."},"verbose":{"type":"integer","minimum":0,"description":"Say more."}},"additionalProperties":false},"annotations":{"destructiveHint":false,"idempotentHint":true}}"#
    );
}

#[tokio::test]
async fn a_tool_lists_arguments_then_local_options_then_globals_with_each_published_schema() {
    let tools = tools_of(&listing()).await;
    assert_eq!(
        serde_json::to_string(tool_named(&tools, "read").unwrap()).unwrap(),
        concat!(
            r#"{"name":"read","description":"Read one value.","inputSchema":{"type":"object","properties":{"#,
            r#""path":{"type":"string","description":"A dot path from the document root."},"#,
            r#""depth":{"description":"How deep to read.","minimum":1,"type":"integer","default":"1"},"#,
            r#""quiet":{"type":"boolean","description":"Print the value alone."},"#,
            r#""old-depth":{"type":"string","description":"Deprecated: Use depth instead.\nThe former depth."},"#,
            r#""file":{"type":"string","description":"The document."},"#,
            r#""verbose":{"type":"integer","minimum":0,"description":"Say more."}},"#,
            r#""required":["path"],"additionalProperties":false},"#,
            r#""annotations":{"readOnlyHint":true,"openWorldHint":false}}"#
        )
    );
}

#[tokio::test]
async fn the_properties_keep_declaration_order_arguments_local_options_then_globals() {
    let tools = tools_of(&listing()).await;
    let read = tool_named(&tools, "read").unwrap();
    assert_eq!(
        keys(&read["inputSchema"]["properties"]),
        ["path", "depth", "quiet", "old-depth", "file", "verbose"]
    );
}

#[tokio::test]
async fn an_input_with_no_published_schema_reads_one_derived_from_its_kind() {
    let tools = tools_of(&listing()).await;
    let kinds = tool_named(&tools, "kinds").unwrap();
    assert!(kinds.get("annotations").is_none());
    assert_eq!(
        kinds["inputSchema"],
        json!({
            "additionalProperties": false,
            "properties": {
                "file": { "description": "The document.", "type": "string" },
                "first": { "description": "One open word.", "type": "string" },
                "flag": { "description": "A flag.", "type": "boolean" },
                "label": {
                    "default": ["a", "b"],
                    "description": "A label.",
                    "items": { "type": "string" },
                    "type": "array",
                },
                "level": { "description": "A count.", "minimum": 0, "type": "integer" },
                "name": { "default": "anon", "description": "An open string.", "type": "string" },
                "rest": { "description": "More open words.", "items": { "type": "string" }, "type": "array" },
                "size": {
                    "description": "A size.",
                    "items": { "enum": ["s", "m"], "type": "string" },
                    "type": "array",
                },
                "tag": { "description": "A tag.", "items": { "type": "string" }, "minItems": 1, "type": "array" },
                "topic": { "description": "A topic.", "items": { "type": "string" }, "minItems": 1, "type": "array" },
                "unset": { "description": "No default to publish.", "type": "string" },
                "verbose": { "description": "Say more.", "minimum": 0, "type": "integer" },
            },
            "required": ["first", "tag", "topic"],
            "type": "object",
        })
    );
    assert_eq!(
        keys(&kinds["inputSchema"]),
        ["type", "properties", "required", "additionalProperties"]
    );
    assert_eq!(
        keys(&kinds["inputSchema"]["properties"]["label"]),
        ["type", "items", "description", "default"]
    );
}

#[tokio::test]
async fn a_tool_name_joins_the_path_with_underscores_each_hyphen_written_as_one() {
    let tools = tools_of(&listing()).await;
    let tool = tool_named(&tools, "cache_clear_all").unwrap();
    assert_eq!(tool["annotations"], json!({ "destructiveHint": true }));
    assert_eq!(tool["description"], "Clear every entry.");
}

#[tokio::test]
async fn a_hidden_command_that_opts_in_is_a_tool_and_an_alias_never_is() {
    let tools = tools_of(&listing()).await;
    assert_eq!(
        tool_named(&tools, "secret").unwrap()["description"],
        "A hidden tool."
    );
    assert!(tool_named(&tools, "r").is_none());
}

#[tokio::test]
async fn a_deprecated_tools_description_opens_with_its_migration_message() {
    let tools = tools_of(&listing()).await;
    assert_eq!(
        tool_named(&tools, "old").unwrap()["description"],
        "Deprecated: Use read instead.\nRead one value the old way."
    );
}

#[tokio::test]
async fn a_line_break_in_a_core_description_or_a_deprecation_message_reads_as_one_space() {
    let tools = tools_of(&multiline()).await;
    let fetch = tool_named(&tools, "fetch").unwrap();
    assert_eq!(
        fetch["description"],
        "Deprecated: Use get instead.\nRead one value at a path."
    );
    let properties = &fetch["inputSchema"]["properties"];
    assert_eq!(
        properties["depth"]["description"],
        "Deprecated: Use --level.\nHow deep to walk."
    );
    assert_eq!(properties["path"]["description"], "The path.");
    let mut session = serve(&multiline());
    session.send(&request(1, "server/discover", json!({})));
    let answer = session.next_line().await;
    session.close().await;
    assert!(
        answer.contains(r#""description":"A fixture kit.""#),
        "{answer}"
    );
}

#[tokio::test]
async fn the_extensions_description_replaces_the_core_one_and_a_tool_with_neither_carries_none() {
    let tools = tools_of(&listing()).await;
    assert_eq!(
        tool_named(&tools, "worded").unwrap()["description"],
        "An agent description.\nIt keeps its line break."
    );
    assert!(
        tool_named(&tools, "bare")
            .unwrap()
            .get("description")
            .is_none()
    );
}
