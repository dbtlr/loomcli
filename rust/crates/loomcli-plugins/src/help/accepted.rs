//! Accepted values: the sentence a row prints for the values its input accepts, authored through
//! `accepts` or derived from a closed set of strings in the input's published schema.

use loomcli_core::InputSchema;

use crate::closed_set::closed_set;

use super::cells::one_line;

/// The most values a derived list names; a larger set is the author's to state with `accepts`.
const MAXIMUM_VALUES: usize = 8;

/// JavaScript's `\s`.
fn is_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

/// The text with DEL and every C1 control replaced by its lowercase `\uXXXX` escape.
fn escape_controls(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        if ('\u{7f}'..='\u{9f}').contains(&character) {
            out.push_str(&format!("\\u{:04x}", u32::from(character)));
        } else {
            out.push(character);
        }
    }
    out
}

/// One value as the list prints it: as written, or as its JSON string when it is empty or holds
/// whitespace, a comma, a double quote, a line terminator, or a control character.
fn listed(value: &str) -> String {
    let plain = !value.is_empty()
        && !value.chars().any(|character| {
            is_space(character)
                || character == ','
                || character == '"'
                || character.is_control()
                || super::extension::is_terminator(character)
        });
    if plain {
        return value.to_owned();
    }
    let json = serde_json::to_string(value).unwrap_or_else(|_| value.to_owned());
    one_line(&escape_controls(&json))
}

/// The sentence derived from an input's schema: `One of: a, b, c.` for a closed set of at most
/// eight distinct strings, and nothing for anything else.
fn derived(schema: &InputSchema) -> Option<String> {
    let distinct = closed_set(schema.as_ref())?;
    if distinct.is_empty() || distinct.len() > MAXIMUM_VALUES {
        return None;
    }
    let values: Vec<String> = distinct.iter().map(|value| listed(value)).collect();
    Some(format!("One of: {}.", values.join(", ")))
}

/// The accepted-values sentence of an input that takes a value: its authored `accepts`, which
/// always wins, or the list derived from its schema.
pub(crate) fn accepted(authored: Option<&str>, schema: &InputSchema) -> Option<String> {
    authored.map(str::to_owned).or_else(|| derived(schema))
}
