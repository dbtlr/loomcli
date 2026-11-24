//! Ports the reference's `jsonkit.test.ts`: one case for each capability the example's README
//! lists, which shows how the declaration assembles Loom's parts, each asserting exact bytes
//! through the mock process. Whole output is compared with the shared expectations outside
//! listed differences. Each action also runs with the testing crate's context builders.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use conformance_harness::compare::Part;
use conformance_harness::runner::assert_part;
use jsonkit::actions::get_value::{GetInputs, get_value};
use jsonkit::actions::list_keys::{KeysInputs, list_keys};
use jsonkit::actions::max_depth::{MaxInputs, max_depth};
use jsonkit::actions::select_fields::{SelectInputs, select_fields};
use jsonkit::json::{format_json, javascript_number, object_entries};
use loomcli_core::{Context, FailureFacts, ProcessHandle};
use loomcli_testing::{
    ActionValues, MockFields, action_context, assert_assembles, assert_described, file_content,
    mock_process, piped_content,
};
use support::{Ran, captured, failed, files_under, printed, run_from};

/// A folder of its own for one test, holding the reference test's `doc.json` and the malformed
/// `broken.json`.
fn folder(test: &str) -> PathBuf {
    let directory = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("jsonkit-{test}"));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(
        directory.join("doc.json"),
        r#"{"name":"loom","tags":["a","b"],"nested":{"deep":{"value":"found"}}}"#,
    )
    .unwrap();
    std::fs::write(directory.join("broken.json"), r#"{"name":"#).unwrap();
    directory
}

/// Runs jsonkit in this process from `directory`, its home, with the stdin a case pipes.
async fn run_in(directory: &Path, argv: &[&str], stdin: &str) -> Ran {
    run_from(directory, directory, argv, stdin, &[]).await
}

fn assert_reference(id: &str, actual: Ran) {
    let expected = captured(id).expected;
    assert_part(id, Part::Stdout, &actual.stdout, &expected.stdout);
    assert_part(id, Part::Stderr, &actual.stderr, &expected.stderr);
    assert_part(id, Part::Exit, &actual.status, &expected.status);
}

#[test]
fn jsonkit_assembles_with_no_fault() {
    assert_assembles(&jsonkit::jsonkit());
    assert_described(&jsonkit::jsonkit());
}

