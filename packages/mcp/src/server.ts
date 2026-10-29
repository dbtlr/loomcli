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
import type { CallToolResult, ProgressUpdate, ServerIdentity, Tool, ToolCall } from './protocol.js';
import {
  handshakeRevisions,
  latestHandshakeRevision,
  protocolRevision,
  undescribedHandshakeRevision,
} from './revision.js';
import type { HandshakeRevision } from './revision.js';

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

/**
 * The stream a server writes, such as a process's stdout: the members of a Node.js writable stream
 * the server uses.
 */
interface ServerOutput {
  write(chunk: string, callback: (error?: Error | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
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

/** Every revision the server serves, as discovery and an unsupported version list them. */
const supportedRevisions = [protocolRevision, ...handshakeRevisions];

/**
 * How a request is served. A request whose `params._meta` carries a protocol version is served on
 * the per-request revision, relying on no earlier request. Any other request is served on the
 * initialize-era revision its connection negotiated.
 */
type Era = 'handshake' | 'per-request';

/** Every method a per-request one may call. Any other, `ping` included, is not found. */
const methods = new Set(['server/discover', 'subscriptions/listen', 'tools/call', 'tools/list']);

/** Every method an initialized connection serves beside `initialize`. Any other is not found. */
const handshakeMethods = new Set(['ping', 'tools/call', 'tools/list']);

function unsupportedVersion(requested: string) {
  return new ProtocolError(
    errorCodes.unsupportedProtocolVersion,
    `Unsupported protocol version. This server speaks MCP ${protocolRevision} per request; send that version in every request's params._meta, or open the connection with initialize for MCP ${handshakeRevisions.join(' or ')}.`,
    { supported: supportedRevisions, requested },
  );
}

function missingMeta(key: string) {
  return new ProtocolError(
    errorCodes.invalidParams,
    `The request's params._meta carries no "${key}". Send "${metaKeys.protocolVersion}" and "${metaKeys.clientCapabilities}" with every request, or open the connection with initialize.`,
  );
}

/** The era a request selects: per-request when its `params._meta` names a protocol version. */
function eraOf(params: unknown): Era {
  const meta = isRecord(params) ? params._meta : undefined;
  return isRecord(meta) && metaKeys.protocolVersion in meta ? 'per-request' : 'handshake';
}

/**
 * The version an `initialize` request negotiates: the one it asks for when the server serves it,
 * and otherwise the latest the server serves, as the initialize-era lifecycle requires. A request
 * with no version string or no capabilities object is answered with the error.
 */
function negotiate(params: unknown): HandshakeRevision | ProtocolError {
  const requested = isRecord(params) ? params.protocolVersion : undefined;
  const capabilities = isRecord(params) ? params.capabilities : undefined;
  if (typeof requested !== 'string' || !isRecord(capabilities)) {
    return new ProtocolError(
      errorCodes.invalidParams,
      'The initialize request carries no protocol version or no capabilities. Send params.protocolVersion as a string and params.capabilities as an object.',
    );
  }
  return handshakeRevisions.find((revision) => revision === requested) ?? latestHandshakeRevision;
}

/**
 * The server's identity as an initialize result carries it. The implementation info of the earliest
 * revision served has no description, which later revisions added.
 */
function implementationInfo(identity: ServerIdentity, version: HandshakeRevision) {
  const { description, ...named } = identity;
  return version === undescribedHandshakeRevision || description === undefined
    ? named
    : { ...named, description };
}

/**
 * A call's result as an initialize-era revision holds it, where structured content is a JSON
 * object. Any other value is left to the text content, which already carries it.
 */
function handshakeCallResult({ structuredContent, ...result }: CallToolResult) {
  return isRecord(structuredContent) ? { ...result, structuredContent } : result;
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
  return version === protocolRevision ? undefined : unsupportedVersion(version);
}

/**
 * The error a request other than `initialize` is answered with before any handler runs, if any.
 * Before `initialize`, a request for a method the server serves needs per-request `_meta`, `ping`
 * aside, which the initialize-era lifecycle allows at any time.
 */
function requestFault(method: string, params: unknown, initialized: boolean) {
  if (eraOf(params) === 'per-request') {
    return methods.has(method)
      ? envelopeFault(params)
      : new ProtocolError(
          errorCodes.methodNotFound,
          `The method is not one this server serves. This server speaks MCP ${protocolRevision}; call server/discover, tools/list, tools/call, or subscriptions/listen.`,
        );
  }
  if (!initialized && method !== 'ping' && (methods.has(method) || handshakeMethods.has(method))) {
    return missingMeta(metaKeys.protocolVersion);
  }
  return handshakeMethods.has(method)
    ? undefined
    : new ProtocolError(
        errorCodes.methodNotFound,
        'The method is not one this server serves on an initialized connection. Call ping, tools/list, or tools/call.',
      );
}

/** Listens for the output's error event. A write the client cannot read has no one to report to. */
function dropWriteError() {
  // The write's own callback has already settled it.
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
 * A request in flight: the controller that aborts it, and whether it is a `tools/call`, the only
 * request whose handler sees that signal.
 */
interface Pending {
  readonly controller: AbortController;
  readonly call: boolean;
}

/**
 * What a request's handler receives beside its params: the era that shapes its result, the signal
 * that aborts it, and, for a call that carries a progress token, the function that sends progress.
 */
interface Handling {
  readonly era: Era;
  readonly signal: AbortSignal;
  readonly progress: ((update: ProgressUpdate) => void) | undefined;
}

/**
 * One run of a server over one pair of streams: the requests in flight, the open subscriptions,
 * and the writes not yet flushed.
 */
class Session {
  readonly #options: McpServerOptions;
  readonly #output: ServerOutput;
  /** Each request in flight by id. A cancelled request leaves the map, so its answer is dropped. */
  readonly #inFlight = new Map<RequestId, Pending>();
  readonly #settling = new Set<Promise<void>>();
  readonly #subscriptions = new Set<RequestId>();
  readonly #writes = new Set<Promise<void>>();
  readonly #splitter = new LineSplitter();
  /** The revision `initialize` negotiated for the connection, once it has. */
  #handshake: HandshakeRevision | undefined;
  #silenced = false;

  constructor(options: McpServerOptions, output: ServerOutput) {
    this.#options = options;
    this.#output = output;
    // A failed write, such as a broken pipe after the client exits, also emits "error" on the stream.
    // With no listener that ends the process, so the session listens until it ends.
    output.on('error', dropWriteError);
  }

  /** Handles each line a chunk of the input finishes. */
  read(chunk: string | Uint8Array) {
    for (const line of this.#splitter.push(chunk)) {
      this.#receive(line);
    }
  }

  /**
   * Ends the run once the input has ended: a last line with no line feed is handled, every call
   * aborts and answers nothing, and once each has settled, each open subscription is cancelled and
   * answered with its closing result. Resolves when every message has been handed to the output,
   * and stops listening for the output's errors. After the caller's signal, nothing is written.
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
    this.#closeSubscriptions();
    await Promise.all(this.#writes);
    this.#output.off('error', dropWriteError);
  }

  /** Cancels each open subscription and answers it with its closing result. */
  #closeSubscriptions() {
    for (const id of this.#subscriptions) {
      this.#send(notificationMessage('notifications/cancelled', { requestId: id }));
      this.#send(resultMessage(id, this.#stamp({}, id)));
    }
    this.#subscriptions.clear();
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
    for (const { controller } of this.#inFlight.values()) {
      controller.abort();
    }
  }

  /** `notifications/cancelled` ends the request it names. Every other notification is ignored. */
  #notify(method: string, params: unknown) {
    const id = method === 'notifications/cancelled' && isRecord(params) ? params.requestId : null;
    if (!isRequestId(id) || this.#subscriptions.delete(id)) {
      return;
    }
    const pending = this.#inFlight.get(id);
    this.#inFlight.delete(id);
    pending?.controller.abort();
  }

  #request(id: RequestId, method: string, params: unknown) {
    const fault =
      this.#idInUse(id) ??
      (method === 'initialize'
        ? undefined
        : requestFault(method, params, this.#handshake !== undefined));
    if (fault !== undefined) {
      this.#send(errorMessage(id, fault));
    } else if (method === 'initialize') {
      this.#initialize(id, params);
    } else if (method === 'ping') {
      this.#send(resultMessage(id, {}));
    } else if (method === 'subscriptions/listen') {
      this.#listen(id);
    } else {
      this.#start(id, method, isRecord(params) ? params : {});
    }
  }

  /**
   * Opens the connection on an initialize-era revision, once. The negotiated revision then serves
   * every request that carries no per-request `_meta`.
   */
  #initialize(id: RequestId, params: unknown) {
    if (this.#handshake !== undefined) {
      this.#send(
        errorMessage(
          id,
          new ProtocolError(
            errorCodes.invalidRequest,
            `The connection is already initialized on MCP ${this.#handshake}. Send initialize once, as the first request.`,
          ),
        ),
      );
      return;
    }
    const version = negotiate(params);
    if (version instanceof ProtocolError) {
      this.#send(errorMessage(id, version));
      return;
    }
    this.#handshake = version;
    this.#send(
      resultMessage(id, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: implementationInfo(this.#options.identity, version),
      }),
    );
  }

