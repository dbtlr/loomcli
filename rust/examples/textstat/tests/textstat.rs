//! Ports the reference's `textstat.test.ts`: one case for each capability the example's README
//! lists, each asserting exact bytes through the mock process.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::path::PathBuf;

use loomcli_testing::{assert_assembles, assert_described};
use support::{Ran, failed, printed, run_from};

/// A folder of its own for one test, holding `one.txt` (6 bytes) and `two.txt` (3 bytes).
fn folder(test: &str) -> PathBuf {
    let directory = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("textstat-{test}"));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("one.txt"), "hello\n").unwrap();
    std::fs::write(directory.join("two.txt"), "a b").unwrap();
    directory
}

/// Runs textstat from `directory`, which is also its home, with the stdin and variables given.
async fn run(directory: &std::path::Path, argv: &[&str], stdin: &str, env: &[(&str, &str)]) -> Ran {
    run_from(directory, directory, argv, stdin, env).await
}

#[test]
fn textstat_assembles_with_no_fault() {
    assert_assembles(&textstat::textstat());
    assert_described(&textstat::textstat());
}

#[tokio::test]
async fn the_files_and_piped_text_count_into_the_table_with_a_total_row_only_when_asked() {
    let directory = folder("table");
    assert_eq!(
        run(&directory, &["one.txt", "two.txt"], "", &[]).await,
        printed("COUNT  SOURCE\n    6  one.txt\n    3  two.txt\n    0  stdin\n")
    );
    assert_eq!(
        run(
            &directory,
            &["--metric", "words", "--total", "one.txt"],
            "one two three",
            &[]
        )
        .await,
        printed("COUNT  SOURCE\n    1  one.txt\n    3  stdin\n    4  total\n")
    );
}

#[tokio::test]
async fn the_byte_threshold_arrives_by_flag_alias_variable_or_configuration_file() {
    let directory = folder("threshold");
    let kept = printed("COUNT  SOURCE\n    6  one.txt\n");
    assert_eq!(
        run(
            &directory,
            &["--min-bytes", "4", "one.txt", "two.txt"],
            "",
            &[]
        )
        .await,
        kept
    );
    assert_eq!(
        run(
            &directory,
            &["--minimum", "4", "one.txt", "two.txt"],
            "",
            &[]
        )
        .await,
        kept
    );
    assert_eq!(
        run(
            &directory,
            &["one.txt", "two.txt"],
            "",
            &[("TEXTSTAT_MIN_BYTES", "4")]
        )
        .await,
        kept
    );
    std::fs::write(directory.join(".textstat.json"), "{ \"minBytes\": 4 }\n").unwrap();
    assert_eq!(
        run(&directory, &["one.txt", "two.txt"], "", &[]).await,
        kept
    );
    // The flag outranks the variable and the file.
    let flagged = run(
        &directory,
        &["--min-bytes", "0", "one.txt", "two.txt"],
        "",
        &[("TEXTSTAT_MIN_BYTES", "4")],
    )
    .await;
    assert!(flagged.stdout.contains("two.txt"));
}

#[tokio::test]
async fn the_catalog_validators_reject_a_value_before_the_action_naming_the_variable() {
    let directory = folder("validators");
    assert_eq!(
        run(
            &directory,
            &["one.txt"],
            "",
            &[("TEXTSTAT_MIN_BYTES", "-1")]
        )
        .await,
        failed(
            2,
            "textstat: Option \"--min-bytes\" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.\nRun \"textstat --help\" to see the usage.\n"
        )
    );
    let ran = run(&directory, &["--metric", "pages", "one.txt"], "", &[]).await;
    assert_eq!(ran.status, 2);
    assert!(ran.stderr.contains("bytes, words, lines"));
}

