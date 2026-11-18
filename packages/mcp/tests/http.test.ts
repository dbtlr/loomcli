/*
 * Acceptance plan for the protocol package's streamable HTTP transport (docs/plugins/mcp.md,
 * Serving over HTTP, and The protocol package's HTTP transport). An in-process `node:http` server
 * on 127.0.0.1, on a free port, hands its sockets and requests to the transport, and a client in
 * the same process proves each rule of the endpoint, the body, the revisions, sessions,
 * notifications, responses, cancellation, receipt deadlines, and shutdown, under Node and Bun.
 */
import { afterEach, describe, expect, it, test, vi } from 'vite-plus/test';

import {
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
} from './http.js';
import type { Served } from './http.js';

let served: Served | undefined = undefined;

/** Starts the fixture server for one test, which `afterEach` stops. */
async function start(settings: Parameters<typeof serve>[0] = {}, socketTimeoutMs = 0) {
  served = await serve(settings, socketTimeoutMs);
  return served;
}

afterEach(async () => {
  vi.useRealTimers();
  await served?.stop();
  served = undefined;
});

/** Fakes the timers the transport sets, and leaves the event loop's own to run I/O. */
function fakeTimers() {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
}

const browser = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' };

describe('the endpoint', () => {
  it('refuses any request that carries an Origin with 403 and a JSON-RPC error with no id, before the hook runs', async () => {
    const origins: string[] = [];
    let judged = 0;
    const { port } = await start({
      authorize: () => {
        judged += 1;
        return true;
      },
      onOriginRefused: (origin) => origins.push(origin),
    });
    const answer = await send(port, { ...perRequest(1, 'server/discover'), headers: browser });
    expect(answer.status).toBe(403);
    expect(answer.headers.connection).toBe('close');
    expect(json(answer)).toEqual({
      error: {
        code: -32_600,
        message:
          'This server answers no request a browser sends. Use an MCP client that is not a web page.',
      },
      id: null,
      jsonrpc: '2.0',
    });
    expect({ judged, origins }).toEqual({ judged: 0, origins: ['http://localhost:3000'] });
  });

  it('answers a path other than /mcp with 404, and compares the path without its query', async () => {
    const { port } = await start();
    const other = await send(port, { ...perRequest(1, 'server/discover'), path: '/other' });
    expect({
      connection: other.headers.connection,
      status: other.status,
      text: other.text,
    }).toEqual({
      connection: 'close',
      status: 404,
      text: '',
    });
    const queried = await send(port, { ...perRequest(1, 'server/discover'), path: '/mcp?x=1' });
    expect(queried.status).toBe(200);
  });

  it('answers GET and every method but POST and DELETE with 405 and Allow', async () => {
    const { port } = await start();
    for (const method of ['GET', 'PUT', 'OPTIONS']) {
      const answer = await send(port, { method });
      expect([answer.status, answer.headers.allow, answer.headers.connection, answer.text]).toEqual(
        [405, 'POST, DELETE', 'close', ''],
      );
    }
  });
});

describe('authorization', () => {
  it('passes the hook a copy of the headers, and answers false with 401 and a Bearer challenge', async () => {
    const seen: (string | null)[] = [];
    const { port } = await start({
      authorize: (headers) => {
        seen.push(headers.get('x-probe'));
        headers.set('x-probe', 'changed');
        return false;
      },
    });
    const sent = {
      ...perRequest(1, 'server/discover'),
      headers: { ...mirrored('server/discover'), 'X-Probe': 'one' },
    };
    const answer = await send(port, sent);
    await send(port, sent);
    expect([
      answer.status,
      answer.headers['www-authenticate'],
      answer.headers.connection,
      answer.text,
    ]).toEqual([401, 'Bearer', 'close', '']);
    expect(seen).toEqual(['one', 'one']);
  });

  it('serves a request the hook allows, judged from its headers', async () => {
    const { port } = await start({
      authorize: (headers) => headers.get('authorization') === 'Bearer sesame',
    });
    const refused = await send(port, perRequest(1, 'server/discover'));
    const allowed = await send(port, {
      ...perRequest(1, 'server/discover'),
      headers: { ...mirrored('server/discover'), Authorization: 'Bearer sesame' },
    });
    expect([refused.status, allowed.status]).toEqual([401, 200]);
  });

  it('judges every request, a refused path and method included, before the path and method', async () => {
    const { port } = await start({ authorize: () => Promise.resolve(false) });
    const path = await send(port, { path: '/other' });
    const method = await send(port, { method: 'GET' });
    expect([path.status, method.status]).toEqual([401, 401]);
  });

  it('answers a hook that throws or rejects with 500 and -32603, and keeps serving', async () => {
    let calls = 0;
    const { port } = await start({
      authorize: () => {
        calls += 1;
        if (calls === 1) {
          throw new TypeError('broken');
        }
        return calls === 2 ? Promise.reject(new Error('rejected')) : true;
      },
    });
    const thrown = await send(port, perRequest(1, 'server/discover'));
    const rejected = await send(port, perRequest(1, 'server/discover'));
    const answered = await send(port, perRequest(1, 'server/discover'));
    expect([thrown.status, thrown.headers.connection, json(thrown).id, json(thrown).error]).toEqual(
      [500, 'close', null, expect.objectContaining({ code: -32_603 })],
    );
    expect([rejected.status, answered.status]).toEqual([500, 200]);
  });
});

