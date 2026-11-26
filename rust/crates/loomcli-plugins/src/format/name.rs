//! The validator `--format` carries.

use loomcli_core::{InputSchema, Issue, ValidationContext, Validator, with_schema_dialect};
use serde_json::{Map, json};

use super::messages;

/// The unadvertised alias `--format` accepts for `jsonl`, unless a record names it directly.
const NDJSON: &str = "ndjson";

/// Accepts a string that names one of the Command's views, with `ndjson` accepted as an alias of
/// `jsonl` unless the record already names `ndjson` itself. The alias is mapped ahead of the match,
/// so the schema the option publishes carries the view names alone.
pub(crate) struct FormatName {
    names: Vec<String>,
    aliased: bool,
}

impl FormatName {
    /// A validator over these view names, in the record's order.
    pub(crate) fn over(names: Vec<String>) -> Self {
        let aliased = !names.iter().any(|name| name == NDJSON);
        Self { names, aliased }
    }
}

impl Validator for FormatName {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        let name = if self.aliased && input == NDJSON {
            "jsonl"
        } else {
            input
        };
        match self.names.iter().find(|each| each.as_str() == name) {
            Some(found) => Ok(found.clone()),
            None => Err(vec![Issue::new(messages::format_issue(&self.names))]),
        }
    }

    fn input_schema(&self) -> InputSchema {
        let mut schema = Map::new();
        schema.insert("type".to_owned(), json!("string"));
        schema.insert("enum".to_owned(), json!(self.names));
        Some(with_schema_dialect(schema))
    }
}
