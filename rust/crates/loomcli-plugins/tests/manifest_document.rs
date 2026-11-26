//! The manifest document, ported from the reference's `manifest.test.ts`: the pinned documents,
//! key order, entries, short spelling, takeover and precedence, and the fixtures that stand on
//! core alone. Help, version, and the formatter belong to other packages, so this application
//! installs the manifest plugin only; its globals are the fixture's own and `--manifest`.

#![cfg(feature = "manifest")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod manifest_support;

use loomcli_core::{
    Activation, AnyExtension, Application, Arg, Command, ConfigurationSource, Extension, Opt,
    OptionTarget, Plugin, ResultViews, Stdin, ValueResult, View, ViewContext,
};
use loomcli_plugins::manifest::manifest;
use manifest_support::{
    App, Ran, application, core_exit_codes, dispatched, document_of, encodings, entry_at, keys,
    run, tokens,
};
use serde_json::{Value, json};

const SCHEMA: &str = "https://json-schema.org/draft/2020-12/schema";

fn pretty(value: &Value) -> String {
    format!("{}\n", serde_json::to_string_pretty(value).unwrap())
}

fn manifest_option(short: Value) -> Value {
    json!({
        "type": "boolean", "name": "manifest",
        "description": "Print this command's manifest as JSON.",
        "deprecated": null, "control": true, "long": "--manifest", "short": short,
        "negative": null, "polarity": "positive", "interaction": false, "color": false,
        "schema": null, "env": [],
    })
}

fn globals(short: Value) -> Value {
    json!([
        {
            "type": "string", "name": "file", "description": "The document.", "deprecated": null,
            "control": false, "long": "--file", "short": "-f", "required": false,
            "requiredWhen": null, "multiple": false, "schema": null, "env": [],
            "envDelimiter": null, "envAllowEmpty": false, "default": null, "implied": null,
            "background": false,
        },
        manifest_option(short),
    ])
}

fn get_entry() -> Value {
    json!({
        "stdin": null, "passthrough": null, "name": "get", "path": ["get"], "description": "Read one value.",
        "details": ["Quote a path.", "Help prose."],
        "examples": [
            { "command": "get a", "note": null },
            { "command": "get b", "note": "B." },
        ],
        "deprecated": null, "hasAction": true, "needsTerminal": false, "result": null, "failures": [],
        "arguments": [{
            "name": "path", "description": "The path.", "required": true, "requiredWhen": null,
            "variadic": false, "schema": null, "default": null,
        }],
        "optionGroups": [],
        "options": [
            {
                "type": "boolean", "name": "raw", "description": "Print raw.", "deprecated": null,
                "control": false, "long": "--raw", "short": null, "negative": "--no-raw",
                "polarity": "both", "interaction": false, "color": false, "schema": null,
                "env": ["APP_RAW"],
            },
            {
                "type": "string", "name": "limit", "description": "The limit.", "deprecated": null,
                "control": false, "long": "--limit", "short": "-l", "required": false,
                "requiredWhen": null, "multiple": false,
                "schema": { "$schema": SCHEMA, "type": "string", "pattern": "^[0-9]+$" },
                "env": ["APP_LIMIT", "APP_LIMIT_FALLBACK"], "envDelimiter": null,
                "envAllowEmpty": true, "default": { "value": "10" }, "implied": null,
                "background": false,
            },
            {
                "type": "string", "name": "tag", "description": null, "deprecated": null,
                "control": false, "long": "--tag", "short": null, "required": false,
                "requiredWhen": null, "multiple": true, "schema": null, "env": ["APP_TAGS"],
                "envDelimiter": ",", "envAllowEmpty": false, "default": null, "implied": null,
                "background": false,
            },
            {
                "type": "count", "name": "verbose", "description": "Say more.",
                "deprecated": null, "control": false, "long": "--verbose", "short": "-v",
                "verbose": false, "quiet": false, "schema": null, "env": ["APP_VERBOSE"],
            },
            {
                "type": "string", "name": "backup", "description": null, "deprecated": null,
                "control": false, "long": "--backup", "short": null, "required": false,
                "requiredWhen": null, "multiple": false, "schema": null, "env": [],
                "envDelimiter": null, "envAllowEmpty": false, "default": { "value": "none" },
                "implied": "simple", "background": false,
            },
            {
                "type": "string", "name": "mode", "description": null, "deprecated": null,
                "control": false, "long": "--mode", "short": null, "required": false,
                "requiredWhen": null, "multiple": false,
                "schema": { "$schema": SCHEMA, "type": "string" }, "env": [],
                "envDelimiter": null, "envAllowEmpty": false, "default": null, "implied": null,
                "background": false,
            },
        ],
        "children": [],
    })
}

