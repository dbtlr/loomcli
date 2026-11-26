//! The sentences of the help plugin: the hint under a usage error.

#[cfg(feature = "help")]
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

/// The requirement shared by the help masthead and the man page.
pub(crate) const TERMINAL_NEED_LABEL: &str = "Needs a terminal: ";
pub(crate) const TERMINAL_NEED_TEXT: &str = "stdin and stderr, outside CI.";
