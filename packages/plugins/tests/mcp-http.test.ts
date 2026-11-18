/*
 * Acceptance plan for `mcp --http` (docs/plugins/mcp.md, Serving over HTTP, and ADR-0184).
 *
 * A fixture application installs `mcp()` with settings its variables name and the verbose plugin,
 * and a process test launches `served mcp --http <address>` under the runtime the test run names,
 * reads the URL line, and drives the server from this process on 127.0.0.1:
 *
 * - Starting. The URL line is stdout's one line, with the port the server took for port 0, and a
 *   loopback bind writes no warning. The end of stdin does not stop the server. Each refused
 *   `--http` form is core's usage error, exit 2, whose sentence names the accepted forms, and a port
 *   another program holds fails the run with exit 1 and a sentence that names the address and the
 *   step. The two non-loopback warnings and the URL host of an unspecified address are proven on
 *   the functions that choose them, because a test binds nothing but 127.0.0.1.
 * - Requests. An `Origin` is answered 403 and writes its -v line; the authorize hook's `false` is
 *   401 and writes its -v line, and its `true` serves; a hook that throws answers 500 for each
 *   request, writes an error line at -v, and the run reports the first throw once when it stops,
 *   the generic message in a distributed build and the Developer Diagnostic in a development build,
 *   and resolves its cancellation code. `maxBodyBytes` answers 413 past it.
 * - Tools. The listing names the opted-in Commands alone, no needs-terminal Command and no
 *   `http` property, a call streams its progress and then its result, and an initialize-era client
 *   calls within its session.
 * - Shutdown. The run's signal aborts each call in flight and tears down an open subscription on
 *   its stream; a process signal ends the server.
 * - Loading. Without `--http`, no module the plugin loads statically imports `node:http`, and Node
 *   reports it never loaded.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';
import {
  eventStream,
  initialize,
  inSession,
  json,
  meta,
  mirrored,
  open,
  perRequest,
  send,
  statusOf,
} from '../../mcp/tests/http.js';
import { addressOf } from '../src/mcp/address.js';
import { endpointLine, networkWarning } from '../src/mcp/serve-http.js';

const fixture = fileURLToPath(new URL('fixtures/mcp.mjs', import.meta.url));

/** How long a server may take to start or stop before the test fails. */
const deadline = 10_000;

/** One `served` process: its URL line once written, what it wrote, and how it ended. */
interface Launched {
  readonly port: () => Promise<number>;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly kill: (signal: NodeJS.Signals) => void;
  readonly exit: Promise<{ readonly status: number | null; readonly signal: string | null }>;
  readonly endStdin: () => void;
}

const running: Launched[] = [];

afterEach(async () => {
  for (const each of running.splice(0)) {
    each.kill('SIGKILL');
    await each.exit;
  }
});