fn get_document(short: Value) -> Value {
    json!({
        "name": "app", "version": "1.2.0", "description": "A fixture application.",
        "tokens": tokens(), "exitCodes": core_exit_codes(), "encodings": encodings(),
        "globals": globals(short), "configuration": null, "command": get_entry(),
    })
}

const DOCUMENT_KEYS: [&str; 9] = [
    "name",
    "version",
    "description",
    "tokens",
    "exitCodes",
    "encodings",
    "globals",
    "configuration",
    "command",
];

#[tokio::test]
async fn the_manifest_prints_the_routed_slice_as_indented_json_in_the_contract_key_order_with_a_missing_argument_held()
 {
    let printed = run(&application(None), &["get", "--manifest"]).await;
    manifest_support::assert_same(
        &serde_json::from_str::<Value>(&printed.stdout).unwrap(),
        &get_document(Value::Null),
    );
    assert_eq!(
        run(&application(None), &["get", "--manifest"]).await,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: pretty(&get_document(Value::Null))
        }
    );
}

#[tokio::test]
async fn the_envelope_carries_the_configuration_fact_after_globals_null_without_a_source() {
    let document = document_of(&application(None), &["--manifest"]).await;
    assert_eq!(document["configuration"], Value::Null);
    assert_eq!(keys(&document), DOCUMENT_KEYS);
}

const SOURCE_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/key");

#[tokio::test]
async fn the_envelope_carries_a_configuration_source_schema_as_schema_after_globals() {
    let source = Plugin::new("@fixture/config")
        .extensions([AnyExtension::from(SOURCE_KEY)])
        .source(
            ConfigurationSource::new(
                &SOURCE_KEY,
                |_: loomcli_core::SourceContext<loomcli_core::NoInputs>| async {
                    Ok(std::collections::BTreeMap::new())
                },
            )
            .schema(manifest_support::schema(json!({
                "type": "object", "properties": { "retries": { "type": "integer" } },
            }))),
        );
    let application: App = Application::new("app")
        .plugins((source, manifest()))
        .action(dispatched);
    let ran = run(&application, &["--manifest"]).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let document: Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(keys(&document), DOCUMENT_KEYS);
    assert_eq!(
        document["configuration"],
        json!({ "schema": { "type": "object", "properties": { "retries": { "type": "integer" } } } })
    );
    assert!(
        ran.stdout.contains(
            "  \"configuration\": {\n    \"schema\": {\n      \"type\": \"object\",\n      \"properties\": {\n        \"retries\": {\n          \"type\": \"integer\"\n        }\n      }\n    }\n  },\n  \"command\""
        ),
        "{}",
        ran.stdout
    );
}

#[tokio::test]
async fn an_earlier_installed_middleware_that_takes_over_wins_over_the_manifest() {
    let takeover = Plugin::new("@fixture/takeover")
        .option("takeover", Opt::boolean())
        .middleware(Activation::options(["takeover"]), |ctx, _next| async move {
            ctx.out.print("taken over").await
        });
    let application: App = Application::new("app")
        .plugins((takeover, manifest()))
        .action(dispatched);
    let ran = run(&application, &["--takeover", "--manifest"]).await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: "taken over\n".into(),
            stderr: String::new()
        }
    );
}

