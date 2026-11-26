//! The closed set of values an input's published schema names, read one keyword at a time.

use serde_json::{Map, Value};

/// One JSON Schema object as the graph publishes it.
pub(super) type Schema = Map<String, Value>;

/// Keywords that describe a schema without constraining the values it accepts, so a closed set
/// beside one still lists every value it accepts.
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
fn closed_keyword(schema: &Schema) -> Option<ClosedKeyword> {
    let mut shapes = schema
        .keys()
        .filter_map(|keyword| closed_keyword_of(keyword));
    let first = shapes.next();
    let harmless = schema.iter().all(|(keyword, value)| {
        closed_keyword_of(keyword).is_some()
            || (keyword == "type" && value == "string")
            || ANNOTATIONS.contains(&keyword.as_str())
    });
    if harmless && shapes.next().is_none() {
        first
    } else {
        None
    }
}

/// The strings of a list that holds nothing else.
fn strings(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|entry| entry.as_str().map(str::to_owned))
        .collect()
}

/// The values one `enum` or `const` level names, or `None` for any other level.
fn member(schema: &Schema) -> Option<Vec<String>> {
    match closed_keyword(schema)? {
        ClosedKeyword::Enum => strings(schema.get("enum")?),
        ClosedKeyword::Const => schema
            .get("const")?
            .as_str()
            .map(|value| vec![value.to_owned()]),
        ClosedKeyword::AnyOf => None,
    }
}

/// The values an `anyOf` names when every member is an `enum` or a `const`, flattened in order.
fn flattened(members: &Value) -> Option<Vec<String>> {
    let mut named = Vec::new();
    for entry in members.as_array()? {
        named.extend(member(entry.as_object()?)?);
    }
    Some(named)
}

/// The distinct values an input's schema names, in first-occurrence order: an `enum`, a `const`, or
/// an `anyOf` of those. A schema that names no closed set, a missing schema included, answers
/// `None`. The set is whole.
pub(super) fn closed_set(schema: Option<&Schema>) -> Option<Vec<String>> {
    let schema = schema?;
    let values = if closed_keyword(schema) == Some(ClosedKeyword::AnyOf) {
        flattened(schema.get("anyOf")?)
    } else {
        member(schema)
    }?;
    let mut distinct: Vec<String> = Vec::with_capacity(values.len());
    for value in values {
        if !distinct.contains(&value) {
            distinct.push(value);
        }
    }
    Some(distinct)
}
