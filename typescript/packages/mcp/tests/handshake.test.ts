// Acceptance plan: see packages/mcp/tests/framing.test.ts.
import { describe, expect, it } from 'vite-plus/test';

import { handshakeRequest, initialize, open, request, serverInfo } from './session.js';

/** The identity an initialize result carries on 2025-06-18, whose implementation has no description. */
const implementation = { name: serverInfo.name, version: serverInfo.version };

const tools = [
  {
    description: 'Answers the call it received.',
    inputSchema: { properties: { text: { type: 'string' } }, type: 'object' },
    name: 'echo',
  },
  { inputSchema: { type: 'object' }, name: 'wait' },
];

describe('initialize', () => {
  it('answers 2025-06-18 with that version, the tools capability, and the server identity', async () => {
    const session = open();
    session.send(initialize(0, '2025-06-18'));
    await expect(session.next()).resolves.toEqual({
      id: 0,
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        protocolVersion: '2025-06-18',
        serverInfo: implementation,
      },
    });
    await session.close();
  });

  it("answers 2025-11-25 with that version and the identity's description", async () => {
    const session = open();
    session.send(initialize(0, '2025-11-25'));
    await expect(session.next()).resolves.toEqual({
      id: 0,
      jsonrpc: '2.0',
      result: { capabilities: { tools: {} }, protocolVersion: '2025-11-25', serverInfo },
    });
    await session.close();
  });

  it.each(['2024-11-05', '2025-03-26', '2026-07-28', '1.0.0'])(
    'answers a request for %s with the latest initialize-era version it serves',
    async (version) => {
      const session = open();
      session.send(initialize(0, version));
      await expect(session.next()).resolves.toMatchObject({
        id: 0,
        result: { protocolVersion: '2025-11-25' },
      });
      await session.close();
    },
  );

  it.each([
    ['no params', undefined],
    ['no protocol version', { capabilities: {} }],
    ['a protocol version that is not a string', { capabilities: {}, protocolVersion: 3 }],
    ['no capabilities', { protocolVersion: '2025-06-18' }],
  ])('answers a handshake with %s with -32602', async (_case, params) => {
    const session = open();
    session.send(
      params === undefined ? handshakeRequest(0, 'initialize') : initialize(0, '', params),
    );
    await expect(session.next()).resolves.toEqual({
      error: { code: -32_602, message: expect.stringContaining('initialize') },
      id: 0,
      jsonrpc: '2.0',
    });
    // A malformed handshake initializes nothing, so the connection still needs one, and takes it.
    session.send(handshakeRequest(1, 'tools/list'));
    await expect(session.next()).resolves.toMatchObject({ error: { code: -32_602 }, id: 1 });
    session.send(initialize(2, '2025-06-18'));
    await expect(session.next()).resolves.toMatchObject({
      id: 2,
      result: { protocolVersion: '2025-06-18' },
    });
    await session.close();
  });

  it('answers a second initialize with -32600 and keeps the version it negotiated', async () => {
    const session = open();
    session.send(initialize(0, '2025-06-18'));
    await session.next();
    session.send(initialize(1, '2025-11-25'));
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_600,
        message:
          'The connection is already initialized on MCP 2025-06-18. Send initialize once, as the first request.',
      },
      id: 1,
      jsonrpc: '2.0',
    });
    session.send(
      handshakeRequest(2, 'tools/call', { arguments: { value: [1] }, name: 'structured' }),
    );
    // 2025-06-18 holds structured content as an object alone, so an array is left to the text.
    await expect(session.next()).resolves.not.toHaveProperty('result.structuredContent');
    await session.close();
  });
});

