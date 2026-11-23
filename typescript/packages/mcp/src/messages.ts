/*
 * The error text the MCP server returns to its client, under ADR-0164. It repeats only the server's
 * own revisions, keys, and methods, and a request id as JSON, so it needs no escaping helper.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */

const lineNotJson = 'The line is not JSON. Send one JSON-RPC message as one line of JSON.';

const batchUnsupported =
  'A batch is not a message this server reads. Send each JSON-RPC message as its own line.';

const notJsonRpcRequest =
  'The message is not a JSON-RPC 2.0 request or notification. Send an object with "jsonrpc": "2.0", a "method", and an "id" for a request.';

function versionNotSpoken(revision: string, handshakes: string): string {
  return `Unsupported protocol version. This server speaks MCP ${revision} per request; send that version in every request's params._meta, or open the connection with initialize for MCP ${handshakes}.`;
}

function metaKeyMissing(key: string, versionKey: string, capabilitiesKey: string): string {
  return `The request's params._meta carries no "${key}". Send "${versionKey}" and "${capabilitiesKey}" with every request, or open the connection with initialize.`;
}

const initializeIncomplete =
  'The initialize request carries no protocol version or no capabilities. Send params.protocolVersion as a string and params.capabilities as an object.';

function methodNotServed(revision: string): string {
  return `The method is not one this server serves. This server speaks MCP ${revision}; call server/discover, tools/list, tools/call, or subscriptions/listen.`;
}

const methodNotServedInitialized =
  'The method is not one this server serves on an initialized connection. Call ping, tools/list, or tools/call.';

function alreadyInitialized(revision: string): string {
  return `The connection is already initialized on MCP ${revision}. Send initialize once, as the first request.`;
}

const idInUse =
  'The request id is in use by a request still in flight. Send each request with an id no request in flight holds.';

function handlerFailed(method: string): string {
  return `The server failed while handling ${method}. The failure is a defect in the server; report it to the server's author.`;
}

const callWithoutTool =
  "The tools/call request names no tool. Send the tool's name as params.name.";

const bodyNotJson =
  'The request body is not JSON. Send one JSON-RPC message as the body of a POST.';

const bodyBatch =
  'A batch is not a message this server reads. Send each JSON-RPC message as the body of its own POST.';

const bodyNotMessage =
  'The body is not a JSON-RPC 2.0 request, notification, or response. Send an object with "jsonrpc": "2.0", a "method", and an "id" for a request.';

const bodyNotJsonType =
  'The request body is not application/json. Send each message with the header Content-Type: application/json.';

function bodyTooLarge(limit: number): string {
  return `The request body is larger than the ${String(limit)} bytes this server reads. Send a smaller message.`;
}

const browserRefused =
  'This server answers no request a browser sends. Use an MCP client that is not a web page.';

const authorizationFailed =
  "The server failed while it authorized the request. The failure is a defect in the server; report it to the server's author.";

function headerMismatch(header: string, source: string): string {
  return `The ${header} header is missing or does not equal ${source}. Send ${header} with the value ${source} holds.`;
}

function noSession(versionKey: string, capabilitiesKey: string): string {
  return `The request carries no MCP-Session-Id. Send the session id the initialize response issued, or send "${versionKey}" and "${capabilitiesKey}" in every request's params._meta, with MCP-Protocol-Version and Mcp-Method headers, and Mcp-Name for tools/call.`;
}

function versionNotSession(revision: string): string {
  return `The MCP-Protocol-Version header names a version other than this session's, MCP ${revision}. Send ${revision}, or leave the header out.`;
}

const unknownCursor = 'The cursor is not one this server issued. Call tools/list without a cursor.';

export {
  alreadyInitialized,
  authorizationFailed,
  batchUnsupported,
  bodyBatch,
  bodyNotJson,
  bodyNotJsonType,
  bodyNotMessage,
  bodyTooLarge,
  browserRefused,
  callWithoutTool,
  handlerFailed,
  headerMismatch,
  idInUse,
  initializeIncomplete,
  lineNotJson,
  methodNotServed,
  methodNotServedInitialized,
  metaKeyMissing,
  noSession,
  notJsonRpcRequest,
  unknownCursor,
  versionNotSession,
  versionNotSpoken,
};
