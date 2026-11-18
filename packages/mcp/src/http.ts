/*
 * The streamable HTTP transport: it answers one `node:http` request at a time, for both eras. A
 * per-request message is a connection of one request, and an initialize-era client gets a session,
 * which holds one connection as one stdio run does. Listening, the address, and every operator
 * sentence stay with the caller, which hands each socket and each request to the transport.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import { Connection, eraOf, metaKeys } from './connection.js';
import type { Admission, Channel, McpServerOptions } from './connection.js';
import {
  bodyWording,
  classify,
  errorCodes,
  errorMessage,
  isRecord,
  ProtocolError,
  resultMessage,
} from './json-rpc.js';
import type { Incoming } from './json-rpc.js';
import {
  authorizationFailed,
  bodyNotJsonType,
  bodyTooLarge,
  browserRefused,
  handlerFailed,
  metaKeyMissing,
  headerMismatch,
  noSession,
  versionNotSession,
} from './messages.js';
import { protocolRevision } from './revision.js';

/**
 * How the transport serves: the hook that judges each request's headers, what it reports of a
 * request refused for its `Origin`, the body limit, the session idle interval, and the run's
 * signal, which stops it.
 */
interface HttpOptions {
  /**
   * Judges a request from a copy of its headers, after the `Origin` check and before the body is
   * read. `false` answers 401, and a throw or a rejection answers 500.
   */
  readonly authorize?: ((headers: Headers) => boolean | Promise<boolean>) | undefined;
  /** Hears the `Origin` of each request refused for carrying one. */
  readonly onOriginRefused?: ((origin: string) => void) | undefined;
  readonly maxBodyBytes: number;
  readonly sessionIdleMs: number;
  readonly signal: AbortSignal;
}

/** The statuses the transport answers with. */
const status = {
  accepted: 202,
  badRequest: 400,
  forbidden: 403,
  internal: 500,
  methodNotAllowed: 405,
  noContent: 204,
  notFound: 404,
  ok: 200,
  timeout: 408,
  tooLarge: 413,
  unauthorized: 401,
  unsupportedType: 415,
} as const;

/** How long the headers of a request may take to arrive, Node's default. */
const headersDeadlineMs = 60_000;
/** How long a whole request may take to arrive, its body included, Node's default. */
const requestDeadlineMs = 300_000;
/** How long a refused request may keep sending before its HTTP connection closes. */
const lingerMs = 2000;
/** How often an open event stream carries a comment line. */
const keepAliveMs = 15_000;
/** The one path the server answers. */
const endpoint = '/mcp';
/** A socket timeout that is off. */
const noTimeout = 0;
/** The largest delay Node schedules without overflow. */
const maximumTimerMs = 2_147_483_647;
/** A socket with no response in flight may await another request. */
const noResponses = 0;
/** The index of a decoded character's one code unit. */
const firstIndex = 0;
/** The code of a character with none, which `atob` never returns. */
const noCode = 0;
/** The step between a raw header's name and its value, and between two headers. */
const rawPair = 2;

/** The answer a request gets when the server's own deadline passes before it arrives whole. */
const rawTimeout = 'HTTP/1.1 408 Request Timeout\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

/** A body past the limit, which is answered 413. */
const tooLarge = Symbol('too large');

/** An answer the transport sends before it has consumed the body, which closes the connection. */
interface Early {
  readonly status: number;
  readonly body?: object;
  readonly headers?: Readonly<Record<string, string>>;
}

/** One message the client sent, as `classify` sorts it. */
type Request = Extract<Incoming, { readonly kind: 'request' }>;

/** A header's value, its repeats joined, or nothing when the request does not carry it. */
function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(', ') : value;
}

/** A fresh copy of the request's headers, as the platform's `Headers`. */
function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();
  const raw = request.rawHeaders;
  for (let index = 0; index < raw.length; index += rawPair) {
    const [name = '', value = ''] = raw.slice(index, index + rawPair);
    headers.append(name, value);
  }
  return headers;
}

