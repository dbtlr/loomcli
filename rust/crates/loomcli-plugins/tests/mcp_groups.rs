//! The option-group constraints of a tool's input schema, ported from the MCP cases of the
//! reference's `option-groups.test.ts` with its `option-groups-app.ts` fixture, and the MCP case of
//! `extension-facts.test.ts`.

#![cfg(feature = "mcp")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod mcp_support;

use std::collections::BTreeMap;

use loomcli_core::{
    Application, Command, Context, Done, Extension, NoInputs, NoResult, Opt, OptionTarget, Polarity,
};
use loomcli_plugins::mcp::extension::{
    MCP_ARGUMENT, MCP_COMMAND, MCP_INPUT, McpAnnotations, McpArgumentFacts, McpCommandFacts,
    McpInputFacts,
};
use loomcli_plugins::mcp::mcp;
use mcp_support::{call, request, serve};
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

/// A binding another plugin owns, which might bind a configuration source.
const FOREIGN_BINDING: Extension<OptionTarget, String> = Extension::new("@fixture/binding");

fn opted() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::new())
}

fn excluding() -> loomcli_core::ExtensionValue<loomcli_core::OptionTarget> {
    MCP_INPUT.value(McpInputFacts::excluded())
}

async fn action(context: Context) -> Result<(), loomcli_core::Error> {
    context.out.print("action").await
}

#[derive(Clone, Copy)]
enum Kind {
    Exclusive,
    OneRequired,
    RequiredTogether,
}

fn choice(name: &str, kind: Kind) -> Command<NoInputs, NoResult, Done> {
    let declaration = Command::new(name)
        .description("Choose inputs.")
        .option("flag", Opt::boolean().description("Positive flag."))
        .option("count", Opt::count().description("Count occurrences."))
        .option(
            "items",
            Opt::string().description("Collect items.").multiple(),
        );
    let members = ["flag", "count", "items"];
    let grouped = match kind {
        Kind::Exclusive => declaration.exclusive(&members),
        Kind::OneRequired => declaration.one_required(&members),
        Kind::RequiredTogether => declaration.required_together(&members),
    };
    grouped.extend([opted()]).action(action)
}

fn application() -> App {
    let bound = Command::new("bound")
        .description("Read bound inputs.")
        .option(
            "first",
            Opt::string()
                .description("First input.")
                .env(["GROUP_FIRST"]),
        )
        .option("second", Opt::string().description("Second input."))
        .one_required(&["first", "second"])
        .extend([opted()])
        .action(action);
    let described = Command::new("described")
        .description("Read described inputs.")
        .option(
            "first",
            Opt::string()
                .description("First input.")
                .extend([MCP_INPUT.value(McpInputFacts::described("Described input."))]),
        )
        .option("second", Opt::string().description("Second input."))
        .required_together(&["first", "second"])
        .extend([opted()])
        .action(action);
    let extended = Command::new("extended")
        .description("Read extended inputs.")
        .option(
            "first",
            Opt::string()
                .description("First input.")
                .extend([FOREIGN_BINDING.value("first".to_owned())]),
        )
        .option("second", Opt::string().description("Second input."))
        .required_together(&["first", "second"])
        .extend([opted()])
        .action(action);
    let negated = Command::new("negated")
        .description("Choose a format or no cache.")
        .option(
            "cache",
            Opt::boolean()
                .description("Skip the cache.")
                .polarity(Polarity::Negative),
        )
        .option("json", Opt::boolean().description("JSON output."))
        .option("yaml", Opt::boolean().description("YAML output."))
        .exclusive(&["cache", "json", "yaml"])
        .extend([opted()])
        .action(action);
    let partial = Command::new("partial")
        .description("Read partly excluded inputs.")
        .option("message", Opt::string().description("The message."))
        .option(
            "file",
            Opt::string().description("The file.").extend([excluding()]),
        )
        .option("left", Opt::string().description("Left input."))
        .option("right", Opt::string().description("Right input."))
        .option(
            "far",
            Opt::string()
                .description("Far input.")
                .extend([excluding()]),
        )
        .one_required(&["message", "file"])
        .exclusive(&["left", "right", "far"])
        .extend([opted()])
        .action(action);
    Application::new("groups")
        .plugins([mcp()])
        .description("Export documents.")
        .option(
            "json",
            Opt::boolean()
                .aliases(["js"])
                .description("JSON output.")
                .polarity(Polarity::Both),
        )
        .option(
            "yaml",
            Opt::boolean()
                .description("YAML output.")
                .polarity(Polarity::Both),
        )
        .option("user", Opt::string().description("User name."))
        .option("password", Opt::string().description("Password."))
        .option(
            "secret",
            Opt::boolean().description("Hidden setting.").hidden(),
        )
        .option("other", Opt::boolean().description("Other setting."))
        .exclusive(&["json", "yaml"])
        .one_required(&["json", "yaml"])
        .required_together(&["user", "password"])
        .exclusive(&["secret", "other"])
        .extend([opted()])
        .command(choice("choice", Kind::Exclusive))
        .command(choice("need", Kind::OneRequired))
        .command(choice("together", Kind::RequiredTogether))
        .command(bound)
        .command(negated)
        .command(described)
        .command(extended)
        .command(partial)
        .action(action)
}