describe('the POST body', () => {
  it('answers a POST that is not application/json with 415, and allows parameters', async () => {
    const { port } = await start();
    const text = await send(port, {
      ...perRequest(1, 'server/discover'),
      headers: { ...mirrored('server/discover'), 'Content-Type': 'text/plain' },
    });
    expect([text.status, text.headers.connection, json(text).id, json(text).error]).toEqual([
      415,
      'close',
      null,
      expect.objectContaining({ code: -32_600 }),
    ]);
    const charset = await send(port, {
      ...perRequest(1, 'server/discover'),
      headers: {
        ...mirrored('server/discover'),
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    expect(charset.status).toBe(200);
  });

  it('refuses a Content-Length past the limit with 413 before reading the body', async () => {
    const { port } = await start({ maxBodyBytes: 64 });
    const answer = await send(port, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'server/discover',
        padding: 'x'.repeat(100),
      }),
    });
    expect([answer.status, answer.headers.connection, json(answer)]).toEqual([
      413,
      'close',
      {
        error: {
          code: -32_600,
          message:
            'The request body is larger than the 64 bytes this server reads. Send a smaller message.',
        },
        id: null,
        jsonrpc: '2.0',
      },
    ]);
  });

  it('counts a chunked body as it arrives and answers 413 past the limit', async () => {
    const { port } = await start({ maxBodyBytes: 64 });
    const answer = await send(port, {
      body: JSON.stringify({ padding: 'x'.repeat(200) }),
      headers: { 'Transfer-Encoding': 'chunked' },
    });
    expect([answer.status, answer.headers.connection]).toEqual([413, 'close']);
  });

  it('answers a body that is not JSON with 400 and -32700, and a batch or a non-message with 400 and -32600', async () => {
    const { port } = await start();
    const notJson = await send(port, { body: '{' });
    const batch = await send(port, { body: [] });
    const neither = await send(port, { body: { hello: 'world' } });
    expect([notJson.status, json(notJson)]).toEqual([
      400,
      {
        error: {
          code: -32_700,
          message: 'The request body is not JSON. Send one JSON-RPC message as the body of a POST.',
        },
        id: null,
        jsonrpc: '2.0',
      },
    ]);
    expect([batch.status, json(batch).id, json(batch).error]).toEqual([
      400,
      null,
      expect.objectContaining({ code: -32_600 }),
    ]);
    expect([neither.status, json(neither).error]).toEqual([
      400,
      expect.objectContaining({ code: -32_600 }),
    ]);
  });

  it('answers a notification and a response with 202 and no body', async () => {
    const { port } = await start();
    const notification = await send(port, {
      body: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    const response = await send(port, { body: { id: 3, jsonrpc: '2.0', result: {} } });
    expect([notification.status, notification.text, response.status, response.text]).toEqual([
      202,
      '',
      202,
      '',
    ]);
  });
});

describe('early refusals close the HTTP connection after a bounded read', () => {
  it('reads every oversized fetch answer as 413 across 40 uploads', async () => {
    const { port } = await start();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const answer = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
        body: 'x'.repeat(5 * 1024 * 1024),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      expect(answer.status).toBe(413);
      await expect(answer.text()).resolves.toContain('-32600');
    }
  }, 20_000);

  it('keeps discarding beyond 64 KiB until the 2 second bound', async () => {
    const { port, sockets } = await start();
    fakeTimers();
    const client = raw(port);
    try {
      await client.connected;
      client.socket.write(
        'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: test\r\nContent-Type: application/json\r\nContent-Length: 10000000\r\n\r\n',
      );
      await until(() => client.text().includes('403'));
      client.socket.write('x'.repeat(131_072));
      for (let turn = 0; turn < 100; turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(sockets[0]?.destroyed).toBe(false);
      vi.advanceTimersByTime(2000);
      await until(() => sockets[0]?.destroyed === true);
    } finally {
      client.socket.destroy();
    }
  });

  it('closes after 2 seconds when the client sends nothing more', async () => {
    const { port, sockets } = await start();
    fakeTimers();
    const client = raw(port);
    await client.connected;
    client.socket.write(
      'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://example.test\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n',
    );
    await until(() => client.text().includes('-32600'));
    const [socket] = sockets;
    vi.advanceTimersByTime(1999);
    expect(socket?.destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    await until(() => socket?.destroyed === true);
    client.socket.destroy();
  });
});

describe('receipt deadlines', () => {
  it('answers 408 and closes when the headers have not arrived within 60 seconds', async () => {
    const { port } = await start();
    fakeTimers();
    const client = raw(port);
    await client.connected;
    await until(() => (served?.sockets.length ?? 0) > 0);
    client.socket.write('POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    vi.advanceTimersByTime(59_999);
    expect(client.text()).toBe('');
    vi.advanceTimersByTime(1);
    await client.ended;
    expect(client.text()).toMatch(/^HTTP\/1\.1 408 /u);
    client.socket.destroy();
  });

  it('answers 408 and closes when the whole request has not arrived within 300 seconds', async () => {
    const { port } = await start();
    fakeTimers();
    const client = raw(port);
    await client.connected;
    await until(() => (served?.sockets.length ?? 0) > 0);
    client.socket.write(
      'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"jsonrpc":',
    );
    await until(() => served?.requests() === 1);
    vi.advanceTimersByTime(60_000);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(client.text()).toBe('');
    vi.advanceTimersByTime(240_000);
    await client.ended;
    expect(client.text()).toMatch(/^HTTP\/1\.1 408 /u);
    client.socket.destroy();
  });
});

describe('2026-07-28, per request', () => {
  it('serves server/discover and tools/list as one JSON answer, statelessly', async () => {
    const { port } = await start();
    const answer = await send(port, perRequest(1, 'tools/list'));
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/json');
    expect(answer.headers['mcp-session-id']).toBeUndefined();
    expect(json(answer)).toMatchObject({
      id: 1,
      result: {
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
        cacheScope: 'private',
        resultType: 'complete',
      },
    });
  });

  it.each([
    ['MCP-Protocol-Version missing', { 'Mcp-Method': 'tools/list' }],
    [
      'MCP-Protocol-Version unmatched',
      { ...mirrored('tools/list'), 'MCP-Protocol-Version': '2025-11-25' },
    ],
    ['Mcp-Method missing', { 'MCP-Protocol-Version': '2026-07-28' }],
    ['Mcp-Method unmatched', mirrored('tools/call')],
  ])('answers %s with 400 and -32020, carrying the id', async (_case, headers) => {
    const { port } = await start();
    const answer = await send(port, { ...perRequest(7, 'tools/list'), headers });
    expect([answer.status, json(answer).id, json(answer).error]).toEqual([
      400,
      7,
      expect.objectContaining({ code: -32_020 }),
    ]);
  });

  it('checks Mcp-Name on tools/call, decoding the base64 form', async () => {
    const { port } = await start();
    const call = perRequest(1, 'tools/call', { arguments: {}, name: 'echo' });
    const missing = await send(port, { ...call, headers: mirrored('tools/call') });
    const wrong = await send(port, { ...call, headers: mirrored('tools/call', 'wait') });
    const encoded = await send(port, {
      ...call,
      headers: mirrored('tools/call', `=?base64?${btoa('echo')}?=`),
    });
    expect(json(missing)).toEqual({
      error: {
        code: -32_020,
        message:
          'The Mcp-Name header is missing or does not equal params.name. Send Mcp-Name with the value params.name holds.',
      },
      id: 1,
      jsonrpc: '2.0',
    });
    expect([missing.status, wrong.status, json(wrong).error]).toEqual([
      400,
      400,
      expect.objectContaining({ code: -32_020 }),
    ]);
    expect([encoded.status, encoded.headers['content-type']]).toEqual([200, 'text/event-stream']);
  });

  it('answers a missing or wrong-typed _meta key with 400 and -32602', async () => {
    const { port } = await start();
    const missing = await send(port, {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      },
      headers: mirrored('tools/list'),
    });
    const wrongType = await send(port, {
      body: {
        id: 2,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': 20_260_728 } },
      },
      headers: mirrored('tools/list'),
    });
    expect([missing.status, json(missing).error, wrongType.status, json(wrongType).error]).toEqual([
      400,
      expect.objectContaining({ code: -32_602 }),
      400,
      expect.objectContaining({ code: -32_602 }),
    ]);
  });

  it('answers an unsupported version with 400 and -32022, and a method not served with 404 and -32601', async () => {
    const { port } = await start();
    const unsupported = await send(port, {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' } },
      },
      headers: { ...mirrored('tools/list'), 'MCP-Protocol-Version': '2027-01-01' },
    });
    const notServed = await send(port, perRequest(2, 'ping'));
    expect([unsupported.status, json(unsupported).error]).toEqual([
      400,
      expect.objectContaining({ code: -32_022 }),
    ]);
    expect([notServed.status, notServed.headers['content-type'], json(notServed).error]).toEqual([
      404,
      'application/json',
      expect.objectContaining({ code: -32_601 }),
    ]);
  });

  it('answers a call whose name is not a string as JSON with 200 and -32602, before any stream', async () => {
    const { port } = await start();
    const answer = await send(port, {
      body: { id: 1, jsonrpc: '2.0', method: 'tools/call', params: { _meta: meta, name: 5 } },
      headers: mirrored('tools/call'),
    });
    expect([answer.status, answer.headers['content-type'], json(answer).error]).toEqual([
      200,
      'application/json',
      expect.objectContaining({ code: -32_602 }),
    ]);
  });

  it('ignores a session id and Last-Event-ID on a per-request message', async () => {
    const { port } = await start();
    const answer = await send(port, {
      ...perRequest(1, 'server/discover'),
      headers: { ...mirrored('server/discover'), 'Last-Event-ID': '4', 'MCP-Session-Id': 'nope' },
    });
    expect(answer.status).toBe(200);
  });
});

describe('event streams', () => {
  it('answers tools/call as an event stream: progress, then the result, then the end', async () => {
    const { port } = await start();
    const response = await open(port, {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { _meta: { ...meta, progressToken: 'p' }, arguments: {}, name: 'progress' },
      },
      headers: mirrored('tools/call', 'progress'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
      'x-accel-buffering': 'no',
    });
    const { text } = await readAll(response);
    expect(
      text
        .split('\n\n')
        .slice(0, -1)
        .map((block) => block.split(': ')[0]),
    ).toEqual(['data', 'data', 'data']);
    const messages = text
      .split('\n\n')
      .slice(0, -1)
      .map((block) => JSON.parse(block.slice('data: '.length)));
    expect(messages).toEqual([
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { message: 'first', progress: 1, progressToken: 'p' },
      },
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progress: 2, progressToken: 'p', total: 2 },
      },
      expect.objectContaining({
        id: 1,
        result: expect.objectContaining({ resultType: 'complete' }),
      }),
    ]);
  });

  it('sends a handler error such as an unknown tool on the stream', async () => {
    const { port } = await start();
    const answer = await send(port, perRequest(1, 'tools/call', { name: 'nothing' }));
    expect(answer.headers['content-type']).toBe('text/event-stream');
    expect(answer.text).toContain('"code":-32602');
  });

  it('writes a comment line every 15 seconds while a stream stays open, and turns off its socket timeout', async () => {
    const { port, release, sockets } = await start();
    fakeTimers();
    const stream = eventStream(
      await open(port, perRequest(1, 'tools/call', { arguments: { label: 'long' }, name: 'wait' })),
    );
    await until(() => served?.events.includes('started long') === true);
    expect(sockets[0]?.timeout ?? 0).toBe(0);
    vi.advanceTimersByTime(15_000);
    await stream.holds(': keep-alive\n\n');
    vi.advanceTimersByTime(15_000);
    await until(() => stream.text().split(': keep-alive').length === 3);
    release('long');
    await expect(stream.next()).resolves.toMatchObject({ id: 1 });
    await stream.ended;
  });

  it('acknowledges subscriptions/listen on a stream that stays open', async () => {
    const { port } = await start();
    const stream = eventStream(await open(port, perRequest('listen', 'subscriptions/listen')));
    await expect(stream.next()).resolves.toEqual({
      jsonrpc: '2.0',
      method: 'notifications/subscriptions/acknowledged',
      params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'listen' }, notifications: {} },
    });
    expect(stream.response.closed).toBe(false);
    stream.response.destroy();
  });
});