#[tokio::test]
async fn schema_numbers_are_written_as_json_stringify_writes_them() {
    let application: App = Application::new("app")
        .plugins((manifest(),))
        .global_option("n", Opt::string().validate(Fractional))
        .action(dispatched);
    let ran = run(&application, &["--manifest"]).await;
    assert!(ran.stdout.contains("\"minimum\": 1,\n"), "{}", ran.stdout);
    assert!(
        ran.stdout.contains("\"maximum\": 10000000000000000,\n"),
        "{}",
        ran.stdout
    );
    assert!(
        ran.stdout.contains("\"exclusiveMinimum\": 1.5\n"),
        "{}",
        ran.stdout
    );
}

#[derive(Clone)]
struct Fractional;

impl loomcli_core::Validator for Fractional {
    type Output = String;
    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        Ok(input.to_owned())
    }
    fn input_schema(&self) -> loomcli_core::InputSchema {
        manifest_support::schema(
            json!({ "minimum": 1.0, "maximum": 1e16, "exclusiveMinimum": 1.5 }),
        )
    }
}

#[test]
#[should_panic(expected = "manifest")]
fn a_short_setting_that_is_not_one_ascii_letter_panics_at_the_call() {
    let _ = manifest().short('1');
}

#[tokio::test]
async fn manifest_short_prints_the_routed_slice_through_its_chosen_short_spelling() {
    let application = application(Some('M'));
    let short = run(&application, &["get", "-M"]).await;
    assert_eq!(short.status, 0);
    assert_eq!(short, run(&application, &["get", "--manifest"]).await);
    assert!(short.stdout.contains("\"short\": \"-M\""));
    assert_eq!(
        serde_json::from_str::<Value>(&short.stdout).unwrap(),
        get_document(json!("-M"))
    );
}

#[tokio::test]
async fn manifest_declares_no_short_spelling_by_default() {
    let ran = run(&application(None), &["get", "-M"]).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        run(&application(None), &["get", "--manifest"]).await.stdout,
        pretty(&get_document(Value::Null))
    );
}

#[tokio::test]
async fn the_root_slice_lists_every_visible_command_and_omits_the_hidden_one() {
    let document = document_of(&application(None), &["--manifest"]).await;
    assert_eq!(keys(&document), DOCUMENT_KEYS);
    let root = entry_at(&document, &[]);
    assert_eq!(root["name"], Value::Null);
    assert_eq!(root["path"], json!([]));
    assert_eq!(root["description"], json!("A fixture application."));
    assert_eq!(root["details"], json!([]));
    assert_eq!(root["examples"], json!([]));
    assert_eq!(root["hasAction"], json!(true));
    assert_eq!(entry_at(&document, &["get"]), &get_entry());
    let children: Vec<&Value> = root["children"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| &c["name"])
        .collect();
    assert_eq!(children, ["get", "old", "cache", "weird", "empty", "pick"]);
    // The hidden option and the hidden global are omitted from every listing.
    assert_eq!(document["globals"], globals(Value::Null));
}

#[tokio::test]
async fn a_deprecated_command_carries_its_message_and_a_value_with_no_field_adds_nothing() {
    let document = document_of(&application(None), &["--manifest"]).await;
    assert_eq!(
        entry_at(&document, &["old"])["deprecated"],
        json!("Use get instead.")
    );
    let empty = entry_at(&document, &["empty"]);
    assert_eq!(
        (&empty["details"], &empty["examples"]),
        (&json!([]), &json!([]))
    );
    assert_eq!(empty["description"], Value::Null);
}

#[tokio::test]
async fn a_hidden_command_routed_to_directly_prints_its_own_slice_and_a_group_prints_its_children()
{
    let application = application(None);
    let secret = document_of(&application, &["secret", "--manifest"]).await;
    assert_eq!(
        entry_at(&secret, &[])["description"],
        json!("A hidden command.")
    );
    assert_eq!(entry_at(&secret, &[])["name"], json!("secret"));
    let cache = document_of(&application, &["cache", "--manifest"]).await;
    let cache = entry_at(&cache, &[]);
    assert_eq!(cache["name"], json!("cache"));
    assert_eq!(cache["hasAction"], json!(false));
    assert_eq!(
        cache["children"][0]["description"],
        json!("Empty the cache.")
    );
    assert_eq!(cache["children"][0]["name"], json!("clear"));
    assert_eq!(cache["children"][0]["path"], json!(["cache", "clear"]));
}