fn claim(name: &str, value: Value) -> Value {
    json!({ "properties": { name: value }, "required": [name] })
}

#[tokio::test]
async fn mcp_lists_sound_group_schemas_and_rejects_group_failures_through_invoke() {
    let mut session = serve(&application());
    session.send(&request(1, "tools/list", json!({})));
    let answer = session.next().await;
    let tools = answer["result"]["tools"].as_array().unwrap();
    let all_of = tools[0]["inputSchema"]["allOf"].as_array().unwrap();
    assert!(all_of.contains(&json!({
        "not": { "allOf": [claim("json", json!({ "const": true })), claim("yaml", json!({ "const": true }))] },
    })));
    assert!(
        all_of.contains(&json!({ "anyOf": [{ "required": ["json"] }, { "required": ["yaml"] }] }))
    );
    session.send(&call(
        2,
        "groups",
        Some(json!({ "json": true, "yaml": true })),
    ));
    let failed = session.next().await;
    assert_eq!(failed["result"]["isError"], true);
    assert!(
        failed["result"]
            .to_string()
            .contains("cannot be used together"),
        "{failed}"
    );
    session.send(&call(
        3,
        "groups",
        Some(json!({ "json": true, "yaml": false })),
    ));
    let agreed = session.next().await;
    assert_eq!(agreed["result"]["isError"], false, "{agreed}");
    let ending = session.close().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
}