describe('initialize-era sessions', () => {
  it('opens a session on a successful initialize alone, with a UUID', async () => {
    const { port } = await start();
    const opened = await send(port, initialize('2025-06-18'));
    expect(opened.status).toBe(200);
    expect(opened.headers['mcp-session-id']).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u,
    );
    expect(json(opened)).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
    const failed = await send(port, inSession(undefined, 1, 'initialize', { capabilities: {} }));
    expect([failed.status, failed.headers['mcp-session-id'], json(failed).error]).toEqual([
      200,
      undefined,
      expect.objectContaining({ code: -32_602 }),
    ]);
  });

  it('serves tools/list as JSON and tools/call as a stream within the session', async () => {
    const { port } = await start();
    const session = await openSession(port);
    const listed = await send(port, inSession(session, 1, 'tools/list'));
    expect([listed.status, json(listed)]).toEqual([
      200,
      { id: 1, jsonrpc: '2.0', result: { tools: expect.any(Array) } },
    ]);
    const called = await send(
      port,
      inSession(session, 2, 'tools/call', { arguments: { value: 1 }, name: 'echo' }),
    );
    expect(called.headers['content-type']).toBe('text/event-stream');
    expect(called.text).toContain('"id":2');
  });

  it('answers a second initialize in the session with 200 and -32600, and keeps the session', async () => {
    const { port } = await start();
    const session = await openSession(port);
    const again = await send(port, {
      ...initialize(),
      headers: { 'MCP-Session-Id': session },
    });
    expect([again.status, again.headers['mcp-session-id'], json(again).error]).toEqual([
      200,
      undefined,
      expect.objectContaining({ code: -32_600 }),
    ]);
    await expect(statusOf(port, inSession(session, 1, 'ping'))).resolves.toBe(200);
  });

  it('answers an unknown session id with 404 and no body, ping and initialize included', async () => {
    const { port } = await start();
    for (const sent of [
      inSession('unknown', 1, 'ping'),
      inSession('unknown', 1, 'tools/list'),
      { ...initialize(), headers: { 'MCP-Session-Id': 'unknown' } },
      {
        body: { jsonrpc: '2.0', method: 'notifications/initialized' },
        headers: { 'MCP-Session-Id': 'unknown' },
      },
    ]) {
      const answer = await send(port, sent);
      expect([answer.status, answer.text]).toEqual([404, '']);
    }
  });

  it('answers a request without a session id with 400 and -32602, except initialize and ping', async () => {
    const { port } = await start();
    const listed = await send(port, inSession(undefined, 1, 'tools/list'));
    const pinged = await send(port, inSession(undefined, 2, 'ping'));
    expect([listed.status, json(listed)]).toEqual([
      400,
      {
        error: {
          code: -32_602,
          message:
            'The request carries no MCP-Session-Id. Send the session id the initialize response issued, or send "io.modelcontextprotocol/protocolVersion" and "io.modelcontextprotocol/clientCapabilities" in every request\'s params._meta, with MCP-Protocol-Version and Mcp-Method headers, and Mcp-Name for tools/call.',
        },
        id: 1,
        jsonrpc: '2.0',
      },
    ]);
    expect([pinged.status, json(pinged)]).toEqual([200, { id: 2, jsonrpc: '2.0', result: {} }]);
  });

  it("answers an MCP-Protocol-Version other than the session's with 400 and -32600", async () => {
    const { port } = await start();
    const session = await openSession(port, '2025-06-18');
    const answer = await send(port, {
      ...inSession(session, 1, 'tools/list'),
      headers: { 'MCP-Protocol-Version': '2025-11-25', 'MCP-Session-Id': session },
    });
    const matched = await send(port, {
      ...inSession(session, 2, 'tools/list'),
      headers: { 'MCP-Protocol-Version': '2025-06-18', 'MCP-Session-Id': session },
    });
    expect([answer.status, json(answer).id, json(answer).error]).toEqual([
      400,
      1,
      expect.objectContaining({ code: -32_600 }),
    ]);
    expect(matched.status).toBe(200);
  });

  it('answers a session request whose header names 2026-07-28 as any other session version mismatch', async () => {
    const { port } = await start();
    const session = await openSession(port);
    const answer = await send(port, {
      ...inSession(session, 1, 'ping'),
      headers: { 'MCP-Protocol-Version': '2026-07-28', 'MCP-Session-Id': session },
    });
    expect([answer.status, json(answer).id, json(answer).error]).toEqual([
      400,
      1,
      expect.objectContaining({ code: -32_600 }),
    ]);
  });

  it('answers a method not served in a session with 200 and -32601', async () => {
    const { port } = await start();
    const session = await openSession(port);
    const answer = await send(port, inSession(session, 1, 'resources/list'));
    expect([answer.status, json(answer).error]).toEqual([
      200,
      expect.objectContaining({ code: -32_601 }),
    ]);
  });

  it('ends a session on DELETE, which aborts its calls, and then answers its id with 404', async () => {
    const { port } = await start();
    const session = await openSession(port);
    const stream = eventStream(
      await open(
        port,
        inSession(session, 1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }),
      ),
    );
    await until(() => served?.events.includes('started one') === true);
    const deleted = await send(port, { headers: { 'MCP-Session-Id': session }, method: 'DELETE' });
    expect([deleted.status, deleted.text]).toEqual([204, '']);
    await stream.ended;
    expect(stream.events()).toEqual([]);
    expect(served?.events).toEqual(['started one', 'aborted one']);
    await expect(statusOf(port, inSession(session, 2, 'ping'))).resolves.toBe(404);
    const again = await send(port, { headers: { 'MCP-Session-Id': session }, method: 'DELETE' });
    const none = await send(port, { method: 'DELETE' });
    expect([again.status, none.status, none.text]).toEqual([404, 400, '']);
  });

  it('ends a session idle for sessionIdleMs, and a call in flight keeps it', async () => {
    const { port, release } = await start({ sessionIdleMs: 1000 });
    fakeTimers();
    const idle = await openSession(port);
    const busy = await openSession(port);
    const stream = eventStream(
      await open(
        port,
        inSession(busy, 1, 'tools/call', { arguments: { label: 'long' }, name: 'wait' }),
      ),
    );
    await until(() => served?.events.includes('started long') === true);
    vi.advanceTimersByTime(999);
    await expect(statusOf(port, inSession(idle, 2, 'ping'))).resolves.toBe(200);
    vi.advanceTimersByTime(1000);
    await expect(statusOf(port, inSession(idle, 3, 'ping'))).resolves.toBe(404);
    release('long');
    await stream.ended;
    vi.advanceTimersByTime(999);
    await expect(statusOf(port, inSession(busy, 4, 'ping'))).resolves.toBe(200);
    vi.advanceTimersByTime(1000);
    await expect(statusOf(port, inSession(busy, 5, 'ping'))).resolves.toBe(404);
  });

  it('restarts the idle clock at each notification', async () => {
    const { port } = await start({ sessionIdleMs: 1000 });
    fakeTimers();
    const session = await openSession(port);
    vi.advanceTimersByTime(900);
    const noted = await send(port, {
      body: { jsonrpc: '2.0', method: 'notifications/initialized' },
      headers: { 'MCP-Protocol-Version': 'wrong', 'MCP-Session-Id': session },
    });
    expect(noted.status).toBe(202);
    vi.advanceTimersByTime(900);
    await expect(statusOf(port, inSession(session, 1, 'ping'))).resolves.toBe(200);
  });
});