#[tokio::test]
async fn marker_characters_print_exactly_c1_controls_escape_up_to_u009f_and_u00a0_stays_raw() {
    let ran = run(&application(None), &["weird", "--manifest"]).await;
    assert_eq!(ran.status, 0);
    assert!(
        ran.stdout.contains(
            "\"description\": \"A \\u009b control, a \\u009f edge, and a \u{a0} space.\""
        )
    );
    assert!(!ran.stdout.contains('\u{9b}'));
    let document: Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(
        entry_at(&document, &[])["options"],
        json!([{
            "type": "string", "name": "marked", "description": null, "deprecated": null,
            "control": false, "long": "--marked", "short": null, "required": false,
            "requiredWhen": null, "multiple": false, "schema": null, "env": [],
            "envDelimiter": null, "envAllowEmpty": false,
            "default": { "value": "c\u{e000}\u{e001}\u{e002}\u{e003}d\u{e003}E000e" },
            "implied": null, "background": false,
        }])
    );
}

#[tokio::test]
async fn an_argument_entry_carries_its_schema_and_default_and_an_absent_description_reads_null() {
    let document = document_of(&application(None), &["pick", "--manifest"]).await;
    assert_eq!(
        entry_at(&document, &[])["arguments"],
        json!([{
            "name": "index", "description": null, "required": false, "requiredWhen": null,
            "variadic": false,
            "schema": { "$schema": SCHEMA, "type": "string", "pattern": "^[0-9]+$" },
            "default": { "value": "0" },
        }])
    );
}

#[tokio::test]
async fn an_unknown_command_still_fails_in_routing() {
    let ran = run(&application(None), &["nope", "--manifest"]).await;
    assert_eq!(ran.status, 2);
    assert_eq!(ran.stdout, "");
    assert_eq!(
        ran.stderr,
        "app: Unknown command \"nope\". Use one of: get, cache, weird, empty, pick.\n"
    );
}

#[tokio::test]
async fn a_manifest_token_after_the_delimiter_is_an_unexpected_argument() {
    let application: App = Application::new("app")
        .plugins((manifest(),))
        .command(
            Command::new("get")
                .argument("path", Arg::string().required())
                .action(dispatched),
        )
        .action(dispatched);
    assert_eq!(
        run(&application, &["get", "x", "--", "--manifest"]).await,
        Ran {
            status: 2,
            stderr: "app: Command \"get\" accepts 1 argument. Remove the extra values.\n"
                .to_owned(),
            stdout: String::new(),
        }
    );
}

#[tokio::test]
async fn the_bytes_are_the_same_with_color_and_modifiers_forced_on() {
    use loomcli_core::RunOptions;
    use loomcli_testing::{MockFields, mock_process};
    use std::sync::Arc;
    let application = application(None);
    let plain = run(&application, &["get", "--manifest"]).await;
    let process = mock_process(
        MockFields::new()
            .argv(["get", "--manifest"])
            .env("FORCE_COLOR", "3")
            .env("COLOR", "always"),
    );
    application
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(process.stdout_text(), plain.stdout);
}

#[tokio::test]
async fn a_result_reads_kind_views_default_and_media_types_each_encoding_from_the_views_media_types()
 {
    let json_view =
        View::new(|value: &String, _: &ViewContext| format!("{{\"value\":\"{value}\"}}\n"));
    let wire = View::new(|value: &String, _: &ViewContext| format!("{{\"value\":\"{value}\"}}\n"))
        .media_type("application/json");
    let jsonl = View::new(|value: &String, _: &ViewContext| format!("\"{value}\"\n"))
        .media_type("application/jsonl");
    let application = Application::new("app")
        .plugins((manifest(),))
        .result(
            ResultViews::new()
                .view("json", json_view)
                .view("wire", wire)
                .view("jsonl", jsonl),
        )
        .action(
            |ctx: loomcli_core::Context<loomcli_core::NoInputs, ValueResult<String>>| async move {
                ctx.out.results("wired".to_owned()).await
            },
        );
    let document = document_of(&application, &["--manifest"]).await;
    assert_eq!(document["encodings"], encodings());
    let result = &document["command"]["result"];
    assert_eq!(
        result,
        &json!({
            "kind": "value",
            "views": ["json", "wire", "jsonl"],
            "default": "json",
            "mediaTypes": { "json": null, "wire": "application/json", "jsonl": "application/jsonl" },
        })
    );
    assert_eq!(keys(result), ["kind", "views", "default", "mediaTypes"]);
}