/** Whether a response can still be written. */
function writable(response: ServerResponse) {
  return !response.destroyed && !response.writableEnded;
}

/** One `application/json` answer: its status, its message, and any headers beside the type. */
interface JsonAnswer {
  readonly status: number;
  readonly message: object;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/** One JSON-RPC message as the one `application/json` answer to a request. */
function sendJson(response: ServerResponse, { headers, message, status: code }: JsonAnswer) {
  const text = JSON.stringify(message);
  response.writeHead(code, {
    ...headers,
    'Content-Length': String(new TextEncoder().encode(text).length),
    'Content-Type': 'application/json',
  });
  response.end(text);
}

/** An answer with no body. */
function sendEmpty(response: ServerResponse, code: number) {
  response.writeHead(code);
  response.end();
}

/** A JSON-RPC error with no `id`, which a refusal before the body carries. */
function refusal(code: number, sentence: string) {
  return errorMessage(null, new ProtocolError(code, sentence));
}

/** Decodes a header value in the `=?base64?…?=` form, and returns any other value as it is. */
function decodedName(value: string | undefined): string | undefined {
  const encoded =
    value === undefined
      ? undefined
      : /^=\?base64\?(?<encoded>.*)\?=$/u.exec(value)?.groups?.encoded;
  if (encoded === undefined) {
    return value;
  }
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (char) => char.codePointAt(firstIndex) ?? noCode),
    );
  } catch {
    return undefined;
  }
}

/**
 * The fault of a per-request message's metadata headers, which must be present and equal the
 * body: the protocol version, the method, and on `tools/call` the tool's name. A `_meta` whose
 * version is not a string is left to the envelope check, which answers it.
 */
function metadataFault(request: IncomingMessage, { method, params }: Request) {
  const meta = isRecord(params) ? params._meta : undefined;
  const version = isRecord(meta) ? meta[metaKeys.protocolVersion] : undefined;
  if (typeof version !== 'string') {
    return undefined;
  }
  const name = isRecord(params) && method === 'tools/call' ? params.name : undefined;
  const checks = [
    {
      actual: headerOf(request, 'MCP-Protocol-Version'),
      expected: version,
      header: 'MCP-Protocol-Version',
      source: `params._meta["${metaKeys.protocolVersion}"]`,
    },
    {
      actual: headerOf(request, 'Mcp-Method'),
      expected: method,
      header: 'Mcp-Method',
      source: 'method',
    },
    ...(typeof name === 'string'
      ? [
          {
            actual: decodedName(headerOf(request, 'Mcp-Name')),
            expected: name,
            header: 'Mcp-Name',
            source: 'params.name',
          },
        ]
      : []),
  ];
  const failed = checks.find(({ actual, expected }) => actual !== expected);
  return failed === undefined
    ? undefined
    : new ProtocolError(errorCodes.headerMismatch, headerMismatch(failed.header, failed.source));
}

/**
 * The status of a per-request refusal before the handler: an envelope refusal, an unsupported
 * version included, is 400, a method not served is 404, and any other is 200.
 */
function perRequestStatus(admission: Extract<Admission, { readonly kind: 'refused' }>) {
  if (admission.stage === 'envelope') {
    return status.badRequest;
  }
  return admission.error.code === errorCodes.methodNotFound ? status.notFound : status.ok;
}

/**
 * The fault of an `MCP-Protocol-Version` header that names a version other than the session's.
 * Without the header, the session's revision serves.
 */
function versionFault(request: IncomingMessage, session: HttpSession) {
  const version = headerOf(request, 'MCP-Protocol-Version');
  const revision = session.connection.handshake ?? '';
  return version === undefined || version === revision
    ? undefined
    : new ProtocolError(errorCodes.invalidRequest, versionNotSession(revision));
}

