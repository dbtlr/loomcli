//! The sentences of the dotenv plugin.

use loomcli_core::{LogFields, escape_control_characters};

pub(super) enum Skip<'a> {
    Except,
    NotOnly,
    Set,
    Specific(&'a str),
}

pub(super) fn imported(count: usize, file: &str) -> (&'static str, LogFields) {
    let template = if count == 1 {
        "Imported {count} variable from {file}."
    } else {
        "Imported {count} variables from {file}."
    };
    (
        template,
        LogFields::new().field("count", count).field("file", file),
    )
}

pub(super) fn skipped(name: &str, file: &str, reason: Skip<'_>) -> (&'static str, LogFields) {
    let fields = LogFields::new().field("file", file).field("name", name);
    match reason {
        Skip::Except => ("Skipped {name} from {file}: on the except list.", fields),
        Skip::NotOnly => ("Skipped {name} from {file}: not on the only list.", fields),
        Skip::Set => ("Skipped {name} from {file}: already set.", fields),
        Skip::Specific(file) => (
            "Skipped {name} from {file}: already set from {specific}.",
            fields.field("specific", file),
        ),
    }
}

pub(super) fn file_unreadable(file: &str) -> String {
    format!(
        "Skipped {}: the file could not be read. Make it readable, or remove it.",
        escape_control_characters(file)
    )
}

pub(super) fn line_malformed(name: &str, line: usize, file: &str) -> String {
    format!(
        "Skipped {} on line {line} of {}: the line is not a valid assignment. Correct the line, or remove it.",
        escape_control_characters(name),
        escape_control_characters(file)
    )
}
