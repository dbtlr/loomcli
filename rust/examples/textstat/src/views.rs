//! textstat's view overrides and the table's cell function.

use loomcli_core::{FailureFacts, FailureView, FatalError, ViewContext};
use serde_json::Value;

use crate::row::Row;

/// A fatal failure prints its escaped message alone, with no application-name prefix.
pub fn fatal_error() -> FailureView<FatalError> {
    FailureView::new(|failure: &FatalError, context| {
        format!("{}\n", context.view_context.style.escape(failure.message()))
    })
}

/// One cell: the field's text, escaped, in the `highlight` token on the summary row and the
/// `primary` token on every other.
#[must_use]
pub fn row_cell(value: &Value, row: &Row, context: &ViewContext) -> String {
    let text = match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let style = &context.style;
    let token = if row.is_total {
        style.highlight()
    } else {
        style.primary()
    };
    token.apply(&style.escape(&text))
}
