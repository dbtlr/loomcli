//! One reachable place in the document.

use serde::Serialize;

/// One reachable place in the document: the dot path that resolves it, and what it holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Entry {
    /// The kind of value at the path, as `describe_kind` words it.
    pub kind: String,
    /// The dot path, `.` for the whole document.
    pub path: String,
}
