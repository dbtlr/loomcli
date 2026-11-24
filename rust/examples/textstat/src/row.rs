//! One counted source.

use serde::Serialize;

/// One counted source: the number its metric produced, and the name the row prints. The summary
/// marker is never serialized, so it cannot enter JSON results or collide with a filename.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Row {
    /// The count the selected metric produced.
    pub count: u64,
    /// The source's name as the operator supplied it, or `stdin`, or `total`.
    pub source: String,
    /// Whether this is the summary row.
    #[serde(skip)]
    pub is_total: bool,
}
