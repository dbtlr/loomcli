import {
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
} from './json-rpc.js';
import type { RequestId } from './json-rpc.js';
import type { CallToolResult, ServerIdentity, Tool, ToolCall } from './protocol.js';
import { protocolRevision } from './revision.js';

/** What a server serves: its identity, its tool listing, and the call of one tool. */
interface McpServerOptions {
  readonly identity: ServerIdentity;
  readonly listTools: () => readonly Tool[] | Promise<readonly Tool[]>;
  readonly callTool: (call: ToolCall) => CallToolResult | Promise<CallToolResult>;
}

/**
 * The stream a server reads, such as a process's stdin: the members of a Node.js readable stream
 * the server uses.
 */
interface ServerInput {
  on(event: 'data', listener: (chunk: string | Uint8Array) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'data', listener: (chunk: string | Uint8Array) => void): unknown;
  off(event: 'end', listener: () => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
  destroy(): unknown;
}

/** The stream a server writes, such as a process's stdout. */
interface ServerOutput {
  write(chunk: string, callback: (error?: Error | null) => void): unknown;
}

/** How a run ends early: when `signal` aborts, every call aborts and the server writes nothing more. */
interface RunOptions {
  readonly signal?: AbortSignal;
}

const metaKeys = {
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
  subscriptionId: 'io.modelcontextprotocol/subscriptionId',
} as const;

/** Every method the server serves. Any other method, `ping` included, is not found. */
const methods = new Set(['server/discover', 'subscriptions/listen', 'tools/call', 'tools/list']);

function unsupportedVersion(requested: string, message: string) {
  return new ProtocolError(errorCodes.unsupportedProtocolVersion, message, {
    supported: [protocolRevision],
    requested,
  });
}

/**
 * The answer to the handshake of earlier revisions, given before any other check, so a legacy
 * client learns which revision it needs.
 */
function legacyInitialize(params: unknown) {
  const requested = isRecord(params) ? params.protocolVersion : undefined;
  return unsupportedVersion(
    typeof requested === 'string' ? requested : '',
    `Unsupported protocol version. This server speaks MCP ${protocolRevision}, which has no initialize request; use a client that supports protocol version ${protocolRevision}.`,
  );
}

function missingMeta(key: string) {
  return new ProtocolError(
    errorCodes.invalidParams,
    `The request's params._meta carries no "${key}". Send "${metaKeys.protocolVersion}" and "${metaKeys.clientCapabilities}" with every request.`,
  );
}

/**
 * The per-request check: every request carries the protocol version and the client's capabilities
 * in `params._meta`, and the version is the pinned revision. The server relies on no earlier
 * request.
 */
function envelopeFault(params: unknown): ProtocolError | undefined {
  const meta = isRecord(params) ? params._meta : undefined;
  const version = isRecord(meta) ? meta[metaKeys.protocolVersion] : undefined;
  const capabilities = isRecord(meta) ? meta[metaKeys.clientCapabilities] : undefined;
  if (typeof version !== 'string') {
    return missingMeta(metaKeys.protocolVersion);
  }
  if (!isRecord(capabilities)) {
    return missingMeta(metaKeys.clientCapabilities);
  }
  return version === protocolRevision
    ? undefined
    : unsupportedVersion(
        version,
        `Unsupported protocol version. This server speaks MCP ${protocolRevision}; send that version in every request's params._meta.`,
      );
}

/** The error a request is answered with before any handler runs, if any. */
function requestFault(method: string, params: unknown): ProtocolError | undefined {
  if (method === 'initialize') {
    return legacyInitialize(params);
  }
  if (!methods.has(method)) {
    return new ProtocolError(
      errorCodes.methodNotFound,
      `The method is not one this server serves. This server speaks MCP ${protocolRevision}; call server/discover, tools/list, tools/call, or subscriptions/listen.`,
    );
  }
  return envelopeFault(params);
}

/**
 * Hands each chunk of the input to `read` until the input ends or the signal aborts. An abort
 * stops reading by destroying the input, since a run that ends on its signal reads nothing more,
 * and an open stdin would keep its process alive.
 */
function readChunks(
  input: ServerInput,
  signal: AbortSignal | undefined,
  read: (chunk: string | Uint8Array) => void,
) {
  if (signal?.aborted === true) {
    input.destroy();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const detach = () => {
      input.off('data', read);
      input.off('end', finish);
      input.off('error', fail);
      signal?.removeEventListener('abort', halt);
    };
    function finish() {
      detach();
      resolve();
    }
    function fail(error: Error) {
      detach();
      reject(error);
    }
    function halt() {
      detach();
      input.destroy();
      resolve();
    }
    input.on('data', read);
    input.on('end', finish);
    input.on('error', fail);
    signal?.addEventListener('abort', halt, { once: true });
  });
}

