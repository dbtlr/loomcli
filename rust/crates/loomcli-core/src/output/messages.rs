//! The operator sentences core's output writes.

use crate::failures::messages::{quoted, routed_subject};
use crate::plugins::plugin::plugin_sentence;

/// The sentence a sequence that stopped early leaves on stderr, without its line end.
pub(super) fn incomplete_output(path: &[String], yielded: usize, written: usize) -> String {
    format!(
        "Output is incomplete: {} stopped after {yielded} rows, {written} written.",
        routed_subject(path)
    )
}

/// The text of the cancellation echo a write rejects with once a closed reader cancelled the run.
pub(super) const RUN_CANCELLED: &str = "The run was cancelled.";

pub(super) fn invalid_redact_path(path: &str) -> String {
    format!(
        "The Application redacts {}, which is not a dotted path of nonempty keys.",
        quoted(path)
    )
}

pub(super) const REDACT_PATH_CORRECTION: &str =
    "List dotted paths of nonempty keys, such as password or user.token.";

pub(super) const RESULTS_NOT_DECLARED: &str =
    "Only the action of a Command that declares a result calls out.results().";

pub(super) fn view_not_declared(name: &str) -> String {
    format!("The view {} is not declared.", quoted(name))
}

pub(super) const VIEW_RENDERS_ROWS: &str = "The selected view renders rows, not a value.";

pub(super) const VIEW_RENDERS_VALUE: &str = "The selected view renders a value, not rows.";

pub(super) const NOT_JSON_DATA: &str =
    "The value cannot be encoded as JSON. Emit plain JSON data from the action.";

pub(super) fn incompatible_transform(plugin: &str, path: &[String]) -> String {
    format!(
        "{} assigned a result transform incompatible with the selected view on {}.",
        plugin_sentence(plugin),
        routed_subject(path)
    )
}
