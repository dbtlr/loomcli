//! The sentences of the configuration plugin.

use std::borrow::Cow;

use loomcli_core::LogFields;
use loomcli_core::{ContextualStyle, Issue, escape_control_characters, issue_path, nowrap};

use super::reading::{Clause, ConfigurationReader, Position, ReaderFormat, has_reader};

/// A value a sentence repeats, escaped as a failure message quotes text.
fn shown(text: &str) -> String {
    escape_control_characters(text)
}

fn clause_text(clause: Clause) -> &'static str {
    match clause {
        Clause::DoesNotExist => "does not exist",
        Clause::CouldNotBeRead => "could not be read",
        Clause::InvalidJson => "is not valid JSON",
        Clause::NotJsonObject => "does not hold a JSON object",
        Clause::InvalidToml => "is not valid TOML",
        Clause::InvalidYaml => "is not valid YAML",
        Clause::NotYamlMapping => "does not hold a YAML mapping",
        Clause::Unread(ReaderFormat::Toml) => "is TOML, which this application does not read",
        Clause::Unread(ReaderFormat::Yaml) => "is YAML, which this application does not read",
    }
}

fn unread_step(readers: &[ConfigurationReader]) -> String {
    let formats = std::iter::once("JSON").chain(
        ReaderFormat::ORDER
            .into_iter()
            .filter(|format| has_reader(readers, *format))
            .map(ReaderFormat::name),
    );
    format!(
        "Supply a {} file.",
        formats.collect::<Vec<_>>().join(" or ")
    )
}

/// What the operator does about the file `--config` named.
fn named_step(clause: Clause, readers: &[ConfigurationReader]) -> Cow<'static, str> {
    match clause {
        Clause::DoesNotExist => "Supply the path of an existing file.",
        Clause::CouldNotBeRead => "Supply a file this process can read.",
        Clause::NotJsonObject => "Write its settings as one JSON object.",
        Clause::NotYamlMapping => "Write its settings as one YAML mapping.",
        Clause::InvalidJson | Clause::InvalidToml | Clause::InvalidYaml => {
            "Correct its syntax, or supply another file."
        }
        Clause::Unread(_) => return Cow::Owned(unread_step(readers)),
    }
    .into()
}

/// What the operator does about a discovered file, or `None` for a clause a discovered file is
/// silent about.
pub(super) fn discovered_step(
    clause: Clause,
    readers: &[ConfigurationReader],
) -> Option<Cow<'static, str>> {
    let step = match clause {
        Clause::DoesNotExist => return None,
        Clause::CouldNotBeRead => "Make it readable, or remove it.",
        Clause::NotJsonObject => "Write its settings as one JSON object, or remove it.",
        Clause::NotYamlMapping => "Write its settings as one YAML mapping, or remove it.",
        Clause::InvalidJson | Clause::InvalidToml | Clause::InvalidYaml => {
            "Correct its syntax, or remove it."
        }
        Clause::Unread(_) => return Some(Cow::Owned(unread_step(readers))),
    };
    Some(Cow::Borrowed(step))
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
pub(super) fn named_file_issue(
    file: &str,
    clause: Clause,
    at: Option<Position>,
    readers: &[ConfigurationReader],
) -> String {
    format!(
        "File \"{}\" {}{}. {}",
        shown(file),
        clause_text(clause),
        where_at(at),
        named_step(clause, readers)
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
        clause_text(clause),
        where_at(at)
    )
}

/// A discovered file that strict configuration cannot use.
pub(super) fn strict_broken_file(
    file: &str,
    clause: Clause,
    at: Option<Position>,
    step: &str,
) -> String {
    format!(
        "Configuration file {} {}{}. {step}",
        shown(file),
        clause_text(clause),
        where_at(at)
    )
}