/** One event of an event stream: a `data:` line of the message's JSON, then a blank line. */
function event(message: object) {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/**
 * The server's own receipt deadlines for one socket: the headers of its next request within 60
 * seconds, and the whole request within 300. A request late for either is answered 408 and its
 * HTTP connection closed. The deadlines rearm when a response finishes and the socket stays open.
 */
class Receipt {
  readonly #socket: Socket;
  #headers: ReturnType<typeof setTimeout> | undefined;
  #whole: ReturnType<typeof setTimeout> | undefined;
  #response: ServerResponse | undefined;
  #inFlight = noResponses;

  constructor(socket: Socket) {
    this.#socket = socket;
    this.arm();
  }

  arm() {
    if (this.#inFlight > noResponses) {
      return;
    }
    this.clear();
    this.#response = undefined;
    this.#headers = setTimeout(() => this.#late(), headersDeadlineMs);
    this.#whole = setTimeout(() => this.#late(), requestDeadlineMs);
  }

  /** The headers arrived, so only the whole request's deadline still runs. */
  started(response: ServerResponse) {
    if (this.#inFlight > noResponses) {
      clearTimeout(this.#whole);
      this.#whole = setTimeout(() => this.#late(), requestDeadlineMs);
    }
    this.#inFlight += 1;
    clearTimeout(this.#headers);
    this.#response = response;
  }

  /** A response finished; only an idle socket awaits another request. */
  finished() {
    this.#inFlight -= 1;
    this.arm();
  }

  /** The body arrived whole. */
  received(response: ServerResponse) {
    if (this.#response === response) {
      clearTimeout(this.#whole);
    }
  }

  clear() {
    clearTimeout(this.#headers);
    clearTimeout(this.#whole);
  }

  #late() {
    this.clear();
    const response = this.#response;
    if (response !== undefined && !response.headersSent) {
      response.writeHead(status.timeout, { Connection: 'close', 'Content-Length': '0' });
      response.end(() => this.#socket.destroy());
      return;
    }
    this.#socket.end(rawTimeout, () => this.#socket.destroy());
  }
}

/**
 * One initialize-era session: its connection, and the clock that ends it once it has had no request
 * or notification and no call in flight for the idle interval.
 */
class HttpSession {
  readonly connection: Connection;
  readonly #idleMs: number;
  readonly #expire: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #ended = false;
  #deadline = Date.now();

  constructor(options: McpServerOptions, idleMs: number, expire: () => void) {
    this.connection = new Connection(options, { onSettled: () => this.touch() });
    this.#idleMs = idleMs;
    this.#expire = expire;
    this.touch();
  }

  /** Restarts the idle clock. */
  touch() {
    if (this.#ended) {
      return;
    }
    clearTimeout(this.#timer);
    this.#deadline = Date.now() + this.#idleMs;
    this.#arm();
  }

  /** Node timers cap at a signed 32-bit delay; longer intervals keep their original deadline. */
  #arm() {
    const remaining = this.#deadline - Date.now();
    this.#timer = setTimeout(
      () => {
        if (Date.now() < this.#deadline) {
          this.#arm();
        } else if (!this.connection.busy) {
          this.#expire();
        }
      },
      Math.min(remaining, maximumTimerMs),
    );
    this.#timer.unref();
  }

  /** Ends the session: its clock stops and its calls abort, answering nothing. */
  end() {
    this.#ended = true;
    clearTimeout(this.#timer);
    this.connection.abortAll();
  }
}

/**
 * The streamable HTTP transport of one server. The caller hands it each socket its `node:http`
 * server accepts and each request, and stops listening when the run's signal aborts; the transport
 * then aborts every call, tears down each per-request subscription, ends every stream, and closes
 * every HTTP connection. `closed` resolves once every call has settled.
 */
class HttpTransport {
  readonly #server: McpServerOptions;
  readonly #options: HttpOptions;
  readonly #sockets = new Map<Socket, Receipt>();
  readonly #sessions = new Map<string, HttpSession>();
  /** Every connection with a request or subscription open, sessions' included. */
  readonly #connections = new Set<Connection>();
  readonly closed: Promise<void>;

  constructor(server: McpServerOptions, options: HttpOptions) {
    this.#server = server;
    this.#options = options;
    const { signal } = options;
    this.closed = signal.aborted
      ? Promise.resolve()
      : new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve(this.#shutdown()), { once: true });
        });
  }

  /** Watches one socket the server accepted, for its receipt deadlines and for shutdown. */
  connection(socket: Socket) {
    if (this.#options.signal.aborted) {
      socket.destroy();
      return;
    }
    this.#sockets.set(socket, new Receipt(socket));
    socket.once('close', () => {
      this.#sockets.get(socket)?.clear();
      this.#sockets.delete(socket);
    });
  }

  /** Answers one request. */
  request(request: IncomingMessage, response: ServerResponse) {
    if (this.#options.signal.aborted) {
      response.destroy();
      return;
    }
    const receipt = this.#sockets.get(request.socket);
    receipt?.started(response);
    request.once('end', () => receipt?.received(response));
    response.once('finish', () => {
      if (!request.socket.destroyed) {
        receipt?.finished();
      }
    });
    this.#serve(request, response).catch(() => this.#fail(request, response));
  }

  /** A throw while the transport serves: 500 when nothing was sent, and otherwise a closed stream. */
  #fail(request: IncomingMessage, response: ServerResponse) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    this.#early(request, response, {
      body: refusal(errorCodes.internalError, handlerFailed('the HTTP request')),
      status: status.internal,
    });
  }

  async #serve(request: IncomingMessage, response: ServerResponse) {
    const early = await this.#screen(request);
    if (this.#options.signal.aborted || response.destroyed || response.writableEnded) {
      return;
    }
    if (early !== undefined) {
      this.#early(request, response, early);
      return;
    }
    await this.#receive(request, response);
  }

  /** Reads the screened body, then checks whether shutdown or the client ended its response. */
  async #receive(request: IncomingMessage, response: ServerResponse) {
    const body = await this.#body(request);
    if (this.#options.signal.aborted || response.destroyed || response.writableEnded) {
      return;
    }
    if (body === tooLarge) {
      this.#early(request, response, this.#tooLarge());
    } else if (body !== undefined && request.method === 'DELETE') {
      this.#delete(request, response);
    } else if (body !== undefined) {
      this.#message(request, response, classify(body, bodyWording));
    }
  }

  /**
   * The answer to a request refused before its body is read, checked in order: `Origin`,
   * authorization, path, method, then a POST's content type and declared length.
   */
  async #screen(request: IncomingMessage): Promise<Early | undefined> {
    const origin = headerOf(request, 'Origin');
    if (origin !== undefined) {
      this.#options.onOriginRefused?.(origin);
      return { body: refusal(errorCodes.invalidRequest, browserRefused), status: status.forbidden };
    }
    return (await this.#authorization(request)) ?? this.#route(request);
  }

  /** The answer of the authorize hook: none when it allows the request. */
  async #authorization(request: IncomingMessage): Promise<Early | undefined> {
    const { authorize } = this.#options;
    if (authorize === undefined) {
      return undefined;
    }
    const headers = headersOf(request);
    try {
      if (await authorize(headers)) {
        return undefined;
      }
    } catch {
      return {
        body: refusal(errorCodes.internalError, authorizationFailed),
        status: status.internal,
      };
    }
    return { headers: { 'WWW-Authenticate': 'Bearer' }, status: status.unauthorized };
  }

  /** The answer to a path, a method, or a POST's content type or length the server refuses. */
  #route(request: IncomingMessage): Early | undefined {
    const [path] = (request.url ?? '').split('?');
    if (path !== endpoint) {
      return { status: status.notFound };
    }
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return { headers: { Allow: 'POST, DELETE' }, status: status.methodNotAllowed };
    }
    const [type = ''] = (headerOf(request, 'Content-Type') ?? '').split(';');
    if (request.method === 'POST' && type.trim().toLowerCase() !== 'application/json') {
      const body = refusal(errorCodes.invalidRequest, bodyNotJsonType);
      return { body, status: status.unsupportedType };
    }
    return Number(headerOf(request, 'Content-Length')) > this.#options.maxBodyBytes
      ? this.#tooLarge()
      : undefined;
  }

  #tooLarge(): Early {
    const sentence = bodyTooLarge(this.#options.maxBodyBytes);
    return { body: refusal(errorCodes.invalidRequest, sentence), status: status.tooLarge };
  }

  /**
   * Sends an answer before the body is consumed. It closes the HTTP connection: the server ends its
   * own side, then reads and discards the unread body for up to 2 seconds or until the client
   * ends its side, and then closes, so the client reads the answer rather
   * than a reset.
   */
  #early(request: IncomingMessage, response: ServerResponse, early: Early) {
    const { socket } = request;
    if (!request.complete) {
      // Node closes a connection whose response says close as soon as the response is written;
      // Ending its own side alone leaves the unread body to the lingering read below.
      socket.destroySoon = () => socket.end();
      linger(request, socket);
    }
    const headers = { ...early.headers, Connection: 'close' };
    if (early.body === undefined) {
      response.writeHead(early.status, { ...headers, 'Content-Length': '0' });
      response.end();
    } else {
      sendJson(response, { headers, message: early.body, status: early.status });
    }
  }

  /** The body, read whole as UTF-8 up to the limit, or nothing when the client left. */
  #body(request: IncomingMessage): Promise<string | typeof tooLarge | undefined> {
    const limit = this.#options.maxBodyBytes;
    return new Promise((resolve) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const stop = (value: string | typeof tooLarge | undefined) => {
        request.off('data', take);
        request.off('end', end);
        chunks.length = 0;
        request.pause();
        resolve(value);
      };
      function take(chunk: Uint8Array) {
        size += chunk.length;
        chunks.push(chunk);
        if (size > limit) {
          stop(tooLarge);
        }
      }
      function end() {
        resolve(Buffer.concat(chunks).toString('utf8'));
        chunks.length = 0;
      }
      request.on('data', take);
      request.once('end', end);
      request.once('close', () => resolve(undefined));
    });
  }

  /** Answers one message the body held. */
  #message(request: IncomingMessage, response: ServerResponse, message: Incoming) {
    if (message.kind === 'invalid') {
      sendJson(response, { message: errorMessage(null, message.error), status: status.badRequest });
    } else if (message.kind === 'response') {
      sendEmpty(response, status.accepted);
    } else if (message.kind === 'notification') {
      sendEmpty(response, this.#notification(request, message));
    } else if (
      headerOf(request, 'MCP-Session-Id') === undefined &&
      headerOf(request, 'MCP-Protocol-Version') === protocolRevision &&
      eraOf(message.params) !== 'per-request'
    ) {
      const error = new ProtocolError(
        errorCodes.invalidParams,
        metaKeyMissing(
          metaKeys.protocolVersion,
          metaKeys.protocolVersion,
          metaKeys.clientCapabilities,
        ),
      );
      sendJson(response, { message: errorMessage(message.id, error), status: status.badRequest });
    } else if (eraOf(message.params) === 'per-request') {
      this.#perRequest(request, response, message);
    } else {
      this.#sessionRequest(request, response, message);
    }
  }

  /**
   * Hands a notification to its session, and answers its status: 202, or 404 for an unknown
   * session. A per-request notification and one with no session id are ignored.
   */
  #notification(
    request: IncomingMessage,
    { method, params }: Extract<Incoming, { readonly kind: 'notification' }>,
  ) {
    const id = headerOf(request, 'MCP-Session-Id');
    if (eraOf(params) === 'per-request' || id === undefined) {
      return status.accepted;
    }
    const session = this.#sessions.get(id);
    session?.touch();
    session?.connection.notify(method, params);
    return session === undefined ? status.notFound : status.accepted;
  }

  /** Serves a per-request message statelessly, as a connection of one request. */
  #perRequest(request: IncomingMessage, response: ServerResponse, message: Request) {
    const mismatch = metadataFault(request, message);
    const connection = new Connection(this.#server);
    const admission =
      mismatch === undefined
        ? connection.admit(message.id, message.method, message.params)
        : ({ error: mismatch, kind: 'refused', stage: 'envelope' } as const);
    if (admission.kind === 'refused') {
      sendJson(response, {
        message: errorMessage(message.id, admission.error),
        status: perRequestStatus(admission),
      });
      return;
    }
    this.#connections.add(connection);
    this.#answer(response, admission, {
      cancel: () => connection.cancel(message.id),
      ended: () => this.#release(connection),
    });
  }

  /** Forgets a connection of one request once its request has ended and settled. */
  #release(connection: Connection) {
    void connection.settled().then(() => this.#connections.delete(connection));
  }

  /** Serves an initialize-era request within its session, or opens one. */
  #sessionRequest(request: IncomingMessage, response: ServerResponse, message: Request) {
    const id = headerOf(request, 'MCP-Session-Id');
    const session = id === undefined ? undefined : this.#sessions.get(id);
    if (id === undefined) {
      this.#sessionless(response, message);
    } else if (session === undefined) {
      sendEmpty(response, status.notFound);
    } else {
      session.touch();
      const mismatch = versionFault(request, session);
      if (mismatch === undefined) {
        this.#inSession(response, session, message);
      } else {
        sendJson(response, {
          message: errorMessage(message.id, mismatch),
          status: status.badRequest,
        });
      }
    }
  }

  #inSession(response: ServerResponse, session: HttpSession, message: Request) {
    const admission = session.connection.admit(message.id, message.method, message.params);
    if (admission.kind === 'refused') {
      sendJson(response, { message: errorMessage(message.id, admission.error), status: status.ok });
      return;
    }
    // A closed stream does not cancel on the initialize-era revisions: the call runs to its end.
    this.#answer(response, admission, {});
  }

  /**
   * Serves an initialize-era request without a session id: `initialize` opens a session when it
   * succeeds, `ping` is answered, and any other request is refused.
   */
  #sessionless(response: ServerResponse, message: Request) {
    if (message.method === 'ping') {
      sendJson(response, { message: resultMessage(message.id, {}), status: status.ok });
    } else if (message.method === 'initialize') {
      this.#initialize(response, message);
    } else {
      const sentence = noSession(metaKeys.protocolVersion, metaKeys.clientCapabilities);
      const error = new ProtocolError(errorCodes.invalidParams, sentence);
      sendJson(response, { message: errorMessage(message.id, error), status: status.badRequest });
    }
  }

  /** Opens a session when the package answers `initialize` with its result, and only then. */
  #initialize(response: ServerResponse, message: Request) {
    const id = crypto.randomUUID();
    const session = new HttpSession(this.#server, this.#options.sessionIdleMs, () =>
      this.#endSession(id),
    );
    const admission = session.connection.admit(message.id, message.method, message.params);
    if (admission.kind === 'refused') {
      session.end();
      sendJson(response, { message: errorMessage(message.id, admission.error), status: status.ok });
      return;
    }
    this.#answer(response, admission, {
      headers: (answer) => {
        if (!('result' in answer)) {
          session.end();
          return {};
        }
        this.#sessions.set(id, session);
        this.#connections.add(session.connection);
        return { 'MCP-Session-Id': id };
      },
    });
  }

  #endSession(id: string) {
    const session = this.#sessions.get(id);
    this.#sessions.delete(id);
    session?.end();
    if (session !== undefined) {
      void session.connection.settled().then(() => this.#connections.delete(session.connection));
    }
  }

  /** DELETE ends the session it names: 204, 400 without a session id, and 404 for an unknown one. */
  #delete(request: IncomingMessage, response: ServerResponse) {
    const id = headerOf(request, 'MCP-Session-Id');
    if (id === undefined) {
      sendEmpty(response, status.badRequest);
    } else if (this.#sessions.has(id)) {
      this.#endSession(id);
      sendEmpty(response, status.noContent);
    } else {
      sendEmpty(response, status.notFound);
    }
  }

  /** Answers an admitted request: on an event stream when its handler streams, and as JSON otherwise. */
  #answer(response: ServerResponse, admission: Admission & { kind: 'admitted' }, hooks: Hooks) {
    const channel = admission.streams ? stream(response, hooks) : single(response, hooks);
    admission.begin(channel);
  }

  /**
   * Stops serving on the run's signal: every call aborts and answers nothing, each per-request
   * subscription still open is torn down on its stream, every stream ends, and every HTTP
   * connection closes. Resolves once every call has settled.
   */
  async #shutdown() {
    const connections = [...this.#connections];
    for (const connection of connections) {
      connection.silence();
      connection.closeSubscriptions();
    }
    for (const session of this.#sessions.values()) {
      session.end();
    }
    this.#sessions.clear();
    this.#closeSockets();
    await Promise.all(connections.map((connection) => connection.settled()));
  }

  /** Closes every HTTP connection, an idle kept-alive one included, once its writes have flushed. */
  #closeSockets() {
    for (const [socket, receipt] of this.#sockets) {
      receipt.clear();
      socket.end(() => socket.destroy());
    }
  }
}