fn multiline() -> App {
    let fetch = Command::new("fetch")
        .deprecated("Use get\ninstead.")
        .description("Read one value\r\nat a path.")
        .argument("path", Arg::string().description("The\npath."))
        .option(
            "depth",
            loomcli_core::Opt::string()
                .deprecated("Use\n--level.")
                .description("How deep\nto walk."),
        )
        .action(dispatched);
    Application::new("app")
        .description("Do the\nwork.")
        .plugins((manifest(),))
        .command(fetch)
        .action(dispatched)
}

#[tokio::test]
async fn a_line_break_in_a_description_or_a_deprecation_message_prints_as_one_space() {
    let document = document_of(&multiline(), &["fetch", "--manifest"]).await;
    assert_eq!(document["description"], json!("Do the work."));
    let fetch = entry_at(&document, &[]);
    assert_eq!(fetch["deprecated"], json!("Use get instead."));
    assert_eq!(fetch["description"], json!("Read one value at a path."));
    assert_eq!(fetch["arguments"][0]["description"], json!("The path."));
    assert_eq!(fetch["options"][0]["deprecated"], json!("Use --level."));
    assert_eq!(
        fetch["options"][0]["description"],
        json!("How deep to walk.")
    );
}

#[tokio::test]
async fn an_application_without_a_description_reads_null() {
    let application: App = Application::new("app")
        .plugins((manifest(),))
        .action(dispatched);
    let document = document_of(&application, &["--manifest"]).await;
    assert_eq!(document["description"], Value::Null);
    assert_eq!(entry_at(&document, &[])["description"], Value::Null);
}

fn content() -> App {
    let read = Command::new("read")
        .stdin(Stdin::new().description("The\nevents."))
        .action(dispatched);
    let piped = Command::new("piped")
        .stdin(Stdin::new().required())
        .action(dispatched);
    let count = Command::new("count")
        .argument("sources", Arg::content().variadic())
        .option("file", loomcli_core::Opt::content().stdin())
        .option(
            "files",
            loomcli_core::Opt::content()
                .max(3)
                .min(1)
                .multiple()
                .required(),
        )
        .action(dispatched);
    Application::new("app")
        .plugins((manifest(),))
        .command(read)
        .command(piped)
        .command(count)
        .action(dispatched)
}

#[tokio::test]
async fn a_command_entry_carries_stdin_null_without_a_declaration_and_the_declaration_on_one_line()
{
    let document = document_of(&content(), &["--manifest"]).await;
    assert_eq!(document["command"]["stdin"], Value::Null);
    assert_eq!(entry_at(&document, &["count"])["stdin"], Value::Null);
    assert_eq!(
        entry_at(&document, &["read"])["stdin"],
        json!({ "description": "The events.", "required": false })
    );
    assert_eq!(
        entry_at(&document, &["piped"])["stdin"],
        json!({ "description": null, "required": true })
    );
    assert_eq!(
        keys(&document["command"]),
        [
            "stdin",
            "passthrough",
            "name",
            "path",
            "description",
            "details",
            "examples",
            "deprecated",
            "hasAction",
            "needsTerminal",
            "result",
            "failures",
            "arguments",
            "optionGroups",
            "options",
            "children",
        ]
    );
}

