//! The explanation one Command declaration carries. It is declarations alone, so an application
//! that installs no explain plugin still compiles against it.

use loomcli_core::{CommandTarget, Extension};
use serde::{Deserialize, Serialize};

/// What `--explain` prints for a Command beside its description.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExplainFacts {
    /// The explanation.
    pub details: String,
    /// Example command lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<String>>,
}

/// `@loom/explain/command`.
pub const EXPLAIN_COMMAND: Extension<CommandTarget, ExplainFacts> =
    Extension::new("@loom/explain/command");
