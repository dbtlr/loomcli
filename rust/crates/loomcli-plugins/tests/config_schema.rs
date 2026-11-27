//! The configuration plugin's schema and provider, ported from the reference's `config.test.ts`:
//! the provided value, the drop rule, an empty file the type rejects, the published schema and its
//! `$schema` pointer, the build check of linked paths, the settings faults, and `inspect()`.

#![cfg(feature = "config")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod config_support;

use std::sync::Arc;

use config_support::*;
use loomcli_core::{
    Application, Context, InvocationOutcome, InvocationValues, InvokeOptions, Opt, ProcessHandle,
    RunOptions,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::config::{ConfigurationSettings, Scope, configuration};
use loomcli_testing::{MockFields, mock_process};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

#[tokio::test]
async fn provided_is_the_type_for_the_passed_file_and_for_an_empty_file_when_none_is_found() {
    let space = Workspace::new();
    let none = space.run().shown(SchemaName::Typed).ran().await;
    assert_eq!((none.status, none.stderr.as_str()), (0, ""));
    assert_eq!(none.provided(), json!({ "retries": 3 }));
    space.write(
        ".app.json",
        &json_text(&json!({ "mode": "slow", "title": "abc", "unknown": { "value": 1 } })),
    );
    let found = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!(found.stderr, read_line(".app.json"));
    // The default fills and the transform runs. A key the type does not describe is never
    // reported, and serde leaves it out of a struct.
    assert_eq!(
        found.provided(),
        json!({ "mode": "slow", "retries": 3, "title": "ABC" })
    );
}

#[tokio::test]
async fn provided_keeps_a_path_as_the_file_wrote_it() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(&json!({ "root": "../out", "sessions": { "sources": [{ "dir": "./t", "harness": "a" }] } })),
    );
    assert_eq!(
        space.run().shown(SchemaName::Typed).ran().await.provided(),
        json!({ "retries": 3, "root": "../out", "sessions": { "sources": [{ "dir": "./t", "harness": "a" }] } })
    );
}

#[tokio::test]
async fn a_value_the_type_rejects_is_dropped_and_named_at_v_alone_and_the_rest_stays() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(&json!({ "mode": "slow", "updates": { "interval": "soon" } })),
    );
    let mut quiet_run = space.run().shown(SchemaName::Typed);
    quiet_run.declared.loud = false;
    let quiet = quiet_run.ran().await;
    assert_eq!((quiet.status, quiet.stderr.as_str()), (0, ""));
    assert_eq!(
        quiet.provided(),
        json!({ "mode": "slow", "retries": 3, "updates": {} })
    );
    let loudly = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!(
        loudly.stderr,
        read_wrong(
            ".app.json",
            &[
                "Ignored updates.interval in .app.json: Invalid input: expected number, received string"
            ]
        )
    );
    assert_eq!(
        loudly.provided(),
        json!({ "mode": "slow", "retries": 3, "updates": {} })
    );
}

#[tokio::test]
async fn a_wrong_value_at_a_key_falls_back_to_the_types_default() {
    let space = Workspace::new();
    space.write(".app.json", &json_text(&json!({ "retries": "many" })));
    let ran = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!(ran.provided(), json!({ "retries": 3 }));
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored retries in .app.json: Invalid input: expected int, received string"]
        )
    );
}

#[tokio::test]
async fn an_array_item_with_a_wrong_or_missing_value_is_removed_whole() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(&json!({
            "sessions": { "sources": [{ "dir": 1 }, { "harness": "b" }, { "harness": 2 }, { "harness": "d" }] }
        })),
    );
    let ran = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!(
        ran.provided(),
        json!({ "retries": 3, "sessions": { "sources": [{ "harness": "b" }, { "harness": "d" }] } })
    );
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &[
                "Ignored sessions.sources[0] in .app.json: Invalid input: expected string, received number",
                "Ignored sessions.sources[2] in .app.json: Invalid input: expected string, received number",
            ]
        )
    );
}

