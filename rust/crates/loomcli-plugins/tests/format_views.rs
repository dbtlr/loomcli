//! Ports `format-views.test.ts`: the `json` and `jsonl` views through their own render function and
//! through `out.render` on the mock process.

#![cfg(feature = "format-views")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Application, Build, Command, Context, NoInputs, ProcessHandle, ReleaseFacts, RenderingPolicy,
    ResultViews, RunOptions, Switch, TerminalControls, ValueResult, View,
};
use loomcli_plugins::format::views::{json, json_mapped, jsonl, jsonl_mapped};
use loomcli_testing::{MockFields, ViewValues, mock_process, view_context};
use serde::{Serialize, Serializer};
use serde_json::{Value, json};

/// What one view writes for `data`, or the sentence it fails with.
fn written<D: Serialize + ?Sized + 'static>(view: &View<D>, data: &D) -> String {
    view.render(data, &view_context(ViewValues::new()))
        .unwrap_or_else(|_| panic!("the view failed"))
}

/// A value whose own `Serialize` decides what the view writes, as `toJSON` does in the reference.
struct Wrapped(Value);

impl Serialize for Wrapped {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        json!({ "wrapped": self.0 }).serialize(serializer)
    }
}

/// A value that cannot be written as JSON, as a `bigint` cannot in the reference.
struct Unencodable;

impl Serialize for Unencodable {
    fn serialize<S: Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
        Err(serde::ser::Error::custom("a secret engine reason"))
    }
}