describe('cancellation and concurrency', () => {
  it('on 2026-07-28, a closed stream cancels its call', async () => {
    const { port } = await start();
    const response = await open(
      port,
      perRequest(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }),
    );
    await until(() => served?.events.includes('started one') === true);
    response.destroy();
    await until(() => served?.events.includes('aborted one') === true);
    expect(served?.events).toEqual(['started one', 'aborted one']);
  });

  it('on 2026-07-28, a closed stream ends a subscription', async () => {
    const { port, stop } = await start();
    const stream = eventStream(await open(port, perRequest('listen', 'subscriptions/listen')));
    await stream.next();
    stream.response.destroy();
    await stream.ended;
    await stop();
    served = undefined;
    // Shutdown finds no subscription left to tear down.
    expect(stream.events()).toHaveLength(1);
  });

  it('in a session, notifications/cancelled aborts the call it names, and its stream ends without a response', async () => {
    const { port } = await start();
    const session = await openSession(port);
    const stream = eventStream(
      await open(
        port,
        inSession(session, 1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }),
      ),
    );
    await until(() => served?.events.includes('started one') === true);
    const cancelled = await send(port, {
      body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
      headers: { 'MCP-Session-Id': session },
    });
    expect(cancelled.status).toBe(202);
    await stream.ended;
    expect(stream.events()).toEqual([]);
    expect(served?.events).toEqual(['started one', 'aborted one']);
  });

  it('in a session, a closed stream does not cancel: the call runs to its end', async () => {
    const { port, release } = await start();
    const session = await openSession(port);
    const response = await open(
      port,
      inSession(session, 1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }),
    );
    await until(() => served?.events.includes('started one') === true);
    response.destroy();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(served?.events).toEqual(['started one']);
    release('one');
    expect(served?.events).toEqual(['started one', 'released one']);
    // The session still serves, and the id is free again once the call settled.
    const again = await send(port, inSession(session, 1, 'tools/list'));
    expect([again.status, json(again).result]).toEqual([200, { tools: expect.any(Array) }]);
  });

  it('ignores notifications/cancelled without a session, and on 2026-07-28', async () => {
    const { port, release } = await start();
    const stream = eventStream(
      await open(port, perRequest(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' })),
    );
    await until(() => served?.events.includes('started one') === true);
    const bare = await send(port, {
      body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    });
    const perRequestNote = await send(port, {
      body: {
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { _meta: meta, requestId: 1 },
      },
    });
    expect([bare.status, perRequestNote.status]).toEqual([202, 202]);
    release('one');
    await expect(stream.next()).resolves.toMatchObject({ id: 1 });
    expect(served?.events).toEqual(['started one', 'released one']);
  });

  it("two clients' overlapping calls answer on their own streams", async () => {
    const { port, release } = await start();
    const session = await openSession(port);
    const first = eventStream(
      await open(port, perRequest(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' })),
    );
    const second = eventStream(
      await open(
        port,
        inSession(session, 1, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }),
      ),
    );
    await until(() => (served?.events.length ?? 0) === 2);
    release('two');
    release('one');
    const [one, two] = await Promise.all([first.next(), second.next()]);
    expect(one).toMatchObject({ id: 1, result: { content: [{ text: 'released one' }] } });
    expect(two).toMatchObject({ id: 1, result: { content: [{ text: 'released two' }] } });
  });
});

describe('shutdown', () => {
  it('aborts every call, answers none, tears down each subscription stream, closes every connection, and resolves once calls settle', async () => {
    const server = await start();
    const session = await openSession(server.port);
    const listen = eventStream(
      await open(server.port, perRequest('listen', 'subscriptions/listen')),
    );
    await listen.next();
    const call = eventStream(
      await open(
        server.port,
        perRequest(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }),
      ),
    );
    const sessionCall = eventStream(
      await open(
        server.port,
        inSession(session, 2, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }),
      ),
    );
    await until(() => server.events.length === 2);
    await server.stop();
    served = undefined;
    await Promise.all([listen.ended, call.ended, sessionCall.ended]);
    expect(listen.events().slice(1)).toEqual([
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'listen' } },
      {
        id: 'listen',
        jsonrpc: '2.0',
        result: {
          _meta: {
            'io.modelcontextprotocol/serverInfo': serverInfo,
            'io.modelcontextprotocol/subscriptionId': 'listen',
          },
          resultType: 'complete',
        },
      },
    ]);
    expect([call.events(), sessionCall.events()]).toEqual([[], []]);
    expect(server.events.toSorted()).toEqual([
      'aborted one',
      'aborted two',
      'started one',
      'started two',
    ]);
    expect(server.sockets.every((socket) => socket.destroyed)).toBe(true);
  });
});

