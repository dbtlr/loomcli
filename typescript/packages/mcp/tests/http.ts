import { createServer, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import type { Socket } from 'node:net';

import { errorCodes, McpServer, ProtocolError } from '@loom/mcp';
import type { HttpOptions, ToolCall } from '@loom/mcp';

/** The `_meta` every request of the pinned revision carries. */
const meta = {
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
};

/** The identity the fixture server declares. */
const serverInfo = { description: 'An HTTP fixture.', name: 'fixture', version: '1.2.3' };

/** The tools the fixture server lists. */
const tools = [
  { inputSchema: { type: 'object' as const }, name: 'echo' },
  { inputSchema: { type: 'object' as const }, name: 'wait' },
];

/** What the fixture's tools saw, in order, such as `started one` and `aborted one`. */
type Events = string[];

/** The label a call's arguments carry. */
function labelOf(call: ToolCall): string {
  const input: unknown = call.arguments;
  const label: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'label') : '';
  return String(label);
}

/**
 * The fixture's tool handlers. `wait` runs until its signal aborts or the test releases its label;
 * `progress` sends two updates and answers; `refuse` throws a protocol error.
 */
function handlers(events: Events, releases: Map<string, () => void>) {
  return {
    echo: (call: ToolCall) => ({
      content: [{ text: JSON.stringify(call.arguments ?? null), type: 'text' as const }],
      isError: false,
    }),
    progress: (call: ToolCall) => {
      call.progress?.({ message: 'first', progress: 1 });
      call.progress?.({ progress: 2, total: 2 });
      return { content: [{ text: 'reported', type: 'text' as const }], isError: false };
    },
    refuse: () => {
      throw new ProtocolError(errorCodes.invalidParams, 'Refused.');
    },
    wait: (call: ToolCall) =>
      new Promise<{ content: { text: string; type: 'text' }[] }>((resolve) => {
        const label = labelOf(call);
        events.push(`started ${label}`);
        const settle = (how: string) => {
          events.push(`${how} ${label}`);
          resolve({ content: [{ text: `${how} ${label}`, type: 'text' }] });
        };
        releases.set(label, () => settle('released'));
        call.signal.addEventListener('abort', () => {
          if (label === 'settling') {
            events.push(`aborted ${label}`);
          } else {
            settle('aborted');
          }
        });
      }),
  };
}

/** One fixture server's address, what its tools saw, and how to stop it. */
interface Served {
  readonly port: number;
  readonly events: Events;
  /** The sockets the server accepted, in order. */
  readonly sockets: Socket[];
  /** How many requests' headers the server has received. */
  readonly requests: () => number;
  /** How many responses finished writing. */
  readonly finishes: () => number;
  readonly release: (label: string) => void;
  /** Aborts the run's signal, stops listening, and resolves once the transport has closed. */
  readonly stop: () => Promise<void>;
}

/** Starts a fixture server on 127.0.0.1, on a free port, with the given transport settings. */
async function serve(
  settings: Partial<Omit<HttpOptions, 'signal'>> = {},
  socketTimeoutMs = 0,
): Promise<Served> {
  const events: Events = [];
  const releases = new Map<string, () => void>();
  const calls: Record<string, (call: ToolCall) => unknown> = handlers(events, releases);
  const server = new McpServer({
    callTool: async (call) => {
      const handler = calls[call.name];
      if (handler === undefined) {
        throw new ProtocolError(errorCodes.invalidParams, 'Unknown tool.');
      }
      const result = await handler(call);
      return Object(result);
    },
    identity: serverInfo,
    listTools: () => tools,
  });
  const stop = new AbortController();
  const transport = server.http({
    maxBodyBytes: 4_194_304,
    sessionIdleMs: 1_800_000,
    ...settings,
    signal: stop.signal,
  });
  const sockets: Socket[] = [];
  const http = createServer();
  // Isolate the transport receipt deadlines from the runtime's shorter idle keep-alive timer.
  http.keepAliveTimeout = 0;
  http.on('connection', (socket: Socket) => {
    sockets.push(socket);
    if (socketTimeoutMs > 0) {
      socket.setTimeout(socketTimeoutMs, () => socket.destroy());
    }
    transport.watch(socket);
  });
  let requests = 0;
  let finishes = 0;
  http.on('request', (request, response) => {
    requests += 1;
    transport.request(request, response);
    response.once('finish', () => {
      finishes += 1;
    });
  });
  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('The fixture server has no port.');
  }
  return {
    events,
    finishes: () => finishes,
    port: address.port,
    release: (label) => releases.get(label)?.(),
    requests: () => requests,
    sockets,
    stop: async () => {
      stop.abort();
      const closed = new Promise<void>((resolve) => http.close(() => resolve()));
      await Promise.all([transport.closed, closed]);
    },
  };
}

/** One HTTP request a test sends. */
interface Sent {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** A body as JSON, or a raw string. */
  readonly body?: unknown;
}

/** A whole answer: its status, its headers, and its body as text. */
interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

/** The parsed JSON body of an answer. */
function json(answer: Answer): Record<string, unknown> {
  const value: unknown = JSON.parse(answer.text);
  return Object(value);
}

