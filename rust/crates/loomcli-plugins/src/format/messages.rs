//! The sentences of the format plugin.

use loomcli_core::escape_control_characters;

pub(super) fn format_issue(names: &[String]) -> String {
    let shown: Vec<String> = names
        .iter()
        .map(|name| escape_control_characters(name))
        .collect();
    format!("Supply one of {}.", shown.join(", "))
}
