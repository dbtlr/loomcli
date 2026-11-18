import {
  errorCodes,
  errorMessage,
  isRecord,
  isRequestId,
  notificationMessage,
  ProtocolError,
  resultMessage,
} from './json-rpc.js';
import type { RequestId } from './json-rpc.js';
import {
  alreadyInitialized,
  callWithoutTool,
  handlerFailed,
  idInUse,
  initializeIncomplete,
  methodNotServed,
  methodNotServedInitialized,
  metaKeyMissing,
  unknownCursor,
  versionNotSpoken,
} from './messages.js';
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
 * Where the messages of one request go: its progress, its answer, and, for a subscription, its
 * teardown. Over stdio every request shares the output; over HTTP each has its own response. `end`
 * says the request will send nothing more, answered or not, and may be called more than once.
 */
interface Channel {
  send(message: object): void;
  end(): void;
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

/** The methods whose handler answers on a stream over HTTP: a call, and a subscription. */
const streamedMethods = new Set(['subscriptions/listen', 'tools/call']);

function unsupportedVersion(requested: string) {
  return new ProtocolError(
    errorCodes.unsupportedProtocolVersion,
    versionNotSpoken(protocolRevision, handshakeRevisions.join(' or ')),
    { supported: supportedRevisions, requested },
  );
}

function missingMeta(key: string) {
  return new ProtocolError(
    errorCodes.invalidParams,
    metaKeyMissing(key, metaKeys.protocolVersion, metaKeys.clientCapabilities),
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
    return new ProtocolError(errorCodes.invalidParams, initializeIncomplete);
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
 * Why a request was refused before its handler: its per-request `_meta` envelope, an unsupported
 * version included, or any other check, such as the method or the request id. The HTTP transport
 * maps the envelope's refusals to their own status.
 */
type RefusalStage = 'envelope' | 'other';

/** A refusal before the handler, and the check that made it. */
interface Refusal {
  readonly error: ProtocolError;
  readonly stage: RefusalStage;
}

/**
 * The refusal a request other than `initialize` is answered with before any handler runs, if any.
 * Before `initialize`, a request for a method the server serves needs per-request `_meta`, `ping`
 * aside, which the initialize-era lifecycle allows at any time. A `tools/call` names its tool with a
 * string.
 */
function requestFault(method: string, params: unknown, initialized: boolean): Refusal | undefined {
  return (
    eraFault(method, params, initialized) ??
    (method === 'tools/call' && !(isRecord(params) && typeof params.name === 'string')
      ? { error: new ProtocolError(errorCodes.invalidParams, callWithoutTool), stage: 'other' }
      : undefined)
  );
}

/** The refusal of a method its era does not serve, or of a per-request envelope, if any. */
function eraFault(method: string, params: unknown, initialized: boolean): Refusal | undefined {
  if (eraOf(params) === 'per-request') {
    if (!methods.has(method)) {
      const error = new ProtocolError(errorCodes.methodNotFound, methodNotServed(protocolRevision));
      return { error, stage: 'other' };
    }
    const envelope = envelopeFault(params);
    return envelope === undefined ? undefined : { error: envelope, stage: 'envelope' };
  }
  if (!initialized && methods.has(method)) {
    return { error: missingMeta(metaKeys.protocolVersion), stage: 'other' };
  }
  return handshakeMethods.has(method)
    ? undefined
    : {
        error: new ProtocolError(errorCodes.methodNotFound, methodNotServedInitialized),
        stage: 'other',
      };
}

/**
 * A request in flight: the controller that aborts it, the channel its messages go to, and whether
 * it is a `tools/call`, the only request whose handler sees that signal.
 */
interface Pending {
  readonly controller: AbortController;
  readonly call: boolean;
  readonly channel: Channel;
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
 * What the connection does with one request: refuses it before any handler runs, or admits it.
 * An admitted request starts once its channel is ready. `streams` says its handler answers on a
 * stream over HTTP: a `tools/call` or a `subscriptions/listen` that reached its handler.
 */
type Admission =
  | ({ readonly kind: 'refused' } & Refusal)
  | {
      readonly kind: 'admitted';
      readonly streams: boolean;
      readonly begin: (channel: Channel) => void;
    };

/** One request as it starts on its channel. */
interface Started {
  readonly channel: Channel;
  readonly id: RequestId;
  readonly method: string;
  readonly params: unknown;
}

/** The size of an empty map. */
const none = 0;

/** What a connection reports to its transport: that its last call in flight settled. */
interface ConnectionOptions {
  readonly onSettled?: () => void;
}

/**
 * One connection's state, apart from its transport: the revision `initialize` negotiated, the
 * requests and subscriptions in flight by id, and the request-id rule. One stdio run is one
 * connection, as is one initialize-era session over HTTP, and one per-request POST is a connection
 * of one request.
 */
class Connection {
  readonly #options: McpServerOptions;
  readonly #onSettled: (() => void) | undefined;
  /** Each request in flight by id. A cancelled request leaves the map, so its answer is dropped. */
  readonly #inFlight = new Map<RequestId, Pending>();
  readonly #settling = new Set<Promise<void>>();
  /** Each open subscription by id, with the channel its teardown goes to. */
  readonly #subscriptions = new Map<RequestId, Channel>();
  /** The revision `initialize` negotiated for the connection, once it has. */
  #handshake: HandshakeRevision | undefined;
  #silenced = false;

  constructor(options: McpServerOptions, connection: ConnectionOptions = {}) {
    this.#options = options;
    this.#onSettled = connection.onSettled;
  }

  /** The revision `initialize` negotiated, once it has. */
  get handshake(): HandshakeRevision | undefined {
    return this.#handshake;
  }

  /** Whether a request is still in flight, which keeps a session from going idle. */
  get busy(): boolean {
    return this.#inFlight.size !== none;
  }

  /** Whether the run's signal ended the connection, after which it answers nothing. */
  get silenced(): boolean {
    return this.#silenced;
  }

  /**
   * Judges one request before any handler runs, and answers what the connection answers itself:
   * `initialize` and `ping`. Every other admitted request starts when it begins on its channel.
   */
  admit(id: RequestId, method: string, params: unknown): Admission {
    const inUse = this.#idInUse(id);
    if (inUse !== undefined) {
      return { kind: 'refused', error: inUse, stage: 'other' };
    }
    const fault =
      method === 'initialize' && eraOf(params) !== 'per-request'
        ? undefined
        : requestFault(method, params, this.#handshake !== undefined);
    return fault === undefined
      ? this.#admitted(method, (channel) => this.#begin({ channel, id, method, params }))
      : { kind: 'refused', ...fault };
  }

  /** Starts an admitted request on its channel. */
  #begin({ channel, id, method, params }: Started) {
    if (method === 'initialize') {
      this.#initialize(id, params, channel);
    } else if (method === 'ping') {
      this.#reply(channel, resultMessage(id, {}));
    } else if (method === 'subscriptions/listen') {
      this.#listen(id, channel);
    } else {
      this.#start({ channel, id, method, params: isRecord(params) ? params : {} });
    }
  }

  #admitted(method: string, begin: (channel: Channel) => void): Admission {
    return { kind: 'admitted', streams: streamedMethods.has(method), begin };
  }

  /** `notifications/cancelled` ends the request it names. Every other notification is ignored. */
  notify(method: string, params: unknown) {
    const id = method === 'notifications/cancelled' && isRecord(params) ? params.requestId : null;
    if (isRequestId(id)) {
      this.cancel(id);
    }
  }

  /**
   * Cancels one request as its client asks: a subscription ends with no message, and a request in
   * flight aborts and answers nothing. Its channel ends at once. An unknown or settled id is
   * ignored.
   */
  cancel(id: RequestId) {
    const subscription = this.#subscriptions.get(id);
    this.#subscriptions.delete(id);
    subscription?.end();
    const pending = this.#inFlight.get(id);
    this.#inFlight.delete(id);
    pending?.controller.abort();
    pending?.channel.end();
  }

  /**
   * Aborts every request in flight. A call answers nothing and its channel ends at once; any other
   * request is still answered when it settles, unless the connection was silenced.
   */
  abortAll() {
    for (const pending of this.#inFlight.values()) {
      pending.controller.abort();
      if (pending.call) {
        pending.channel.end();
      }
    }
  }

  /**
   * Ends the connection on the run's signal: every request aborts and answers nothing. An open
   * subscription's teardown is still sent, by `closeSubscriptions`.
   */
  silence() {
    this.#silenced = true;
    this.abortAll();
  }

  /** Resolves once every request in flight has settled. */
  async settled() {
    // A Set visits an entry added while it is iterated, and skips one deleted once it settles.
    for (const settling of this.#settling) {
      await settling;
    }
  }

  /**
   * Cancels each open subscription and answers it with its closing result, on its own channel,
   * which then ends. A silenced connection still sends this teardown, because the revision requires
   * the notification of a server that tears down a subscription.
   */
  closeSubscriptions() {
    for (const [id, channel] of this.#subscriptions) {
      channel.send(notificationMessage('notifications/cancelled', { requestId: id }));
      channel.send(resultMessage(id, this.#stamp({}, id)));
      channel.end();
    }
    this.#subscriptions.clear();
  }

  /** Sends one message on a channel, unless the connection was silenced. */
  #reply(channel: Channel, message: object) {
    if (!this.#silenced) {
      channel.send(message);
    }
    channel.end();
  }

  /**
   * Opens the connection on an initialize-era revision, once. The negotiated revision then serves
   * every request that carries no per-request `_meta`.
   */
  #initialize(id: RequestId, params: unknown, channel: Channel) {
    if (this.#handshake !== undefined) {
      const refusal = alreadyInitialized(this.#handshake);
      this.#reply(channel, errorMessage(id, new ProtocolError(errorCodes.invalidRequest, refusal)));
      return;
    }
    const version = negotiate(params);
    if (version instanceof ProtocolError) {
      this.#reply(channel, errorMessage(id, version));
      return;
    }
    this.#handshake = version;
    this.#reply(
      channel,
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
      ? new ProtocolError(errorCodes.invalidRequest, idInUse)
      : undefined;
  }

  /** Opens a subscription. The server offers no notification type, so it sends nothing more on it. */
  #listen(id: RequestId, channel: Channel) {
    if (this.#silenced) {
      channel.end();
      return;
    }
    this.#subscriptions.set(id, channel);
    channel.send(
      notificationMessage('notifications/subscriptions/acknowledged', {
        notifications: {},
        _meta: { [metaKeys.subscriptionId]: id },
      }),
    );
  }

  #start({ channel, id, method, params }: Started & { readonly params: Record<string, unknown> }) {
    const pending = { call: method === 'tools/call', channel, controller: new AbortController() };
    this.#inFlight.set(id, pending);
    const progress = pending.call ? this.#progress(id, pending, params) : undefined;
    const handling = { era: eraOf(params), progress, signal: pending.controller.signal };
    const outcome = this.#outcome(method, params, handling);
    const settling = this.#answer(id, pending, outcome);
    this.#settling.add(settling);
    void settling.finally(() => {
      this.#settling.delete(settling);
      if (this.#inFlight.size === none) {
        this.#onSettled?.();
      }
    });
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
      pending.channel.end();
      return;
    }
    this.#reply(
      pending.channel,
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
      if (
        this.#silenced ||
        this.#inFlight.get(id) !== pending ||
        pending.controller.signal.aborted
      ) {
        return;
      }
      pending.channel.send(
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
        : new ProtocolError(errorCodes.internalError, handlerFailed(method));
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

  /** One tool call, its result in the shape of its era. Admission already checked its name. */
  async #call(params: Record<string, unknown>, handling: Handling) {
    const name = typeof params.name === 'string' ? params.name : '';
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
      throw new ProtocolError(errorCodes.invalidParams, unknownCursor);
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
}

export { Connection, eraOf, metaKeys };
export type { Admission, Channel, ConnectionOptions, McpServerOptions, RefusalStage };
