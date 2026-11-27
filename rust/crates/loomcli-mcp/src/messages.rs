//! The error text the MCP server returns to its client, under the reference's ADR-0164. It repeats
//! only the server's own revisions, keys, and methods, so it needs no escaping helper.

pub(crate) const LINE_NOT_JSON: &str =
    "The line is not JSON. Send one JSON-RPC message as one line of JSON.";

pub(crate) const BATCH_UNSUPPORTED: &str =
    "A batch is not a message this server reads. Send each JSON-RPC message as its own line.";

pub(crate) const NOT_JSON_RPC_REQUEST: &str = "The message is not a JSON-RPC 2.0 request or notification. Send an object with \"jsonrpc\": \"2.0\", a \"method\", and an \"id\" for a request.";

pub(crate) fn version_not_spoken(revision: &str, handshakes: &str) -> String {
    format!(
        "Unsupported protocol version. This server speaks MCP {revision} per request; send that version in every request's params._meta, or open the connection with initialize for MCP {handshakes}."
    )
}

pub(crate) fn meta_key_missing(key: &str, version_key: &str, capabilities_key: &str) -> String {
    format!(
        "The request's params._meta carries no \"{key}\". Send \"{version_key}\" and \"{capabilities_key}\" with every request, or open the connection with initialize."
    )
}

pub(crate) const INITIALIZE_INCOMPLETE: &str = "The initialize request carries no protocol version or no capabilities. Send params.protocolVersion as a string and params.capabilities as an object.";

pub(crate) fn method_not_served(revision: &str) -> String {
    format!(
        "The method is not one this server serves. This server speaks MCP {revision}; call server/discover, tools/list, tools/call, or subscriptions/listen."
    )
}

pub(crate) const METHOD_NOT_SERVED_INITIALIZED: &str = "The method is not one this server serves on an initialized connection. Call ping, tools/list, or tools/call.";

pub(crate) fn already_initialized(revision: &str) -> String {
    format!(
        "The connection is already initialized on MCP {revision}. Send initialize once, as the first request."
    )
}

/// The request's id stays out of the sentence: a client chose it, and the response carries it.
pub(crate) const ID_IN_USE: &str = "The request id is in use by a request still in flight. Send each request with an id no request in flight holds.";

pub(crate) fn handler_failed(method: &str) -> String {
    format!(
        "The server failed while handling {method}. The failure is a defect in the server; report it to the server's author."
    )
}

pub(crate) const CALL_WITHOUT_TOOL: &str =
    "The tools/call request names no tool. Send the tool's name as params.name.";

pub(crate) const UNKNOWN_CURSOR: &str =
    "The cursor is not one this server issued. Call tools/list without a cursor.";

pub(crate) const BODY_NOT_JSON: &str =
    "The request body is not JSON. Send one JSON-RPC message as the body of a POST.";

pub(crate) const BODY_BATCH: &str = "A batch is not a message this server reads. Send each JSON-RPC message as the body of its own POST.";

pub(crate) const BODY_NOT_MESSAGE: &str = "The body is not a JSON-RPC 2.0 request, notification, or response. Send an object with \"jsonrpc\": \"2.0\", a \"method\", and an \"id\" for a request.";