/**
 * What a response does around its request: `cancel` when its client closes it before it ends,
 * `ended` once it has ended, and `headers` for the answer of a JSON response.
 */
interface Hooks {
  readonly cancel?: () => void;
  readonly ended?: () => void;
  readonly headers?: (answer: object) => Readonly<Record<string, string>>;
}

/**
 * A channel that answers with one `application/json` response once its request ends. A request
 * that ends with no answer, as one aborted by shutdown, closes the response.
 */
function single(response: ServerResponse, hooks: Hooks): Channel {
  let answer: object | undefined = undefined;
  let done = false;
  response.once('close', () => {
    if (!done) {
      done = true;
      hooks.cancel?.();
      hooks.ended?.();
    }
  });
  return {
    end: () => {
      if (done) {
        return;
      }
      done = true;
      hooks.ended?.();
      if (answer === undefined) {
        response.destroy();
      } else if (writable(response)) {
        sendJson(response, {
          headers: hooks.headers?.(answer),
          message: answer,
          status: status.ok,
        });
      }
    },
    send: (message) => {
      answer = message;
    },
  };
}

/**
 * A channel that answers on an event stream: its headers go out at once, each message is one
 * event, and a comment line follows every 15 seconds. The socket's idle timeout is off while the
 * stream is open and restored when it ends.
 */