#[tokio::test]
async fn mcp_schemas_describe_named_false_zero_and_empty_list_absence_and_omit_uncertain_requirements()
 {
    let mut session = serve(&application());
    session.send(&request(1, "tools/list", json!({})));
    let listed = session.next().await;
    let schemas: BTreeMap<String, Value> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| {
            (
                tool["name"].as_str().unwrap().to_owned(),
                tool["inputSchema"].clone(),
            )
        })
        .collect();
    let flag = claim("flag", json!({ "const": true }));
    let count = claim("count", json!({ "minimum": 1 }));
    let items = claim("items", json!({ "minItems": 1 }));
    assert_eq!(
        schemas["choice"]["allOf"],
        json!([
            { "not": { "allOf": [flag, count] } },
            { "not": { "allOf": [flag, items] } },
            { "not": { "allOf": [count, items] } },
        ])
    );
    // A negative Boolean member is absent as true, so it claims its exclusive group as false.
    let negated = claim("cache", json!({ "const": false }));
    let json_claim = claim("json", json!({ "const": true }));
    let yaml_claim = claim("yaml", json!({ "const": true }));
    assert_eq!(
        schemas["negated"]["allOf"],
        json!([
            { "not": { "allOf": [negated, json_claim] } },
            { "not": { "allOf": [negated, yaml_claim] } },
            { "not": { "allOf": [json_claim, yaml_claim] } },
        ])
    );
    assert_eq!(schemas["need"]["allOf"].as_array().unwrap().len(), 1);
    assert_eq!(schemas["together"]["allOf"].as_array().unwrap().len(), 1);
    assert!(schemas["bound"].get("allOf").is_none());
    // The plugin's own extension binds nothing, and another plugin's might.
    assert_eq!(schemas["described"]["allOf"].as_array().unwrap().len(), 1);
    assert!(schemas["extended"].get("allOf").is_none());
    // An excluded member is never supplied in a call, so each group constrains the members listed.
    assert_eq!(
        schemas["partial"]["allOf"],
        json!([
            { "anyOf": [{ "required": ["message"] }] },
            { "not": { "allOf": [{ "required": ["left"] }, { "required": ["right"] }] } },
        ])
    );
    let absent = json!({ "count": 0, "flag": false, "items": [] });
    session.send(&call(2, "choice", Some(absent.clone())));
    assert_eq!(session.next().await["result"]["isError"], false);
    session.send(&call(3, "need", Some(absent)));
    assert_eq!(session.next().await["result"]["isError"], true);
    session.send(&call(
        4,
        "together",
        Some(json!({ "count": 1, "flag": true, "items": ["item"] })),
    ));
    assert_eq!(session.next().await["result"]["isError"], false);
    let ending = session.close().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
}

/// `extension-facts.test.ts`: MCP keeps every field its facts name, each value accepted at the
/// call and read back whole.
#[test]
fn mcp_keeps_every_field_its_facts_name() {
    let command = McpCommandFacts::annotations(
        McpAnnotations::new()
            .destructive(false)
            .idempotent(true)
            .open_world(false)
            .read_only(true),
    )
    .description("Read one value.");
    let written = serde_json::to_value(&command).unwrap();
    assert_eq!(
        written,
        json!({
            "annotations": { "destructive": false, "idempotent": true, "openWorld": false, "readOnly": true },
            "description": "Read one value.",
        })
    );
    assert_eq!(
        serde_json::from_value::<McpCommandFacts>(written).unwrap(),
        command
    );
    let argument = McpArgumentFacts::new("The path to read.");
    assert_eq!(
        serde_json::to_value(&argument).unwrap(),
        json!({ "description": "The path to read." })
    );
    assert_eq!(
        serde_json::to_value(McpInputFacts::described("The file.")).unwrap(),
        json!({ "description": "The file." })
    );
    assert_eq!(
        serde_json::to_value(McpInputFacts::excluded()).unwrap(),
        json!({ "exclude": true })
    );
    // Each value passes its descriptor's rules where a declaration carries it.
    let graph = Application::new("facts")
        .plugins([mcp()])
        .command(
            Command::new("get")
                .description("Get.")
                .extend([MCP_COMMAND.value(command.clone())])
                .argument(
                    "path",
                    loomcli_core::Arg::string()
                        .description("A path.")
                        .extend([MCP_ARGUMENT.value(argument.clone())]),
                )
                .option(
                    "file",
                    Opt::string()
                        .description("A file.")
                        .extend([MCP_INPUT.value(McpInputFacts::described("The file."))]),
                )
                .option(
                    "secret",
                    Opt::string().description("A secret.").extend([excluding()]),
                )
                .action(action),
        )
        .inspect()
        .unwrap();
    let get = graph.command(&["get"]).unwrap();
    assert_eq!(
        loomcli_core::read_extension(get.as_ref(), &MCP_COMMAND).unwrap(),
        Some(command)
    );
    assert_eq!(
        loomcli_core::read_extension(get.arguments[0].as_ref(), &MCP_ARGUMENT).unwrap(),
        Some(argument)
    );
}
