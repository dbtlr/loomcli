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
