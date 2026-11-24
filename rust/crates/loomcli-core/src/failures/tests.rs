//! Unit tests of core's failure sentences, default text, failure form, and translations. Ported
//! from the reference's `failures.test.ts`, `failure-form.test.ts`, `errors.test.ts`, and
//! `exit-codes.test.ts`, the cases a pure function answers without a run.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use super::form::{FormScene, failure_form};
use super::sentences::{
    as_sentence, command_sentence, core_text, default_text, foreign_failure, is_author_fault,
    marked_sentence, mid_sentence, reason_of, to_failure,
};
use super::translators::translated;
use super::*;
use crate::Failure;
use crate::diagnostics::{DiagnosticParts, rules};
use crate::style::{Capabilities, Palette, Renderer, escape, style};

fn words(list: &[&str]) -> Vec<String> {
    list.iter().map(|word| (*word).to_owned()).collect()
}

/// Resolves marked text as plain text, as a run's plain resolution does.
fn plain(text: &str) -> String {
    Renderer::new(Capabilities::PLAIN, Palette::new()).plain(text)
}

/// A class that declares 2 without extending `UsageError`.
#[derive(Debug, crate::Failure)]
#[failure(exit_code = 2)]
struct StrictError {
    #[failure(base)]
    base: FatalError,
}

#[test]
fn the_default_text_opens_a_usage_failure_with_the_application_name() {
    let failure = UnknownCommandError::new("nope", words(&["get", "cache"]));
    assert_eq!(
        default_text(&failure, "failures"),
        "failures: Unknown command \"nope\". Use one of: get, cache.\n"
    );
}

#[test]
fn the_default_text_opens_every_problem_line_with_the_application_name() {
    let failure = InputError::new(
        "Option \"--depth\": Use decimal digits.\nOption \"-m\": Use fast or slow.",
        Vec::new(),
    );
    assert_eq!(
        default_text(&failure, "failures"),
        "failures: Option \"--depth\": Use decimal digits.\nfailures: Option \"-m\": Use fast or slow.\n"
    );
}

#[test]
fn the_default_text_escapes_a_right_to_left_override_in_a_quoted_token() {
    let failure = UnknownOptionError::new("--a\u{202e}b");
    assert_eq!(
        default_text(&failure, "failures"),
        "failures: Unknown option \"--a\\u202eb\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
    );
}

#[test]
fn a_fatal_failure_writes_its_message_alone_and_an_author_fault_the_generic_message() {
    assert_eq!(
        default_text(&FatalError::new("Expected failure."), "fixture"),
        "Expected failure.\n"
    );
    let strict = StrictError {
        base: FatalError::new("Strict mode refused the value."),
    };
    assert_eq!(
        default_text(&strict, "exits"),
        "Strict mode refused the value.\n"
    );
    let declaration = DeclarationError::sentence_only("The root Command has no action.");
    assert_eq!(
        default_text(&declaration, "fixture"),
        "fixture: Something went wrong.\n"
    );
    let defect = InternalError::message_only("Unexpected failure.", FatalError::new("x"));
    assert_eq!(
        default_text(&defect, "fixture"),
        "fixture: Something went wrong.\n"
    );
    let result = ResultError::new(ResultFault::Missing, Vec::new());
    assert_eq!(
        default_text(&result, "fixture"),
        "fixture: Something went wrong.\n"
    );
    let directory = WorkingDirectoryError::new(std::io::Error::other("gone"));
    assert_eq!(
        default_text(&directory, "fixture"),
        "fixture: The current working directory cannot be read. Change to a directory that exists and run the command again.\n"
    );
}

#[test]
fn an_author_fault_is_a_declaration_fault_or_a_defect() {
    assert!(is_author_fault(&DeclarationError::sentence_only("x")));
    assert!(is_author_fault(&ResultError::new(
        ResultFault::Repeated,
        Vec::new()
    )));
    assert!(!is_author_fault(&FatalError::new("x")));
    assert!(!is_author_fault(&RepeatedOptionError::new("-f")));
}

#[test]
fn core_text_keeps_a_fatal_errors_marked_message_and_escapes_every_other_class() {
    let marked = style().bold().apply("down");
    let fatal = FatalError::new(marked.clone());
    assert_eq!(marked_sentence(&fatal, &marked), marked);
    assert_eq!(plain(&core_text(&fatal, "app", &[])), "down\n");
    let usage = UnknownOptionError::new(marked.clone());
    assert_eq!(
        marked_sentence(&usage, usage.message()),
        escape(usage.message())
    );
    assert_eq!(
        marked_sentence(&usage, usage.message()),
        "Unknown option \"\u{e003}E000[\"style\",[[\"modifier\",\"bold\"]]]\u{e003}E001down\u{e003}E002\". Supply a declared option; prefix a hyphenated path with \"./\"."
    );
    // An escaped mark displays literally, so the operator reads what was typed.
    assert_eq!(
        plain(&core_text(&usage, "app", &[])),
        "app: Unknown option \"\u{e000}[\"style\",[[\"modifier\",\"bold\"]]]\u{e001}down\u{e002}\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
    );
}

