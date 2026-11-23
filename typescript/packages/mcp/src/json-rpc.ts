import {
  batchUnsupported,
  bodyBatch,
  bodyNotJson,
  bodyNotMessage,
  lineNotJson,
  notJsonRpcRequest,
} from './messages.js';
import type { JsonValue } from './protocol.js';

/** A request's id, which its response and any cancellation name. */
type RequestId = number | string;

/** The JSON-RPC error codes the server answers, and the protocol's unsupported-version code. */
const errorCodes = {
  internalError: -32_603,
  invalidParams: -32_602,
  invalidRequest: -32_600,
  headerMismatch: -32_020,
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

/** The refusals of a message that is not one a transport reads, worded for its framing. */
interface Wording {
  readonly notJson: ProtocolError;
  readonly batch: ProtocolError;
  readonly notRequest: ProtocolError;
}

/** The refusals of a stdio line. */
const lineWording: Wording = {
  batch: new ProtocolError(errorCodes.invalidRequest, batchUnsupported),
  notJson: new ProtocolError(errorCodes.parseError, lineNotJson),
  notRequest: new ProtocolError(errorCodes.invalidRequest, notJsonRpcRequest),
};

/** The refusals of an HTTP POST body. */
const bodyWording: Wording = {
  batch: new ProtocolError(errorCodes.invalidRequest, bodyBatch),
  notJson: new ProtocolError(errorCodes.parseError, bodyNotJson),
  notRequest: new ProtocolError(errorCodes.invalidRequest, bodyNotMessage),
};

/** The parsed text, or nothing when it does not parse. */
function parse(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** Sorts one parsed object: a client's response, a notification, a request, or neither. */
function classifyObject(
  message: Record<string, unknown>,
  notRequest: ProtocolError,
  strictResponses: boolean,
): Incoming {
  const { id, method, params } = message;
  if (method === undefined && ('result' in message || 'error' in message)) {
    return strictResponses && (message.jsonrpc !== '2.0' || !isRequestId(id))
      ? { kind: 'invalid', id: null, error: notRequest }
      : { kind: 'response' };
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

/**
 * Reads one message, a stdio line or a POST body, as a request, a notification, a client's
 * response, or a message to refuse in the transport's wording.
 */
function classify(text: string, wording: Wording = lineWording): Incoming {
  const parsed = parse(text);
  if (parsed === undefined) {
    return { kind: 'invalid', id: null, error: wording.notJson };
  }
  if (Array.isArray(parsed.value)) {
    return { kind: 'invalid', id: null, error: wording.batch };
  }
  return isRecord(parsed.value)
    ? classifyObject(parsed.value, wording.notRequest, wording === bodyWording)
    : { kind: 'invalid', id: null, error: wording.notRequest };
}

/** Whether a line holds nothing but JSON whitespace, which carries no message. */
function isBlank(line: string) {
  return /^[\t\r ]*$/u.test(line);
}

/**
 * Splits a stream of chunks into lines. A message split across two reads joins into one line, a
 * multibyte character split across two chunks decodes once, and a blank line is dropped.
 */
class LineSplitter {
  #pending = '';
  readonly #decoder = new TextDecoder();

  /** The complete lines a chunk finishes, in order, blank ones left out. */
  push(chunk: string | Uint8Array): string[] {
    this.#pending +=
      typeof chunk === 'string' ? chunk : this.#decoder.decode(chunk, { stream: true });
    const lines = this.#pending.split('\n');
    this.#pending = lines.pop() ?? '';
    return lines.filter((line) => !isBlank(line));
  }

  /** The last line, when the input ended without a line feed after it and it is not blank. */
  end(): string[] {
    const rest = this.#pending + this.#decoder.decode();
    this.#pending = '';
    return isBlank(rest) ? [] : [rest];
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
  bodyWording,
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