function stream(response: ServerResponse, hooks: Hooks): Channel {
  response.writeHead(status.ok, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  const { socket } = response;
  const previous = socket?.timeout ?? noTimeout;
  socket?.setTimeout(noTimeout);
  const beat = setInterval(() => {
    if (writable(response)) {
      response.write(': keep-alive\n\n');
    }
  }, keepAliveMs);
  let done = false;
  const finish = () => {
    done = true;
    clearInterval(beat);
    socket?.setTimeout(previous);
    hooks.ended?.();
  };
  response.once('close', () => {
    if (!done) {
      finish();
      hooks.cancel?.();
    }
  });
  return {
    end: () => {
      if (!done) {
        finish();
        response.end();
      }
    },
    send: (message) => {
      if (!done && writable(response)) {
        response.write(event(message));
      }
    },
  };
}

/**
 * Reads and discards a refused request's unread body for up to 2 seconds or until the client
 * ends its side, and then closes the socket.
 */
function linger(request: IncomingMessage, socket: Socket) {
  const close = () => {
    clearTimeout(timer);
    socket.destroy();
  };
  const timer = setTimeout(close, lingerMs);
  request.once('end', close);
  socket.once('close', () => clearTimeout(timer));
  request.resume();
}

export { HttpTransport };
export type { HttpOptions };
