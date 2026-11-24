//! Declared failures in the manifest, ported from the reference's `manifest-failures.test.ts`: the
//! exit-code table, the per-Command lists, and the failure-code conflict.

#![cfg(feature = "manifest")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod manifest_support;

use loomcli_core::{
    Application, Build, Command, EX_DATAERR, EX_SOFTWARE, EX_UNAVAILABLE, Failure, FatalError,
    Plugin,
};
use loomcli_plugins::manifest::extension::{
    DeclaredFailure, MANIFEST_COMMAND, ManifestCommandFacts,
};
use loomcli_plugins::manifest::manifest;
use manifest_support::{App, Ran, core_exit_codes, dispatched, document_of, keys, run, run_as};
use serde_json::{Value, json};

#[derive(Debug, Failure)]
#[failure(code = "bad-data", exit_code = EX_DATAERR)]
struct BadDataError {
    #[failure(base)]
    base: FatalError,
}

#[derive(Debug, Failure)]
#[failure(code = "inner-bad")]
struct InnerBadError {
    #[failure(base)]
    base: BadDataError,
}

#[derive(Debug, Failure)]
#[failure(code = "write-bad")]
struct WriteBadError {
    #[failure(base)]
    base: BadDataError,
}

#[derive(Debug, Failure)]
#[failure(code = "unavailable", exit_code = EX_UNAVAILABLE)]
struct UnavailableError {
    #[failure(base)]
    base: FatalError,
}

#[derive(Debug, Failure)]
#[failure(code = "software-fault", exit_code = EX_SOFTWARE)]
struct SoftwareError {
    #[failure(base)]
    base: FatalError,
}

/// A class that declares neither code, so it inherits 1 and `fatal`.
#[derive(Debug, Failure)]
struct PlainError {
    #[failure(base)]
    base: FatalError,
}

/// A class that declares 2, whose row core's own row already explains.
#[derive(Debug, Failure)]
#[failure(code = "refused", exit_code = 2)]
struct RefusedError {
    #[failure(base)]
    base: FatalError,
}

#[derive(Debug, Failure)]
#[failure(code = "invalid-json", exit_code = EX_DATAERR)]
struct InvalidJsonError {
    #[failure(base)]
    base: FatalError,
}

/// A second class under the same failure code that declares no exit code, so it exits 1.
#[derive(Debug, Failure)]
#[failure(code = "invalid-json")]
struct LooseJsonError {
    #[failure(base)]
    base: FatalError,
}

fn facts(failures: Vec<DeclaredFailure>) -> ManifestCommandFacts {
    ManifestCommandFacts::new().failures(failures)
}

fn bad_data() -> DeclaredFailure {
    DeclaredFailure::of::<BadDataError>("The data is bad.")
}

/// A plugin that supplies an entry identical to the author's, and one of its own, on `read`.
fn supplier() -> Plugin {
    Plugin::new("@fixture/supplier").on_command_attach(|command| {
        if command.name() == Some("read") {
            command.extend([MANIFEST_COMMAND.value(facts(vec![
                bad_data(),
                DeclaredFailure::of::<UnavailableError>("The service is down."),
            ]))])?;
        }
        Ok(())
    })
}

