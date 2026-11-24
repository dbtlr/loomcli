//! The manifest's collecting extension, ported from the reference's `extension-facts.test.ts` (the
//! manifest part) and the declaration rules of `manifest-failures.test.ts`: a value is checked at
//! the call that carries it, and the graph stores what the descriptor was given.

#![cfg(feature = "manifest-extension")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_core::{Application, Command, EX_DATAERR, Failure, FatalError, read_extension};
use loomcli_plugins::manifest::extension::{
    CommandExample, DeclaredFailure, MANIFEST_COMMAND, ManifestCommandFacts,
};
use serde_json::{Value, json};

#[derive(Debug, Failure)]
#[failure(code = "missing", exit_code = EX_DATAERR)]
struct MissingError {
    #[failure(base)]
    base: FatalError,
}

/// A class that declares nothing, so it lists the code and exit code it inherits.
#[derive(Debug, Failure)]
struct PlainError {
    #[failure(base)]
    base: FatalError,
}

fn get_with(
    facts: ManifestCommandFacts,
) -> Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Application::new("app")
        .command(
            Command::new("get")
                .action(|_: loomcli_core::Context| async { Ok(()) })
                .extend([MANIFEST_COMMAND.value(facts)]),
        )
        .action(|_: loomcli_core::Context| async { Ok(()) })
}

/// The message of the declaration fault one value raises at its call, or `None` for none.
fn fault_of(facts: ManifestCommandFacts) -> Option<String> {
    let caught = catch_unwind(AssertUnwindSafe(|| drop(get_with(facts))));
    caught.err().map(|payload| {
        payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| {
                payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
            })
            .unwrap_or_default()
    })
}

fn invalid(message: &str) -> String {
    format!(
        "Command \"get\" holds an invalid \"@loomcli/plugins/manifest/command\" value: {message}\n"
    )
}

fn bad_data() -> DeclaredFailure {
    DeclaredFailure::new("bad-data", 65, "The data is bad.")
}

#[test]
fn the_manifest_reads_each_declared_failure_from_its_class_and_keeps_every_field() {
    let facts = ManifestCommandFacts::new()
        .details("Quote a path that holds a shell metacharacter.")
        .examples(vec![CommandExample::new("get name")])
        .failures(vec![DeclaredFailure::of::<MissingError>(
            "Nothing is at the path.",
        )]);
    assert_eq!(
        serde_json::to_value(&facts).unwrap(),
        json!({
            "details": "Quote a path that holds a shell metacharacter.",
            "examples": [{ "command": "get name" }],
            "failures": [{ "code": "missing", "exitCode": 65, "meaning": "Nothing is at the path." }],
        })
    );
    let graph = get_with(facts.clone()).inspect().unwrap();
    let get = graph.command(&["get"]).unwrap();
    assert_eq!(
        read_extension(&**get, &MANIFEST_COMMAND).unwrap(),
        vec![facts]
    );
}

#[test]
fn a_declared_failure_is_stored_as_its_classs_failure_code_exit_code_and_meaning_in_that_key_order()
{
    let facts = ManifestCommandFacts::new().failures(vec![bad_data()]);
    let graph = get_with(facts).inspect().unwrap();
    let stored = &graph.command(&["get"]).unwrap().extensions["@loomcli/plugins/manifest/command"];
    let failure = &stored[0]["failures"][0];
    assert_eq!(
        failure,
        &json!({ "code": "bad-data", "exitCode": 65, "meaning": "The data is bad." })
    );
    let keys: Vec<&str> = failure
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["code", "exitCode", "meaning"]);
}

#[test]
fn a_class_that_declares_nothing_stores_the_code_and_exit_code_it_inherits() {
    let declared = DeclaredFailure::of::<PlainError>("The data is bad.");
    assert_eq!(
        serde_json::to_value(&declared).unwrap(),
        json!({ "code": "fatal", "exitCode": 1, "meaning": "The data is bad." })
    );
}

#[test]
fn a_failure_meaning_on_two_lines_is_rejected_at_the_call() {
    for meaning in [
        "The data\nis bad.",
        "The data\r\nis bad.",
        "  ",
        "",
        "The data\u{2028}is bad.",
    ] {
        let facts = ManifestCommandFacts::new()
            .failures(vec![DeclaredFailure::new("bad-data", 65, meaning)]);
        assert_eq!(
            fault_of(facts)
                .as_deref()
                .map(|fault| fault.contains(&invalid(
                    "Supply one line that holds a character other than whitespace."
                ))),
            Some(true),
            "{meaning:?}"
        );
    }
    assert_eq!(
        fault_of(ManifestCommandFacts::new().failures(vec![bad_data()])),
        None
    );
}

#[test]
fn a_failure_code_outside_the_grammar_and_an_exit_code_outside_the_bound_are_rejected() {
    let code = "Failure declares failure code \"Bad_Code\". Declare a kebab-case code of lowercase letters and digits, such as \"registry-down\".";
    let facts =
        ManifestCommandFacts::new().failures([DeclaredFailure::new("Bad_Code", 65, "Bad.")]);
    assert!(fault_of(facts).unwrap().contains(&invalid(code)));
    for exit in [0u8, 126, 200] {
        let facts =
            ManifestCommandFacts::new().failures([DeclaredFailure::new("bad-data", exit, "Bad.")]);
        let message = invalid(&format!(
            "Failure \"bad-data\" declares exit code {exit}. Declare an exit code from 1 to 125."
        ));
        assert!(fault_of(facts).unwrap().contains(&message), "{exit}");
    }
}

#[test]
fn markdown_details_of_next_line_alone_are_content_and_a_byte_order_mark_is_not() {
    let blank = invalid("Supply Markdown that holds a character other than whitespace.");
    assert_eq!(
        fault_of(ManifestCommandFacts::new().details("\u{85}")),
        None
    );
    let fault = fault_of(ManifestCommandFacts::new().details("\u{feff}\u{a0} \t"));
    assert!(fault.unwrap().contains(&blank));
}

#[test]
fn an_example_command_or_note_on_two_lines_and_blank_details_are_rejected_at_the_call() {
    let line = invalid("Supply one line that holds a character other than whitespace.");
    let markdown = invalid("Supply Markdown that holds a character other than whitespace.");
    let command = ManifestCommandFacts::new().examples(vec![CommandExample::new("get a\nget b")]);
    assert!(fault_of(command).unwrap().contains(&line));
    let note =
        ManifestCommandFacts::new().examples(vec![CommandExample::new("get a").note("One.\nTwo.")]);
    assert!(fault_of(note).unwrap().contains(&line));
    let blank = ManifestCommandFacts::new().details(" \t\n ");
    assert!(fault_of(blank).unwrap().contains(&markdown));
}

#[test]
fn valid_values_pass_and_markdown_may_hold_blank_lines() {
    for facts in [
        ManifestCommandFacts::new().details("First line.\n\nThird line."),
        ManifestCommandFacts::new()
            .details("First line.\nSecond line.")
            .examples(vec![CommandExample::new("get a").note("One.")]),
        ManifestCommandFacts::new(),
    ] {
        assert_eq!(fault_of(facts), None);
    }
}

#[test]
fn the_descriptor_is_collecting_and_keeps_its_identity() {
    assert_eq!(
        MANIFEST_COMMAND.identity(),
        "@loomcli/plugins/manifest/command"
    );
    let value: Value = serde_json::to_value(ManifestCommandFacts::new()).unwrap();
    assert_eq!(value, json!({}));
}