#[tokio::test]
async fn a_wrong_value_inside_a_map_removes_that_value_and_an_entry_that_then_lacks_a_key_goes_next()
 {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(&json!({ "owners": { "alpha": { "id": 1 }, "beta": { "extra": 1 }, "gamma": { "id": "ok" } } })),
    );
    let ran = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!(
        ran.provided(),
        json!({ "owners": { "gamma": { "id": "ok" } }, "retries": 3 })
    );
    // serde stops at its first failure, so the drops come one per round, in the file's order.
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &[
                "Ignored owners.alpha.id in .app.json: Invalid input: expected string, received number",
                "Ignored owners.alpha in .app.json: Missing key: \"id\"",
                "Ignored owners.beta in .app.json: Missing key: \"id\"",
            ]
        )
    );
}

#[tokio::test]
async fn a_failure_with_no_path_removes_every_key_and_the_file_passes_as_an_empty_file() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(&json!({ "mode": "bad", "other": 1 })),
    );
    let ran = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::TopRefined)
        .ran()
        .await;
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored every key in .app.json: Pick another mode."]
        )
    );
    assert_eq!(ran.provided(), json!({}));
}

#[tokio::test]
async fn a_type_that_still_rejects_an_empty_file_is_the_authors_defect_with_code_1() {
    let space = Workspace::new();
    let sentence = "The configuration schema rejects an empty file: Add present.";
    for content in [None, Some(json_text(&json!({ "other": 1 })))] {
        if let Some(content) = &content {
            space.write(".app.json", content);
        }
        let mut run = space.run().shown(SchemaName::Refined);
        run.declared.provided = false;
        let ran = run.ran().await;
        assert_eq!(ran.status, 1, "{content:?}");
        assert!(ran.stderr.contains(sentence), "{}", ran.stderr);
        assert!(
            ran.stderr.contains("@loomcli/plugins/config/empty-file"),
            "{}",
            ran.stderr
        );
    }
    space.write(".app.json", &json_text(&json!({ "present": true })));
    let ran = space.run().shown(SchemaName::Refined).ran().await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
}

