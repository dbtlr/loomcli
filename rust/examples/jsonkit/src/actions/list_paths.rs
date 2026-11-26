//! The hidden `paths` action: a sequence of rows that can stop early.

use loomcli_core::{Context, Error, FatalError, Outcome, RowSource, RowsResult};
use serde_json::Value;

use crate::document_input::DocumentInputs;
use crate::entries::Entry;
use crate::json::object_members;
use crate::kinds::describe_kind;
use crate::read_json::read_json;

/// The path of the whole document, which resolves to the document itself.
const ROOT: &str = ".";

/// The key a walk refuses, so one document proves what a source that fails leaves behind.
const REFUSED: &str = "boom";

/// A child is reached from its parent by one segment, and the root spells no segment of its own.
fn join(parent: &str, segment: &str) -> String {
    if parent == ROOT {
        segment.to_owned()
    } else {
        format!("{parent}.{segment}")
    }
}

/// The members of one value under the segment that reaches each, in document order. The walk owns
/// the value, so each member moves out of it and no subtree is copied.
fn members(value: Value) -> Vec<(String, Value)> {
    match value {
        Value::Array(items) => items
            .into_iter()
            .enumerate()
            .map(|(index, item)| (index.to_string(), item))
            .collect(),
        Value::Object(record) => object_members(record),
        _ => Vec::new(),
    }
}

/// One place the walk has still to visit: a value under its path, or a refused key, which fails
/// the walk when it is reached.
enum Pending {
    Value { path: String, value: Value },
    Refused { path: String },
}

/// One entry per reachable path, the parent before its members, depth first. The walk visits one
/// place per row it is asked for, so the writer requests one row at a time and a refused key stops
/// the sequence after every row before it was written.
#[must_use = "a walk visits nothing until it is iterated"]
pub struct Walk {
    pending: Vec<Pending>,
}

impl Iterator for Walk {
    type Item = Result<Entry, Error>;

    fn next(&mut self) -> Option<Result<Entry, Error>> {
        match self.pending.pop()? {
            Pending::Refused { path } => {
                // Nothing after the failure is reached.
                self.pending.clear();
                Some(Err(FatalError::new(format!(
                    "Cannot walk {path}. Remove the \"{REFUSED}\" key from the document."
                ))
                .into()))
            }
            Pending::Value { path, value } => {
                let entry = Entry {
                    kind: describe_kind(&value),
                    path: path.clone(),
                };
                let children = members(value).into_iter().rev().map(|(segment, member)| {
                    let child = join(&path, &segment);
                    if segment == REFUSED {
                        Pending::Refused { path: child }
                    } else {
                        Pending::Value {
                            path: child,
                            value: member,
                        }
                    }
                });
                self.pending.extend(children);
                Some(Ok(entry))
            }
        }
    }
}

/// The whole document, root first, which is the sequence the Command declares.
pub fn walk(document: Value) -> Walk {
    Walk {
        pending: vec![Pending::Value {
            path: ROOT.to_owned(),
            value: document,
        }],
    }
}

/// The walk is the result, so core writes each row as the walk yields it.
pub async fn list_paths(context: Context<DocumentInputs, RowsResult<Entry>>) -> Outcome {
    let Context {
        inputs, out, log, ..
    } = context;
    let document = read_json(&inputs.file, &log).await?;
    out.results(RowSource::try_iter(walk(document))).await
}
