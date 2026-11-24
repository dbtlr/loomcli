//! The `$schema` pointer a configuration file may hold: the URL of the file's hosted JSON Schema,
//! which an editor reads. The schema the plugin publishes lists it, and the plugin removes it from
//! the file before it validates, so it is never a setting.

use loomcli_core::InputSchema;
use serde_json::{Map, Value, json};

const POINTER_KEY: &str = "$schema";

/// A reference into the schema's own definitions.
const DEFINITION_PREFIX: &str = "#/$defs/";

/// Whether a schema describes an object: its `type` is `object`, or it lists `properties`.
fn describes_object(schema: &Map<String, Value>) -> bool {
    schema.get("type") == Some(&json!("object"))
        || schema.get("properties").is_some_and(Value::is_object)
}

/// One object schema with the pointer among its `properties`, or the schema as it is otherwise. A
/// property the author already declared for the pointer is kept.
fn listing(schema: &Map<String, Value>) -> Map<String, Value> {
    if !describes_object(schema) {
        return schema.clone();
    }
    let mut properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if properties.contains_key(POINTER_KEY) {
        return schema.clone();
    }
    properties.insert(POINTER_KEY.to_owned(), json!({ "type": "string" }));
    let mut listed = schema.clone();
    listed.insert("properties".to_owned(), Value::Object(properties));
    listed
}

/// A published JSON Schema with the pointer listed among the properties of its top-level object.
/// A top level that is a `$ref` into its own `$defs` lists it in the definition it names. A top
/// level that describes an object with no `properties`, such as a record, gains `properties` with
/// the pointer alone. A union, an `allOf`, and any other top level are published as they are.
pub(crate) fn with_pointer(schema: InputSchema) -> InputSchema {
    let published = schema?;
    let reference = published.get("$ref").and_then(Value::as_str);
    let defs = published.get("$defs").and_then(Value::as_object);
    if let (Some(name), Some(defs)) = (
        reference.and_then(|reference| reference.strip_prefix(DEFINITION_PREFIX)),
        defs,
    ) && let Some(Value::Object(definition)) = defs.get(name)
    {
        let mut defs = defs.clone();
        defs.insert(name.to_owned(), Value::Object(listing(definition)));
        let mut published = published.clone();
        published.insert("$defs".to_owned(), Value::Object(defs));
        return Some(published);
    }
    Some(listing(&published))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }

    // config.test.ts: "the published schema: %s", and the graph's published schema.
    #[test]
    fn the_published_schema_lists_the_pointer_where_the_top_level_object_is() {
        let pointer = json!({ "type": "string" });
        for (answer, expected) in [
            (
                json!({ "type": "object", "properties": { "retries": { "type": "integer" } } }),
                json!({ "type": "object", "properties": { "retries": { "type": "integer" }, "$schema": pointer } }),
            ),
            (
                json!({ "additionalProperties": { "type": "number" }, "type": "object" }),
                json!({ "additionalProperties": { "type": "number" }, "type": "object", "properties": { "$schema": pointer } }),
            ),
            (
                json!({
                    "$defs": { "Config": { "properties": { "retries": { "type": "integer" } }, "type": "object" } },
                    "$ref": "#/$defs/Config"
                }),
                json!({
                    "$defs": { "Config": { "properties": { "retries": { "type": "integer" }, "$schema": pointer }, "type": "object" } },
                    "$ref": "#/$defs/Config"
                }),
            ),
            (
                json!({ "properties": { "$schema": { "format": "uri", "type": "string" } }, "type": "object" }),
                json!({ "properties": { "$schema": { "format": "uri", "type": "string" } }, "type": "object" }),
            ),
            (
                json!({ "anyOf": [{ "type": "object" }, { "type": "null" }] }),
                json!({ "anyOf": [{ "type": "object" }, { "type": "null" }] }),
            ),
        ] {
            assert_eq!(with_pointer(Some(map(answer))), Some(map(expected)));
        }
        assert_eq!(with_pointer(None), None);
    }
}