describe('HTTP guard regressions', () => {
  it('refuses an empty Origin', async () => {
    const { port } = await start();
    const answer = await send(port, {
      ...perRequest(1, 'tools/list'),
      headers: { ...mirrored('tools/list'), Origin: '' },
    });
    expect(answer.status).toBe(403);
  });

  it('answers a declared oversized length before any body byte arrives', async () => {
    const { port } = await start({ maxBodyBytes: 64 });
    const client = raw(port);
    try {
      await client.connected;
      client.socket.write(
        'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 65\r\n\r\n',
      );
      await until(() => client.text().includes('413'));
      expect(client.text()).toMatch(/^HTTP\/1\.1 413 /u);
    } finally {
      client.socket.destroy();
    }
  });

  it('counts many separately received chunks toward the body limit', async () => {
    const { port, sockets } = await start({ maxBodyBytes: 64 });
    const client = raw(port);
    const concatenation = vi.spyOn(Buffer, 'concat');
    try {
      await client.connected;
      client.socket.write(
        'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n',
      );
      for (let index = 0; index < 10; index += 1) {
        client.socket.write('10\r\nxxxxxxxxxxxxxxxx\r\n');
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      client.socket.end('0\r\n\r\n');
      await until(() => client.text().includes('413'));
      expect(client.text()).toMatch(/^HTTP\/1\.1 413 /u);
      await until(() => sockets.every((socket) => socket.destroyed));
      expect(concatenation).not.toHaveBeenCalled();
    } finally {
      concatenation.mockRestore();
      client.socket.destroy();
    }
  });

  it('does not arm receipt deadlines over a pipelined response in flight', async () => {
    const { port, release } = await start();
    fakeTimers();
    const client = raw(port);
    try {
      await client.connected;
      const packets = ['one', 'two'].map((label, index) => {
        const sent = perRequest(index, 'tools/call', { arguments: { label }, name: 'wait' });
        const body = JSON.stringify(sent.body);
        return `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\n${Object.entries(
          sent.headers ?? {},
        )
          .map(([key, value]) => `${key}: ${value}\r\n`)
          .join('')}\r\n${body}`;
      });
      client.socket.write(packets.join(''));
      await until(() => served?.events.length === 2);
      vi.advanceTimersByTime(3000);
      release('one');
      await until(() => client.text().includes('released one'));
      vi.advanceTimersByTime(300_000);
      expect(served?.events).toEqual(['started one', 'started two', 'released one']);
      expect(client.text()).not.toContain('408');
      release('two');
      await until(() => client.text().includes('released two'));
    } finally {
      client.socket.destroy();
    }
  });

  it('a session cannot cancel another session using the same request id', async () => {
    const { port, release } = await start();
    const one = await openSession(port);
    const two = await openSession(port);
    const first = eventStream(
      await open(
        port,
        inSession(one, 1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }),
      ),
    );
    const second = eventStream(
      await open(
        port,
        inSession(two, 1, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }),
      ),
    );
    await until(() => served?.events.length === 2);
    await send(port, {
      body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
      headers: { 'MCP-Session-Id': one },
    });
    await first.ended;
    expect(served?.events).toEqual(['started one', 'started two', 'aborted one']);
    release('two');
    await expect(second.next()).resolves.toMatchObject({ id: 1 });
  });

  it('in-session requests restart the idle clock', async () => {
    const { port } = await start({ sessionIdleMs: 1000 });
    fakeTimers();
    const session = await openSession(port);
    vi.advanceTimersByTime(900);
    await expect(statusOf(port, inSession(session, 1, 'ping'))).resolves.toBe(200);
    vi.advanceTimersByTime(900);
    await expect(statusOf(port, inSession(session, 2, 'ping'))).resolves.toBe(200);
  });
});