/// Every declared-failure rule, spread over a small application. `inner` sits under `group` ahead
/// of `write`, so its code is met before `write`'s only in a depth-first walk.
fn application() -> App {
    let read = Command::new("read")
        .description("The read command.")
        .action(dispatched)
        .extend([MANIFEST_COMMAND.value(facts(vec![bad_data()]))]);
    let inner = Command::new("inner")
        .description("The inner command.")
        .action(dispatched)
        .extend([
            MANIFEST_COMMAND.value(facts(vec![DeclaredFailure::of::<InnerBadError>(
                "The inner data is bad.",
            )])),
        ]);
    let group = Command::new("group")
        .description("The group command.")
        .command(inner);
    let write = Command::new("write")
        .description("The write command.")
        .action(dispatched)
        .extend([MANIFEST_COMMAND.value(facts(vec![
            DeclaredFailure::of::<WriteBadError>("The written data is bad."),
            bad_data(),
        ]))]);
    let plain = Command::new("plain")
        .description("The plain command.")
        .action(dispatched)
        .extend([MANIFEST_COMMAND.value(facts(vec![
            DeclaredFailure::of::<PlainError>("Something plain failed."),
            DeclaredFailure::of::<RefusedError>("The request was refused."),
        ]))]);
    let secret = Command::new("secret")
        .description("The secret command.")
        .hidden()
        .action(dispatched)
        .extend([
            MANIFEST_COMMAND.value(facts(vec![DeclaredFailure::of::<SoftwareError>("A bug.")]))
        ]);
    let none = Command::new("none")
        .description("The none command.")
        .action(dispatched);
    Application::new("app")
        .description("The app application.")
        .plugins((manifest(), supplier()))
        .command(read)
        .command(group)
        .command(write)
        .command(plain)
        .command(secret)
        .command(none)
        .action(dispatched)
}

fn expected_table() -> Value {
    let mut table = core_exit_codes();
    table.insert(
        "65".into(),
        json!("Declared failures: bad-data, inner-bad, write-bad"),
    );
    table.insert("69".into(), json!("Declared failures: unavailable"));
    table.insert("70".into(), json!("Declared failures: software-fault"));
    let mut rows: Vec<(String, Value)> = table.into_iter().collect();
    rows.sort_by_key(|(code, _)| code.parse::<u16>().unwrap());
    Value::Object(rows.into_iter().collect())
}

async fn failures_of(name: &str) -> Value {
    let document = document_of(&application(), &["--manifest"]).await;
    document["command"]["children"]
        .as_array()
        .unwrap()
        .iter()
        .find(|child| child["name"] == name)
        .unwrap_or_else(|| panic!("the document holds no child {name:?}"))["failures"]
        .clone()
}

#[tokio::test]
async fn the_table_joins_each_declared_code_to_core_rows_in_ascending_order_naming_failures_depth_first()
 {
    let ran = run(&application(), &["--manifest"]).await;
    let document: Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(document["exitCodes"], expected_table());
    assert_eq!(
        keys(&document["exitCodes"]),
        [
            "0", "1", "2", "65", "69", "70", "129", "130", "131", "141", "143"
        ]
    );
    assert!(
        ran.stdout
            .contains("\"65\": \"Declared failures: bad-data, inner-bad, write-bad\"")
    );
}

#[tokio::test]
async fn every_slice_carries_the_whole_application_table_a_hidden_command_included() {
    let application = application();
    let none = document_of(&application, &["none", "--manifest"]).await;
    assert_eq!(none["exitCodes"], expected_table());
    let secret = document_of(&application, &["secret", "--manifest"]).await;
    assert_eq!(
        secret["command"]["failures"],
        json!([{ "code": "software-fault", "exitCode": 70, "meaning": "A bug." }])
    );
}

#[tokio::test]
async fn a_command_with_no_declared_failures_reads_an_empty_list() {
    assert_eq!(failures_of("none").await, json!([]));
    let document = document_of(&application(), &["--manifest"]).await;
    assert_eq!(document["command"]["failures"], json!([]));
}

#[tokio::test]
async fn an_author_value_and_a_plugin_value_concatenate_in_collection_order_and_an_identical_entry_prints_once()
 {
    assert_eq!(
        failures_of("read").await,
        json!([
            { "code": "bad-data", "exitCode": 65, "meaning": "The data is bad." },
            { "code": "unavailable", "exitCode": 69, "meaning": "The service is down." },
        ])
    );
}

#[tokio::test]
async fn an_entry_lists_its_failure_code_exit_code_and_meaning_in_that_key_order() {
    assert_eq!(
        keys(&failures_of("read").await[0]),
        ["code", "exitCode", "meaning"]
    );
}

