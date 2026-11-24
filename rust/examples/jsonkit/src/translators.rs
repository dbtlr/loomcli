//! The translator from a JSON parse error to jsonkit's failure class.

use loomcli_core::{EX_DATAERR, Failure, FatalError, Translation, translate};

/// A document that is not valid JSON. The data was read, and its syntax is wrong, so it exits with
/// `EX_DATAERR`. The translator sees only the parse error, so the sentence names no source and
/// quotes no parser text. A machine reader branches on its failure code, `invalid-json`.
#[derive(Debug, Failure)]
#[failure(code = "invalid-json", exit_code = EX_DATAERR)]
pub struct InvalidJsonError {
    #[failure(base)]
    base: FatalError,
}

impl InvalidJsonError {
    /// The failure, keeping the parse error as its cause.
    #[must_use]
    pub fn new(cause: serde_json::Error) -> Self {
        Self {
            base: FatalError::with_cause(
                "The document is not valid JSON. Correct its syntax, or supply another document.",
                cause,
            ),
        }
    }
}

/// `serde_json` returns a parse error for a malformed document, and no reader handles it, so the
/// translation turns it into `InvalidJsonError` wherever it is raised.
#[must_use]
pub fn invalid_json() -> Translation {
    translate(|error: serde_json::Error| Ok(InvalidJsonError::new(error)))
}