/** Sends one request on a fresh HTTP connection and answers its response, as it starts. */
function open(port: number, sent: Sent = {}): Promise<IncomingMessage> {
  const { body, headers = {}, method = 'POST', path = '/mcp' } = sent;
  const text = body === undefined || typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        agent: false,
        headers: {
          ...(text === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        host: '127.0.0.1',
        method,
        path,
        port,
      },
      resolve,
    );
    outgoing.on('error', reject);
    outgoing.end(text);
  });
}

/** Reads a whole response as text. */
function readAll(response: IncomingMessage): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      text += chunk;
    });
    response.on('end', () =>
      resolve({ headers: response.headers, status: response.statusCode ?? 0, text }),
    );
    response.on('error', reject);
  });
}

/** Sends one request and reads its whole answer. */
async function send(port: number, sent: Sent = {}): Promise<Answer> {
  return readAll(await open(port, sent));
}

/** Sends one request and answers its status alone. */
async function statusOf(port: number, sent: Sent = {}): Promise<number> {
  const answer = await send(port, sent);
  return answer.status;
}

/**
 * An event stream as a client reads it: `next` answers the next event's message, `text` holds
 * everything read so far, comment lines included, and `ended` resolves when the stream ends.
 */
function eventStream(response: IncomingMessage) {
  let text = '';
  let read = 0;
  const waiters: (() => void)[] = [];
  const wake = () => {
    for (const waiter of waiters.splice(0)) {
      waiter();
    }
  };
  response.setEncoding('utf8');
  response.on('data', (chunk: string) => {
    text += chunk;
    wake();
  });
  const ended = new Promise<void>((resolve) => {
    response.on('close', () => {
      wake();
      resolve();
    });
  });
  const events = () =>
    text
      .split('\n\n')
      .slice(0, -1)
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice('data: '.length)));
  const next = async (): Promise<Record<string, unknown>> => {
    while (events().length <= read) {
      if (response.closed) {
        throw new Error(`The stream ended. It carried:\n${text}`);
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    read += 1;
    return Object(events()[read - 1]);
  };
  /** Resolves once the text read so far holds the given string. */
  const holds = async (wanted: string) => {
    while (!text.includes(wanted)) {
      if (response.closed) {
        throw new Error(`The stream ended without "${wanted}". It carried:\n${text}`);
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  return { ended, events, holds, next, response, text: () => text };
}

/** The headers a per-request message mirrors: its version, its method, and a call's tool name. */
function mirrored(method: string, name?: string): Record<string, string> {
  return {
    'MCP-Protocol-Version': '2026-07-28',
    'Mcp-Method': method,
    ...(name === undefined ? {} : { 'Mcp-Name': name }),
  };
}

/** A per-request message with its headers mirrored. */
function perRequest(
  id: number | string,
  method: string,
  params: Record<string, unknown> = {},
): Sent {
  const name = typeof params.name === 'string' ? params.name : undefined;
  return {
    body: { id, jsonrpc: '2.0', method, params: { ...params, _meta: meta } },
    headers: mirrored(method, name),
  };
}

/** An initialize-era request, with the session id when one is given. */
function inSession(
  session: string | undefined,
  id: number | string,
  method: string,
  params?: Record<string, unknown>,
): Sent {
  return {
    body: { id, jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) },
    headers: session === undefined ? {} : { 'MCP-Session-Id': session },
  };
}

/** An `initialize` request for a revision, with the capabilities a handshake carries. */
function initialize(protocolVersion = '2025-11-25'): Sent {
  return inSession(undefined, 0, 'initialize', {
    capabilities: {},
    clientInfo: { name: 'http-client', version: '0.1.0' },
    protocolVersion,
  });
}

/** Opens a session and answers its id. */
async function openSession(port: number, protocolVersion?: string): Promise<string> {
  const answer = await send(port, initialize(protocolVersion));
  const id = answer.headers['mcp-session-id'];
  if (typeof id !== 'string') {
    throw new Error(`initialize issued no session id: ${answer.text}`);
  }
  return id;
}

/** A raw TCP connection to the server, and everything it has read. */
function raw(port: number) {
  const socket = connect({ allowHalfOpen: true, host: '127.0.0.1', port });
  let text = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    text += chunk;
  });
  socket.on('error', () => {
    // A write after the server closed is refused; the test reads what arrived.
  });
  // The server's end of its side, which a refusal sends before it stops reading.
  const ended = new Promise<void>((resolve) => {
    socket.once('end', resolve);
    socket.once('close', resolve);
  });
  // The connection closed whole, as when the server stops reading and a write is refused.
  const closed = new Promise<void>((resolve) => {
    socket.once('close', resolve);
  });
  const connected = new Promise<void>((resolve) => {
    socket.once('connect', resolve);
  });
  return { closed, connected, ended, socket, text: () => text };
}

/** Resolves once the condition holds, checking at each turn of the event loop. */
async function until(condition: () => boolean, description = condition.toString()) {
  const deadline = process.hrtime.bigint() + 5_000_000_000n;
  while (!condition()) {
    if (process.hrtime.bigint() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

export {
  eventStream,
  initialize,
  inSession,
  json,
  meta,
  mirrored,
  open,
  openSession,
  perRequest,
  raw,
  readAll,
  send,
  serve,
  serverInfo,
  statusOf,
  until,
};
export type { Answer, Served, Sent };