/// A strict schema issue, at its original path or on the whole file.
pub(super) fn rejected_value(path: Option<&str>, file: &str, message: &str) -> String {
    let file = shown(file);
    let message = shown(message);
    let stop = if message.ends_with(['.', '!', '?']) {
        ""
    } else {
        "."
    };
    match path {
        Some(path) => format!(
            "Configuration value {} in {file}: {message}{stop} Correct the value, or remove it.",
            shown(path)
        ),
        None => {
            format!("Configuration file {file}: {message}{stop} Correct the file, or remove it.")
        }
    }
}

pub(super) fn strict_unknown_key(path: &str, file: &str) -> String {
    format!(
        "Unknown key {} in {}. Check its spelling, or remove it.",
        shown(path),
        shown(file)
    )
}

pub(super) fn strict_option_issue(spelling: &str, label: &str, issue: &Issue) -> String {
    let at = issue_path(issue).map_or_else(String::new, |path| format!(" at {}", shown(&path)));
    format!(
        "Option \"{}\" (from {}){at}: {}",
        shown(spelling),
        shown(label),
        shown(&issue.message)
    )
}

pub(super) fn source_label(path: &str, file: &str) -> String {
    format!("{} in {}", shown(path), shown(file))
}

/// The notice that no file was found.
pub(super) fn no_file_notice(file: &str, app: &str, style: &ContextualStyle) -> String {
    format!(
        "Found no configuration file. Create {} to configure {}.",
        warned(file, style),
        shown(app)
    )
}

pub(super) const NO_FILE_FOUND: &str = "Found no configuration file.";

pub(super) fn read_from(file: &str) -> (&'static str, LogFields) {
    (
        "Read configuration from {file}.",
        LogFields::new().field("file", file),
    )
}

pub(super) fn looked_for(file: &str) -> (&'static str, LogFields) {
    (
        "Looked for {file}: not found.",
        LogFields::new().field("file", file),
    )
}

/// The `-v` line for one removed value: the value at a shown path, kept on one line, or every key.
pub(super) fn ignored_value(
    key: Option<&str>,
    file: Option<&str>,
    issue: &str,
) -> (&'static str, LogFields) {
    const WHOLE: &str = "Ignored every key: {issue}";
    const WHOLE_FILE: &str = "Ignored every key in {file}: {issue}";
    const KEY: &str = "Ignored {key}: {issue}";
    const KEY_FILE: &str = "Ignored {key} in {file}: {issue}";
    let mut fields = LogFields::new();
    if let Some(file) = file {
        fields = fields.field("file", file);
    }
    fields = fields.field("issue", issue);
    if let Some(key) = key {
        fields = fields.field("key", key);
    }
    let template = match (key, file) {
        (None, None) => WHOLE,
        (None, Some(_)) => WHOLE_FILE,
        (Some(_), None) => KEY,
        (Some(_), Some(_)) => KEY_FILE,
    };
    (template, fields)
}

/// The debug event for a value an option cannot take.
pub(super) fn ignored_option(
    spelling: &str,
    path: Option<&str>,
    label: &str,
    issue: &str,
) -> (&'static str, LogFields) {
    const OPTION: &str = r#"Ignored option "{option}" from {label}: {issue}"#;
    const POSITION: &str = r#"Ignored option "{option}" at {position} from {label}: {issue}"#;
    let fields = LogFields::new()
        .field("issue", issue)
        .field("label", label)
        .field("option", spelling);
    match path {
        Some(path) => (POSITION, fields.field("position", path)),
        None => (OPTION, fields),
    }
}

pub(super) const BOOLEAN_ISSUE: &str = "Use true or false.";

pub(super) const UNKNOWN_KEY_ISSUE: &str = "Unknown key. Check its spelling, or remove it.";

pub(super) const COUNT_ISSUE: &str = "Use a whole number of 0 or more.";

pub(super) const STRING_OR_NUMBER_ISSUE: &str = "Use a string or a number.";

pub(super) const STRING_LIST_ISSUE: &str = "Use an array of strings or numbers.";

pub(super) fn arity_issue(arity: usize, multiple: bool) -> String {
    if multiple {
        format!("Use an array of arrays, each of {arity} strings or numbers.")
    } else {
        format!("Use an array of {arity} strings or numbers.")
    }
}
