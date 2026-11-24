//! Accepted values: the sentence a row prints for the values its input accepts, authored through
//! `accepts` or derived from a closed set of strings in the input's published schema.

use loomcli_core::InputSchema;
use serde_json::{Map, Value};

use super::cells::one_line;

/// The most values a derived list names; a larger set is the author's to state with `accepts`.
const MAXIMUM_VALUES: usize = 8;

/// Keywords that describe a schema without constraining the values it accepts.
const ANNOTATIONS: [&str; 10] = [
    "$comment",
    "$id",
    "$schema",
    "default",
    "deprecated",
    "description",
    "examples",
    "readOnly",
    "title",
    "writeOnly",
];

/// The keywords that name a closed set of values at one level.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ClosedKeyword {
    AnyOf,
    Const,
    Enum,
}

fn closed_keyword_of(keyword: &str) -> Option<ClosedKeyword> {
    match keyword {
        "anyOf" => Some(ClosedKeyword::AnyOf),
        "const" => Some(ClosedKeyword::Const),
        "enum" => Some(ClosedKeyword::Enum),
        _ => None,
    }
}

/// The one closed-set keyword a level holds, when every other keyword beside it leaves each listed
/// value accepted: `type: "string"` or an annotation. Two closed-set keywords at one level, or any
/// keyword that could narrow the set, answer `None`.
fn closed_keyword(schema: &Map<String, Value>) -> Option<ClosedKeyword> {
    let mut shapes = Vec::new();
    for (keyword, value) in schema {
        match closed_keyword_of(keyword) {
            Some(shape) => shapes.push(shape),
            None => {
                let harmless = (keyword == "type" && value.as_str() == Some("string"))
                    || ANNOTATIONS.contains(&keyword.as_str());
                if !harmless {
                    return None;
                }
            }
        }
    }
    match shapes.as_slice() {
        [shape] => Some(*shape),
        _ => None,
    }
}

/// A list of strings, when the value is one.
fn strings(value: Option<&Value>) -> Option<Vec<String>> {
    value?
        .as_array()?
        .iter()
        .map(|entry| entry.as_str().map(str::to_owned))
        .collect()
}

/// The values one `enum` or `const` level names, or `None` for any other level.
fn member(schema: &Map<String, Value>) -> Option<Vec<String>> {
    match closed_keyword(schema)? {
        ClosedKeyword::Enum => strings(schema.get("enum")),
        ClosedKeyword::Const => schema
            .get("const")
            .and_then(Value::as_str)
            .map(|value| vec![value.to_owned()]),
        ClosedKeyword::AnyOf => None,
    }
}

/// The values an `anyOf` names when every member is an `enum` or a `const`, flattened in order.
fn flattened(members: Option<&Value>) -> Option<Vec<String>> {
    let mut values = Vec::new();
    for entry in members?.as_array()? {
        values.extend(member(entry.as_object()?)?);
    }
    Some(values)
}

/// The distinct values an input's schema names, in first-occurrence order.
fn closed_set(schema: &InputSchema) -> Option<Vec<String>> {
    let schema = schema.as_ref()?;
    let values = if closed_keyword(schema) == Some(ClosedKeyword::AnyOf) {
        flattened(schema.get("anyOf"))?
    } else {
        member(schema)?
    };
    let mut distinct: Vec<String> = Vec::new();
    for value in values {
        if !distinct.contains(&value) {
            distinct.push(value);
        }
    }
    Some(distinct)
}

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
    let distinct = closed_set(schema)?;
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
