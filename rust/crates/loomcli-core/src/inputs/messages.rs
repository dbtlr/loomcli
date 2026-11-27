//! The operator sentences of validation, missing inputs, option groups, and content inputs. Every
//! name, spelling, and path a sentence repeats passes through the control-character escape.

use crate::failures::messages::quoted;
use crate::inspection::OptionGroupKind;
use crate::support::escape_control_characters;

/// How a line names an argument: by the spelling that reaches it.
pub(crate) fn argument_subject(spelling: &str) -> String {
    format!("Argument {}", quoted(spelling))
}

/// How a line names an option: by the spelling that reaches it, and by the source that filled its
/// value when one did.
pub(crate) fn option_subject(spelling: &str, origin: Option<&str>) -> String {
    format!("Option {}{}", quoted(spelling), origin_clause(origin))
}

fn origin_clause(label: Option<&str>) -> String {
    label.map_or_else(String::new, |label| {
        format!(" (from {})", escape_control_characters(label))
    })
}

fn position(path: Option<&str>) -> String {
    path.map_or_else(String::new, |path| {
        format!(" at {}", escape_control_characters(path))
    })
}

/// One issue under its input's subject. A path segment may hold text the operator typed.
pub(crate) fn issue_line(subject: &str, path: Option<&str>, issue: &str) -> String {
    format!("{subject}{}: {issue}", position(path))
}

pub(crate) fn stdin_issue(issue: &str) -> String {
    format!("Stdin: {issue}")
}

/// A configuration fill's template and fields.
pub(crate) type FillLog = (&'static str, crate::LogFields);

/// The debug event for a configuration source's value that validation dropped.
pub(crate) fn ignored_fill(
    spelling: &str,
    path: Option<&str>,
    label: &str,
    issue: &str,
) -> FillLog {
    const FIELD: &str = r#"Ignored option "{option}" from {label}: {issue}"#;
    const POSITION: &str = r#"Ignored option "{option}" at {position} from {label}: {issue}"#;
    let fields = crate::LogFields::new()
        .field("issue", issue)
        .field("label", label)
        .field("option", spelling);
    match path {
        Some(path) => (POSITION, fields.field("position", path)),
        None => (FIELD, fields),
    }
}

/// How a missing value reads: one value, or at least one for a collected input.
fn amount(collected: bool) -> &'static str {
    if collected {
        "at least one value"
    } else {
        "a value"
    }
}

fn when_not_interactive(conditional: bool) -> &'static str {
    if conditional {
        " when input is not interactive"
    } else {
        ""
    }
}

/// What to supply for a missing option: its spellings that need no value, or its value.
pub(crate) enum OptionFix<'a> {
    Spellings(&'a [&'a str]),
    Value {
        collected: bool,
        arity: Option<usize>,
    },
}

fn option_fix(fix: &OptionFix<'_>) -> String {
    match fix {
        OptionFix::Spellings(spellings) => {
            let names: Vec<String> = spellings.iter().map(|name| quoted(name)).collect();
            format!("Supply {}.", names.join(" or "))
        }
        OptionFix::Value {
            collected: true,
            arity: Some(arity),
        } => {
            format!("Supply at least one set of {arity} values.")
        }
        OptionFix::Value {
            collected: false,
            arity: Some(arity),
        } => {
            format!("Supply {arity} values.")
        }
        OptionFix::Value {
            collected: true,
            arity: None,
        } => "Supply at least one value.".to_owned(),
        OptionFix::Value {
            collected: false,
            arity: None,
        } => "Supply a value.".to_owned(),
    }
}

/// The sentence of a required option left out, where `subject` is its [`option_subject`].
pub(crate) fn required_option(subject: &str, conditional: bool, fix: &OptionFix<'_>) -> String {
    format!(
        "{subject} is required{}. {}",
        when_not_interactive(conditional),
        option_fix(fix)
    )
}

pub(crate) fn required_argument(name: &str, collected: bool, conditional: bool) -> String {
    format!(
        "Argument {} requires {}{}. Supply a value for {}.",
        quoted(name),
        amount(collected),
        when_not_interactive(conditional),
        quoted(name)
    )
}

pub(crate) const SILENT_REJECTION: &str =
    "The validator rejected this value without an explanation. Supply a different value.";

pub(crate) const ENVIRONMENT_COUNT: &str = "Use a whole number of 0 or more.";

pub(crate) const ENVIRONMENT_BOOLEAN: &str = "Use true, false, yes, no, y, n, on, off, 1, or 0.";

pub(crate) const UNREADABLE_FILE: &str = "Expected a readable file that exists.";

pub(crate) const FILE_PATHS_ONLY: &str =
    "This input accepts file paths only. Use ./- for a file named -.";

pub(crate) const PIPED_STDIN: &str = "Expected piped or redirected stdin.";

fn sources(count: usize) -> &'static str {
    if count == 1 { "source" } else { "sources" }
}

pub(crate) fn too_few_sources(minimum: usize) -> String {
    format!("Expected at least {minimum} readable {}.", sources(minimum))
}

pub(crate) fn too_many_sources(maximum: usize) -> String {
    format!("Expected at most {maximum} readable {}.", sources(maximum))
}

/// A group member as a sentence names it: its quoted spelling, and the source that filled it.
fn group_member(spelling: &str, label: Option<&str>) -> String {
    format!("{}{}", quoted(spelling), origin_clause(label))
}

fn joined_names(names: &[String]) -> String {
    match names {
        [only] => only.clone(),
        [first, second] => format!("{first} and {second}"),
        [rest @ .., last] => format!("{}, and {last}", rest.join(", ")),
        [] => String::new(),
    }
}

/// Each member is its spelling and, when a source filled it, that source's label.
/// For a requirement the first member is the trigger, followed by only the options still needed.
pub(crate) fn group_sentence(kind: OptionGroupKind, members: &[(String, Option<&str>)]) -> String {
    let listed = || {
        let names: Vec<String> = members
            .iter()
            .map(|(spelling, label)| group_member(spelling, *label))
            .collect();
        joined_names(&names)
    };
    match kind {
        OptionGroupKind::Exclusive => {
            format!(
                "Options {} cannot be used together. Supply only one of them.",
                listed()
            )
        }
        OptionGroupKind::OneRequired => {
            format!(
                "One of options {} is required. Supply at least one of them.",
                listed()
            )
        }
        OptionGroupKind::RequiredTogether => {
            format!(
                "Options {} must be supplied together. Supply all of them, or none.",
                listed()
            )
        }
        OptionGroupKind::Requires => requirement_sentence(members),
    }
}

fn requirement_sentence(members: &[(String, Option<&str>)]) -> String {
    let Some(((spelling, label), needed)) = members.split_first() else {
        return String::new();
    };
    let trigger = group_member(spelling, *label);
    let remove = quoted(spelling);
    let names: Vec<String> = needed.iter().map(|(name, _)| quoted(name)).collect();
    let lacking = joined_names(&names);
    let (noun, pronoun) = if names.len() == 1 {
        ("option", "it")
    } else {
        ("options", "them")
    };
    format!(
        "Option {trigger} requires {noun} {lacking}. Supply {pronoun} as well, or remove {remove}."
    )
}

pub(crate) fn environment_arity(arity: usize, delimiter: &str) -> String {
    format!("Use {arity} values separated by {}.", quoted(delimiter))
}
