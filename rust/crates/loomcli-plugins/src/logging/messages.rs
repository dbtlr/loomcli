//! The sentences of the logging plugin: the text of a failure the plugin hands to `on_error`, the
//! `-v` and `-vv` lines, the two warnings for a rejected variable, and the failure hint.

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
#[cfg(feature = "logging")]
pub(super) const LOGGING_TO: &str = "Logging to {path}.";

/// The current file was renamed or removed during rotation.
#[cfg(feature = "logging")]
pub(super) const ROTATED: &str = "Rotated {path}.";

/// A rejected level leaves the declared thresholds in effect.
#[cfg(feature = "logging")]
pub(super) fn bad_level(name: &str, value: &str) -> String {
    format!(
        "Cannot use {}={} as a log level. Use trace, debug, info, warn, or error; using the application's log levels for this run.",
        escape_control_characters(name),
        escape_control_characters(value),
    )
}

/// A rejected path leaves the declared file in effect.
#[cfg(feature = "logging")]
pub(super) fn bad_file(name: &str, value: &str) -> String {
    format!(
        "Cannot append to the log file {} named by {}. Set it to a writable file path; using the application's log file for this run.",
        escape_control_characters(value),
        escape_control_characters(name),
    )
}

/// A file that received the failure's own record.
#[cfg(feature = "logging")]
pub(super) fn failure_log(path: &str, run: &str) -> String {
    format!(
        "Read the log of this run in {} (run {}).",
        escape_control_characters(path),
        escape_control_characters(run),
    )
}
