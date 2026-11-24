//! The kinds of JSON value, as every Command words them.

use serde_json::Value;

/// One member reads as `1 key` or `1 item`, never `1 keys`.
const SINGULAR: usize = 1;

/// Member counts read as English, so one member never reports "1 items".
fn count(amount: usize, noun: &str) -> String {
    let plural = if amount == SINGULAR { "" } else { "s" };
    format!("{amount} {noun}{plural}")
}

/// One wording for every JSON kind, shared by the summary and the keys diagnostic.
#[must_use]
pub fn describe_kind(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Array(items) => format!("array with {}", count(items.len(), "item")),
        Value::Object(members) => format!("object with {}", count(members.len(), "key")),
        Value::String(_) => "string".to_owned(),
        Value::Number(_) => "number".to_owned(),
        Value::Bool(_) => "boolean".to_owned(),
    }
}
