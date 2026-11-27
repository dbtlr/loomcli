//! The `select` action.

use std::collections::BTreeSet;

use loomcli_core::{Content, Context, Inputs, Outcome, escape_control_characters};
use loomcli_validators::text;
use serde_json::{Map, Value};

use crate::document_input::document_input;
use crate::json_layout::JsonLayout;
use crate::kinds::describe_kind;
use crate::read_json::read_json;

/// What `select` reads.
#[derive(Inputs)]
pub struct SelectInputs {
    /// The document, from the shared document input.
    #[option(builder = document_input())]
    pub file: Content,
    /// A field to keep. Repeat it for several.
    // A field names a key, so the empty string can never name one.
    #[option(short = 'F', required, validate = text())]
    pub field: Vec<String>,
    /// Shared JSON layout options.
    #[inputs(flatten)]
    pub layout: JsonLayout,
}

/// Missing fields warn once while the remaining selection keeps its first-occurrence order.
pub async fn select_fields(context: Context<SelectInputs>) -> Outcome {
    let Context {
        inputs,
        out,
        log,
        style,
        ..
    } = context;
    let document = read_json(&inputs.file, &log).await?;
    let Value::Object(record) = document else {
        return Err(out.fatal(format!(
            "Expected an object at the root; found {}. Supply a document whose root is an object.",
            describe_kind(&document)
        )));
    };
    let mut seen = BTreeSet::new();
    let mut selected = Map::new();
    for field in &inputs.field {
        if !seen.insert(field.as_str()) {
            continue;
        }
        match record.get(field) {
            Some(value) => {
                selected.insert(field.clone(), value.clone());
            }
            None => {
                out.warn(&format!(
                    "Field not found: \"{}\". Run jsonkit keys to list the fields.",
                    style.escape(&escape_control_characters(field))
                ))
                .await?;
            }
        }
    }
    out.print(&style.escape(&inputs.layout.format(&Value::Object(selected))))
        .await
}
