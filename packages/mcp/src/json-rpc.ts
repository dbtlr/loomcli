import type { JsonValue } from './protocol.js';

/** A request's id, which its response and any cancellation name. */
type RequestId = number | string;

/** The JSON-RPC error codes the server answers, and the protocol's unsupported-version code. */
const errorCodes = {
  internalError: -32_603,
  invalidParams: -32_602,
  invalidRequest: -32_600,
  methodNotFound: -32_601,
  parseError: -32_700,
  unsupportedProtocolVersion: -32_022,
} as const;

/**
 * A request answered with a JSON-RPC error rather than a result. A handler throws one to choose
 * the error; any other throw is answered with `internalError`.
 */
class ProtocolError extends Error {
  readonly code: number;
  readonly data: JsonValue | undefined;

  constructor(code: number, message: string, data?: JsonValue) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.data = data;
  }
}

/** One line the client wrote, sorted by what the server does with it. */
type Incoming =
  | {
      readonly kind: 'request';
      readonly id: RequestId;
      readonly method: string;
      readonly params: unknown;
    }
  | { readonly kind: 'notification'; readonly method: string; readonly params: unknown }
  | { readonly kind: 'response' }
  | { readonly kind: 'invalid'; readonly id: RequestId | null; readonly error: ProtocolError };

/** Whether a parsed JSON value is a plain object, whose members a message reads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' || typeof value === 'number';
}

const notJson = new ProtocolError(
  errorCodes.parseError,
  'The line is not JSON. Send one JSON-RPC message as one line of JSON.',
);
const batch = new ProtocolError(
  errorCodes.invalidRequest,
  'A batch is not a message this server reads. Send each JSON-RPC message as its own line.',
);
const notRequest = new ProtocolError(
  errorCodes.invalidRequest,
  'The message is not a JSON-RPC 2.0 request or notification. Send an object with "jsonrpc": "2.0", a "method", and an "id" for a request.',
);

/** The parsed line, or `notJson` when it does not parse. */
function parse(line: string): { readonly value: unknown } | ProtocolError {
  try {
    return { value: JSON.parse(line) };
  } catch {
    return notJson;
  }
}

/** Sorts one parsed object: a client's response, a notification, a request, or neither. */
function classifyObject(message: Record<string, unknown>): Incoming {
  const { id, method, params } = message;
  if (method === undefined && ('result' in message || 'error' in message)) {
    return { kind: 'response' };
  }
  const named = isRequestId(id) ? id : null;
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') {
    return { kind: 'invalid', id: named, error: notRequest };
  }
  if (!('id' in message)) {
    return { kind: 'notification', method, params };
  }
  return named === null
    ? { kind: 'invalid', id: null, error: notRequest }
    : { kind: 'request', id: named, method, params };
}

/** Reads one line as a request, a notification, a client's response, or a message to refuse. */
function classify(line: string): Incoming {
  const parsed = parse(line);
  if (parsed instanceof ProtocolError) {
    return { kind: 'invalid', id: null, error: parsed };
  }
  if (Array.isArray(parsed.value)) {
    return { kind: 'invalid', id: null, error: batch };
  }
  return isRecord(parsed.value)
    ? classifyObject(parsed.value)
    : { kind: 'invalid', id: null, error: notRequest };
}

/**
 * Splits a stream of chunks into lines. A message split across two reads joins into one line, and
 * a multibyte character split across two chunks decodes once.
 */
class LineSplitter {
  #pending = '';
  readonly #decoder = new TextDecoder();

  /** The complete lines a chunk finishes, in order. */
  push(chunk: string | Uint8Array): string[] {
    this.#pending +=
      typeof chunk === 'string' ? chunk : this.#decoder.decode(chunk, { stream: true });
    const lines = this.#pending.split('\n');
    this.#pending = lines.pop() ?? '';
    return lines;
  }

  /** The last line, when the input ended without a line feed after it. */
  end(): string[] {
    const rest = this.#pending + this.#decoder.decode();
    this.#pending = '';
    return rest === '' ? [] : [rest];
  }
}

/**
 * One message as the stdio transport writes it: `JSON.stringify` output with no indentation and a
 * line feed, so no message holds a raw line break.
 */
function frame(message: object): string {
  return `${JSON.stringify(message)}\n`;
}

/** A successful response to a request. */
function resultMessage(id: RequestId, result: object) {
  return { jsonrpc: '2.0', id, result };
}

/** An error response. `id` is `null` when the message named no id the server could read. */
function errorMessage(id: RequestId | null, error: ProtocolError) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
    },
  };
}

/** A notification the server sends. */
function notificationMessage(method: string, params: object) {
  return { jsonrpc: '2.0', method, params };
}

export {
  classify,
  errorCodes,
  errorMessage,
  frame,
  isRecord,
  isRequestId,
  LineSplitter,
  notificationMessage,
  ProtocolError,
  resultMessage,
};
export type { Incoming, RequestId };
