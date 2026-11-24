//! The action `get` and `fetch` share.

use loomcli_core::{Content, Context, Inputs, Outcome};

use crate::document_input::document_input;
use crate::json::format_json;
use crate::read_json::read_json;
use crate::resolve_path::resolve_path;

/// What `get` and its former spelling `fetch` read.
#[derive(Inputs)]
pub struct GetInputs {
    /// The document, from the shared document input.
    #[option(builder = document_input())]
    pub file: Content,
    /// Dot path to read.
    #[argument]
    pub path: String,
}

/// Prints the value at the path.
pub async fn get_value(context: Context<GetInputs>) -> Outcome {
    let Context {
        inputs, out, style, ..
    } = context;
    let document = read_json(&inputs.file, &out, &style).await?;
    let value = resolve_path(&document, &inputs.path)?;
    out.print(&style.escape(&format_json(value))).await
}
