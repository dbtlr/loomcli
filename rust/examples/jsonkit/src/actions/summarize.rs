//! The root action.

use loomcli_core::{Context, Outcome, RowsResult};
use serde_json::Value;

use crate::document_input::DocumentInputs;
use crate::json::object_entries;
use crate::kinds::describe_kind;
use crate::member::Member;
use crate::read_json::read_json;

/// Names the document's kind on stderr and emits its top-level members as the result. A document
/// that is not an object has no members, so its result is an empty sequence.
pub async fn summarize(context: Context<DocumentInputs, RowsResult<Member>>) -> Outcome {
    let Context {
        inputs, out, style, ..
    } = context;
    let document = read_json(&inputs.file, &out, &style).await?;
    out.info(&describe_kind(&document)).await?;
    let members: Vec<Member> = match &document {
        Value::Object(record) => object_entries(record)
            .into_iter()
            .map(|(key, value)| Member {
                key: key.clone(),
                kind: describe_kind(value),
            })
            .collect(),
        _ => Vec::new(),
    };
    out.results(members).await
}
