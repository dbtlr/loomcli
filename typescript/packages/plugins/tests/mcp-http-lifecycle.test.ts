import { createServer, Server } from 'node:http';
import type Http from 'node:http';

import { Application } from '@loomcli/core';
import type { MessageArguments } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';
import { describe, expect, it, test, vi } from 'vite-plus/test';

import { serveHttp } from '../src/mcp/serve-http.js';
import { runOnMock } from './fixtures/in-process.js';

vi.mock('node:http', async (original) => {
  const http = await original<typeof Http>();
  return { ...http, createServer: vi.fn(http.createServer) };
});

function application(
  signal: AbortController,
  onListening: (server: Server) => void,
  abortOnWarning = false,
) {
  return new Application('fixture', {
    description: 'HTTP lifecycle fixture.',
    plugins: [verbose()],
    version: '1.0.0',
  }).action(async (context) => {
    vi.mocked(createServer).mockImplementationOnce(() => {
      const server = new Server();
      server.once('listening', () => onListening(server));
      return server;
    });
    await serveHttp(
      {
        ...context,
        out: {
          ...context.out,
          warn: async (...args: MessageArguments) => {
            await context.out.warn(...args);
            if (abortOnWarning) {
              signal.abort();
            }
          },
        },
      },
      {
        address: { host: '127.0.0.1', port: 0, urlHost: '127.0.0.1', written: '0' },
        settings: {},
        transport: () => ({
          closed: new Promise<void>((resolve) =>
            signal.signal.addEventListener('abort', () => resolve(), { once: true }),
          ),
          request: (_request, response) => {
            response.end();
          },
          watch: () => {},
        }),
      },
    );
  });
}

describe('HTTP listener lifecycle', () => {
  it('logs an accept error and continues serving', async () => {
    const signal = new AbortController();
    let handled = false;
    let listening = false;
    const app = application(signal, (server) => {
      setImmediate(() => {
        handled = server.listenerCount('error') > 0;
        try {
          if (handled) {
            server.emit('error', Object.assign(new Error('accept'), { code: 'EMFILE' }));
          }
          listening = server.listening;
        } finally {
          signal.abort();
        }
      });
    });
    const result = await runOnMock(app, { argv: ['-v'] }, { signal: signal.signal });
    expect(handled).toBe(true);
    expect(listening).toBe(true);
    expect(result.stderr).toContain('EMFILE');
  });

  it('announces nothing when aborted during listen', async () => {
    const signal = new AbortController();
    const app = application(signal, () => signal.abort());
    const result = await runOnMock(app, {}, { signal: signal.signal });
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});

test('waits for the listener close callback before returning', async () => {
  const signal = new AbortController();
  let closed = false;
  const app = application(signal, (server) => {
    const close = server.close.bind(server);
    vi.spyOn(server, 'close').mockImplementation((callback) =>
      close((error) => {
        setTimeout(() => {
          closed = true;
          callback?.(error);
        }, 100);
      }),
    );
    setImmediate(() => signal.abort());
  });
  await runOnMock(app, {}, { signal: signal.signal });
  expect(closed).toBe(true);
});

test('does not announce a URL when aborted while writing the network warning', async () => {
  const signal = new AbortController();
  const app = application(
    signal,
    (server) => {
      vi.spyOn(server, 'address').mockReturnValue({
        address: '192.0.2.1',
        family: 'IPv4',
        port: 1,
      });
    },
    true,
  );
  const result = await runOnMock(app, {}, { signal: signal.signal });
  expect(result.stderr).toContain('can call');
  expect(result.stdout).toBe('');
});
