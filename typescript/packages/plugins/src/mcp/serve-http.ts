/*
 * The `mcp --http` server. It listens with `node:http` at the address the operator named, warns
 * when that address is not loopback, writes the URL line, and hands each socket and request to the
 * protocol package's transport until the run's signal aborts. `serve.js` loads this module only
 * when `--http` is given, so no other run loads `node:http`.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import { FatalError, InternalError } from '@loomcli/core';
import type { ActionContext, Phrase } from '@loomcli/core';

import { exactText } from '../exact-text.js';
import { mcpBrokenAuthorizeHook } from '../rules.js';
import type { HttpAddress } from './address.js';
import { mcpPhrase } from './phrases.js';
import type { McpSettings } from './plugin.js';

/**
 * The protocol package's HTTP transport, written here rather than imported so this module's
 * declarations name no private package.
 */
interface Transport {
  watch(socket: Socket): void;
  request(request: IncomingMessage, response: ServerResponse): void;
  readonly closed: Promise<void>;
}

/** How the transport serves, as the protocol package takes it. */
interface TransportOptions {
  readonly authorize: ((headers: Headers) => Promise<boolean>) | undefined;
  readonly onOriginRefused: (origin: string) => void;
  readonly maxBodyBytes: number;
  readonly sessionIdleMs: number;
  readonly signal: AbortSignal;
}

/** The context the HTTP server reads: the application's name, `log`, `out`, and the run's signal. */
type HttpContext = Pick<ActionContext<unknown>, 'graph' | 'log' | 'out' | 'signal'>;

/** What `mcp --http` serves: the address, the plugin's settings, and the server's transport. */
interface HttpServing {
  readonly address: HttpAddress;
  readonly settings: McpSettings;
  readonly transport: (options: TransportOptions) => Transport;
}

/** The address the server bound, as `node:http` reports it. */
interface Bound {
  readonly address: string;
  readonly port: number;
}

/** The first throw of the authorize hook in the run, which the server reports once it stops. */
interface Thrown {
  first?: { readonly value: unknown };
}

/** The largest POST body the server reads by default: 4 MiB. */
const defaultMaxBodyBytes = 4_194_304;
/** How long an initialize-era session may sit idle by default: 30 minutes. */
const defaultSessionIdleMs = 1_800_000;

/** Whether a bound address is loopback: in 127.0.0.0/8, `::1`, or an IPv4-mapped loopback address. */
function isLoopback(address: string): boolean {
  return /^(?:::ffff:)?127\./iu.test(address) || address === '::1';
}

/**
 * The host the URL line names: the loopback address that reaches an unspecified address from this
 * machine, and otherwise the host as the operator wrote it.
 */
function urlHost(bound: Bound, address: HttpAddress): string {
  if (bound.address === '0.0.0.0') {
    return '127.0.0.1';
  }
  return bound.address === '::' ? '[::1]' : address.urlHost;
}

/** The system error code of a failed listen, or `unknown` when it carries none. */
function codeOf(error: unknown): string {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

/** What the server bound, or the address it was asked to bind when it reports none. */
function boundOf(server: Server, address: HttpAddress): Bound {
  const bound = server.address();
  return typeof bound === 'object' && bound !== null
    ? bound
    : { address: address.host, port: address.port };
}

/** Listens at the address, and answers what the server bound, or the failure that names why not. */
function listen(server: Server, address: HttpAddress, name: string): Promise<Bound> {
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      const sentence = mcpPhrase('bindFailed', name, address.written, codeOf(error));
      reject(new FatalError(sentence));
    };
    server.once('error', fail);
    server.listen(address.port, address.host, () => {
      server.off('error', fail);
      resolve(boundOf(server, address));
    });
  });
}

/**
 * The author's hook as the transport calls it: each refusal is a `debug` line, and each throw an
 * `error` event that carries it, the first kept for the report when the server stops.
 */
function authorizer(
  { log }: HttpContext,
  { authorize }: McpSettings,
  thrown: Thrown,
): TransportOptions['authorize'] {
  if (authorize === undefined) {
    return undefined;
  }
  return async (headers) => {
    try {
      const allowed = await authorize({ headers });
      if (!allowed) {
        log.debug(mcpPhrase('unauthorizedLine'));
      }
      return allowed;
    } catch (error) {
      thrown.first ??= { value: error };
      log.error(mcpPhrase('hookThrewLine'), { error });
      throw error;
    }
  };
}