#[tokio::test]
async fn a_content_input_entry_carries_min_and_max_null_when_its_declaration_states_no_bound() {
    let document = document_of(&content(), &["--manifest"]).await;
    let count = entry_at(&document, &["count"]);
    let min_length = json!({ "minLength": 1, "type": "string" });
    assert_eq!(
        count["arguments"],
        json!([{
            "type": "content", "stdin": false, "min": null, "max": null, "name": "sources",
            "description": null, "required": false, "requiredWhen": null, "variadic": true,
            "schema": min_length, "default": null,
        }])
    );
    assert_eq!(
        keys(&count["arguments"][0]),
        [
            "type",
            "stdin",
            "min",
            "max",
            "name",
            "description",
            "required",
            "requiredWhen",
            "variadic",
            "schema",
            "default",
        ]
    );
    let shared = |name: &str,
                  stdin: bool,
                  bounds: (Value, Value),
                  required: bool,
                  multiple: bool| {
        json!({
            "type": "content", "stdin": stdin, "min": bounds.0, "max": bounds.1, "name": name,
            "description": null, "deprecated": null, "control": false, "long": format!("--{name}"),
            "short": null, "required": required, "requiredWhen": null, "multiple": multiple,
            "schema": min_length, "env": [], "envDelimiter": null, "default": null,
            "implied": null,
        })
    };
    assert_eq!(
        count["options"],
        json!([
            shared("file", true, (Value::Null, Value::Null), false, false),
            shared("files", false, (json!(1), json!(3)), true, true),
        ])
    );
    assert_eq!(
        keys(&count["options"][0]),
        [
            "type",
            "stdin",
            "min",
            "max",
            "name",
            "description",
            "deprecated",
            "control",
            "long",
            "short",
            "required",
            "requiredWhen",
            "multiple",
            "schema",
            "env",
            "envDelimiter",
            "default",
            "implied",
        ]
    );
}

// Short spellings: settings accepted, and collisions reported under the ordinary rule.

#[derive(loomcli_core::Inputs)]
struct OtherOptions {
    /// Another plugin's option.
    #[option(short = 'M')]
    other: bool,
}

#[test]
fn manifest_accepts_either_case_of_an_ascii_letter() {
    for short in [None, Some('m'), Some('M')] {
        let _ = application(short);
    }
}

fn collision_app(owner: &str) -> App {
    let manifest = manifest().short('M');
    let base = Application::new("app");
    let application: App = match owner {
        "global" => base
            .plugins((manifest,))
            .global_option("mode", loomcli_core::Opt::boolean().short('M'))
            .action(dispatched),
        "local" => base
            .plugins((manifest,))
            .command(
                Command::new("get")
                    .option("mode", loomcli_core::Opt::boolean().short('M'))
                    .action(dispatched),
            )
            .action(dispatched),
        _ => base
            .plugins((
                loomcli_core::Plugin::new("@fixture/other").options::<OtherOptions>(),
                manifest,
            ))
            .action(dispatched),
    };
    application
}

/// The fault the collision raises: at the author's call, or at the build.
fn collision(owner: &str) -> String {
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let fault = collision_app(owner)
            .inspect()
            .expect_err("the spelling is taken");
        loomcli_core::FailureFacts::message(&fault).to_owned()
    }));
    match caught {
        Ok(message) => message,
        Err(payload) => payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| {
                payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
            })
            .unwrap_or_default(),
    }
}

#[test]
fn the_manifest_short_spelling_colliding_with_a_global_a_local_or_a_plugin_option_reports_the_ordinary_rule()
 {
    for owner in ["global", "local", "plugin"] {
        let message = collision(owner);
        assert!(
            message.contains("@loomcli/core/spelling-taken"),
            "{owner}: {message}"
        );
        assert!(message.contains("-M"), "{owner}: {message}");
    }
}

#[tokio::test]
async fn a_listing_never_advertises_an_option_group_that_would_reveal_a_hidden_member() {
    use loomcli_core::Opt;
    let pick = Command::new("pick")
        .option("a", Opt::boolean())
        .option("b", Opt::boolean())
        .option("c", Opt::boolean().hidden())
        .exclusive(&["a", "b"])
        .exclusive(&["a", "c"])
        .action(dispatched);
    let application: App = Application::new("app")
        .plugins((manifest(),))
        .command(pick)
        .action(dispatched);
    let document = document_of(&application, &["pick", "--manifest"]).await;
    assert_eq!(
        entry_at(&document, &[])["optionGroups"],
        json!([{ "kind": "exclusive", "options": ["a", "b"] }])
    );
}
