//! Messages for a Command's action-specific declarations.

use crate::failures::messages::{command_sentence, command_subject, quoted};

pub(super) const PASSTHROUGH_DECLARED_TWICE: &str = "A Command declares passthrough twice.";
pub(super) const TERMINAL_NEED_DECLARED_TWICE: &str = "A Command declares a terminal need twice.";

pub(super) fn arguments_without_action(command: Option<&str>) -> String {
    format!(
        "{} declares arguments but registers no action to receive them.",
        command_sentence(command)
    )
}

pub(super) fn passthrough_without_action(command: Option<&str>) -> String {
    format!(
        "{} declares passthrough but registers no action to receive it.",
        command_sentence(command)
    )
}

pub(super) fn terminal_need_without_action(command: Option<&str>) -> String {
    format!(
        "{} needs a terminal but registers no action.",
        command_sentence(command)
    )
}

pub(super) fn argument_after_variadic(
    name: &str,
    reason: &str,
    variadic: &str,
    command: Option<&str>,
) -> String {
    format!(
        "Argument {} {reason} and follows variadic argument {} on {}.",
        quoted(name),
        quoted(variadic),
        command_subject(command)
    )
}
