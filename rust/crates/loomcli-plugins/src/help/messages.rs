//! The sentences of the help plugin: the hint under a usage error.

use loomcli_core::escape_control_characters;

pub(super) fn usage_hint(command: &[&str]) -> String {
    let shown: Vec<String> = command
        .iter()
        .map(|word| escape_control_characters(word))
        .collect();
    format!("Run \"{}\" to see the usage.", shown.join(" "))
}
