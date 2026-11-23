/*
 * Acceptance plan for the MCP protocol package (docs/plugins/mcp.md).
 *
 * The protocol package is proven when its own conformance tests, which import nothing of Loom,
 * produce these results under Node and Bun:
 *
 * - The constants. The package exports the per-request revision, `2026-07-28`, and the
 *   initialize-era revisions, `2025-11-25` and `2025-06-18`, and every version check and answer
 *   reads them.
 * - Framing. A message split across two reads parses once, two messages in one read parse in order,
 *   a blank line is ignored, a line that is not JSON answers `-32700`, a batch and a JSON value
 *   that is not a request answer `-32600`, and every line the server writes parses as one message
 *   and holds no raw line break.
 * - Discovery and versions. `server/discover` answers the fields above with `ttlMs` and
 *   `cacheScope` and lists all three revisions. Before `initialize`, a request without `_meta`, or
 *   missing either required key, answers `-32602`, a per-request `2025-11-25` answers `-32022`
 *   listing all three revisions and the requested version, and a per-request `ping` and an unknown
 *   method answer `-32601`.
 * - The handshake. `initialize` answers the initialize-era version it asks for, or `2025-11-25`
 *   for any other, with the tools capability and the identity, without its description on
 *   `2025-06-18`. A malformed one answers `-32602` and a second one `-32600`. An initialized
 *   connection answers `ping`, which also answers before `initialize`, `tools/list`, and
 *   `tools/call` without `resultType`, the identity in `_meta`, `ttlMs`, or `cacheScope`, leaves
 *   out structured content that is not an object, sends progress and honours cancellation, answers
 *   any other method `-32601`, and still serves a request carrying per-request `_meta` on
 *   `2026-07-28`.
 * - Tools. `tools/list` answers with `resultType`, `ttlMs`, `cacheScope`, and no `nextCursor`, a
 *   cursor answers `-32602`, and `tools/call` reaches the handler it was given with the request's
 *   name and arguments.
 * - Request ids. A request reusing the id of a call or a subscription in flight answers `-32600`
 *   naming the id, the first call runs on untouched, and the id serves again once its request
 *   settles or is cancelled.
 * - Cancellation. A cancelled request's handler sees its signal abort and no response is written,
 *   and a cancellation for an unknown or settled id changes nothing.
 * - Subscriptions and shutdown. `subscriptions/listen` is acknowledged first by
 *   `notifications/subscriptions/acknowledged` with an empty filter and the subscription's id in
 *   `_meta`, a client's cancellation ends it with no response, and closing stdin aborts calls in
 *   flight, answers none of them, waits for each to settle, sends `notifications/cancelled` naming
 *   the subscription, ends it with its closing result carrying its id in `_meta`, and resolves. A
 *   client that stops reading before stdin ends leaves the run to resolve and the process to exit
 *   0.
 * - The run's signal. A signal already aborted resolves the run with nothing read or written, and a
 *   signal that aborts while a call and a subscription are open aborts the call, writes nothing
 *   more, and resolves with stdin still open, as it does after stdin has ended.
 * - Progress. A call whose `_meta` carries a progress token, a string and a number each, receives a
 *   progress function, and each call of it writes one `notifications/progress` with the token and
 *   the given values, in call order. A `total` or `message` left out is absent from the params, and
 *   nothing is written after the call's response, after its cancellation, or after shutdown. A call
 *   without a token receives no function.
 */

import { setTimeout as after } from 'node:timers/promises';

import { describe, expect, it } from 'vite-plus/test';

import { open, request } from './session.js';

/** An error response as the server writes it, with the code the case names. */
function error(id: number | string | null, code: number) {
  return {
    error: expect.objectContaining({ code, message: expect.any(String) }),
    id,
    jsonrpc: '2.0',
  };
}

describe('stdio framing', () => {
  it('parses a message split across two reads once', async () => {
    const session = open();
    const line = `${JSON.stringify(request(1, 'tools/list'))}\n`;
    session.send(line.slice(0, 20));
    await after(50);
    session.send(line.slice(20));
    await expect(session.next()).resolves.toMatchObject({
      id: 1,
      result: { resultType: 'complete' },
    });
    const { messages } = await session.close();
    expect(messages).toHaveLength(1);
  });

  it('parses two messages in one read in order', async () => {
    const session = open();
    session.send(
      `${JSON.stringify(request(1, 'server/discover'))}\n${JSON.stringify(request(2, 'tools/list'))}\n`,
    );
    await expect(session.next()).resolves.toMatchObject({ id: 1 });
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    await session.close();
  });

  it('answers a line that is not JSON with -32700', async () => {
    const session = open();
    session.send('{"jsonrpc": "2.0", \n');
    await expect(session.next()).resolves.toEqual(error(null, -32_700));
    await session.close();
  });

  it('ignores a blank line', async () => {
    const session = open();
    session.send('\n');
    session.send(' \t\r\n');
    session.send(request(1, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 1 });
    const { messages } = await session.close();
    expect(messages).toHaveLength(1);
  });

  it('answers a batch with -32600', async () => {
    const session = open();
    session.send([request(1, 'server/discover'), request(2, 'tools/list')]);
    await expect(session.next()).resolves.toEqual(error(null, -32_600));
    const { messages } = await session.close();
    expect(messages).toHaveLength(1);
  });

  it('answers a JSON value that is not a request or notification with -32600', async () => {
    const session = open();
    session.send(42);
    session.send({ id: 7, jsonrpc: '2.0' });
    session.send({ id: 8, method: 'tools/list' });
    await expect(session.next()).resolves.toEqual(error(null, -32_600));
    await expect(session.next()).resolves.toEqual(error(7, -32_600));
    await expect(session.next()).resolves.toEqual(error(8, -32_600));
    await session.close();
  });

  it('ignores a response from the client', async () => {
    const session = open();
    session.send({ id: 1, jsonrpc: '2.0', result: {} });
    session.send({ error: { code: -32_603, message: 'Failed.' }, id: 2, jsonrpc: '2.0' });
    session.send(request(3, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 3 });
    const { messages } = await session.close();
    expect(messages).toHaveLength(1);
  });

  it('writes each message as one line of JSON with no raw line break', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: { text: 'a\nb' }, name: 'echo' }));
    session.send(request(2, 'tools/list'));
    session.send('not json\n');
    await session.next();
    await session.next();
    await session.next();
    const { lines, messages } = await session.close();
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.stringify(JSON.parse(line)))).toEqual(lines);
    expect(messages.find((message) => message.id === 1)).toMatchObject({
      result: { content: [{ text: 'first line\nsecond line', type: 'text' }] },
    });
  });
});
