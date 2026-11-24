//! The failures jsonkit's Commands declare to the manifest, each with one line of meaning.
//!
//! The manifest lists each by the failure code its class declares. A Command inherits no failure
//! from its parent, so each Command lists the ones it can raise; these shared lists keep the
//! Commands in step.

use loomcli_plugins::manifest::extension::DeclaredFailure;

use crate::resolve_path::PathNotFoundError;
use crate::translators::InvalidJsonError;

/// Shared by every Command that reads a document.
#[must_use]
pub fn read_failures() -> Vec<DeclaredFailure> {
    vec![DeclaredFailure::of::<InvalidJsonError>(
        "The document is not valid JSON.",
    )]
}

/// Shared by every Command that resolves a path the operator supplies.
#[must_use]
pub fn path_failures() -> Vec<DeclaredFailure> {
    vec![DeclaredFailure::of::<PathNotFoundError>(
        "The path names no value in the document.",
    )]
}