#[tokio::test]
async fn the_logging_plugin_appends_one_record_for_each_run_to_textstat_jsonl() {
    let directory = folder("logging");
    let state = directory.join("state");
    let ran = run(
        &directory,
        &["one.txt"],
        "",
        &[("XDG_STATE_HOME", &state.to_string_lossy())],
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let text = std::fs::read_to_string(state.join("textstat").join("textstat.jsonl")).unwrap();
    let record: serde_json::Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(record["level"], "info");
    assert_eq!(record["message"], "Counted the sources.");
}

#[tokio::test]
async fn the_hidden_timing_writes_its_info_line_to_stderr_and_help_does_not_list_it() {
    let directory = folder("timing");
    let ran = run(&directory, &["--timing", "one.txt"], "", &[]).await;
    assert!(ran.stdout.contains("one.txt"));
    let line = ran.stderr.strip_suffix("ms\n").expect("a timing line");
    let digits = line.strip_prefix("ℹ elapsed: ").unwrap_or(line);
    assert!(
        digits
            .rsplit(' ')
            .next()
            .unwrap()
            .chars()
            .all(|c| c.is_ascii_digit()),
        "{:?}",
        ran.stderr
    );
    let help = run(&directory, &["--help"], "", &[]).await;
    assert!(!help.stdout.contains("--timing"));
}

#[tokio::test]
async fn the_formatter_prints_the_declared_rows_as_json_in_place_of_the_table() {
    let directory = folder("json");
    let ran = run(
        &directory,
        &["--format", "json", "--total", "one.txt"],
        "",
        &[],
    )
    .await;
    let rows: serde_json::Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(
        rows,
        serde_json::json!([
            { "count": 6, "source": "one.txt" },
            { "count": 0, "source": "stdin" },
            { "count": 6, "source": "total" }
        ])
    );
}

#[tokio::test]
async fn help_explain_manifest_and_suggestions_describe_the_same_assembled_graph() {
    let directory = folder("describe");
    let help = run(&directory, &["--help"], "", &[]).await;
    assert_eq!(help.status, 0);
    assert!(
        help.stdout
            .contains("Textstat counts files and piped text in order.")
    );
    assert!(help.stdout.contains("--format"));
    assert!(help.stdout.contains("textstat --metric words --total *.md"));
    let explain = run(&directory, &["missing.txt", "--explain"], "", &[]).await;
    assert_eq!(explain.status, 0);
    assert!(
        explain
            .stdout
            .contains("Count bytes, words, or lines across text sources.")
    );
    let manifest = run(&directory, &["-M"], "", &[]).await;
    let document: serde_json::Value = serde_json::from_str(&manifest.stdout).unwrap();
    assert_eq!(document["name"], "textstat");
    assert!(!manifest.stdout.contains("timing"));
    let near = run(&directory, &["--totl", "one.txt"], "", &[]).await;
    assert_eq!(near.status, 2);
    assert!(near.stderr.contains("Did you mean \"--total\"?"));
}

#[tokio::test]
async fn the_delimiter_and_first_file_allow_hyphenated_names_and_child_names_as_files() {
    let directory = folder("delimiter");
    std::fs::write(directory.join("-notes.txt"), "abc").unwrap();
    std::fs::write(directory.join("completion"), "abcd").unwrap();
    for (argv, rows) in [
        (
            &["one.txt", "--", "-notes.txt"][..],
            "    6  one.txt\n    3  -notes.txt\n",
        ),
        (
            &["one.txt", "completion"][..],
            "    6  one.txt\n    4  completion\n",
        ),
        (&["--", "completion"][..], "    4  completion\n"),
    ] {
        let result = run(&directory, argv, "", &[]).await;
        assert_eq!(result.status, 0);
        assert!(result.stderr.is_empty());
        assert!(result.stdout.contains(rows), "{}", result.stdout);
    }
}

#[tokio::test]
async fn completion_routes_and_offers_children_or_files() {
    let directory = folder("completion");
    let bash = run(&directory, &["completion", "bash"], "", &[]).await;
    assert_eq!(bash.status, 0);
    assert!(bash.stdout.contains("textstat"));
    let group = run(&directory, &["completion"], "", &[]).await;
    assert_eq!(group.status, 2);
    assert!(group.stdout.is_empty());
    assert!(
        group
            .stderr
            .contains("Command \"completion\" requires a subcommand.")
    );
    assert!(
        group
            .stderr
            .contains("To pass \"completion\" as an argument, write -- before it.")
    );
    assert_eq!(
        run(
            &directory,
            &["completion", "__complete", "--", "co"],
            "",
            &[]
        )
        .await,
        printed("completion\tPrint or install a shell completion script.\n:0\n")
    );
    assert_eq!(
        run(
            &directory,
            &["completion", "__complete", "--", "a"],
            "",
            &[]
        )
        .await,
        printed(":0\n")
    );
}
