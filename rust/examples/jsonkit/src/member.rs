//! A top-level member of the document.

use serde::Serialize;

/// One top-level object member: its key and the kind of JSON value it holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Member {
    /// The key.
    pub key: String,
    /// The kind of its value, as `describe_kind` words it.
    pub kind: String,
}
