//! jsonkit's view overrides.

use loomcli_core::{FailureFacts, FailureView, FatalError};

/// A fatal failure prints its message alone, with no application-name prefix.
pub fn fatal_error() -> FailureView<FatalError> {
    FailureView::new(|failure: &FatalError, context| {
        format!("{}\n", context.view_context.style.escape(failure.message()))
    })
}