test('shutdown awaits a deleted session whose aborted call is still settling', async () => {
  const server = await start();
  const session = await openSession(server.port);
  const stream = eventStream(
    await open(
      server.port,
      inSession(session, 1, 'tools/call', { arguments: { label: 'settling' }, name: 'wait' }),
    ),
  );
  await until(() => server.events.includes('started settling'));
  let closed = false;
  let stopping = Promise.resolve();
  try {
    await send(server.port, { headers: { 'MCP-Session-Id': session }, method: 'DELETE' });
    stopping = server.stop().then(() => {
      closed = true;
      return undefined;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(closed).toBe(false);
  } finally {
    server.release('settling');
    await stopping;
    await stream.ended;
  }
});

test('every early answer explicitly closes a keep-alive connection', async () => {
  const { port } = await start({
    authorize: (headers) => {
      if (headers.get('x-status') === '500') {
        throw new Error('broken hook');
      }
      return headers.get('x-status') !== '401';
    },
    maxBodyBytes: 64,
  });
  for (const [code, extra, path, method, type] of [
    [401, 'X-Status: 401\r\n', '/mcp', 'POST', 'application/json'],
    [403, 'Origin: \r\n', '/mcp', 'POST', 'application/json'],
    [404, '', '/other', 'POST', 'application/json'],
    [405, '', '/mcp', 'GET', 'application/json'],
    [413, '', '/mcp', 'POST', 'application/json'],
    [415, '', '/mcp', 'POST', 'text/plain'],
    [500, 'X-Status: 500\r\n', '/mcp', 'POST', 'application/json'],
  ]) {
    const client = raw(port);
    try {
      await client.connected;
      client.socket.write(
        `${String(method)} ${String(path)} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nContent-Type: ${String(type)}\r\nContent-Length: 100\r\n${String(extra)}\r\n`,
      );
      await until(() => client.text().includes('\r\n\r\n'));
      expect(client.text()).toContain(`HTTP/1.1 ${String(code)} `);
      expect(client.text().toLowerCase()).toContain('connection: close\r\n');
    } finally {
      client.socket.destroy();
    }
  }
});

test('re-arms receipt deadlines after a keep-alive response', async () => {
  const { port } = await start();
  fakeTimers();
  const client = raw(port);
  try {
    await client.connected;
    client.socket.write(
      'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 45\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"ping"}     ',
    );
    await until(() => client.text().includes('"result"'));
    await until(() => served?.finishes() === 1);
    client.socket.write('POST /mcp HTTP/1.1\r\n');
    vi.advanceTimersByTime(60_000);
    await client.ended;
    expect(client.text()).toContain('HTTP/1.1 408');
  } finally {
    client.socket.destroy();
  }
});

test('shutdown closes even sockets with no request yet', async () => {
  const server = await start();
  const client = raw(server.port);
  try {
    await client.connected;
    await until(() => server.sockets.length === 1);
    await server.stop();
    await client.ended;
    await until(() => server.sockets.every((socket) => socket.destroyed));
    expect(server.sockets.every((socket) => socket.destroyed)).toBe(true);
  } finally {
    client.socket.destroy();
  }
});

test('an open stream outlives the socket idle timeout', async () => {
  const { port, release } = await start({}, 50);
  const stream = eventStream(
    await open(port, perRequest(1, 'tools/call', { arguments: { label: 'idle' }, name: 'wait' })),
  );
  await until(() => served?.events.includes('started idle') === true);
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  expect(stream.response.closed).toBe(false);
  release('idle');
  await expect(stream.next()).resolves.toMatchObject({ id: 1 });
});

test('authorization resolving after shutdown never dispatches a call', async () => {
  const authorization: { allow?: () => void } = {};
  const server = await start({
    authorize: () =>
      new Promise<boolean>((resolve) => {
        authorization.allow = () => resolve(true);
      }),
  });
  const answer = send(
    server.port,
    perRequest(1, 'tools/call', {
      arguments: { label: 'late' },
      name: 'wait',
    }),
  ).catch(() => undefined);
  await until(() => authorization.allow !== undefined);
  await server.stop();
  authorization.allow?.();
  await answer;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(server.events).toEqual([]);
});

test.each([{ result: {} }, { error: { code: -32_600, message: 'bad' } }])(
  'HTTP refuses a malformed response envelope %j',
  async (body) => {
    const { port } = await start();
    const answer = await send(port, { body });
    expect(answer.status).toBe(400);
    expect(json(answer)).toMatchObject({ error: { code: -32_600 } });
  },
);

test('a pinned HTTP version requires per-request metadata even for ping', async () => {
  const { port } = await start();
  const ping = inSession(undefined, 1, 'ping');
  const answer = await send(port, { ...ping, headers: mirrored('ping') });
  expect(answer.status).toBe(400);
  expect(json(answer)).toMatchObject({ error: { code: -32_602 } });
  await expect(statusOf(port, ping)).resolves.toBe(200);
});

test('per-request initialize is not a served method', async () => {
  const { port } = await start();
  const answer = await send(port, perRequest(1, 'initialize'));
  expect(answer.status).toBe(404);
  expect(json(answer)).toMatchObject({ error: { code: -32_601 } });
});

test('a long session idle interval expires at its deadline without timer overflow', async () => {
  const { port } = await start({ sessionIdleMs: 2_147_484_647 });
  fakeTimers();
  const session = await openSession(port);
  vi.advanceTimersByTime(1000);
  await expect(statusOf(port, inSession(session, 1, 'ping'))).resolves.toBe(200);
  vi.advanceTimersByTime(2_147_483_647);
  await expect(statusOf(port, inSession(session, 2, 'ping'))).resolves.toBe(200);
  vi.advanceTimersByTime(2_147_484_647);
  await expect(statusOf(port, inSession(session, 3, 'ping'))).resolves.toBe(404);
});

test('a call settling after session deletion leaves its idle timer stopped', async () => {
  const server = await start();
  fakeTimers();
  const session = await openSession(server.port);
  await open(
    server.port,
    inSession(session, 1, 'tools/call', {
      arguments: { label: 'settling' },
      name: 'wait',
    }),
  );
  await until(() => server.events.includes('started settling'));
  try {
    await send(server.port, { headers: { 'MCP-Session-Id': session }, method: 'DELETE' });
    const timers = vi.getTimerCount();
    server.release('settling');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vi.getTimerCount()).toBe(timers);
  } finally {
    server.release('settling');
  }
});
