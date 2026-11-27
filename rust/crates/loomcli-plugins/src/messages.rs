//! The sentences of the files at the top of `src`, which several plugins share.

/// The sentence both encode failures start with. The engine's reason differs between libraries and
/// can hold data, so it stays on the error's source and out of the message.
#[cfg(any(feature = "format-views", feature = "manifest"))]
#[cfg_attr(not(feature = "format-views"), allow(dead_code))]
pub(crate) const ENCODE_FAILURE: &str =
    "The value cannot be encoded as JSON. Emit plain JSON data from the action.";

#[cfg(feature = "installation")]
pub(crate) const FILE_WRITTEN: &str = "File written.";
#[cfg(feature = "installation")]
pub(crate) const FILE_REMOVED: &str = "File removed.";
#[cfg(feature = "installation")]
pub(crate) const PROGRAM_RUN: &str = "Program run.";
#[cfg(all(feature = "installation", any(feature = "self-update", test)))]
pub(crate) const BINARY_REPLACED: &str = "Binary replaced.";