#[tokio::test]
async fn a_linked_option_takes_the_file_value_not_the_output_and_a_dropped_value_fills_nothing() {
    let space = Workspace::new();
    space.write(".app.json", &json_text(&json!({ "title": "abc" })));
    let kept = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!(kept.received()["title"], json!("abc"));
    assert_eq!(kept.provided()["title"], json!("ABC"));
    space.write(".app.json", &json_text(&json!({ "title": 5 })));
    let dropped = space
        .run()
        .arg(&["-L"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert!(dropped.received().get("title").is_none());
    // The type names the removal once, and the source names no second line for the same value.
    assert_eq!(
        dropped.stderr,
        read_wrong(
            ".app.json",
            &["Ignored title in .app.json: Invalid input: expected string, received number"]
        )
    );
}

#[tokio::test]
async fn a_schema_default_never_fills_a_linked_option() {
    let space = Workspace::new();
    assert_eq!(
        space.run().shown(SchemaName::Typed).received().await,
        defaults_with(json!({ "loud": 0 }))
    );
}

#[tokio::test]
async fn the_source_and_the_provider_share_one_read_so_a_warning_prints_once() {
    let space = Workspace::new();
    space.write(".app.json", "{");
    let ran = space.run().shown(SchemaName::Typed).ran().await;
    assert_eq!(
        ran.stderr,
        skipped(".app.json", &invalid_json("line 1, column 2"))
    );
    assert_eq!(ran.provided(), json!({ "retries": 3 }));
}

#[tokio::test]
async fn no_config_leaves_a_broken_file_unread_and_provided_is_the_value_for_an_empty_file() {
    let space = Workspace::new();
    space.write(".app.json", "{");
    let ran = space
        .run()
        .arg(&["--no-config"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(ran.provided(), json!({ "retries": 3 }));
}

#[derive(Deserialize, Serialize)]
struct Empty {}

/// An application with the configuration plugin alone, opting in to the provider when asked.
fn plain(uses: bool) -> App {
    let config = configuration::<Empty>(ConfigurationSettings::new(None));
    let app = Application::new("app").plugins([config.plugin]);
    let app = if uses {
        app.uses([&config.provider])
    } else {
        app
    };
    app.action(|context: Context| async move { context.out.print("ran").await })
}

async fn run_plain(uses: bool, fields: MockFields) -> Ran {
    let process = mock_process(fields);
    let code = plain(uses)
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

#[tokio::test]
async fn the_provider_reads_the_file_when_no_linked_option_needs_a_value() {
    let space = Workspace::new();
    space.write(".app.json", "{");
    let fields = || MockFields::new().cwd(&space.project).home(&space.home);
    let read = run_plain(true, fields()).await;
    assert_eq!(
        read.stderr,
        skipped(".app.json", &invalid_json("line 1, column 2"))
    );
    let none = run_plain(false, fields()).await;
    assert_eq!((none.stderr.as_str(), none.stdout.as_str()), ("", "ran\n"));
}

#[tokio::test]
async fn a_config_file_that_cannot_be_used_fails_the_run_from_the_provider_as_from_the_source() {
    let space = Workspace::new();
    let ran = run_plain(
        true,
        MockFields::new()
            .argv(["--config", "missing.json"])
            .cwd(&space.project)
            .home(&space.home),
    )
    .await;
    assert_eq!(ran.status, 2);
    assert!(
        ran.stderr.contains(
            "Option \"--config\": File \"missing.json\" does not exist. Supply the path of an existing file."
        ),
        "{}",
        ran.stderr
    );
}

#[tokio::test]
async fn in_an_invocation_by_name_a_named_file_the_provider_reads_first_names_config_by_name() {
    let space = Workspace::new();
    let process = mock_process(MockFields::new().cwd(&space.project).home(&space.home));
    let outcome = plain(true)
        .invoke(
            &[],
            InvocationValues::new().option("config", "missing.json"),
            InvokeOptions::new(),
            Some(process as Arc<dyn ProcessHandle>),
        )
        .await;
    let InvocationOutcome::Failed { failure, .. } = outcome else {
        panic!("the invocation fails");
    };
    let problems: Vec<Value> = failure
        .failure()
        .and_then(|failure| failure.downcast_ref::<loomcli_core::InputError>())
        .map(|error| error.problems().iter().map(problem_json).collect())
        .unwrap_or_default();
    assert_eq!(
        Value::Array(problems),
        json!([{
            "input": { "global": true, "kind": "option", "name": "config" },
            "issues": [{ "message": "File \"missing.json\" does not exist. Supply the path of an existing file." }],
            "reason": "invalid",
            "spelling": "config"
        }])
    );
}

#[cfg(all(feature = "config-toml", feature = "config-yaml"))]
#[tokio::test]
async fn a_top_level_schema_key_is_removed_before_validation_in_every_format() {
    let space = Workspace::new().with_formats(&[
        loomcli_plugins::config::toml::TOML,
        loomcli_plugins::config::yaml::YAML,
    ]);
    for (file, content) in [
        (
            ".app.json",
            json_text(&json!({ "$schema": "https://example.com/app.json", "title": "json" })),
        ),
        (
            ".app.toml",
            "\"$schema\" = \"https://example.com/app.json\"\ntitle = \"toml\"\n".to_owned(),
        ),
        (
            ".app.yaml",
            "$schema: https://example.com/app.json\ntitle: yaml\n".to_owned(),
        ),
    ] {
        space.write(file, &content);
        let ran = space
            .run()
            .shown(SchemaName::Typed)
            .settings(Settings::file(file))
            .ran()
            .await;
        assert_eq!(ran.stderr, "", "{file}");
        assert_eq!(
            ran.provided(),
            json!({ "retries": 3, "title": file[5..].to_uppercase() }),
            "{file}"
        );
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Strict {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
}

#[tokio::test]
async fn a_schema_key_below_the_top_level_is_ordinary_and_a_strict_type_keeps_the_file() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(&json!({ "$schema": "https://example.com/app.json", "updates": { "$schema": "x", "interval": 5 } })),
    );
    assert_eq!(
        space.run().shown(SchemaName::Loose).ran().await.provided(),
        json!({ "updates": { "$schema": "x", "interval": 5 } })
    );
    space.write(
        ".app.json",
        &json_text(&json!({ "$schema": "https://example.com/app.json", "title": "kept" })),
    );
    let config = configuration::<Strict>(ConfigurationSettings::new(None));
    let provider = config.provider.clone();
    let app = Application::new("app")
        .plugins([config.plugin])
        .uses([&config.provider])
        .action(move |context: Context| {
            let provider = provider.clone();
            async move {
                let value = context.provided(&provider)?;
                context
                    .out
                    .print(&serde_json::to_string(&*value).unwrap())
                    .await
            }
        });
    let process = mock_process(MockFields::new().cwd(&space.project).home(&space.home));
    app.run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(process.stdout_text(), "{\"title\":\"kept\"}\n");
}

/// A build fault's parts, as the reference's `linkFault` returns them.
#[derive(Debug, PartialEq)]
struct LinkFault {
    correction: Vec<String>,
    rule: Option<&'static str>,
    sentence: String,
}

/// The fault the graph build reports for an application that links one option into the schema,
/// or `None` when it builds.
fn link_fault(schema: Value, path: &str, kind: &str) -> Option<LinkFault> {
    let config = configuration::<Map<String, Value>>(ConfigurationSettings::new(
        schema.as_object().cloned(),
    ));
    let extension = [CONFIG_INPUT.value(ConfigInputFacts::path(path))];
    let option = match kind {
        "boolean" => Opt::boolean().extend(extension).into(),
        "count" => Opt::count().extend(extension).into(),
        "multiple" => Opt::string().multiple().extend(extension).into(),
        "arity" => Opt::string().arity(2).extend(extension).into(),
        _ => Opt::string().extend(extension).into(),
    };
    let app = declare(Application::new("app").plugins([config.plugin]), option)
        .action(|_: Context| async { Ok(()) });
    app.check().first().map(|fault| LinkFault {
        correction: fault.correction().to_vec(),
        rule: fault.rule().map(|rule| rule.identity()),
        sentence: fault.sentence().to_owned(),
    })
}

fn declare(
    app: Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Fresh>,
    option: loomcli_core::OptionDecl,
) -> Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Fresh> {
    app.option("opt", option)
}

const PATH_RULE: &str = "@loomcli/plugins/config/link-path";
const TYPE_RULE: &str = "@loomcli/plugins/config/link-type";
const PATH_CORRECTION: &str = "Link a path the schema describes, or add the key to the schema.";
const TYPE_CORRECTION: &str = "Link a key that holds a value the option takes: a string or a number for a string option, a Boolean for a Boolean option, a whole number for a counted option, or an array for a multiple or arity option.";

/// Asserts the whole fault, as the reference's `toEqual` does.
fn assert_fault(fault: Option<LinkFault>, rule: &'static str, sentence: &str, correction: &str) {
    assert_eq!(
        fault,
        Some(LinkFault {
            correction: vec![correction.to_owned()],
            rule: Some(rule),
            sentence: sentence.to_owned(),
        })
    );
}

/// Asserts the fault's rule alone, as the reference's `toMatchObject({ rule })` does.
fn assert_rule(fault: Option<LinkFault>, rule: &'static str) {
    assert_eq!(fault.expect("the build faults").rule, Some(rule));
}

#[test]
fn a_link_to_a_key_the_schema_does_not_hold_is_a_build_fault_and_a_held_key_builds() {
    let schema = json!({
        "type": "object",
        "properties": {
            "minBytes": { "type": "number" },
            "updates": { "type": "object", "properties": { "channel": { "type": "string" } } }
        }
    });
    assert_fault(
        link_fault(schema.clone(), "maxBytes", "string"),
        PATH_RULE,
        "The root Command option \"opt\" links to maxBytes, which the configuration schema does not hold.",
        PATH_CORRECTION,
    );
    assert_rule(
        link_fault(schema.clone(), "updates.stable", "string"),
        PATH_RULE,
    );
    assert_eq!(link_fault(schema.clone(), "minBytes", "string"), None);
    assert_eq!(link_fault(schema, "updates.channel", "string"), None);
}

#[test]
fn a_link_to_a_value_the_option_cannot_take_is_a_build_fault_in_every_branch_of_a_union() {
    let schema = json!({
        "type": "object",
        "properties": {
            "flag": { "type": "boolean" },
            "list": { "type": "array", "items": { "type": "string" } },
            "mixed": { "anyOf": [{ "type": "boolean" }, { "type": "string" }] },
            "sessions": { "type": "object", "properties": { "harness": { "type": "string" } } },
            "size": { "type": "integer" },
            "word": { "type": "string", "enum": ["a", "b"] }
        }
    });
    assert_fault(
        link_fault(schema.clone(), "sessions", "string"),
        TYPE_RULE,
        "The root Command option \"opt\" links to sessions, which holds an object.",
        TYPE_CORRECTION,
    );
    assert_rule(link_fault(schema.clone(), "flag", "string"), TYPE_RULE);
    assert_eq!(link_fault(schema.clone(), "flag", "boolean"), None);
    assert_eq!(link_fault(schema.clone(), "size", "count"), None);
    assert_eq!(link_fault(schema.clone(), "list", "multiple"), None);
    assert_eq!(link_fault(schema.clone(), "word", "string"), None);
    assert_rule(link_fault(schema.clone(), "size", "multiple"), TYPE_RULE);
    assert_eq!(link_fault(schema.clone(), "mixed", "boolean"), None);
    assert_rule(link_fault(schema, "mixed", "count"), TYPE_RULE);
}

#[test]
fn a_union_member_that_lists_the_key_is_judged_and_an_open_one_that_does_not_stops_the_check() {
    let listed = json!({
        "type": "object",
        "properties": { "fast": { "type": "boolean" } },
        "additionalProperties": {}
    });
    let judged = json!({
        "type": "object",
        "properties": { "pick": { "anyOf": [listed, { "type": "object", "properties": {}, "additionalProperties": false }] } }
    });
    assert_rule(link_fault(judged, "pick.fast", "string"), TYPE_RULE);
    let unchecked = json!({
        "type": "object",
        "properties": { "pick": { "anyOf": [listed, { "type": "object", "properties": {}, "additionalProperties": {} }] } }
    });
    assert_eq!(link_fault(unchecked, "pick.fast", "string"), None);
}

#[test]
fn a_shape_that_names_only_annotations_takes_any_value_so_a_link_through_it_is_unchecked() {
    let schema = json!({
        "type": "object",
        "properties": {
            "extra": { "examples": [{ "level": "debug" }] },
            "fallback": { "default": {} }
        }
    });
    assert_eq!(link_fault(schema.clone(), "extra.level", "string"), None);
    assert_eq!(link_fault(schema, "fallback.level", "string"), None);
}

#[test]
fn a_link_into_an_open_object_a_map_an_array_or_no_shape_gets_no_check() {
    let schema = json!({
        "type": "object",
        "properties": {
            "loose": { "type": "object", "properties": {}, "additionalProperties": {} },
            "records": { "type": "object", "propertyNames": { "type": "string" }, "additionalProperties": { "type": "string" } },
            "sources": { "type": "array", "items": { "type": "object", "properties": { "harness": { "type": "string" } }, "required": ["harness"] } }
        }
    });
    assert_eq!(link_fault(schema.clone(), "loose.anything", "string"), None);
    assert_eq!(
        link_fault(schema.clone(), "records.any.name", "string"),
        None
    );
    assert_eq!(link_fault(schema, "sources.harness", "string"), None);
    assert_eq!(link_fault(Value::Null, "nothing.here", "string"), None);
}

#[test]
fn the_graph_publishes_the_schema_with_a_schema_string_among_its_top_level_properties() {
    let schema = json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": { "retries": { "type": "integer" } }
    });
    let config = configuration::<Map<String, Value>>(ConfigurationSettings::new(
        schema.as_object().cloned(),
    ));
    let graph = Application::new("app")
        .plugins([config.plugin])
        .action(|_: Context| async { Ok(()) })
        .inspect()
        .unwrap();
    assert_eq!(
        serde_json::to_value(&graph.configuration).unwrap(),
        json!({
            "schema": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": { "retries": { "type": "integer" }, "$schema": { "type": "string" } }
            }
        })
    );
    let none = configuration::<Map<String, Value>>(ConfigurationSettings::new(None));
    let graph = Application::new("app")
        .plugins([none.plugin])
        .action(|_: Context| async { Ok(()) })
        .inspect()
        .unwrap();
    assert_eq!(
        serde_json::to_value(&graph.configuration).unwrap(),
        json!({ "schema": null })
    );
}

#[test]
fn inspect_lists_config_and_no_config_and_the_binding_value_on_each_bound_option() {
    let graph = application(&Declared::default()).inspect().unwrap();
    let global = |graph: &loomcli_core::CommandGraph, name: &str| {
        graph
            .globals
            .iter()
            .find(|option| option.name() == name)
            .map(|option| serde_json::to_value(&**option).unwrap())
            .unwrap_or(Value::Null)
    };
    let config = global(&graph, "config");
    assert_eq!(
        (
            config["control"].clone(),
            config["description"].clone(),
            config["short"].clone(),
            config["type"].clone()
        ),
        (
            json!(true),
            json!("Read configuration from this file alone."),
            Value::Null,
            json!("string")
        )
    );
    let no_config = global(&graph, "no-config");
    assert_eq!(
        (
            no_config["control"].clone(),
            no_config["description"].clone(),
            no_config["short"].clone(),
            no_config["type"].clone()
        ),
        (
            json!(true),
            json!("Read no configuration file."),
            Value::Null,
            json!("boolean")
        )
    );
    let limit = graph
        .root
        .options
        .iter()
        .find(|option| option.name() == "limit")
        .unwrap();
    assert_eq!(
        Value::Object(limit.extensions().clone()),
        json!({ "@loomcli/plugins/config/input": { "path": "limits.bytes" } })
    );
    let short = application(&Declared {
        settings: Settings::default().with_short('c'),
        ..Declared::default()
    })
    .inspect()
    .unwrap();
    assert_eq!(global(&short, "config")["short"], json!("-c"));
}

#[test]
fn the_directory_option_is_a_global_string_option_that_is_not_a_control() {
    let graph = application(&Declared {
        settings: Settings::default().with_directory("project"),
        ..Declared::default()
    })
    .inspect()
    .unwrap();
    let find = |graph: &loomcli_core::CommandGraph| {
        graph
            .globals
            .iter()
            .find(|option| option.name() == "project")
            .map(|option| serde_json::to_value(&**option).unwrap())
    };
    let plain = find(&graph).unwrap();
    assert_eq!(
        (
            plain["control"].clone(),
            plain["description"].clone(),
            plain["short"].clone(),
            plain["type"].clone(),
            plain["env"].clone()
        ),
        (
            json!(false),
            json!("Look for the configuration file from this directory."),
            Value::Null,
            json!("string"),
            json!([])
        )
    );
    let described = Settings {
        directory: Some((
            "project".to_owned(),
            Some('p'),
            Some("The project.".to_owned()),
        )),
        ..Settings::default()
    };
    let graph = application(&Declared {
        settings: described,
        ..Declared::default()
    })
    .inspect()
    .unwrap();
    let described = find(&graph).unwrap();
    assert_eq!(
        (described["description"].clone(), described["short"].clone()),
        (json!("The project."), json!("-p"))
    );
    let graph = application(&Declared::default()).inspect().unwrap();
    assert!(find(&graph).is_none());
}

/// The panic message a settings call gives, or `None` when it returns.
fn settings_fault(
    build: impl FnOnce() -> ConfigurationSettings<Empty> + std::panic::UnwindSafe,
) -> Option<String> {
    panics(build)
}

fn assert_settings_fault(message: Option<String>, rule: &str, sentence: &str, correction: &str) {
    let message = message.expect("the settings call panics");
    for part in [rule, sentence, correction] {
        assert!(message.contains(part), "{part}: {message}");
    }
}

#[test]
fn a_file_that_is_not_a_relative_path_panics_with_the_file_path_fault() {
    for file in [
        "",
        "/etc/textstat.json",
        "\\textstat.json",
        "C:textstat.json",
        "a//b.json",
        "./.textstat.json",
        "..",
        "/*.json",
        "a/../*.json",
    ] {
        assert_settings_fault(
            settings_fault(|| ConfigurationSettings::new(None).file(file)),
            "@loomcli/plugins/config/file-path",
            "Plugin \"@loomcli/plugins/config\" file is not a relative path.",
            "Supply a relative path such as .textstat.toml, with no empty, ., or .. segment.",
        );
    }
}

#[test]
fn a_file_with_stray_glob_syntax_or_an_unreadable_listed_extension_panics_with_the_pattern_fault() {
    for file in [
        "*.json",
        "dir*/.textstat.json",
        ".textstat.t*",
        ".textstat.{toml,yaml",
    ] {
        assert_settings_fault(
            settings_fault(|| ConfigurationSettings::new(None).file(file)),
            "@loomcli/plugins/config/file-pattern",
            "Plugin \"@loomcli/plugins/config\" file holds glob syntax other than an extension of * or a brace list.",
            "Write the name literally, and use * or a brace list only as the whole text after its last dot.",
        );
    }
    for file in [".textstat.{toml,ini}", ".textstat.{}", ".textstat.{TOML}"] {
        assert_settings_fault(
            settings_fault(|| ConfigurationSettings::new(None).file(file)),
            "@loomcli/plugins/config/file-pattern",
            "Plugin \"@loomcli/plugins/config\" file lists an extension the plugin cannot read.",
            "List only json, jsonc, toml, yaml, or yml in the braces, or use * for any of them.",
        );
    }
}

#[test]
fn an_env_that_is_not_a_variable_name_panics_with_the_variable_name_fault() {
    for env in ["", "1APP", "APP-CONFIG", "APP CONFIG", "APP=1", "É"] {
        assert_settings_fault(
            settings_fault(|| ConfigurationSettings::new(None).env(env)),
            "@loomcli/plugins/config/variable-name",
            "Plugin \"@loomcli/plugins/config\" env is not a variable name.",
            "Name a variable such as COLLECTOR_CONFIG: a letter or an underscore, then letters, digits, or underscores.",
        );
    }
}

#[test]
fn a_root_marker_that_is_not_one_path_segment_panics_with_the_root_name_fault() {
    for root in ["", "a/b", "a\\b", ".", "..", "/"] {
        assert_settings_fault(
            settings_fault(|| {
                ConfigurationSettings::new(None).scopes(&[project(&["package.json", root])])
            }),
            "@loomcli/plugins/config/root-name",
            "Plugin \"@loomcli/plugins/config\" root is not a file name.",
            "Name an entry in the project's root directory, such as package.json or .git.",
        );
    }
}

#[test]
fn well_formed_settings_return_the_plugin() {
    let files = [
        ".textstat.json",
        #[cfg(feature = "config-toml")]
        ".norn/config.toml",
        "dir\\.textstat.*",
        #[cfg(all(feature = "config-toml", feature = "config-yaml"))]
        ".textstat.{toml,yaml,yml,json}",
        ".textstat.{json,json}",
        ".textstat.conf",
        ".textstatrc",
        ".text\u{2028}stat.json",
    ];
    for file in files {
        assert_eq!(
            panics(
                || configuration::<Empty>(ConfigurationSettings::new(None).file(file).formats(&[
                    #[cfg(feature = "config-toml")]
                    loomcli_plugins::config::toml::TOML,
                    #[cfg(feature = "config-yaml")]
                    loomcli_plugins::config::yaml::YAML,
                ]))
            )
            .map(|_| file),
            None
        );
    }
    let built = panics(|| {
        let _ = configuration::<Empty>(ConfigurationSettings::new(None).short('c'));
        let _ = configuration::<Empty>(ConfigurationSettings::new(None).env("APP_CONFIG"));
        let _ = configuration::<Empty>(ConfigurationSettings::new(None).env("_x9"));
        let _ = configuration::<Empty>(ConfigurationSettings::new(None).notice());
        let _ = configuration::<Empty>(
            ConfigurationSettings::new(None)
                .scopes(&[project(&["package.json", ".git"]), Scope::User]),
        );
        let _ = configuration::<Empty>(ConfigurationSettings::new(None).scopes(&[Scope::User]));
    });
    assert_eq!(built, None);
}

#[test]
fn a_directory_option_named_config_or_no_config_claims_the_plugins_own_spelling_and_faults() {
    for name in ["config", "no-config"] {
        let message = panics(|| {
            configuration::<Empty>(
                ConfigurationSettings::new(None)
                    .directory(loomcli_plugins::config::DirectoryOption::new(name)),
            )
        });
        assert!(message.is_some(), "{name}");
    }
}

#[test]
fn an_arity_option_links_an_array_key_and_refuses_a_string_key() {
    let schema = json!({
        "type": "object",
        "properties": {
            "pair": {"type": "array", "items": {"type": "string"}},
            "word": {"type": "string"},
        },
    });
    assert!(link_fault(schema.clone(), "pair", "arity").is_none());
    assert_fault(
        link_fault(schema, "word", "arity"),
        TYPE_RULE,
        "The root Command option \"opt\" links to word, which holds a string.",
        TYPE_CORRECTION,
    );
}