  /**
   * The answer to a request whose id a call or subscription still in flight holds. The request in
   * flight keeps its id and runs untouched, so its answer stays the only one under that id.
   */
  #idInUse(id: RequestId): ProtocolError | undefined {
    return this.#inFlight.has(id) || this.#subscriptions.has(id)
      ? new ProtocolError(
          errorCodes.invalidRequest,
          `The request id ${JSON.stringify(id)} is in use by a request still in flight. Send each request with an id no request in flight holds.`,
        )
      : undefined;
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
    const pending = { call: method === 'tools/call', controller: new AbortController() };
    this.#inFlight.set(id, pending);
    const progress = pending.call ? this.#progress(id, pending, params) : undefined;
    const handling = { era: eraOf(params), progress, signal: pending.controller.signal };
    const outcome = this.#outcome(method, params, handling);
    const settling = this.#answer(id, pending, outcome);
    this.#settling.add(settling);
    void settling.finally(() => this.#settling.delete(settling));
  }

  /**
   * Writes a request's answer once it settles, unless the client cancelled it meanwhile. A call
   * whose signal aborted, which only shutdown or the run's signal does to a call still in the map,
   * answers nothing either.
   */
  async #answer(id: RequestId, pending: Pending, outcome: Promise<object>) {
    const settled = await outcome;
    if (this.#inFlight.get(id) !== pending) {
      return;
    }
    this.#inFlight.delete(id);
    if (pending.call && pending.controller.signal.aborted) {
      return;
    }
    this.#send(
      settled instanceof ProtocolError ? errorMessage(id, settled) : resultMessage(id, settled),
    );
  }

  /**
   * The function a call sends progress through, when its request's `params._meta` carries a
   * progress token. Each call writes one `notifications/progress` on the token, passing `progress`
   * on as given, until the call is answered, cancelled by the client, or aborted.
   */
  #progress(
    id: RequestId,
    pending: Pending,
    params: Record<string, unknown>,
  ): ((update: ProgressUpdate) => void) | undefined {
    const meta = params._meta;
    const token = isRecord(meta) ? meta.progressToken : undefined;
    // A progress token is a string or a number, as a request id is.
    if (!isRequestId(token)) {
      return undefined;
    }
    return ({ message, progress, total }) => {
      if (this.#inFlight.get(id) !== pending || pending.controller.signal.aborted) {
        return;
      }
      this.#send(
        notificationMessage('notifications/progress', {
          progressToken: token,
          progress,
          ...(total === undefined ? {} : { total }),
          ...(message === undefined ? {} : { message }),
        }),
      );
    };
  }

  /**
   * A request's result in the shape of its era, stamped on the per-request revision, or the error to
   * answer it with. A handler's own throw is internal.
   */
  async #outcome(method: string, params: Record<string, unknown>, handling: Handling) {
    try {
      const result = await this.#dispatch(method, params, handling);
      return handling.era === 'per-request' ? this.#stamp(result) : result;
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
    handling: Handling,
  ): Promise<object> {
    if (method === 'server/discover') {
      return {
        supportedVersions: supportedRevisions,
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: 'private',
      };
    }
    return method === 'tools/list'
      ? this.#list(params, handling.era)
      : this.#call(params, handling);
  }

  /** One tool call, its result in the shape of its era. */
  async #call(params: Record<string, unknown>, handling: Handling) {
    const { name } = params;
    if (typeof name !== 'string') {
      throw new ProtocolError(
        errorCodes.invalidParams,
        "The tools/call request names no tool. Send the tool's name as params.name.",
      );
    }
    const { era, progress, signal } = handling;
    const call: ToolCall = { name, arguments: params.arguments, signal };
    const result = await this.#options.callTool(
      progress === undefined ? call : { ...call, progress },
    );
    return era === 'per-request' ? result : handshakeCallResult(result);
  }

  /** The tool listing: one page, which no client caches on the per-request revision. */
  async #list(params: Record<string, unknown>, era: Era) {
    if (params.cursor !== undefined) {
      throw new ProtocolError(
        errorCodes.invalidParams,
        'The cursor is not one this server issued. Call tools/list without a cursor.',
      );
    }
    const tools = await this.#options.listTools();
    return era === 'per-request' ? { tools, ttlMs: 0, cacheScope: 'private' } : { tools };
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
    // A write the client can no longer read has no one to report to, so its callback drops the error.
    // The session's error listener drops the stream's error event the same way.
    const written = new Promise<void>((resolve) => {
      this.#output.write(frame(message), () => resolve());
    });
    this.#writes.add(written);
    void written.then(() => this.#writes.delete(written));
  }
}

/**
 * An MCP server over a stdio-style pair of streams, of both eras. A request carrying per-request
 * `_meta` is served on the per-request revision, which serves `server/discover`, `tools/list`,
 * `tools/call`, and `subscriptions/listen`. A connection that opens with `initialize` is served on
 * the initialize-era revision it negotiates, which serves `ping`, `tools/list`, and `tools/call`.
 * Every other method is not found.
 */
class McpServer {
  readonly #options: McpServerOptions;

  constructor(options: McpServerOptions) {
    this.#options = options;
  }

  /**
   * Serves one client until the input ends or `signal` aborts. When the input ends, the server
   * aborts every call in flight, answers none of them, waits for each to settle, closes each open
   * subscription, and resolves. When `signal` aborts, before or after the input ends, it stops
   * reading, aborts every call, writes nothing more, and resolves once every call has settled.
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
