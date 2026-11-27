//! The published schema's unknown-key walk, through the configuration provider.

#![cfg(feature = "config")]

mod config_support;

use config_support::{Workspace, read_line, wrong};
use loomcli_core::{Application, Opt};
use loomcli_plugins::config::{ConfigurationReader, ConfigurationSettings, configuration};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

const FILE: &str = ".app.json";
const ISSUE: &str = "Unknown key. Check its spelling, or remove it.";

fn line(path: &str) -> String {
    wrong(&[&format!("Ignored {path} in {FILE}: {ISSUE}")])
}

fn closed() -> Value {
    json!({
        "type":"object",
        "properties": {
            "stateDir": {"type":"string"},
            "updates": {"type":"object", "properties": {
                "channel":{"type":"string"}, "interval":{"type":"number"}
            }},
            "sessions": {"type":"object", "properties": {
                "sources": {"type":"array","items":{"type":"object","properties":{
                    "harness":{"type":"string"},"name":{"type":"string"}
                }}}
            }}
        }
    })
}

async fn read<T: DeserializeOwned + Send + Sync + 'static>(
    schema: Value,
    file: &str,
    contents: &str,
    formats: &[ConfigurationReader],
    verbose: bool,
) -> String {
    let space = Workspace::new();
    space.write(file, contents);
    let config = configuration::<T>(
        ConfigurationSettings::new(schema.as_object().cloned())
            .file(file)
            .formats(formats),
    );
    let app = Application::new("app")
        .plugins([config.plugin])
        .global_option("loud", Opt::count().short('L').verbose())
        .uses([&config.provider])
        .action(|_| async { Ok(()) });
    let argv: &[&str] = if verbose { &["-L"] } else { &[] };
    let ran = space.run().arg(argv).ran_with(&app).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, ""), "{}", ran.stderr);
    ran.stderr
}

async fn report(schema: Value, file: Value) -> String {
    read::<Map<String, Value>>(schema, FILE, &file.to_string(), &[], true).await
}

#[tokio::test]
async fn unknown_keys_are_named_depth_first_in_file_order_at_verbose_only() {
    let file =
        json!({"stateDir":"yes","state_dir":"typo","updates":{"chanel":"beta","interval":5}});
    assert_eq!(
        report(closed(), file.clone()).await,
        read_line(FILE) + &line("state_dir") + &line("updates.chanel")
    );
    assert_eq!(
        read::<Map<String, Value>>(closed(), FILE, &file.to_string(), &[], false).await,
        ""
    );
}

#[tokio::test]
async fn a_key_inside_an_array_item_uses_the_index_in_the_file() {
    let file = json!({"sessions":{"sources":[{"harness":"a"},{"harness":"b","nmae":"x"}]}});
    assert_eq!(
        report(closed(), file).await,
        read_line(FILE) + &line("sessions.sources[1].nmae")
    );
}

#[tokio::test]
async fn open_objects_unconstrained_shapes_and_absent_json_schema_leave_keys_unchecked() {
    let shape = json!({"properties": {
        "free": {"title":"any"},
        "loose": {"properties":{"known":{"type":"string"}},"additionalProperties":true},
        "table": {"type":"object","additionalProperties":{"properties":{"id":{"type":"string"}}}
    }}});
    let file = json!({"free":{"any":{"thing":1}},"loose":{"extra":1},"table":{"first":{"typo":1},"second":{}}});
    assert_eq!(report(shape, file).await, read_line(FILE));
    assert_eq!(
        report(Value::Null, json!({"state_dir":"x"})).await,
        read_line(FILE)
    );
}