describe('an initialized connection', () => {
  it('serves the handshake, ping, tools/list, and tools/call in the shape of its revision', async () => {
    const session = open();
    session.send(initialize(0, '2025-06-18'));
    await session.next();
    session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    session.send(handshakeRequest(1, 'ping'));
    await expect(session.next()).resolves.toEqual({ id: 1, jsonrpc: '2.0', result: {} });
    session.send(handshakeRequest(2, 'tools/list'));
    await expect(session.next()).resolves.toEqual({ id: 2, jsonrpc: '2.0', result: { tools } });
    session.send(handshakeRequest(3, 'tools/call', { arguments: { text: 'hi' }, name: 'echo' }));
    await expect(session.next()).resolves.toEqual({
      id: 3,
      jsonrpc: '2.0',
      result: {
        content: [{ text: 'first line\nsecond line', type: 'text' }],
        isError: false,
        structuredContent: { arguments: { text: 'hi' }, name: 'echo' },
      },
    });
    await expect(session.close()).resolves.toMatchObject({ status: 0 });
  });

  it.each([
    ['an array', [1, 2]],
    ['a string', 'text'],
    ['a number', 3],
    ['null', null],
  ])(
    'leaves out structured content that is %s, which the text already carries',
    async (_case, value) => {
      const session = open();
      session.send(initialize(0, '2025-11-25'));
      await session.next();
      session.send(handshakeRequest(1, 'tools/call', { arguments: { value }, name: 'structured' }));
      await expect(session.next()).resolves.toEqual({
        id: 1,
        jsonrpc: '2.0',
        result: { content: [{ text: JSON.stringify(value), type: 'text' }], isError: false },
      });
      await session.close();
    },
  );

  it("sends progress on the call's token and drops the answer of a cancelled call", async () => {
    const session = open();
    session.send(initialize(0, '2025-06-18'));
    await session.next();
    session.send(
      handshakeRequest(1, 'tools/call', {
        _meta: { progressToken: 'p' },
        arguments: { updates: [{ message: 'one', progress: 1 }] },
        name: 'progress',
      }),
    );
    await expect(session.next()).resolves.toEqual({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { message: 'one', progress: 1, progressToken: 'p' },
    });
    await expect(session.next()).resolves.toMatchObject({ id: 1, result: { isError: false } });
    session.send(handshakeRequest(2, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }));
    await session.observed('started two');
    session.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
    await session.observed('aborted two');
    session.send(handshakeRequest(3, 'ping'));
    await expect(session.next()).resolves.toMatchObject({ id: 3 });
    const { messages } = await session.close();
    expect(messages.map((message) => message.id)).toEqual([0, undefined, 1, 3]);
  });

  it.each(['server/discover', 'subscriptions/listen', 'resources/list'])(
    'answers %s without per-request _meta with -32601',
    async (method) => {
      const session = open();
      session.send(initialize(0, '2025-11-25'));
      await session.next();
      session.send(handshakeRequest(1, method));
      await expect(session.next()).resolves.toEqual({
        error: {
          code: -32_601,
          message:
            'The method is not one this server serves on an initialized connection. Call ping, tools/list, or tools/call.',
        },
        id: 1,
        jsonrpc: '2.0',
      });
      await session.close();
    },
  );

  it('checks a request whose _meta names a protocol version on 2026-07-28, even after the handshake', async () => {
    const session = open();
    session.send(initialize(0, '2025-06-18'));
    await session.next();
    session.send(
      handshakeRequest(1, 'tools/list', {
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
      }),
    );
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_602,
        message: expect.stringContaining(
          'params._meta carries no "io.modelcontextprotocol/clientCapabilities"',
        ),
      },
      id: 1,
      jsonrpc: '2.0',
    });
    await session.close();
  });

  it('serves a request carrying per-request _meta on 2026-07-28 beside the handshake', async () => {
    const session = open();
    session.send(initialize(0, '2025-06-18'));
    await session.next();
    session.send(request(1, 'tools/call', { arguments: { value: [1] }, name: 'structured' }));
    await expect(session.next()).resolves.toMatchObject({
      id: 1,
      result: { resultType: 'complete', structuredContent: [1] },
    });
    session.send(handshakeRequest(2, 'tools/list'));
    await expect(session.next()).resolves.toEqual({ id: 2, jsonrpc: '2.0', result: { tools } });
    await session.close();
  });
});

describe('before initialize', () => {
  it('answers ping', async () => {
    const session = open();
    session.send(handshakeRequest(1, 'ping'));
    await expect(session.next()).resolves.toEqual({ id: 1, jsonrpc: '2.0', result: {} });
    await session.close();
  });

  it('answers a tool request without per-request _meta with -32602 naming both ways in', async () => {
    const session = open();
    session.send(handshakeRequest(1, 'tools/list'));
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_602,
        message:
          'The request\'s params._meta carries no "io.modelcontextprotocol/protocolVersion". Send "io.modelcontextprotocol/protocolVersion" and "io.modelcontextprotocol/clientCapabilities" with every request, or open the connection with initialize.',
      },
      id: 1,
      jsonrpc: '2.0',
    });
    await session.close();
  });
});

describe('a connection on 2026-07-28', () => {
  it('keeps structured content of any JSON value', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: { value: 'text' }, name: 'structured' }));
    await expect(session.next()).resolves.toMatchObject({
      id: 1,
      result: { resultType: 'complete', structuredContent: 'text' },
    });
    await session.close();
  });
});
