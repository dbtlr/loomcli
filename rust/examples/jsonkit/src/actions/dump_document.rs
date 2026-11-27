//! The hidden `debug` action.

use loomcli_core::{Content, Context, Inputs, Outcome};

use crate::document_input::document_input;
use crate::json_layout::JsonLayout;
use crate::read_json::read_json;

/// What the hidden debug Command reads.
#[derive(Inputs)]
pub struct DumpInputs {
    /// The document, from the shared document input.
    #[option(builder = document_input())]
    pub file: Content,
    /// Shared JSON layout options.
    #[inputs(flatten)]
    pub layout: JsonLayout,
}

/// Prints the whole parsed document.
pub async fn dump_document(context: Context<DumpInputs>) -> Outcome {
    let Context {
        inputs,
        out,
        log,
        style,
        ..
    } = context;
    let document = read_json(&inputs.file, &log).await?;
    out.print(&style.escape(&inputs.layout.format(&document)))
        .await
}