#[tokio::test]
async fn the_pointer_is_removed_and_a_nested_schema_key_is_ordinary() {
    let file = json!({"$schema":"https://example.test/s.json","updates":{"$schema":"x"}});
    assert_eq!(
        report(closed(), file).await,
        read_line(FILE) + &line("updates.$schema")
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Typed {
    sessions: Option<Sessions>,
    updates: Option<Updates>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Sessions {
    sources: Vec<Harness>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Harness {
    harness: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Updates {
    interval: Option<f64>,
}

#[tokio::test]
async fn the_walk_skips_removed_values_and_keeps_surviving_array_items_at_their_original_positions()
{
    let file = json!({
        "sessions":{"sources":[
            {"harness":1,"nmae":"x"},
            {"harness":false},
            {"harness":"b"},
            {"harness":"c","nmae":"d"}
        ]},
        "updates":{"interval":"soon","nope":1}
    });
    assert_eq!(
        read::<Typed>(closed(), FILE, &file.to_string(), &[], true).await,
        concat!(
            "› Read configuration from .app.json.\n",
            "› Ignored sessions.sources[0] in .app.json: Invalid input: expected string, received number\n",
            "› Ignored sessions.sources[1] in .app.json: Invalid input: expected string, received boolean\n",
            "› Ignored updates.interval in .app.json: Invalid input: expected number, received string\n",
            "› Ignored sessions.sources[3].nmae in .app.json: Unknown key. Check its spelling, or remove it.\n",
            "› Ignored updates.nope in .app.json: Unknown key. Check its spelling, or remove it.\n",
        )
    );
}

#[cfg(feature = "config-yaml")]
#[tokio::test]
async fn each_path_to_a_shared_yaml_value_gets_its_own_line() {
    let stderr = read::<Map<String, Value>>(
        closed(),
        ".app.yaml",
        "sessions:\n  sources:\n    - &one { harness: a, nmae: x }\n    - *one\n",
        &[loomcli_plugins::config::yaml::YAML],
        true,
    )
    .await;
    assert_eq!(
        stderr,
        concat!(
            "› Read configuration from .app.yaml.\n",
            "› Ignored sessions.sources[0].nmae in .app.yaml: Unknown key. Check its spelling, or remove it.\n",
            "› Ignored sessions.sources[1].nmae in .app.yaml: Unknown key. Check its spelling, or remove it.\n",
        )
    );
}

#[tokio::test]
async fn tuple_items_use_their_own_published_shapes() {
    let schema = json!({"properties": {"pair":{"prefixItems":[
        {"properties":{"id":{"type":"string"}}},
        {"properties":{"label":{"type":"string"}}}
    ]}}});
    let file = json!({"pair":[{"id":"a"},{"label":"b","lable":"c"}]});
    assert_eq!(
        report(schema, file).await,
        read_line(FILE) + &line("pair[1].lable")
    );
}

#[tokio::test]
async fn a_surviving_tuple_item_keeps_its_original_published_shape() {
    let schema = json!({"properties":{"sessions":{"properties":{"sources":{"prefixItems":[
        {"properties":{"harness":{"type":"string"},"id":{"type":"string"}}},
        {"properties":{"harness":{"type":"string"},"label":{"type":"string"}}}
    ]}}}}});
    let file =
        json!({"sessions":{"sources":[{"harness":1},{"harness":"b","label":"b","lable":"c"}]}});
    assert_eq!(
        read::<Typed>(schema, FILE, &file.to_string(), &[], true).await,
        concat!(
            "› Read configuration from .app.json.\n",
            "› Ignored sessions.sources[0] in .app.json: Invalid input: expected string, received number\n",
            "› Ignored sessions.sources[1].lable in .app.json: Unknown key. Check its spelling, or remove it.\n",
        )
    );
}

#[tokio::test]
async fn unknown_keys_with_invisible_differences_are_quoted_by_segment() {
    for (raw, shown) in [
        ("", r#""""#),
        ("stateDir ", r#""stateDirU+0020""#),
        (" stateDir", r#""U+0020stateDir""#),
        ("state\u{200b}Dir", r#""stateU+200BDir""#),
        ("state\u{a0}Dir", r#""stateU+00A0Dir""#),
        ("state\u{ad}Dir", r#""stateU+00ADDir""#),
        ("\u{feff}stateDir", r#""U+FEFFstateDir""#),
        ("\u{feff} x", r#""U+FEFFU+0020x""#),
        ("a\"\u{200b}b", r#""a\"U+200Bb""#),
        ("a\\\u{ad}b", r#""a\\U+00ADb""#),
        ("stateDir  ", r#""stateDirU+0020U+0020""#),
        ("a b\u{200b}c", r#""a bU+200Bc""#),
        (" a b ", r#""U+0020a bU+0020""#),
        ("stateDir\n", r#""stateDir\u000a""#),
        ("\tstateDir", r#""\u0009stateDir""#),
        ("stateDir\u{2028}", r#""stateDir\u2028""#),
    ] {
        assert_eq!(
            report(closed(), json!({raw:1})).await,
            read_line(FILE) + &line(shown),
            "{raw:?}"
        );
    }
    assert_eq!(
        report(closed(), json!({"sessions":{"sources":[{"harness":"a","na\u{200b}me":"x"}]},"updates":{" chanel":"x"}})).await,
        read_line(FILE) + &line(r#"sessions.sources[0]."naU+200Bme""#) + &line(r#"updates."U+0020chanel""#)
    );
}

#[tokio::test]
async fn a_visible_key_keeps_punctuation_and_core_escapes_controls_on_one_line() {
    let cases = [
        ("a b", "a b"),
        ("a\"b", "a\"b"),
        ("a.b", "a.b"),
        ("a\\b", "a\\b"),
        ("state_dir", "state_dir"),
        ("a\nb", r"a\u000ab"),
        ("a\u{1b}b", r"a\u001bb"),
        ("a\tb", r"a\u0009b"),
        ("stateDir\u{1b}", r"stateDir\u001b"),
        ("stateDir\u{202e}", r"stateDir\u202e"),
        ("x\u{85}", r"x\u0085"),
    ];
    let file = Value::Object(
        cases
            .iter()
            .map(|(raw, _)| ((*raw).to_owned(), json!(1)))
            .collect(),
    );
    assert_eq!(
        report(closed(), file).await,
        read_line(FILE)
            + &cases
                .iter()
                .map(|(_, shown)| line(shown))
                .collect::<String>()
    );
}

#[tokio::test]
async fn an_empty_dropped_key_has_its_own_line() {
    let text = read::<std::collections::BTreeMap<String, i64>>(
        Value::Null,
        FILE,
        r#"{"":"x","other":1}"#,
        &[],
        true,
    )
    .await;
    assert_eq!(
        text,
        "› Read configuration from .app.json.\n› Ignored  in .app.json: Invalid input: expected int, received string\n"
    );
}
