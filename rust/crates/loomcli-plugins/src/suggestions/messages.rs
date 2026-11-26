//! The sentences of the suggestions plugin.

use loomcli_core::escape_control_characters;

/// The sentence that names what the operator typed and offers the matches as its fix, or `None`
/// when nothing matched.
pub(super) fn unknown_with_suggestion(kind: &str, typed: &str, names: &[String]) -> Option<String> {
    let shown: Vec<String> = names
        .iter()
        .map(|name| escape_control_characters(name))
        .collect();
    let fix = match shown.as_slice() {
        [] => return None,
        [only] => format!("Did you mean \"{only}\"?"),
        _ => format!("Did you mean one of these: {}?", shown.join(", ")),
    };
    Some(format!(
        "Unknown {} \"{}\". {fix}",
        escape_control_characters(kind),
        escape_control_characters(typed)
    ))
}
