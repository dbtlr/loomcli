//! The sentences of the logging plugin: the text of a failure the plugin hands to `on_error`.

use loomcli_core::escape_control_characters;

pub(super) fn unresolved_directory(variable: &str) -> String {
    format!(
        "Cannot resolve the log directory because {} is not set.",
        escape_control_characters(variable)
    )
}

pub(super) fn create_directory(path: &str) -> String {
    format!(
        "Cannot create the log directory \"{}\".",
        escape_control_characters(path)
    )
}

pub(super) fn append(path: &str) -> String {
    format!(
        "Cannot append to the log file \"{}\".",
        escape_control_characters(path)
    )
}

pub(super) fn rotate(path: &str) -> String {
    format!(
        "Cannot rotate the log file \"{}\".",
        escape_control_characters(path)
    )
}

/// The first successful append for one outermost run.
pub(super) const LOGGING_TO: &str = "Logging to {path}.";

/// The current file was renamed or removed during rotation.
pub(super) const ROTATED: &str = "Rotated {path}.";