/**
 * One run of a server over one pair of streams: the requests in flight, the open subscriptions,
 * and the writes not yet flushed.
 */
class Session {
  readonly #options: McpServerOptions;
  readonly #output: ServerOutput;
  /** Each request in flight by id. A cancelled request leaves the map, so its answer is dropped. */
  readonly #inFlight = new Map<RequestId, AbortController>();
  readonly #settling = new Set<Promise<void>>();
  readonly #subscriptions = new Set<RequestId>();
  readonly #writes = new Set<Promise<void>>();
  readonly #splitter = new LineSplitter();
  #silenced = false;

  constructor(options: McpServerOptions, output: ServerOutput) {
    this.#options = options;
    this.#output = output;
  }

  /** Handles each line a chunk of the input finishes. */
  read(chunk: string | Uint8Array) {
    for (const line of this.#splitter.push(chunk)) {
      this.#receive(line);
    }
  }

  /**
   * Ends the run once the input has ended: a last line with no line feed is handled, every call
   * aborts, and once each has settled, each open subscription is cancelled and answered with its
   * closing result. Resolves when every message has been handed to the output. After the caller's
   * signal, nothing is written.
   */
  async end() {
    for (const line of this.#splitter.end()) {
      this.#receive(line);
    }
    this.#abortAll();
    // A Set visits an entry added while it is iterated, and skips one deleted once it settles.
    for (const settling of this.#settling) {
      await settling;
    }
    for (const id of this.#subscriptions) {
      this.#send(notificationMessage('notifications/cancelled', { requestId: id }));
      this.#send(resultMessage(id, this.#stamp({}, id)));
    }
    this.#subscriptions.clear();
    await Promise.all(this.#writes);
  }

  /** Handles one line the client wrote. */
  #receive(line: string) {
    if (this.#silenced) {
      return;
    }
    const message = classify(line);
    if (message.kind === 'invalid') {
      this.#send(errorMessage(message.id, message.error));
    } else if (message.kind === 'notification') {
      this.#notify(message.method, message.params);
    } else if (message.kind === 'request') {
      this.#request(message.id, message.method, message.params);
    }
  }

  /**
   * Ends the run on the caller's signal: every call aborts, and the server writes nothing more, an
   * open subscription's closing result included.
   */
  silence() {
    this.#silenced = true;
    this.#subscriptions.clear();
    this.#abortAll();
  }