#[test]
fn a_missing_value_names_the_attached_form_only_when_the_next_word_refused_to_be_one() {
    // `-f --quiet` or `-f --`: the next word is never a separate value.
    assert_eq!(
        MissingValueError::new("-f", MissingValueForm::Attached).message(),
        "Option \"-f\" requires a value. Supply a value after \"-f\", or attach one that starts with a hyphen as \"-f=<value>\"."
    );
    // `-f` as the last word.
    assert_eq!(
        MissingValueError::new("--mode", MissingValueForm::Separate).message(),
        "Option \"--mode\" requires a value. Supply a value after \"--mode\"."
    );
}

#[test]
fn core_text_writes_each_hint_on_its_own_line_under_the_sentence() {
    let failure = UnknownCommandError::new("nope", words(&["get"]));
    let hints = words(&["Run it again.", "Or not."]);
    assert_eq!(
        plain(&core_text(&failure, "app", &hints)),
        "app: Unknown command \"nope\". Use one of: get.\nRun it again.\nOr not.\n"
    );
}

#[test]
fn an_invocation_by_name_names_the_key_the_caller_wrote() {
    let option = UnknownOptionError::by_name("verbos");
    assert_eq!(
        option.message(),
        "Unknown option \"verbos\". Supply the name of a declared option."
    );
    assert_eq!(option.spelling(), "verbos");
    let argument = UnexpectedArgumentError::undeclared(words(&["get"]), 1, "pth");
    assert_eq!(
        argument.message(),
        "Command \"get\" declares no argument \"pth\". Supply the name of a declared argument."
    );
    assert_eq!(
        (argument.accepted(), argument.extra()),
        (1, &words(&["pth"])[..])
    );
}

#[test]
fn sentence_helpers_shape_a_subject_and_a_borrowed_message() {
    assert_eq!(command_sentence(None), "The root Command");
    assert_eq!(command_sentence(Some("get")), "Command \"get\"");
    assert_eq!(mid_sentence("Plugin \"x\""), "plugin \"x\"");
    assert_eq!(as_sentence("No file"), "No file.");
    assert_eq!(as_sentence("No file."), "No file.");
}

#[test]
fn a_reason_is_a_declaration_faults_sentence_or_a_message_with_controls_escaped() {
    let fault = Error::from(DeclarationError::sentence_only("The plugin\nbroke."));
    assert_eq!(reason_of(&fault), "The plugin\\u000abroke.");
    let foreign = Error::from(std::io::Error::other("Disk\u{202e} full"));
    assert_eq!(reason_of(&foreign), "Disk\\u202e full");
}

/// The form of one failure in a run of the given build, with these hints.
fn form(failure: &dyn Failure, development: bool, hints: &[String]) -> FailureForm {
    failure_form(
        failure,
        &FormScene {
            development,
            hints,
            plain: &plain,
        },
    )
}