#[tokio::test]
async fn one_failure_code_on_two_commands_with_one_exit_code_and_meaning_is_listed_on_both() {
    assert_eq!(
        failures_of("write").await,
        json!([
            { "code": "write-bad", "exitCode": 65, "meaning": "The written data is bad." },
            { "code": "bad-data", "exitCode": 65, "meaning": "The data is bad." },
        ])
    );
}

#[tokio::test]
async fn a_class_that_declares_neither_code_lists_1_and_fatal_and_a_class_that_declares_2_lists_2_and_neither_adds_a_row()
 {
    assert_eq!(
        failures_of("plain").await,
        json!([
            { "code": "fatal", "exitCode": 1, "meaning": "Something plain failed." },
            { "code": "refused", "exitCode": 2, "meaning": "The request was refused." },
        ])
    );
    let document = document_of(&application(), &["--manifest"]).await;
    assert_eq!(
        document["exitCodes"]["1"],
        json!("Expected action failure, internal failure, or invalid declarations")
    );
    assert_eq!(
        document["exitCodes"]["2"],
        json!("Invalid invocation inputs")
    );
}

const NOT_JSON: &str = "The document is not valid JSON.";

fn get_with(
    first: DeclaredFailure,
) -> Command<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Command::new("get")
        .action(dispatched)
        .extend([MANIFEST_COMMAND.value(facts(vec![first]))])
}

/// An application where `invalid-json` is declared on `get` and again by `second`.
fn conflicting(second: DeclaredFailure, on_get: bool) -> App {
    let first = DeclaredFailure::of::<InvalidJsonError>(NOT_JSON);
    let application = Application::new("app").plugins((manifest(),));
    if on_get {
        let get = Command::new("get")
            .action(dispatched)
            .extend([MANIFEST_COMMAND.value(facts(vec![first, second]))]);
        return application.command(get).action(dispatched);
    }
    let select = Command::new("select")
        .action(dispatched)
        .extend([MANIFEST_COMMAND.value(facts(vec![second]))]);
    application
        .command(get_with(first))
        .command(select)
        .action(dispatched)
}

fn finding(failure: &DeclaredFailure, on: &str) -> String {
    let line = format!(
        "    MANIFEST_COMMAND.value(ManifestCommandFacts::new().failures([DeclaredFailure::new({:?}, {}, {:?})]))",
        failure.code, failure.exit_code, failure.meaning
    );
    let start = line.find("failures(").unwrap();
    let length = line.len() - 1 - start;
    format!(
        "{line}\n{}{} on {on}",
        " ".repeat(start),
        "^".repeat(length)
    )
}

/// What a conflict reports: the Developer Diagnostic in a development build, and the generic
/// message in a distributed one.
async fn conflict_reports(application: &App, argv: &[&str]) -> (Ran, Ran) {
    (
        run_as(application, argv, Build::Development).await,
        run(application, argv).await,
    )
}

fn assert_conflict(
    reports: &(Ran, Ran),
    sentence: &str,
    first: (&DeclaredFailure, &str),
    second: (&DeclaredFailure, &str),
) {
    let (development, distributed) = reports;
    assert_eq!((development.status, development.stdout.as_str()), (1, ""));
    let stderr = &development.stderr;
    let expected = format!(
        "-- FAILURE CODE CONFLICT ------- @loomcli/plugins/manifest/failure-code-conflict\n\n{sentence}\n\n{}\n\n{}\n\nThe manifest lists each failure code once for the whole application, with one\nexit code and one meaning, so a consumer reads one contract for each code. Two\ndeclarations of one code that disagree leave it no single entry to list.\n\nDeclare one exit code and one meaning for each failure code.\n",
        finding(first.0, first.1),
        finding(second.0, second.1),
    );
    assert_eq!(stderr, &expected);
    assert_eq!(
        distributed,
        &Ran {
            status: 1,
            stdout: String::new(),
            stderr: "app: Something went wrong.\n".into()
        }
    );
}