  #abortAll() {
    for (const controller of this.#inFlight.values()) {
      controller.abort();
    }
  }

  /** `notifications/cancelled` ends the request it names. Every other notification is ignored. */
  #notify(method: string, params: unknown) {
    const id = method === 'notifications/cancelled' && isRecord(params) ? params.requestId : null;
    if (!isRequestId(id) || this.#subscriptions.delete(id)) {
      return;
    }
    const controller = this.#inFlight.get(id);
    this.#inFlight.delete(id);
    controller?.abort();
  }

  #request(id: RequestId, method: string, params: unknown) {
    const fault = requestFault(method, params);
    if (fault !== undefined) {
      this.#send(errorMessage(id, fault));
    } else if (method === 'subscriptions/listen') {
      this.#listen(id);
    } else {
      this.#start(id, method, isRecord(params) ? params : {});
    }
  }

  /** Opens a subscription. The server offers no notification type, so it sends nothing more on it. */
  #listen(id: RequestId) {
    this.#subscriptions.add(id);
    this.#send(
      notificationMessage('notifications/subscriptions/acknowledged', {
        notifications: {},
        _meta: { [metaKeys.subscriptionId]: id },
      }),
    );
  }

  #start(id: RequestId, method: string, params: Record<string, unknown>) {
    const controller = new AbortController();
    this.#inFlight.set(id, controller);
    const settling = this.#answer(id, controller, this.#outcome(method, params, controller.signal));
    this.#settling.add(settling);
    void settling.finally(() => this.#settling.delete(settling));
  }

  /** Writes a request's answer once it settles, unless the request was cancelled meanwhile. */
  async #answer(id: RequestId, controller: AbortController, outcome: Promise<object>) {
    const settled = await outcome;
    if (this.#inFlight.get(id) !== controller) {
      return;
    }
    this.#inFlight.delete(id);
    this.#send(
      settled instanceof ProtocolError ? errorMessage(id, settled) : resultMessage(id, settled),
    );
  }

  /** A request's stamped result, or the error to answer it with. A handler's own throw is internal. */
  async #outcome(method: string, params: Record<string, unknown>, signal: AbortSignal) {
    try {
      return this.#stamp(await this.#dispatch(method, params, signal));
    } catch (error) {
      return error instanceof ProtocolError
        ? error
        : new ProtocolError(
            errorCodes.internalError,
            `The server failed while handling ${method}. The failure is a defect in the server; report it to the server's author.`,
          );
    }
  }

  async #dispatch(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<object> {
    if (method === 'server/discover') {
      return {
        supportedVersions: [protocolRevision],
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: 'private',
      };
    }
    if (method === 'tools/list') {
      return this.#list(params);
    }
    const { name } = params;
    if (typeof name !== 'string') {
      throw new ProtocolError(
        errorCodes.invalidParams,
        "The tools/call request names no tool. Send the tool's name as params.name.",
      );
    }
    return this.#options.callTool({ name, arguments: params.arguments, signal });
  }

  /** The tool listing: one page, which no client caches. */
  async #list(params: Record<string, unknown>) {
    if (params.cursor !== undefined) {
      throw new ProtocolError(
        errorCodes.invalidParams,
        'The cursor is not one this server issued. Call tools/list without a cursor.',
      );
    }
    return { tools: await this.#options.listTools(), ttlMs: 0, cacheScope: 'private' };
  }

  /** A result as the revision requires it: complete, with the server's identity in `_meta`. */
  #stamp(result: object, subscriptionId?: RequestId) {
    return {
      resultType: 'complete',
      ...result,
      _meta: {
        ...(subscriptionId === undefined ? {} : { [metaKeys.subscriptionId]: subscriptionId }),
        [metaKeys.serverInfo]: this.#options.identity,
      },
    };
  }

  /** Writes one message as one line, unless the run was ended by the caller's signal. */
  #send(message: object) {
    if (this.#silenced) {
      return;
    }
    // A write the client can no longer read has no one to report to, so its error is dropped.
    const written = new Promise<void>((resolve) => {
      this.#output.write(frame(message), () => resolve());
    });
    this.#writes.add(written);
    void written.then(() => this.#writes.delete(written));
  }
}

/**
 * An MCP server of the pinned revision over a stdio-style pair of streams. It serves
 * `server/discover`, `tools/list`, `tools/call`, and `subscriptions/listen`, and answers every
 * other method as not found.
 */
class McpServer {
  readonly #options: McpServerOptions;

  constructor(options: McpServerOptions) {
    this.#options = options;
  }

  /**
   * Serves one client until the input ends or `signal` aborts. When the input ends, the server
   * aborts every call in flight, waits for each to settle, closes each open subscription, and
   * resolves. When `signal` aborts, before or after the input ends, it stops reading, aborts
   * every call, writes nothing more, and resolves once every call has settled.
   */
  async run(input: ServerInput, output: ServerOutput, options: RunOptions = {}): Promise<void> {
    const { signal } = options;
    const session = new Session(this.#options, output);
    // The signal is watched until the run resolves, so a call that settles after it aborts writes nothing.
    const silence = () => session.silence();
    if (signal?.aborted === true) {
      silence();
    }
    signal?.addEventListener('abort', silence, { once: true });
    try {
      await readChunks(input, signal, (chunk) => session.read(chunk));
    } finally {
      await session.end();
      signal?.removeEventListener('abort', silence);
    }
  }
}

export { McpServer };
export type { McpServerOptions, RunOptions, ServerInput, ServerOutput };
