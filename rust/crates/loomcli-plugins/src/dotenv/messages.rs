//! The sentences of the dotenv plugin.

use loomcli_core::escape_control_characters;

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