/** Resolves once the condition holds, checking every few milliseconds, or fails at the deadline. */
async function until(condition: () => boolean, what: () => string) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > deadline) {
      throw new Error(what());
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

/**
 * Launches the fixture `served` with the words after its name, under the runtime the test run
 * names. A caller signal, SIGUSR2, aborts the run as an embedding caller would.
 */
function launch(words: readonly string[], env: Record<string, string> = {}): Launched {
  const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
  const child = spawn(runtime, [fixture, 'served', ...words], {
    env: childEnvironment({ FIXTURE_CALLER_SIGNAL: '1', ...env }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ status: number | null; signal: string | null }>((resolve) => {
    child.on('close', (status, signal) => resolve({ signal, status }));
  });
  let closed = false;
  void exit.finally(() => {
    closed = true;
  });
  const launched: Launched = {
    endStdin: () => child.stdin.end(),
    exit,
    kill: (signal) => {
      if (!closed) {
        child.kill(signal);
      }
    },
    port: async () => {
      await until(
        () => stdout.includes('\n') || closed,
        () => `The server wrote no URL line. It wrote:\n${stdout}${stderr}`,
      );
      const port = /^http:\/\/[^\n]+:(?<port>\d+)\/mcp\n/u.exec(stdout)?.groups?.port;
      if (port === undefined) {
        throw new Error(`The server wrote no URL line. It wrote:\n${stdout}${stderr}`);
      }
      return Number(port);
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
  running.push(launched);
  return launched;
}

/** Stops a server through its caller's signal and answers how it ended. */
async function stop(server: Launched) {
  server.kill('SIGUSR2');
  return server.exit;
}

describe('starting the server', () => {
  it("writes the URL line, with the port it took, as stdout's one line, and no warning on loopback", async () => {
    const server = launch(['mcp', '--http', '0']);
    const port = await server.port();
    expect(port).toBeGreaterThan(0);
    await expect(statusOf(port, perRequest(1, 'tools/list'))).resolves.toBe(200);
    const ending = await stop(server);
    expect(server.stdout()).toBe(`http://127.0.0.1:${String(port)}/mcp\n`);
    expect({ ...ending, stderr: server.stderr() }).toEqual({
      signal: null,
      status: 130,
      stderr: '',
    });
  });

  it('binds the host the operator names, and the end of stdin does not stop it', async () => {
    const server = launch(['mcp', '--http', '127.0.0.1:0']);
    const port = await server.port();
    server.endStdin();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await expect(statusOf(port, perRequest(1, 'server/discover'))).resolves.toBe(200);
    await stop(server);
  });

  it.each([
    ':8080',
    '::1:8080',
    '70000',
    'http://127.0.0.1:8080',
    '127.0.0.1:8080/mcp',
    '[127.0.0.1]:80',
    'host:',
  ])('refuses --http %s with the usage error, which names the accepted forms', async (value) => {
    const server = launch(['mcp', '--http', value]);
    const ending = await server.exit;
    expect(ending.status).toBe(2);
    expect(server.stderr()).toContain(
      'Supply a port, such as 8080, or host:port, such as 127.0.0.1:8080 or [::1]:8080.',
    );
    expect(server.stdout()).toBe('');
  });

  it('fails with exit 1 and names the address and the step when another program holds the port', async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => {
      holder.listen(0, '127.0.0.1', resolve);
    });
    const address = holder.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const server = launch(['mcp', '--http', `127.0.0.1:${String(port)}`]);
      const ending = await server.exit;
      expect(ending.status).toBe(1);
      expect(server.stderr()).toContain(
        `served mcp cannot serve at 127.0.0.1:${String(port)}, because another program is using that port. Run it with another port, or with 0 to take any free port.`,
      );
      expect(server.stdout()).toBe('');
    } finally {
      holder.close();
    }
  });
});

describe('the --http value', () => {
  it.each([
    ['0', { host: '127.0.0.1', port: 0, urlHost: '127.0.0.1' }],
    ['8080', { host: '127.0.0.1', port: 8080, urlHost: '127.0.0.1' }],
    ['localhost:65535', { host: 'localhost', port: 65_535, urlHost: 'localhost' }],
    ['0.0.0.0:80', { host: '0.0.0.0', port: 80, urlHost: '0.0.0.0' }],
    ['[::1]:8080', { host: '::1', port: 8080, urlHost: '[::1]' }],
    ['[::]:0', { host: '::', port: 0, urlHost: '[::]' }],
  ])('accepts %s', (written, address) => {
    expect(addressOf(written)).toEqual({ ...address, written });
  });

  it.each([
    ':8080',
    '::1:8080',
    '[::1]',
    '65536',
    '[nope]:80',
    'a b:80',
    'x:-1',
    '[::\t1]:80',
    '[::\n1]:80',
    '[::\r1]:80',
  ])('refuses %s', (written) => {
    expect(addressOf(written)).toBeUndefined();
  });
});

/** The address a value names, which the test knows the option accepts. */
function named(written: string) {
  const address = addressOf(written);
  if (address === undefined) {
    throw new Error(`The test names an address the option refuses: ${written}`);
  }
  return address;
}

describe('what a bind tells the operator', () => {
  it('writes no warning for a loopback address, IPv4-mapped included', () => {
    for (const bound of ['127.0.0.1', '127.0.0.5', '::1', '::ffff:127.0.0.1']) {
      expect(networkWarning({ address: bound, port: 1 }, named('0'), false)).toBeUndefined();
    }
  });

  it('warns about open access without a hook, and about cleartext credentials with one', () => {
    const address = named('0.0.0.0:8080');
    const bound = { address: '0.0.0.0', port: 8080 };
    expect(networkWarning(bound, address, false)).toBe(
      'Serving at 0.0.0.0:8080, which other hosts can reach, with no authorize hook, so any host that reaches it can call the tools without credentials. Serve on 127.0.0.1, or put the server behind something that authenticates.',
    );
    expect(networkWarning({ address: '10.1.2.3', port: 8080 }, named('10.1.2.3:8080'), true)).toBe(
      'Serving at 10.1.2.3:8080 over plain HTTP, so requests and their credentials cross the network unencrypted, where anyone on the path can read and replay them. Put TLS in front of the server, such as a reverse proxy that terminates it.',
    );
  });

  it('names the loopback address that reaches an unspecified address in the URL line', () => {
    expect(endpointLine({ address: '0.0.0.0', port: 8080 }, named('0.0.0.0:8080'))).toBe(
      'http://127.0.0.1:8080/mcp\n',
    );
    expect(endpointLine({ address: '::', port: 8080 }, named('[::]:8080'))).toBe(
      'http://[::1]:8080/mcp\n',
    );
    expect(endpointLine({ address: '::1', port: 41_000 }, named('[::1]:0'))).toBe(
      'http://[::1]:41000/mcp\n',
    );
  });
});

describe('requests', () => {
  it('refuses an Origin with 403 and writes its -v line', async () => {
    const server = launch(['-v', 'mcp', '--http', '0']);
    const port = await server.port();
    const answer = await send(port, {
      ...perRequest(1, 'tools/list'),
      headers: { ...mirrored('tools/list'), Origin: 'https://evil.example' },
    });
    expect(answer.status).toBe(403);
    await stop(server);
    expect(server.stderr()).toContain(
      'Refused a request from origin https://evil.example, because this server answers no browser request.',
    );
  });

  it("answers the hook's false with 401 and its -v line, and serves what it allows", async () => {
    const server = launch(['-v', 'mcp', '--http', '0'], { FIXTURE_AUTHORIZE: 'token' });
    const port = await server.port();
    const refused = await send(port, perRequest(1, 'tools/list'));
    const allowed = await send(port, {
      ...perRequest(2, 'tools/list'),
      headers: { ...mirrored('tools/list'), Authorization: 'Bearer sesame' },
    });
    expect([refused.status, refused.headers['www-authenticate'], allowed.status]).toEqual([
      401,
      'Bearer',
      200,
    ]);
    await stop(server);
    expect(server.stderr()).toContain('Refused a request the authorize hook did not allow.');
  });

  it('answers each throw of the hook with 500, keeps serving, and reports the first throw once when it stops', async () => {
    const server = launch(['-v', 'mcp', '--http', '0'], { FIXTURE_AUTHORIZE: 'throw' });
    const port = await server.port();
    const first = await send(port, perRequest(1, 'tools/list'));
    const second = await send(port, perRequest(2, 'tools/list'));
    expect([first.status, json(first).error, second.status]).toEqual([
      500,
      expect.objectContaining({ code: -32_603 }),
      500,
    ]);
    const ending = await stop(server);
    expect(ending.status).toBe(130);
    const stderr = server.stderr();
    expect(stderr.split('The authorize hook threw, so the request was answered 500.')).toHaveLength(
      3,
    );
    expect(stderr).toContain('TypeError: token.trim is not a function');
    expect(stderr.split('Something went wrong.')).toHaveLength(2);
  });

  it('reports the throw as its Developer Diagnostic in a development build', async () => {
    const server = launch(['mcp', '--http', '0'], {
      FIXTURE_AUTHORIZE: 'throw',
      FIXTURE_BUILD: 'development',
    });
    const port = await server.port();
    await expect(statusOf(port, perRequest(1, 'tools/list'))).resolves.toBe(500);
    const ending = await stop(server);
    expect(ending.status).toBe(130);
    expect(server.stderr()).toContain('@loomcli/plugins/mcp/broken-authorize-hook');
    expect(server.stderr()).toContain(
      'The authorize hook given to mcp() threw while it judged a request, so the server answered that request with 500.',
    );
  });

  it('answers a body past maxBodyBytes with 413', async () => {
    const server = launch(['mcp', '--http', '0'], { FIXTURE_MAX_BODY: '64' });
    const port = await server.port();
    const answer = await send(
      port,
      perRequest(1, 'tools/call', { arguments: { word: 'x'.repeat(100) }, name: 'echo' }),
    );
    expect([answer.status, json(answer).error]).toEqual([
      413,
      expect.objectContaining({ code: -32_600 }),
    ]);
    await stop(server);
  });
});

describe('tools over HTTP', () => {
  it('lists the opted-in Commands alone, with no needs-terminal Command and no http property', async () => {
    const server = launch(['mcp', '--http', '0']);
    const port = await server.port();
    const listed = json(await send(port, perRequest(1, 'tools/list')));
    const tools: unknown[] = Object(listed.result).tools;
    expect(tools.map((tool) => Object(tool).name)).toEqual(['echo', 'wait', 'counted']);
    for (const tool of tools) {
      expect(Object(Object(tool).inputSchema).properties).not.toHaveProperty('http');
    }
    const top = await send(port, perRequest(2, 'tools/call', { arguments: {}, name: 'top' }));
    expect(top.text).toContain(
      String.raw`Unknown tool \"top\". Call tools/list for the tool names.`,
    );
    await stop(server);
  });

  it("streams a call's progress, then its result", async () => {
    const server = launch(['mcp', '--http', '0']);
    const port = await server.port();
    const stream = eventStream(
      await open(port, {
        body: {
          id: 1,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { _meta: { ...meta, progressToken: 't' }, arguments: {}, name: 'counted' },
        },
        headers: mirrored('tools/call', 'counted'),
      }),
    );
    await stream.ended;
    expect(stream.events().map((message) => Object(message.params).message ?? message.id)).toEqual([
      'Fetching records 0/2 (started)',
      'Fetching records 1/2 (updated)',
      'Fetching records 1/2 (ended)',
      1,
    ]);
    await stop(server);
  });

  it('serves an initialize-era client within its session', async () => {
    const server = launch(['mcp', '--http', '0']);
    const port = await server.port();
    const opened = await send(port, initialize('2025-06-18'));
    const session = opened.headers['mcp-session-id'];
    expect(session).toBeTypeOf('string');
    const called = await send(
      port,
      inSession(String(session), 1, 'tools/call', { arguments: { word: 'hello' }, name: 'echo' }),
    );
    expect(called.text).toContain(String.raw`"text":"hello\n"`);
    await stop(server);
  });
});

describe('shutdown', () => {
  it("the run's signal aborts each call and tears down an open subscription on its stream", async () => {
    const server = launch(['mcp', '--http', '0']);
    const port = await server.port();
    const listen = eventStream(await open(port, perRequest('listen', 'subscriptions/listen')));
    await listen.next();
    const call = eventStream(
      await open(port, perRequest(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' })),
    );
    await until(
      () => server.stderr().includes('started one'),
      () => server.stderr(),
    );
    const ending = await stop(server);
    await Promise.all([listen.ended, call.ended]);
    expect(ending.status).toBe(130);
    expect(server.stderr()).toBe('started one\naborted one\n');
    expect(listen.events().slice(1)).toEqual([
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'listen' } },
      {
        id: 'listen',
        jsonrpc: '2.0',
        result: {
          _meta: {
            'io.modelcontextprotocol/serverInfo': { name: 'served', version: '3.0.0' },
            'io.modelcontextprotocol/subscriptionId': 'listen',
          },
          resultType: 'complete',
        },
      },
    ]);
    expect(call.events()).toEqual([]);
  });

  it('a process signal ends the server', async () => {
    const server = launch(['mcp', '--http', '0']);
    const port = await server.port();
    await expect(statusOf(port, perRequest(1, 'tools/list'))).resolves.toBe(200);
    server.kill('SIGTERM');
    const ending = await server.exit;
    expect(ending.signal === 'SIGTERM' || ending.status === 143).toBe(true);
  });
});

/** The pack modules a module imports statically, and the other specifiers it names. */
function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [
    ...text.matchAll(
      /^\s*(?:(?:import|export)\b[^;'"]*?from\s*|import\s*)["'](?<specifier>[^"']+)["']/gmu,
    ),
  ].map((match) => match.groups?.specifier ?? '');
}

describe('loading', () => {
  const built = fileURLToPath(new URL('../dist/src/mcp/', import.meta.url));

  it('without --http, no module the plugin loads statically imports node:http', () => {
    const seen = new Set<string>();
    const pending = [join(built, 'plugin.js'), join(built, 'serve.js')];
    const external: string[] = [];
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (!seen.has(file)) {
        seen.add(file);
        for (const specifier of staticImports(file)) {
          if (specifier.startsWith('.')) {
            pending.push(join(dirname(file), specifier));
          } else {
            external.push(specifier);
          }
        }
      }
    }
    expect(external).not.toContain('node:http');
    expect([...seen].map((file) => file.slice(built.length))).not.toContain('serve-http.js');
    expect(readFileSync(join(built, 'serve.js'), 'utf8')).toContain('import("./serve-http.js")');
  });

  it('Node loads node:http for --http alone', async () => {
    const stdio = launch(['mcp'], { FIXTURE_REPORT_HTTP: '1' });
    stdio.endStdin();
    await stdio.exit;
    const http = launch(['mcp', '--http', '0'], { FIXTURE_REPORT_HTTP: '1' });
    await http.port();
    await stop(http);
    const unknown = process.env.LOOM_TEST_RUNTIME === 'bun';
    expect([stdio.stderr(), http.stderr()]).toEqual(
      unknown
        ? ['node:http unknown\n', 'node:http unknown\n']
        : ['node:http not loaded\n', 'node:http loaded\n'],
    );
  });
});
