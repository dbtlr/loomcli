//! The protocol revisions the server speaks, spelled in this module alone.
//!
//! Every version check and every answer that names a revision reads these constants, so moving
//! to a later revision is a change here and to the code that revision changes.

/// The revision this crate speaks per request, with no handshake.
pub const PROTOCOL_REVISION: &str = "2026-07-28";

/// The latest initialize-era revision, which answers an `initialize` that asks for a revision
/// this crate does not serve.
pub const LATEST_HANDSHAKE_REVISION: &str = "2025-11-25";

/// The initialize-era revision whose implementation info has no description, which the next
/// revision added.
pub const UNDESCRIBED_HANDSHAKE_REVISION: &str = "2025-06-18";

/// The initialize-era revisions this crate also serves, latest first, for a client that opens its
/// connection with `initialize`.
pub const HANDSHAKE_REVISIONS: [&str; 2] =
    [LATEST_HANDSHAKE_REVISION, UNDESCRIBED_HANDSHAKE_REVISION];

/// Every revision the server serves, per-request first, as discovery and an unsupported-version
/// answer list them.
pub(crate) fn supported_revisions() -> Vec<&'static str> {
    let mut all = vec![PROTOCOL_REVISION];
    all.extend(HANDSHAKE_REVISIONS);
    all
}
