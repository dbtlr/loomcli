//! The error text the HTTP transport answers with, under the reference's ADR-0164. It repeats only
//! the server's own revisions, keys, headers, and limit, never a value a request carried, so it
//! needs no escaping helper.

pub(super) const BODY_NOT_JSON_TYPE: &str = "The request body is not application/json. Send each message with the header Content-Type: application/json.";

pub(super) fn body_too_large(limit: u64) -> String {
    format!(
        "The request body is larger than the {limit} bytes this server reads. Send a smaller message."
    )
}

pub(super) const BROWSER_REFUSED: &str =
    "This server answers no request a browser sends. Use an MCP client that is not a web page.";

pub(super) const AUTHORIZATION_FAILED: &str = "The server failed while it authorized the request. The failure is a defect in the server; report it to the server's author.";

pub(super) fn header_mismatch(header: &str, source: &str) -> String {
    format!(
        "The {header} header is missing or does not equal {source}. Send {header} with the value {source} holds."
    )
}

pub(super) fn no_session(version_key: &str, capabilities_key: &str) -> String {
    format!(
        "The request carries no MCP-Session-Id. Send the session id the initialize response issued, or send \"{version_key}\" and \"{capabilities_key}\" in every request's params._meta, with MCP-Protocol-Version and Mcp-Method headers, and Mcp-Name for tools/call."
    )
}

pub(super) fn version_not_session(revision: &str) -> String {
    format!(
        "The MCP-Protocol-Version header names a version other than this session's, MCP {revision}. Send {revision}, or leave the header out."
    )
}
