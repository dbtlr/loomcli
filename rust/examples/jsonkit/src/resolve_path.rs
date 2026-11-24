//! The one path syntax and the one failure every Command that takes a path shares.

use loomcli_core::{EX_DATAERR, Failure, FatalError, escape_control_characters};
use serde_json::Value;

/// A segment of digits alone indexes an array.
fn is_digits(segment: &str) -> bool {
    !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit())
}

/// The member one segment reaches from `current`, or `None` when it holds none. A resolved
/// `null` is `Some(&Value::Null)`, so it stays distinct from an unresolved path.
fn resolve_segment<'a>(current: &'a Value, segment: &str) -> Option<&'a Value> {
    match current {
        // A count of digits beyond any index reads as no index, as an index past the end does.
        Value::Array(items) if is_digits(segment) => segment
            .parse::<usize>()
            .ok()
            .and_then(|index| items.get(index)),
        Value::Object(members) => members.get(segment),
        _ => None,
    }
}

/// A path the document does not hold. The document was read, so its data holds no value there,
/// which `EX_DATAERR` reports and `EX_NOINPUT` would misreport as a missing input file. The path is
/// quoted, so a trailing dot stays inside the quotes, with its control characters escaped; the
/// application's `FatalError` view escapes its markup. A machine reader branches on its failure
/// code, `path-not-found`, which the manifest lists.
#[derive(Debug, Failure)]
#[failure(code = "path-not-found", exit_code = EX_DATAERR)]
pub struct PathNotFoundError {
    #[failure(base)]
    base: FatalError,
}

impl PathNotFoundError {
    /// The failure for `path`, quoted with its control characters escaped.
    #[must_use]
    pub fn new(path: &str) -> Self {
        Self {
            base: FatalError::new(format!(
                "Path not found: \"{}\". Run jsonkit keys to list the keys at the root.",
                escape_control_characters(path)
            )),
        }
    }
}

/// The value at a path, or `PathNotFoundError` when the document holds none. Digit segments index
/// arrays; on an object every segment, digits included, is a key. Every Command that takes a path
/// resolves it here, so one syntax and one failure serve the whole application.
pub fn resolve_path<'a>(document: &'a Value, path: &str) -> Result<&'a Value, PathNotFoundError> {
    let mut current = document;
    for segment in path.split('.') {
        current = resolve_segment(current, segment).ok_or_else(|| PathNotFoundError::new(path))?;
    }
    Ok(current)
}
