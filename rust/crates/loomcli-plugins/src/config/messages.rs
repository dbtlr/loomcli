//! The sentences of the configuration plugin. A clause that says why a file cannot be used is one
//! of the fixed strings `Clause::text` returns.

use loomcli_core::{ContextualStyle, escape_control_characters, nowrap};

use super::reading::{Clause, Position};

/// A value a sentence repeats, escaped as a failure message quotes text.
fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// What the operator does about the file `--config` named.
fn named_step(clause: Clause) -> &'static str {
    match clause {
        Clause::DoesNotExist => "Supply the path of an existing file.",
        Clause::CouldNotBeRead => "Supply a file this process can read.",
        Clause::NotJsonObject => "Write its settings as one JSON object.",
        Clause::NotYamlMapping => "Write its settings as one YAML mapping.",
        Clause::InvalidJson | Clause::InvalidToml | Clause::InvalidYaml => {
            "Correct its syntax, or supply another file."
        }
    }
}

/// What the operator does about a discovered file, or `None` for a clause a discovered file is
/// silent about.
pub(super) fn discovered_step(clause: Clause) -> Option<&'static str> {
    match clause {
        Clause::DoesNotExist => None,
        Clause::CouldNotBeRead => Some("Make it readable, or remove it."),
        Clause::NotJsonObject => Some("Write its settings as one JSON object, or remove it."),
        Clause::NotYamlMapping => Some("Write its settings as one YAML mapping, or remove it."),
        Clause::InvalidJson | Clause::InvalidToml | Clause::InvalidYaml => {
            Some("Correct its syntax, or remove it.")
        }
    }
}

/// Where a file stops parsing, or nothing when the parser named no place.
fn where_at(at: Option<Position>) -> String {
    at.map_or_else(String::new, |at| {
        format!(" at line {}, column {}", at.line, at.column)
    })
}

/// A file escaped, marked up for the terminal, and kept whole when a lane wraps.
fn warned(file: &str, style: &ContextualStyle) -> String {
    nowrap(&style.escape(&shown(file)))
}

/// The files a warning lists, in order.
fn warned_files(files: &[&str], style: &ContextualStyle) -> String {
    files
        .iter()
        .map(|file| warned(file, style))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Why the file `--config` named cannot be used.
pub(super) fn named_file_issue(file: &str, clause: Clause, at: Option<Position>) -> String {
    format!(
        "File \"{}\" {}{}. {}",
        shown(file),
        clause.text(),
        where_at(at),
        named_step(clause)
    )
}

/// The failure of the file `--config` named, on the option that named it.
pub(super) fn named_file_failure(spelling: &str, issue: &str) -> String {
    format!("Option \"{}\": {issue}", shown(spelling))
}

/// `--config` beside `--no-config`.
pub(super) fn exclusive_file_options(spellings: &[String]) -> String {
    let quoted: Vec<String> = spellings
        .iter()
        .map(|spelling| format!("\"{}\"", shown(spelling)))
        .collect();
    format!(
        "Options {} cannot be used together. Supply only one of them.",
        quoted.join(" and ")
    )
}

/// The warning of files that match the pattern after the one found.
pub(super) fn skipped_candidates(skipped: &[&str], found: &str, style: &ContextualStyle) -> String {
    format!(
        "Skipped {}: {} matches the same pattern first. Keep one of the files, and remove the others.",
        warned_files(skipped, style),
        warned(found, style)
    )
}

/// The warning of a discovered file that cannot be used, for a clause that has a step.
pub(super) fn skipped_unusable(
    file: &str,
    clause: Clause,
    at: Option<Position>,
    step: &str,
    style: &ContextualStyle,
) -> String {
    format!(
        "Skipped {}: the file {}{}, so this run reads no configuration. {step}",
        warned(file, style),
        clause.text(),
        where_at(at)
    )
}

/// The notice that no file was found.
pub(super) fn no_file_notice(file: &str, app: &str, style: &ContextualStyle) -> String {
    format!(
        "Found no configuration file. Create {} to configure {}.",
        warned(file, style),
        shown(app)
    )
}

/// The `-v` line for one removed value: the value at a shown path, kept on one line, or every key.
pub(super) fn ignored_value(
    path: Option<&str>,
    file: Option<&str>,
    issue: &str,
    style: &ContextualStyle,
) -> String {
    let subject = path.map_or_else(
        || "every key".to_owned(),
        |path| nowrap(&style.escape(&shown(path))),
    );
    let place = file.map_or_else(String::new, |file| format!(" in {}", warned(file, style)));
    format!("Ignored {subject}{place}: {}", style.escape(&shown(issue)))
}

/// The `-v` line for one value an option cannot take.
pub(super) fn ignored_option(
    spelling: &str,
    path: Option<&str>,
    label: &str,
    issue: &str,
    style: &ContextualStyle,
) -> String {
    let position = path.map_or_else(String::new, |path| format!(" at {}", shown(path)));
    format!(
        "Ignored option \"{}\"{position} from {}: {issue}",
        shown(spelling),
        style.escape(&shown(label))
    )
}

pub(super) const BOOLEAN_ISSUE: &str = "Use true or false.";

pub(super) const COUNT_ISSUE: &str = "Use a whole number of 0 or more.";

pub(super) const STRING_OR_NUMBER_ISSUE: &str = "Use a string or a number.";

pub(super) const STRING_LIST_ISSUE: &str = "Use an array of strings or numbers.";
