//! The sentences of the suggestions plugin.

use loomcli_core::escape_control_characters;

/// The sentence that names what the operator typed and offers the matches as its fix, or `None`
/// when nothing matched.
pub(super) fn unknown_with_suggestion(kind: &str, typed: &str, names: &[String]) -> Option<String> {
    let fix = value_suggestion(names)?;
    Some(format!(
        "Unknown {} \"{}\". {fix}",
        escape_control_characters(kind),
        escape_control_characters(typed)
    ))
}

/// The fix for a rejected value, containing only names of accepted candidates.
pub(super) fn value_suggestion(names: &[String]) -> Option<String> {
    let shown: Vec<String> = names
        .iter()
        .map(|name| escape_control_characters(name))
        .collect();
    match shown.as_slice() {
        [] => None,
        [only] => Some(format!("Did you mean \"{only}\"?")),
        _ => Some(format!("Did you mean one of these: {}?", shown.join(", "))),
    }
}
