//! The hidden `debug` action.

use loomcli_core::{Context, Outcome};

use crate::document_input::DocumentInputs;
use crate::json::format_json;
use crate::read_json::read_json;

/// Prints the whole parsed document.
pub async fn dump_document(context: Context<DocumentInputs>) -> Outcome {
    let Context {
        inputs, out, style, ..
    } = context;
    let document = read_json(&inputs.file, &out, &style).await?;
    out.print(&style.escape(&format_json(&document))).await
}