/** Warns when the bound address is not loopback, then writes the URL line, stdout's one line. */
async function announce({ out, signal }: HttpContext, serving: HttpServing, bound: Bound) {
  if (signal.aborted) {
    return;
  }
  const warning = warningPhrase(bound, serving.address, serving.settings.authorize !== undefined);
  if (warning !== undefined) {
    await out.warn(warning);
  }
  if (signal.aborted) {
    return;
  }
  await out.render(endpointLine(bound, serving.address), exactText);
}

/**
 * The warning a bind writes: none on a loopback address, and otherwise open access without an
 * authorize hook, or credentials in the clear with one.
 */
function warningPhrase(bound: Bound, address: HttpAddress, hooked: boolean): Phrase | undefined {
  if (isLoopback(bound.address)) {
    return undefined;
  }
  return hooked
    ? mcpPhrase('cleartextWarning', address.written)
    : mcpPhrase('openNetworkWarning', address.written);
}

/** The URL line: the endpoint at the host the URL names and the port the server bound. */
function endpointLine(bound: Bound, address: HttpAddress): string {
  return `http://${urlHost(bound, address)}:${String(bound.port)}/mcp\n`;
}

/** Stops listening once the run's signal aborts; the transport closes every HTTP connection. */
function stopOnAbort(server: Server, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve());
    if (signal.aborted) {
      stop();
    } else {
      signal.addEventListener('abort', stop, { once: true });
    }
  });
}

/**
 * Serves the tools over HTTP until the run's signal aborts, and resolves once every call has
 * settled. A bind failure fails the run before it serves. When the authorize hook threw during the
 * run, the server reports its first throw once it stops, as a defect.
 */
async function serveHttp(context: HttpContext, serving: HttpServing): Promise<void> {
  const thrown: Thrown = {};
  const transport = serving.transport(transportOptions(context, serving.settings, thrown));
  const server = servingServer(transport);
  const bound = await listen(server, serving.address, context.graph.name);
  watchErrors(server, context);
  const listenerClosed = stopOnAbort(server, context.signal);
  await announce(context, serving, bound);
  await Promise.all([transport.closed, listenerClosed]);
  reportFirstThrow(thrown);
}

/** Hands the listener's sockets and requests to the transport. */
function servingServer(transport: Transport) {
  const server = createServer();
  server.on('connection', (socket: Socket) => transport.watch(socket));
  server.on('request', (request, response) => transport.request(request, response));
  return server;
}

/** Reports accept errors without stopping the listener. */
function watchErrors(server: Server, context: HttpContext) {
  server.on('error', (error: unknown) => {
    context.log.error(mcpPhrase('serverErrorLine'), { code: codeOf(error), error });
  });
}

/** The Developer Diagnostic's sentence for a throw of the authorize hook, which stays English. */
const brokenAuthorizeHookSentence =
  'The authorize hook given to mcp() threw while it judged a request, so the server answered that request with 500.';

/** The Developer Diagnostic's correction for a throw of the authorize hook, which stays English. */
const brokenAuthorizeHookCorrection =
  'Return true or false from authorize for every request, and throw from it for none.';

/** Fails the run once with the authorize hook's first throw, when it threw at all. */
function reportFirstThrow({ first }: Thrown) {
  if (first !== undefined) {
    throw new InternalError(mcpBrokenAuthorizeHook, {
      cause: first.value,
      correction: brokenAuthorizeHookCorrection,
      sentence: brokenAuthorizeHookSentence,
    });
  }
}

/** The transport's options: the wrapped hook, the settings' limits, and the run's signal. */
function transportOptions(
  context: HttpContext,
  settings: McpSettings,
  thrown: Thrown,
): TransportOptions {
  return {
    authorize: authorizer(context, settings, thrown),
    maxBodyBytes: settings.maxBodyBytes ?? defaultMaxBodyBytes,
    onOriginRefused: (origin) => {
      context.log.debug(mcpPhrase('originRefused'), { origin });
    },
    sessionIdleMs: settings.sessionIdleMs ?? defaultSessionIdleMs,
    signal: context.signal,
  };
}

export { endpointLine, serveHttp, warningPhrase };