#[tokio::test]
async fn one_failure_code_with_two_exit_codes_is_a_declaration_error_naming_the_code_and_both_commands()
 {
    let first = DeclaredFailure::of::<InvalidJsonError>(NOT_JSON);
    let second = DeclaredFailure::of::<LooseJsonError>(NOT_JSON);
    let application = conflicting(second.clone(), false);
    for argv in [&["--manifest"][..], &["get", "--manifest"][..]] {
        assert_conflict(
            &conflict_reports(&application, argv).await,
            "Failure \"invalid-json\" is declared with exit code 65 on Command \"get\" and exit code 1 on Command \"select\".",
            (&first, "Command \"get\""),
            (&second, "Command \"select\""),
        );
    }
}

#[tokio::test]
async fn one_failure_code_with_two_meanings_is_a_declaration_error_naming_the_code_and_both_commands()
 {
    let first = DeclaredFailure::of::<InvalidJsonError>(NOT_JSON);
    let second = DeclaredFailure::of::<InvalidJsonError>("The document cannot be parsed.");
    let application = conflicting(second.clone(), false);
    assert_conflict(
        &conflict_reports(&application, &["select", "--manifest"]).await,
        "Failure \"invalid-json\" is declared with meaning \"The document is not valid JSON.\" on Command \"get\" and meaning \"The document cannot be parsed.\" on Command \"select\".",
        (&first, "Command \"get\""),
        (&second, "Command \"select\""),
    );
}

#[tokio::test]
async fn a_conflicting_meaning_is_quoted_with_its_control_characters_escaped() {
    let second = DeclaredFailure::of::<InvalidJsonError>("Bad \u{202e}evil\u{9b}\" on \"x");
    let application = conflicting(second, false);
    let reports = conflict_reports(&application, &["--manifest"]).await;
    assert!(
        reports.0.stderr.contains(
            "\n\nFailure \"invalid-json\" is declared with meaning \"The document is not valid JSON.\" on Command \"get\" and meaning \"Bad \\u202eevil\\u009b\" on \"x\" on Command \"select\".\n\n"
        ),
        "{}",
        reports.0.stderr
    );
    assert_eq!(reports.1.status, 1);
}

#[tokio::test]
async fn one_failure_code_with_two_exit_codes_on_one_command_is_a_declaration_error_naming_that_command_twice()
 {
    let first = DeclaredFailure::of::<InvalidJsonError>(NOT_JSON);
    let second = DeclaredFailure::of::<LooseJsonError>(NOT_JSON);
    let application = conflicting(second.clone(), true);
    assert_conflict(
        &conflict_reports(&application, &["--manifest"]).await,
        "Failure \"invalid-json\" is declared with exit code 65 on Command \"get\" and exit code 1 on Command \"get\".",
        (&first, "Command \"get\""),
        (&second, "Command \"get\""),
    );
}

#[tokio::test]
async fn one_failure_code_with_two_meanings_on_one_command_is_a_declaration_error_naming_that_command_twice()
 {
    let first = DeclaredFailure::of::<InvalidJsonError>(NOT_JSON);
    let second = DeclaredFailure::of::<InvalidJsonError>("The document cannot be parsed.");
    let application = conflicting(second.clone(), true);
    assert_conflict(
        &conflict_reports(&application, &["get", "--manifest"]).await,
        "Failure \"invalid-json\" is declared with meaning \"The document is not valid JSON.\" on Command \"get\" and meaning \"The document cannot be parsed.\" on Command \"get\".",
        (&first, "Command \"get\""),
        (&second, "Command \"get\""),
    );
}

#[tokio::test]
async fn a_conflict_never_reaches_a_run_without_manifest() {
    let application = conflicting(DeclaredFailure::of::<LooseJsonError>(NOT_JSON), false);
    assert_eq!(
        run(&application, &["get"]).await,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: "dispatched\n".into()
        }
    );
}
