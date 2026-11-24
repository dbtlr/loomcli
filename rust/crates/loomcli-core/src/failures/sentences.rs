//! The sentences core's failure classes write, and core's default text for a failure.

use crate::diagnostics::{DiagnosticParts, rules};
use crate::style::{escape, escape_control_characters};

use super::{
    DeclarationError, Error, Failure, FailureFacts, FatalError, InternalError, UsageError,
    WorkingDirectoryError,
};

/// A value a sentence quotes, such as raw text an operator typed or a name an author declared: in
/// double quotes, with every control character escaped so it cannot reorder or break the line. The
/// failure's own field keeps the raw value.
pub(crate) fn quoted(value: &str) -> String {
    format!("\"{}\"", escape_control_characters(value))
}

/// The text with its first character uppercased, as a subject that opens a sentence.
fn capitalized(text: &str) -> String {
    let mut characters = text.chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(characters).collect()
    })
}

/// A sentence's subject placed after its start, its first letter lowercased: `Plugin` reads
/// `plugin`.
pub(crate) fn mid_sentence(text: &str) -> String {
    let mut characters = text.chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_lowercase().chain(characters).collect()
    })
}

/// How a diagnostic names one Command inside a sentence: by name, or as the unnamed root.
pub(crate) fn command_subject(name: Option<&str>) -> String {
    name.map_or_else(
        || "the root Command".to_owned(),
        |name| format!("Command \"{name}\""),
    )
}

/// The same subject at the start of a sentence.
pub(crate) fn command_sentence(name: Option<&str>) -> String {
    capitalized(&command_subject(name))
}

/// The routed path names the Command a sentence speaks of; an empty path is the root.
pub(crate) fn routed_subject(command: &[String]) -> String {
    command_subject(command.last().map(String::as_str))
}

/// The same subject at the start of a sentence, where a token fault names its Command.
pub(crate) fn routed_sentence(command: &[String]) -> String {
    capitalized(&routed_subject(command))
}

/// The kind of name a routing fault asks for when its Command offers no candidate.
#[derive(Clone, Copy)]
pub(crate) enum Offered {
    Command,
    Subcommand,
}

/// The clause that states a routing fault's fix: the candidates, or, when the Command offers none
/// because every child is hidden or deprecated, the kind of name to supply.
pub(crate) fn offering(candidates: &[String], kind: Offered) -> String {
    if candidates.is_empty() {
        let kind = match kind {
            Offered::Command => "command",
            Offered::Subcommand => "subcommand",
        };
        format!(" Supply the name of a declared {kind}.")
    } else {
        format!(" Use one of: {}.", candidates.join(", "))
    }
}

/// One message someone else wrote, as a sentence of its own: a full stop added only where the
/// message carries none.
pub(crate) fn as_sentence(text: &str) -> String {
    if text.ends_with('.') {
        text.to_owned()
    } else {
        format!("{text}.")
    }
}

/// What a diagnostic says about an error, with every control character escaped: a
/// `DeclarationError`'s sentence, because its message holds its whole diagnostic, another failure's
/// message, or a foreign error's own `Display`.
pub(crate) fn reason_of(error: &Error) -> String {
    let reason = match error.failure() {
        Some(failure) => failure_reason(failure),
        None => error.foreign().map(ToString::to_string).unwrap_or_default(),
    };
    escape_control_characters(&reason)
}

/// What a failure says about itself in a diagnostic: a `DeclarationError`'s sentence, or its
/// message.
pub(crate) fn failure_reason(failure: &dyn Failure) -> String {
    match failure.downcast_ref::<DeclarationError>() {
        Some(fault) => fault.sentence().to_owned(),
        None => failure.message().to_owned(),
    }
}

/// The one message a distributed build shows an operator for a defect or a declaration fault: the
/// application name and a fixed phrase, with no reason, class name, code, or path.
pub(crate) fn generic_defect_text(application: &str) -> String {
    format!("{application}: {GENERIC_MESSAGE}\n")
}

/// The message a defect reads in a distributed build, which names no reason.
pub(crate) const GENERIC_MESSAGE: &str = "Something went wrong.";

/// Whether one failure is only the author's to fix: a declaration fault or a defect. A development
/// build shows the author its Developer Diagnostic; a distributed one shows the generic message.
pub(crate) fn is_author_fault(failure: &dyn Failure) -> bool {
    failure.is::<DeclarationError>() || failure.is::<InternalError>()
}

/// Core's own text for one failure, with the trailing newline every view's text carries.
///
/// The application name opens every line of a usage failure's message, one line for each problem it
/// reports, and a working directory failure's line. A declaration fault and a defect read the
/// generic defect message, because only the author can act on their detail. Every other class
/// writes its message alone, even one that declares a usage error's exit code. It is the default
/// view of every failure class and the text the plain fallback path writes, so it runs no
/// application code.
pub(crate) fn default_text(failure: &dyn Failure, application: &str) -> String {
    if failure.is::<UsageError>() || failure.is::<WorkingDirectoryError>() {
        return failure
            .message()
            .split('\n')
            .map(|line| format!("{application}: {line}\n"))
            .collect();
    }
    if is_author_fault(failure) {
        return generic_defect_text(application);
    }
    format!("{}\n", failure.message())
}

/// One failure's sentence as core's default text marks it: escaped, unless it is the authored
/// marked message of a `FatalError` or a class that extends it. Core's default failure view and a
/// failure form's message both read it.
pub(crate) fn marked_sentence(failure: &dyn Failure, text: &str) -> String {
    if failure.is::<FatalError>() {
        text.to_owned()
    } else {
        escape(text)
    }
}

/// Core's default view of one failure: its default text, marked as [`marked_sentence`] marks it,
/// with each hint on its own line under it as marked text it does not escape.
pub(crate) fn core_text(failure: &dyn Failure, application: &str, hints: &[String]) -> String {
    let mut text = marked_sentence(failure, &default_text(failure, application));
    for hint in hints {
        text.push_str(hint);
        text.push('\n');
    }
    text
}

/// The defect a foreign error no translator answered reports: its reason as the sentence, and the
/// error itself as the cause a development build's diagnostic shows.
pub(crate) fn foreign_failure(error: Error) -> InternalError {
    let sentence = reason_of(&error);
    InternalError::new(
        rules::FOREIGN_THROW,
        DiagnosticParts::new(sentence).correction(rules::FOREIGN_THROW_CORRECTION),
        error,
    )
}

/// Every error reaches reporting as a failure: a failure as itself, and a foreign error as the
/// `foreign-throw` defect.
pub(crate) fn to_failure(error: Error) -> Box<dyn Failure> {
    error
        .into_failure()
        .unwrap_or_else(|error| Box::new(foreign_failure(error)))
}