#[test]
fn a_fatal_failures_form_reads_its_code_exit_code_message_and_hints_in_the_contracts_order() {
    let form = form(&FatalError::new("The registry is down."), false, &[]);
    assert_eq!(
        serde_json::to_string(&form).ok().as_deref(),
        Some(r#"{"code":"fatal","exitCode":1,"message":"The registry is down.","hints":[]}"#)
    );
}

#[test]
fn an_input_errors_form_holds_both_lines_with_no_application_name_and_no_trailing_newline() {
    let failure = InputError::new(
        "Option \"limit\": Use decimal digits.\nArgument \"path\" requires a value. Supply a value for \"path\".",
        Vec::new(),
    );
    let form = form(&failure, false, &[]);
    assert_eq!(
        (
            form.code.as_str(),
            form.exit_code.get(),
            form.message.as_str()
        ),
        (
            "invalid-input",
            2,
            "Option \"limit\": Use decimal digits.\nArgument \"path\" requires a value. Supply a value for \"path\"."
        )
    );
}

#[test]
fn a_marked_message_and_a_marked_hint_read_as_plain_text() {
    let failure = FatalError::new(style().red().apply("The registry is down."));
    let hints = vec![style().bold().apply("Run it again.")];
    let form = form(&failure, false, &hints);
    assert_eq!(form.message, "The registry is down.");
    assert_eq!(form.hints, ["Run it again."]);
}

#[test]
fn a_defects_form_reads_the_generic_message_in_a_distributed_build_and_its_sentence_in_development()
{
    let defect = foreign_failure(Error::from(std::io::Error::other("Cannot read the value.")));
    let distributed = form(&defect, false, &[]);
    assert_eq!(
        (
            distributed.code.as_str(),
            distributed.exit_code.get(),
            distributed.message.as_str()
        ),
        ("internal", 1, "Something went wrong.")
    );
    let development = form(&defect, true, &[]);
    assert_eq!(development.message, "Cannot read the value.");
    let fault = DeclarationError::sentence_only("The root Command has no action.");
    assert_eq!(
        form(&fault, true, &[]).message,
        "The root Command has no action."
    );
    assert_eq!(form(&fault, false, &[]).code, "internal");
}

#[test]
fn a_usage_failures_form_keeps_its_declared_exit_code() {
    let failure = UnknownCommandError::new("nope", words(&["get"]));
    let form = form(&failure, false, &[]);
    assert_eq!(
        (
            form.code.as_str(),
            form.exit_code.get(),
            form.message.as_str()
        ),
        (
            "unknown-command",
            2,
            "Unknown command \"nope\". Use one of: get."
        )
    );
}

#[test]
fn a_foreign_error_reports_as_the_foreign_throw_defect() {
    let failure = to_failure(Error::from(std::io::Error::other("Broke\nhere.")));
    let defect = failure.downcast_ref::<InternalError>();
    assert_eq!(
        defect
            .and_then(InternalError::rule)
            .map(|rule| rule.identity()),
        Some("@loomcli/core/foreign-throw")
    );
    assert_eq!(
        defect.map(InternalError::sentence),
        Some("Broke\\u000ahere.")
    );
    assert_eq!(
        defect.map(InternalError::correction),
        Some(&[rules::FOREIGN_THROW_CORRECTION.to_owned()][..])
    );
    assert!(failure.cause().is_some());
    let kept = to_failure(Error::from(FatalError::new("Kept.")));
    assert!(kept.is::<FatalError>());
}

fn parse_failure() -> Translation {
    translate(|error: std::num::ParseIntError| {
        Ok::<_, std::num::ParseIntError>(FatalError::with_cause(
            "The count is not a number.",
            error,
        ))
    })
}

#[test]
fn a_translation_answers_a_foreign_error_of_exactly_its_type() {
    let error = Error::from("x".parse::<u8>().expect_err("an invalid digit"));
    let answered = translated(error, [&parse_failure()]);
    assert_eq!(
        answered
            .downcast_failure::<FatalError>()
            .map(FailureFacts::message),
        Some("The count is not a number.")
    );
}

#[test]
fn a_translation_hands_back_any_other_error_unchanged() {
    let error = Error::from(std::io::Error::other("Disk full."));
    let handed = translated(error, [&parse_failure()]);
    assert!(handed.failure().is_none());
    assert_eq!(
        handed.foreign_type_name(),
        Some(std::any::type_name::<std::io::Error>())
    );
    assert_eq!(
        handed.foreign().map(ToString::to_string).as_deref(),
        Some("Disk full.")
    );
}

#[test]
fn a_translator_that_hands_its_error_back_passes_it_on_and_the_first_failure_wins() {
    let declining = translate(|error: std::num::ParseIntError| Err::<FatalError, _>(error));
    let second = translate(|_: std::num::ParseIntError| {
        Ok::<_, std::num::ParseIntError>(FatalError::new("Second."))
    });
    let third = translate(|_: std::num::ParseIntError| {
        Ok::<_, std::num::ParseIntError>(FatalError::new("Third."))
    });
    let error = Error::from("x".parse::<u8>().expect_err("an invalid digit"));
    let answered = translated(error, [&declining, &second, &third]);
    assert_eq!(
        answered.failure().map(FailureFacts::message),
        Some("Second.")
    );
}

#[test]
fn a_translation_matches_a_boxed_foreign_error_by_its_concrete_type() {
    let boxed: Box<dyn std::error::Error + Send + Sync> =
        Box::new("x".parse::<u8>().expect_err("an invalid digit"));
    let answered = translated(Error::from_foreign(boxed), [&parse_failure()]);
    assert!(answered.downcast_failure::<FatalError>().is_some());
}

#[test]
fn a_failure_is_never_offered_to_a_translator() {
    let offered = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let seen = Arc::clone(&offered);
    let watching = Translation {
        translate: Arc::new(move |error| {
            seen.store(true, std::sync::atomic::Ordering::SeqCst);
            Err(error)
        }),
    };
    let kept = translated(Error::from(FatalError::new("Kept.")), [&watching]);
    assert!(!offered.load(std::sync::atomic::Ordering::SeqCst));
    assert!(kept.downcast_failure::<FatalError>().is_some());
}

#[test]
fn an_encoding_encodes_a_form_or_returns_its_failure() {
    let encoding = encode_failure("application/json", |form: &FailureForm| {
        format!("{{\"code\":\"{}\"}}\n", form.code)
    });
    let failure = FatalError::new("Down.");
    assert_eq!(
        encoding.encode(&form(&failure, false, &[])).ok().as_deref(),
        Some("{\"code\":\"fatal\"}\n")
    );
    let broken = encode_failure("application/jsonl", |_: &FailureForm| {
        Err::<String, _>(FatalError::new("Cannot encode."))
    });
    assert!(broken.encode(&form(&failure, false, &[])).is_err());
    assert_eq!(broken.media_type(), "application/jsonl");
}

#[test]
fn an_internal_error_without_a_cause_carries_its_rule_and_parts() {
    let defect = InternalError::without_cause(
        rules::NEXT_MISUSE,
        DiagnosticParts::new("next() ran twice.").correction("Call next() once."),
    );
    assert!(defect.cause().is_none());
    assert_eq!(defect.message(), "next() ran twice.");
    assert_eq!(defect.correction(), ["Call next() once."]);
}
