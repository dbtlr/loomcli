//! The `stats depth max` action.

use loomcli_core::{Content, Context, Inputs, Outcome};
use serde_json::Value;

use crate::document_input::document_input;
use crate::read_json::read_json;
use crate::resolve_path::resolve_path;

/// A scalar holds no array or object.
const SCALAR: usize = 0;

/// Each array or object adds one level to the deepest level among its members.
const LEVEL: usize = 1;

/// What `stats depth max` reads.
#[derive(Inputs)]
pub struct MaxInputs {
    /// The document, from the shared document input.
    #[option(builder = document_input())]
    pub file: Content,
    /// Dot path to measure. Omit it for the root.
    #[argument]
    pub path: Option<String>,
}

/// The members of an array or object, or none for a scalar.
fn members_of(value: &Value) -> Option<Box<dyn Iterator<Item = &Value> + '_>> {
    match value {
        Value::Array(items) => Some(Box::new(items.iter())),
        Value::Object(members) => Some(Box::new(members.values())),
        _ => None,
    }
}

/// How many arrays and objects nest at a value: 0 for a scalar, 1 for an empty array or object.
fn depth_of(value: &Value) -> usize {
    match members_of(value) {
        None => SCALAR,
        Some(members) => LEVEL + members.map(depth_of).fold(SCALAR, usize::max),
    }
}

/// Prints the deepest nesting level under the path. An omitted path measures the whole document.
pub async fn max_depth(context: Context<MaxInputs>) -> Outcome {
    let Context {
        inputs, out, style, ..
    } = context;
    let document = read_json(&inputs.file, &out, &style).await?;
    let value = match &inputs.path {
        None => &document,
        Some(path) => resolve_path(&document, path)?,
    };
    out.print(&depth_of(value).to_string()).await
}
