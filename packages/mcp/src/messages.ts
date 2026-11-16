/*
 * The error text the MCP server returns to its client, under ADR-0164: the sentence of each
 * JSON-RPC error it answers a line, a request, or a failed handler with. Each is a function of the
 * values it repeats, or a constant, and the code that builds the `ProtocolError` calls it. The
 * values a sentence repeats are the server's own protocol revisions, meta keys, and method names,
 * and a request id written as JSON, so the package depends on no escaping helper.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */

/**
 * The error of a line that is not JSON.
 *
 * @example
 * ```ts
 * console.log(lineNotJson); // 'The line is not JSON. Send one JSON-RPC message as one line of JSON.'
 * ```
 */
const lineNotJson = 'The line is not JSON. Send one JSON-RPC message as one line of JSON.';

/**
 * The error of a batch, which the server does not read.
 *
 * @example
 * ```ts
 * console.log(batchUnsupported);
 * ```
 */
const batchUnsupported =
  'A batch is not a message this server reads. Send each JSON-RPC message as its own line.';

/**
 * The error of a message that is neither a request nor a notification.
 *
 * @example
 * ```ts
 * console.log(notJsonRpcRequest);
 * ```
 */
const notJsonRpcRequest =
  'The message is not a JSON-RPC 2.0 request or notification. Send an object with "jsonrpc": "2.0", a "method", and an "id" for a request.';

/**
 * The error of a per-request revision the server does not speak, naming the one it does and the
 * initialize-era revisions, joined with `or`.
 *
 * @example
 * ```ts
 * versionNotSpoken(protocolRevision, handshakeRevisions.join(' or '));
 * ```
 */
function versionNotSpoken(revision: string, handshakes: string): string {
  return `Unsupported protocol version. This server speaks MCP ${revision} per request; send that version in every request's params._meta, or open the connection with initialize for MCP ${handshakes}.`;
}

/**
 * The error of a request whose `params._meta` lacks a key the per-request revision needs.
 *
 * @example
 * ```ts
 * metaKeyMissing('io.modelcontextprotocol/protocolVersion', 'io.modelcontextprotocol/protocolVersion', 'io.modelcontextprotocol/clientCapabilities');
 * ```
 */
function metaKeyMissing(key: string, versionKey: string, capabilitiesKey: string): string {
  return `The request's params._meta carries no "${key}". Send "${versionKey}" and "${capabilitiesKey}" with every request, or open the connection with initialize.`;
}

/**
 * The error of an `initialize` request with no version string or no capabilities object.
 *
 * @example
 * ```ts
 * console.log(initializeIncomplete);
 * ```
 */
const initializeIncomplete =
  'The initialize request carries no protocol version or no capabilities. Send params.protocolVersion as a string and params.capabilities as an object.';

/**
 * The error of a per-request method the server does not serve, naming its revision.
 *
 * @example
 * ```ts
 * methodNotServed(protocolRevision);
 * ```
 */
function methodNotServed(revision: string): string {
  return `The method is not one this server serves. This server speaks MCP ${revision}; call server/discover, tools/list, tools/call, or subscriptions/listen.`;
}

/**
 * The error of a method an initialized connection does not serve.
 *
 * @example
 * ```ts
 * console.log(methodNotServedInitialized);
 * ```
 */
const methodNotServedInitialized =
  'The method is not one this server serves on an initialized connection. Call ping, tools/list, or tools/call.';

/**
 * The error of a second `initialize`, naming the revision the connection negotiated.
 *
 * @example
 * ```ts
 * alreadyInitialized(latestHandshakeRevision);
 * ```
 */
function alreadyInitialized(revision: string): string {
  return `The connection is already initialized on MCP ${revision}. Send initialize once, as the first request.`;
}

/**
 * The error of a request whose id a request still in flight holds. The error response's `id`
 * member carries that id, so the sentence does not repeat it.
 *
 * @example
 * ```ts
 * console.log(idInUse); // 'The request id is in use by a request still in flight. Send each request ...'
 * ```
 */
const idInUse =
  'The request id is in use by a request still in flight. Send each request with an id no request in flight holds.';

/**
 * The error of a handler that failed with anything but a protocol error, naming the method.
 *
 * @example
 * ```ts
 * handlerFailed('tools/call');
 * ```
 */
function handlerFailed(method: string): string {
  return `The server failed while handling ${method}. The failure is a defect in the server; report it to the server's author.`;
}

/**
 * The error of a `tools/call` request that names no tool.
 *
 * @example
 * ```ts
 * console.log(callWithoutTool);
 * ```
 */
const callWithoutTool =
  "The tools/call request names no tool. Send the tool's name as params.name.";

/**
 * The error of a `tools/list` cursor the server did not issue.
 *
 * @example
 * ```ts
 * console.log(unknownCursor); // 'The cursor is not one this server issued. Call tools/list without a cursor.'
 * ```
 */
const unknownCursor = 'The cursor is not one this server issued. Call tools/list without a cursor.';

export {
  alreadyInitialized,
  batchUnsupported,
  callWithoutTool,
  handlerFailed,
  idInUse,
  initializeIncomplete,
  lineNotJson,
  methodNotServed,
  methodNotServedInitialized,
  metaKeyMissing,
  notJsonRpcRequest,
  unknownCursor,
  versionNotSpoken,
};
