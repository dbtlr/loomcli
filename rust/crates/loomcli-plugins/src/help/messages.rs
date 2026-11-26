//! The sentences of the help plugin: the hint under a usage error.

use loomcli_core::escape_control_characters;

#[cfg(feature = "help")]
pub(super) fn usage_hint(command: &[&str]) -> String {
    let shown: Vec<String> = command
        .iter()
        .map(|word| escape_control_characters(word))
        .collect();
    format!("Run \"{}\" to see the usage.", shown.join(" "))
}

/// The `--` row that explains the escape for a child name.
pub(crate) const CHILD_NAME_ESCAPE: &str =
    "Read every later word as an argument, even a command name.";

/// The label of the terminal requirement.
pub(crate) const TERMINAL_NEED_LABEL: &str = "Needs a terminal: ";
/// The terminal requirement shared by help, man pages, and command references.
pub(crate) const TERMINAL_NEED_TEXT: &str = "stdin and stderr, outside CI.";

pub(super) fn stdin_sentence(required: bool) -> &'static str {
    if required {
        "Required. Reads piped or redirected stdin. Terminal input is not accepted."
    } else {
        "Optional. Reads piped or redirected stdin. Terminal input is not accepted."
    }
}

pub(super) fn stdin_example(path: &str) -> String {
    format!("Example: <producer> | {}", escape_control_characters(path))
}
