//! The `keys` action.

use loomcli_core::{Content, Context, Inputs, Outcome};
use serde_json::Value;

use crate::document_input::document_input;
use crate::json::object_entries;
use crate::kinds::describe_kind;
use crate::read_json::read_json;
use crate::resolve_path::resolve_path;

/// What `keys` reads.
#[derive(Inputs)]
pub struct KeysInputs {
    /// The document, from the shared document input.
    #[option(builder = document_input())]
    pub file: Content,
    /// Dot path to list. Omit it for the root.
    #[argument]
    pub path: Option<String>,
}

/// Prints the keys of the object at the path, one per line. An omitted path selects the whole
/// document, so the root keeps its own wording.
pub async fn list_keys(context: Context<KeysInputs>) -> Outcome {
    let Context {
        inputs, out, style, ..
    } = context;
    let document = read_json(&inputs.file, &out, &style).await?;
    let value = match &inputs.path {
        None => &document,
        Some(path) => resolve_path(&document, path)?,
    };
    let place = inputs.path.as_deref().unwrap_or("the root");
    let Value::Object(record) = value else {
        return Err(out.fatal(format!(
            "Expected an object at {place}; found {}. Run jsonkit paths to find the paths that hold objects.",
            describe_kind(value)
        )));
    };
    for (key, _) in object_entries(record) {
        out.print(&style.escape(key)).await?;
    }
    Ok(())
}
