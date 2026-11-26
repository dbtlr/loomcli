//! The sentences core's failure classes write, the quoting helpers every sentence of core repeats a
//! value through, and core's default text for a failure.

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
        |name| format!("Command {}", quoted(name)),
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

/// Names a list joins, each escaped, separated by `separator`.
pub(crate) fn escaped_list(names: &[String], separator: &str) -> String {
    names
        .iter()
        .map(|name| escape_control_characters(name))
        .collect::<Vec<_>>()
        .join(separator)
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
        format!(" Use one of: {}.", escaped_list(candidates, ", "))
    }
}

pub(crate) fn unknown_command(token: &str, candidates: &[String]) -> String {
    format!(
        "Unknown command {}.{}",
        quoted(token),
        offering(candidates, Offered::Command)
    )
}

/// The sentence of a group routed to with no subcommand. The root has no name to repeat, and the
/// default text already opens with the application name, so the root's sentence names no Command.
pub(crate) fn missing_subcommand(command: &[String], candidates: &[String]) -> String {
    if command.is_empty() {
        format!(
            "A command is required.{}",
            offering(candidates, Offered::Command)
        )
    } else {
        format!(
            "{} requires a subcommand.{}",
            routed_sentence(command),
            offering(candidates, Offered::Subcommand)
        )
    }
}

pub(crate) fn pass_as_argument(sentence: &str, argument: &str) -> String {
    format!(
        "{sentence} To pass {} as an argument, write -- before it.",
        quoted(argument)
    )
}

pub(crate) fn declared_no_passthrough(command: &[String]) -> String {
    format!(
        "{} declares no passthrough. Remove passthrough from the values.",
        routed_sentence(command)
    )
}

pub(crate) fn terminal_unavailable(application: &str, command: &[String]) -> String {
    let words = std::iter::once(application)
        .chain(command.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "{} needs a terminal. Run {} with stdin and stderr at a terminal, outside CI.",
        routed_sentence(command),
        quoted(&words)
    )
}

pub(crate) fn unexpected_arguments(command: &[String], accepted: usize) -> String {
    let subject = routed_sentence(command);
    match accepted {
        0 => format!("{subject} accepts no arguments. Remove the supplied values."),
        1 => format!("{subject} accepts 1 argument. Remove the extra values."),
        _ => format!("{subject} accepts {accepted} arguments. Remove the extra values."),
    }
}

pub(crate) fn undeclared_argument(command: &[String], name: &str) -> String {
    format!(
        "{} declares no argument {}. Supply the name of a declared argument.",
        routed_sentence(command),
        quoted(name)
    )
}

pub(crate) fn unknown_option(spelling: &str) -> String {
    format!(
        "Unknown option {}. Supply a declared option; prefix a hyphenated path with \"./\".",
        quoted(spelling)
    )
}

pub(crate) fn unknown_option_before_arguments(spelling: &str) -> String {
    format!(
        "Unknown option {}. Supply a declared option, or pass it as an argument after \"--\".",
        quoted(spelling)
    )
}

/// The unknown option of an invocation by name, which asks for a declared name, because the caller
/// typed no spelling.
pub(crate) fn unknown_option_name(name: &str) -> String {
    format!(
        "Unknown option {}. Supply the name of a declared option.",
        quoted(name)
    )
}

pub(crate) fn missing_value(spelling: &str) -> String {
    let spelling = quoted(spelling);
    format!("Option {spelling} requires a value. Supply a value after {spelling}.")
}

/// The sentence of an option whose next word was an option word or the bare `--`, so it names the
/// attached form too.
pub(crate) fn missing_attached_value(spelling: &str) -> String {
    let quoted_spelling = quoted(spelling);
    format!(
        "Option {quoted_spelling} requires a value. Supply a value after {quoted_spelling}, or attach one that starts with a hyphen as {}.",
        quoted(&format!("{spelling}=<value>"))
    )
}

pub(crate) fn missing_arity(
    spelling: &str,
    arity: usize,
    received: usize,
    refused: Option<&str>,
) -> String {
    let spelling = quoted(spelling);
    match refused {
        Some(refused) => format!(
            "Option {spelling} requires {arity} values, and {} reads as an option. Supply {arity} values after {spelling}; a value that reads as an option cannot be one of them.",
            quoted(refused)
        ),
        None => format!(
            "Option {spelling} requires {arity} values and received {received}. Supply {arity} values after {spelling}."
        ),
    }
}

pub(crate) fn attached_arity_value(spelling: &str) -> String {
    let spelling = quoted(spelling);
    format!(
        "Option {spelling} takes its values as separate words. Supply each one after {spelling} as its own word."
    )
}

pub(crate) fn counted_value(spelling: &str) -> String {
    let spelling = quoted(spelling);
    format!(
        "Counted option {spelling} does not accept a value. Repeat {spelling} to raise its count."
    )
}

pub(crate) fn boolean_value(spelling: &str) -> String {
    format!(
        "Boolean option {} does not accept a value. Supply the flag alone.",
        quoted(spelling)
    )
}

pub(crate) fn repeated_option(spelling: &str) -> String {
    format!(
        "Option {} can be supplied only once. Remove the repeated option.",
        quoted(spelling)
    )
}

pub(crate) fn misplaced_option(spelling: &str, commands: &[Vec<String>]) -> String {
    let names: Vec<String> = commands.iter().map(|path| path.join(" ")).collect();
    match names.as_slice() {
        [only] => format!(
            "Option {} belongs to command {}. Supply it after {}.",
            quoted(spelling),
            quoted(only),
            quoted(only)
        ),
        _ => format!(
            "Option {} belongs to commands {}. Supply it after the command name.",
            quoted(spelling),
            escaped_list(&names, ", ")
        ),
    }
}

pub(crate) const WORKING_DIRECTORY_UNREADABLE: &str = "The current working directory cannot be read. Change to a directory that exists and run the command again.";

pub(crate) fn result_missing(path: &[String]) -> String {
    format!(
        "{} declares a result and its action returned without emitting one. Call out.results() once.",
        routed_sentence(path)
    )
}

pub(crate) fn result_repeated(path: &[String]) -> String {
    format!(
        "{} emitted its result twice. Call out.results() once.",
        routed_sentence(path)
    )
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