/// What one invocation of a root action that renders `data` through `view` left behind.
async fn rendered<D: Serialize + Clone + Send + Sync + 'static>(
    view: View<D>,
    data: D,
    policy: RenderingPolicy,
    build: Build,
) -> (u8, String, String) {
    let application =
        Application::new("format-views")
            .rendering(policy)
            .action(move |ctx: Context| {
                let (view, data) = (view.clone(), data.clone());
                async move { ctx.out.render(&data, &view).await }
            });
    let process = mock_process(MockFields::new().release(ReleaseFacts::new(build)));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[test]
fn json_over_an_object_writes_one_indented_document() {
    assert_eq!(
        written(&json::<Value>(), &json!({ "count": 1, "name": "a" })),
        "{\n  \"count\": 1,\n  \"name\": \"a\"\n}\n"
    );
}

#[test]
fn json_over_an_array_writes_one_indented_document() {
    assert_eq!(
        written(&json::<Value>(), &json!([1, 2, 3])),
        "[\n  1,\n  2,\n  3\n]\n"
    );
}

#[test]
fn json_over_an_empty_array_writes_the_empty_array() {
    assert_eq!(written(&json::<Value>(), &json!([])), "[]\n");
}

#[test]
fn json_applies_its_map_before_encoding() {
    let view = json_mapped(|data: &Value| data["kept"].clone());
    assert_eq!(
        written(&view, &json!({ "discarded": "x", "kept": { "count": 2 } })),
        "{\n  \"count\": 2\n}\n"
    );
}

#[test]
fn json_honors_a_values_own_serialization() {
    assert_eq!(
        written(&json::<Wrapped>(), &Wrapped(json!(5))),
        "{\n  \"wrapped\": 5\n}\n"
    );
}

#[test]
fn jsonl_over_an_array_writes_one_compact_line_per_element() {
    assert_eq!(
        written(&jsonl::<Value>(), &json!([{ "count": 1 }, { "count": 2 }])),
        "{\"count\":1}\n{\"count\":2}\n"
    );
}

#[test]
fn jsonl_over_a_non_array_writes_one_compact_line() {
    assert_eq!(
        written(&jsonl::<Value>(), &json!({ "count": 1 })),
        "{\"count\":1}\n"
    );
}

#[test]
fn jsonl_over_an_empty_array_prints_nothing() {
    assert_eq!(written(&jsonl::<Value>(), &json!([])), "");
}

#[test]
fn jsonl_applies_its_map_before_encoding() {
    let view = jsonl_mapped(|rows: &Value| {
        rows.as_array()
            .unwrap()
            .iter()
            .map(|row| row["count"].clone())
            .collect::<Vec<_>>()
    });
    assert_eq!(
        written(&view, &json!([{ "count": 1 }, { "count": 2 }])),
        "1\n2\n"
    );
}

#[test]
fn jsonl_honors_each_elements_own_serialization() {
    let rows = vec![Wrapped(json!(1)), Wrapped(json!(2))];
    assert_eq!(
        written(&jsonl::<Vec<Wrapped>>(), &rows),
        "{\"wrapped\":1}\n{\"wrapped\":2}\n"
    );
}

#[test]
fn a_view_over_a_slice_writes_the_collected_rows() {
    let rows = [json!({ "a": 1 }), json!({ "a": 2 })];
    assert_eq!(
        written(&jsonl::<[Value]>(), &rows),
        "{\"a\":1}\n{\"a\":2}\n"
    );
    assert_eq!(
        written(&json::<[Value]>(), &rows[..1]),
        "[\n  {\n    \"a\": 1\n  }\n]\n"
    );
}

// Rust has no `undefined`: the reference's top-level `undefined` case has no counterpart, and
// the value that writes nothing is `None`, which JSON spells `null`.
#[test]
fn an_absent_value_is_null_because_rust_has_no_undefined() {
    assert_eq!(written(&json::<Option<u8>>(), &None), "null\n");
    assert_eq!(written(&jsonl::<Option<u8>>(), &None), "null\n");
}

#[test]
fn numbers_are_written_as_json_stringify_writes_them() {
    let numbers = json!([
        1.0,
        0.5,
        1e21,
        1.5e-7,
        123456789012345680000.0,
        0.000001,
        -0.0
    ]);
    assert_eq!(
        written(&jsonl::<Value>(), &numbers),
        "1\n0.5\n1e+21\n1.5e-7\n123456789012345680000\n0.000001\n0\n"
    );
    assert_eq!(
        written(&jsonl::<Vec<f64>>(), &vec![f64::NAN, f64::INFINITY]),
        "null\nnull\n"
    );
    assert_eq!(
        written(
            &jsonl::<Value>(),
            &json!({ "n": 100, "big": 9007199254740993_u64 })
        ),
        "{\"n\":100,\"big\":9007199254740993}\n"
    );
}

#[test]
fn strings_are_escaped_as_json_stringify_escapes_them() {
    assert_eq!(
        written(
            &jsonl::<Value>(),
            &json!("a\"b\\c\n\t\u{8}\u{c}\u{1}é\u{2028}")
        ),
        "\"a\\\"b\\\\c\\n\\t\\b\\f\\u0001é\u{2028}\"\n"
    );
}

#[test]
fn nested_empties_and_indentation_match_json_stringify() {
    assert_eq!(
        written(
            &json::<Value>(),
            &json!({ "a": [], "b": {}, "c": [{ "d": null }] })
        ),
        "{\n  \"a\": [],\n  \"b\": {},\n  \"c\": [\n    {\n      \"d\": null\n    }\n  ]\n}\n"
    );
}

#[test]
fn a_value_that_cannot_be_encoded_fails_with_one_fixed_sentence_and_keeps_its_cause() {
    let sentence = "The value cannot be encoded as JSON. Emit plain JSON data from the action.";
    for view in [json::<Unencodable>(), jsonl::<Unencodable>()] {
        let error = view
            .render(&Unencodable, &view_context(ViewValues::new()))
            .unwrap_err();
        let foreign = error.foreign().expect("a foreign error");
        assert_eq!(foreign.to_string(), sentence);
        let cause = std::error::Error::source(foreign).expect("the engine's error as the cause");
        assert!(cause.to_string().contains("a secret engine reason"));
    }
}

#[tokio::test]
async fn a_value_that_cannot_be_encoded_is_reported_at_exit_1() {
    let faulted = (
        1,
        String::new(),
        "format-views: Something went wrong.\n".to_owned(),
    );
    let (code, stdout, stderr) = rendered_unencodable(Build::Distributed).await;
    assert_eq!((code, stdout, stderr), faulted);
    let (code, _, stderr) = rendered_unencodable(Build::Development).await;
    assert_eq!(code, 1);
    assert!(stderr.contains(
        "\n\nThe value cannot be encoded as JSON. Emit plain JSON data from the action.\n"
    ));
}

/// The run of a root action that renders `Unencodable` through `jsonl()` and lets the failure
/// propagate.
async fn rendered_unencodable(build: Build) -> (u8, String, String) {
    let application = Application::new("format-views").action(|ctx: Context| async move {
        ctx.out.render(&Unencodable, &jsonl::<Unencodable>()).await
    });
    let process = mock_process(MockFields::new().release(ReleaseFacts::new(build)));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn del_and_the_c1_controls_print_as_escapes_under_every_color_setting() {
    let controls = format!("a{}b{}c{}d", '\u{1b}', '\u{9b}', '\u{7f}');
    for switch in [Switch::Never, Switch::Always] {
        for preserve in [false, true] {
            let mut policy = RenderingPolicy::new().color(switch);
            if preserve {
                policy = policy.terminal_controls(TerminalControls::Preserve);
            }
            assert_eq!(
                rendered(
                    jsonl::<String>(),
                    controls.clone(),
                    policy,
                    Build::Distributed
                )
                .await,
                (
                    0,
                    "\"a\\u001bb\\u009bc\\u007fd\"\n".to_owned(),
                    String::new()
                )
            );
        }
    }
}

#[test]
fn json_and_jsonl_declare_their_media_types_under_every_map() {
    let command = Command::new("count")
        .result(
            ResultViews::<Value>::new()
                .view("json", json::<Value>())
                .view("jsonl", jsonl::<Value>())
                .view("mappedJson", json_mapped(|data: &Value| data.clone()))
                .view("mappedJsonl", jsonl_mapped(|data: &Value| data.clone())),
        )
        .action(|_: Context<NoInputs, ValueResult<Value>>| async { Ok(()) });
    let graph = Application::new("app").command(command).inspect().unwrap();
    let result = serde_json::to_value(&graph.command(&["count"]).unwrap().result).unwrap();
    assert_eq!(
        result["mediaTypes"],
        json!({
            "json": "application/json",
            "jsonl": "application/jsonl",
            "mappedJson": "application/json",
            "mappedJsonl": "application/jsonl",
        })
    );
}