#[tokio::test]
async fn each_modular_command_reads_the_document_from_file_or_from_piped_text() {
    let directory = folder("reads");
    assert_eq!(
        run_in(
            &directory,
            &["get", "nested.deep.value", "-f", "doc.json"],
            ""
        )
        .await,
        printed("\"found\"\n")
    );
    assert_eq!(
        run_in(&directory, &["keys"], r#"{"b":1,"a":2}"#).await,
        printed("b\na\n")
    );
    assert_eq!(
        run_in(
            &directory,
            &[
                "select", "--field", "name", "-F", "missing", "-f", "doc.json"
            ],
            ""
        )
        .await,
        Ran {
            status: 0,
            stdout: "{\n  \"name\": \"loom\"\n}\n".to_owned(),
            stderr: "⚠ Field not found: \"missing\". Run jsonkit keys to list the fields.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn selects_repeated_field_rejects_an_empty_value_through_the_catalogs_text() {
    assert_eq!(
        run_in(
            &folder("empty-field"),
            &["select", "--field", "", "-f", "doc.json"],
            ""
        )
        .await,
        failed(
            2,
            "jsonkit: Option \"--field\" at 0: Expected a nonempty value.\nRun \"jsonkit select --help\" to see the usage.\n"
        )
    );
}

#[tokio::test]
async fn an_alias_a_deprecated_command_and_a_path_three_levels_deep_all_route() {
    let directory = folder("routes");
    let keys = run_in(&directory, &["keys", "-f", "doc.json"], "").await;
    assert_eq!(keys, printed("name\ntags\nnested\n"));
    assert_eq!(
        run_in(&directory, &["ls", "-f", "doc.json"], "").await,
        keys
    );
    assert_eq!(
        run_in(&directory, &["fetch", "name", "-f", "doc.json"], "").await,
        printed("\"loom\"\n")
    );
    assert_eq!(
        run_in(&directory, &["stats", "depth", "max", "-f", "doc.json"], "").await,
        printed("3\n")
    );
}

#[tokio::test]
async fn an_unknown_command_lists_the_visible_ones_leaving_out_hidden_and_deprecated_commands() {
    assert_eq!(
        run_in(&folder("typo"), &["typo", "-f", "doc.json"], "").await,
        failed(
            2,
            "jsonkit: Unknown command \"typo\". Use one of: help, doctor, completion, mcp, manpage, get, keys, select, stats.\nRun \"jsonkit --help\" to see the usage.\n"
        )
    );
}

#[tokio::test]
async fn the_doctor_plugins_command_runs_at_the_root_without_a_document() {
    let rule = "─".repeat(80);
    assert_eq!(
        run_in(&folder("doctor"), &["doctor"], "").await,
        printed(&format!(
            "Host checks\n───────────\n● Platform: linux\n● Output: not a terminal\n{rule}\n╭─ Result ───────────╮\n│ All checks passed. │\n╰────────────────────╯\n"
        ))
    );
}

#[tokio::test]
async fn the_verbose_plugin_decides_whether_the_readers_debug_line_prints() {
    let directory = folder("verbose");
    assert_eq!(
        run_in(&directory, &["-v", "keys", "-f", "doc.json"], "").await,
        Ran {
            status: 0,
            stdout: "name\ntags\nnested\n".to_owned(),
            stderr: "› Reading doc.json.\n".to_owned(),
        }
    );
    assert_eq!(
        run_in(&directory, &["keys", "-f", "doc.json"], "")
            .await
            .stderr,
        ""
    );
}

#[tokio::test]
async fn the_root_result_prints_records_and_the_formatter_turns_it_into_json() {
    let directory = folder("root");
    assert_eq!(
        run_in(&directory, &["-f", "doc.json"], "").await,
        Ran {
            status: 0,
            stdout: "key   name\nkind  string\n\nkey   tags\nkind  array with 2 items\n\nkey   nested\nkind  object with 1 key\n\n3 records\n".to_owned(),
            stderr: "ℹ object with 3 keys\n".to_owned(),
        }
    );
    assert_eq!(
        run_in(&directory, &["--format", "json", "-f", "doc.json"], "").await,
        Ran {
            status: 0,
            stdout: "[\n  {\n    \"key\": \"name\",\n    \"kind\": \"string\"\n  },\n  {\n    \"key\": \"tags\",\n    \"kind\": \"array with 2 items\"\n  },\n  {\n    \"key\": \"nested\",\n    \"kind\": \"object with 1 key\"\n  }\n]\n".to_owned(),
            stderr: "ℹ object with 3 keys\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn the_hidden_paths_sequence_writes_one_json_line_per_path_through_the_formatter() {
    assert_eq!(
        run_in(
            &folder("paths"),
            &["paths", "-o", "jsonl", "-f", "doc.json"],
            ""
        )
        .await,
        printed(concat!(
            "{\"kind\":\"object with 3 keys\",\"path\":\".\"}\n",
            "{\"kind\":\"string\",\"path\":\"name\"}\n",
            "{\"kind\":\"array with 2 items\",\"path\":\"tags\"}\n",
            "{\"kind\":\"string\",\"path\":\"tags.0\"}\n",
            "{\"kind\":\"string\",\"path\":\"tags.1\"}\n",
            "{\"kind\":\"object with 1 key\",\"path\":\"nested\"}\n",
            "{\"kind\":\"object with 1 key\",\"path\":\"nested.deep\"}\n",
            "{\"kind\":\"string\",\"path\":\"nested.deep.value\"}\n",
        ))
    );
}

#[tokio::test]
async fn a_sequence_that_stops_early_leaves_its_rows_and_the_incomplete_line() {
    assert_eq!(
        run_in(
            &folder("boom"),
            &["paths"],
            r#"{"a":1,"boom":{"b":2},"c":3}"#
        )
        .await,
        Ran {
            status: 1,
            stdout: "kind  object with 3 keys\npath  .\n\nkind  number\npath  a\n".to_owned(),
            stderr: "Output is incomplete: Command \"paths\" stopped after 2 rows, 2 written.\nCannot walk boom. Remove the \"boom\" key from the document.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_declared_failure_and_a_translated_parse_error_each_exit_65_through_the_fatal_view() {
    let directory = folder("fatal");
    assert_eq!(
        run_in(&directory, &["get", "missing", "-f", "doc.json"], "").await,
        failed(
            65,
            "Path not found: \"missing\". Run jsonkit keys to list the keys at the root.\n"
        )
    );
    assert_eq!(
        run_in(&directory, &["get", "name", "-f", "broken.json"], "").await,
        failed(
            65,
            "The document is not valid JSON. Correct its syntax, or supply another document.\n"
        )
    );
}

#[tokio::test]
async fn help_prints_the_details_get_md_carries_and_version_the_declared_version() {
    let directory = folder("help");
    let help = run_in(&directory, &["get", "--help"], "").await;
    assert!(
        help.stdout
            .contains("A path is a dot-separated walk from the root of the document.")
    );
    assert_reference("jsonkit-help-get-long", help);
    assert_eq!(
        run_in(&directory, &["--version"], "").await,
        printed("jsonkit v0.0.0\n")
    );
}

#[tokio::test]
async fn the_color_plugin_forces_the_themes_colors_onto_a_piped_help_page() {
    let directory = folder("color");
    let plain = run_in(&directory, &["--help"], "").await;
    assert!(!plain.stdout.contains('\u{1b}'));
    assert_reference("jsonkit-help-root-long", plain);
    let colored = run_in(&directory, &["--help", "--color"], "").await;
    assert!(colored.stdout.contains("\u{1b}["));
    assert_reference("jsonkit-color-help-with-color-flag", colored);
}

#[tokio::test]
async fn the_example_plugin_explains_the_routed_command_without_reading_a_document() {
    assert_eq!(
        run_in(&folder("explain"), &["get", "--explain"], "").await,
        printed(
            "jsonkit get\nRead one value at a path.\nA path is a dot-separated walk from the root of the document.\n  jsonkit get name -f doc.json\n  jsonkit get nested.deep.value -f doc.json\n"
        )
    );
}

#[tokio::test]
async fn an_unknown_option_points_at_the_explanation_of_the_command_reached() {
    assert_eq!(
        run_in(&folder("hint"), &["select", "--bogus"], "").await,
        failed(
            2,
            "jsonkit: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\nRun \"jsonkit select --help\" to see the usage.\nRun \"jsonkit select --explain\" to explain this command.\n"
        )
    );
}

#[tokio::test]
async fn the_manifest_and_inspect_describe_the_graph_without_the_hidden_commands() {
    let manifest = run_in(&folder("manifest"), &["--manifest"], "").await;
    assert!(manifest.stdout.contains("\"name\": \"jsonkit\""));
    assert!(!manifest.stdout.contains("\"debug\""));
    let graph = serde_json::to_string(&jsonkit::jsonkit().inspect().unwrap()).unwrap();
    assert!(graph.contains("\"minLength\":1"));
}

#[tokio::test]
async fn completion_answers_a_word_three_levels_below_the_root() {
    assert_reference(
        "jsonkit-completion-protocol-nested-prefix-max",
        run_in(
            &folder("completion"),
            &["completion", "__complete", "--", "stats", "depth", "m"],
            "",
        )
        .await,
    );
}

#[tokio::test]
async fn the_mcp_server_lists_the_document_commands_as_tools() {
    let requests = [
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"conformance","version":"0"}}}"#,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
    ];
    let stdin: String = requests.iter().map(|line| format!("{line}\n")).collect();
    let listed = run_in(&folder("mcp"), &["mcp"], &stdin).await;
    assert!(listed.stdout.contains("\"stats_depth_max\""));
    assert_reference("jsonkit-mcp-tools-list-2025-06-18", listed);
}

#[tokio::test]
async fn manpage_writes_a_page_for_each_visible_command_three_levels_deep_included() {
    let directory = folder("manpage");
    let out = directory.join("man");
    let ran = run_in(
        &directory,
        &["manpage", "generate", "--out", &out.to_string_lossy()],
        "",
    )
    .await;
    assert_eq!(ran.status, 0);
    let mut written = BTreeMap::new();
    files_under(&directory, &out, &mut written);
    assert!(written.contains_key("man/jsonkit-get.1"));
    assert!(written.contains_key("man/jsonkit-stats-depth-max.1"));
    let id = "jsonkit-manpage-generate";
    assert_part(id, Part::Files, &written, &captured(id).files);
}

fn get_inputs(file: loomcli_core::Content, path: &str) -> GetInputs {
    GetInputs {
        file,
        path: path.to_owned(),
    }
}

/// A mock process whose output a test reads back after an action ran on it.
fn process() -> Arc<loomcli_testing::MockProcess> {
    mock_process(MockFields::new())
}

#[tokio::test]
async fn get_value_prints_the_value_at_the_path_of_a_file() {
    let directory = folder("unit-get");
    let process = process();
    let ctx: Context<GetInputs> = action_context(
        ActionValues::new(get_inputs(file_content(&directory, "doc.json"), "tags"))
            .process(Arc::clone(&process) as Arc<dyn ProcessHandle>),
    );
    get_value(ctx).await.unwrap();
    assert_eq!(process.stdout_text(), "[\n  \"a\",\n  \"b\"\n]\n");
    assert_eq!(process.stderr_text(), "");
}

#[tokio::test]
async fn get_value_returns_the_path_not_found_failure_for_a_missing_path() {
    let ctx: Context<GetInputs> = action_context(ActionValues::new(get_inputs(
        piped_content(r#"{"a":{}}"#),
        "a.b",
    )));
    let error = get_value(ctx).await.unwrap_err();
    let failure = error
        .downcast_failure::<jsonkit::resolve_path::PathNotFoundError>()
        .expect("the path's failure");
    assert_eq!(
        failure.message(),
        "Path not found: \"a.b\". Run jsonkit keys to list the keys at the root."
    );
}

#[tokio::test]
async fn get_value_returns_the_parse_error_the_translator_turns_into_invalid_json() {
    let ctx: Context<GetInputs> =
        action_context(ActionValues::new(get_inputs(piped_content("{"), "a")));
    let error = get_value(ctx).await.unwrap_err();
    assert!(
        error
            .foreign()
            .is_some_and(|foreign| foreign.is::<serde_json::Error>())
    );
}

#[tokio::test]
async fn list_keys_prints_the_keys_in_javascript_order_and_names_the_root_for_no_path() {
    let process = process();
    let ctx: Context<KeysInputs> = action_context(
        ActionValues::new(KeysInputs {
            file: piped_content(r#"{"b":1,"a":2,"10":3,"2":4}"#),
            path: None,
        })
        .process(Arc::clone(&process) as Arc<dyn ProcessHandle>),
    );
    list_keys(ctx).await.unwrap();
    assert_eq!(process.stdout_text(), "2\n10\nb\na\n");

    let ctx: Context<KeysInputs> = action_context(ActionValues::new(KeysInputs {
        file: piped_content("[1]"),
        path: None,
    }));
    let error = list_keys(ctx).await.unwrap_err();
    assert_eq!(
        error.failure().unwrap().message(),
        "Expected an object at the root; found array with 1 item. Run jsonkit paths to find the paths that hold objects."
    );

    let ctx: Context<KeysInputs> = action_context(ActionValues::new(KeysInputs {
        file: piped_content(r#"{"a":{"b":"c"}}"#),
        path: Some("a.b".to_owned()),
    }));
    let error = list_keys(ctx).await.unwrap_err();
    assert_eq!(
        error.failure().unwrap().message(),
        "Expected an object at a.b; found string. Run jsonkit paths to find the paths that hold objects."
    );
}

#[tokio::test]
async fn max_depth_counts_each_array_and_object_that_nests() {
    for (document, path, depth) in [
        ("1", None, "0\n"),
        ("[]", None, "1\n"),
        ("{}", None, "1\n"),
        (r#"[[[[]]]]"#, None, "4\n"),
        (r#"{"a":[1,{"b":[]}],"c":2}"#, None, "4\n"),
        (r#"{"a":[1,{"b":[]}],"c":2}"#, Some("a.1"), "2\n"),
        (r#"{"a":[1,{"b":[]}],"c":2}"#, Some("c"), "0\n"),
    ] {
        let process = process();
        let ctx: Context<MaxInputs> = action_context(
            ActionValues::new(MaxInputs {
                file: piped_content(document),
                path: path.map(str::to_owned),
            })
            .process(Arc::clone(&process) as Arc<dyn ProcessHandle>),
        );
        max_depth(ctx).await.unwrap();
        assert_eq!(process.stdout_text(), depth, "{document} at {path:?}");
    }
}

#[tokio::test]
async fn select_fields_warns_once_per_missing_field_and_keeps_the_first_occurrence_order() {
    let process = process();
    let ctx: Context<SelectInputs> = action_context(
        ActionValues::new(SelectInputs {
            file: piped_content(r#"{"b":1,"a":2,"2":"two","1":"one"}"#),
            field: ["a", "zzz", "b", "a", "zzz", "2", "1"]
                .map(str::to_owned)
                .to_vec(),
        })
        .process(Arc::clone(&process) as Arc<dyn ProcessHandle>),
    );
    select_fields(ctx).await.unwrap();
    // The integer keys come first, in ascending order, as a JavaScript object holds them.
    assert_eq!(
        process.stdout_text(),
        "{\n  \"1\": \"one\",\n  \"2\": \"two\",\n  \"a\": 2,\n  \"b\": 1\n}\n"
    );
    assert_eq!(
        process.stderr_text(),
        "⚠ Field not found: \"zzz\". Run jsonkit keys to list the fields.\n"
    );
}

#[tokio::test]
async fn select_fields_fails_on_a_document_whose_root_is_no_object() {
    let ctx: Context<SelectInputs> = action_context(ActionValues::new(SelectInputs {
        file: piped_content("[1]"),
        field: vec!["a".to_owned()],
    }));
    let error = select_fields(ctx).await.unwrap_err();
    assert_eq!(
        error.failure().unwrap().message(),
        "Expected an object at the root; found array with 1 item. Supply a document whose root is an object."
    );
}

#[test]
fn numbers_print_as_javascript_writes_them() {
    for (number, written) in [
        (0.0, "0"),
        (-0.0, "0"),
        (1.0, "1"),
        (100.0, "100"),
        (51.5, "51.5"),
        (-0.12, "-0.12"),
        (0.1, "0.1"),
        (0.000_001, "0.000001"),
        (1e-7, "1e-7"),
        (1.5e-7, "1.5e-7"),
        (123_456_789_012_345_680_000.0, "123456789012345680000"),
        (1e21, "1e+21"),
        (1.5e300, "1.5e+300"),
        (9_007_199_254_740_993.0, "9007199254740992"),
    ] {
        assert_eq!(javascript_number(number), written, "{number}");
    }
}

#[test]
fn a_document_prints_as_json_stringify_writes_what_json_parse_read() {
    let document: serde_json::Value = serde_json::from_str(
        r#"{"z":1.0,"10":true,"2":null,"01":[],"x":{},"4294967295":"big","a":[1e2,"\u001b",{"k":"v"}]}"#,
    )
    .unwrap();
    assert_eq!(
        format_json(&document),
        "{\n  \"2\": null,\n  \"10\": true,\n  \"z\": 1,\n  \"01\": [],\n  \"x\": {},\n  \"4294967295\": \"big\",\n  \"a\": [\n    100,\n    \"\\u001b\",\n    {\n      \"k\": \"v\"\n    }\n  ]\n}"
    );
    let serde_json::Value::Object(members) = &document else {
        unreachable!()
    };
    assert_eq!(
        object_entries(members)
            .into_iter()
            .map(|(key, _)| key.as_str())
            .collect::<Vec<_>>(),
        ["2", "10", "z", "01", "x", "4294967295", "a"]
    );
    assert_eq!(format_json(&serde_json::json!("text")), "\"text\"");
}
