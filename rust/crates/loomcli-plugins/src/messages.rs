//! The sentences of the files at the top of `src`, which several plugins share.

/// The sentence both encode failures start with. The engine's reason differs between libraries and
/// can hold data, so it stays on the error's source and out of the message.
pub(crate) const ENCODE_FAILURE: &str =
    "The value cannot be encoded as JSON. Emit plain JSON data from the action.";
