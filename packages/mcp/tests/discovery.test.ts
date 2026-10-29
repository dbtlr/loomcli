// Acceptance plan: see packages/mcp/tests/framing.test.ts.
import { describe, expect, it } from 'vite-plus/test';

import { open, request, serverInfo } from './session.js';

describe('server/discover', () => {
  it('answers every revision it serves, the tools capability, no caching, and the server identity', async () => {
    const session = open();
    session.send(request(1, 'server/discover'));
    await expect(session.next()).resolves.toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: {
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
        cacheScope: 'private',
        capabilities: { tools: {} },
        resultType: 'complete',
        supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18'],
        ttlMs: 0,
      },
    });
    await expect(session.close()).resolves.toMatchObject({ status: 0 });
  });
});

describe('per-request checks', () => {
  it.each([
    ['no params', { id: 1, jsonrpc: '2.0', method: 'tools/list' }],
    ['no _meta', { id: 1, jsonrpc: '2.0', method: 'tools/list', params: {} }],
    [
      'no protocol version',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/clientCapabilities': {} } },
      },
    ],
    [
      'no client capabilities',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      },
    ],
  ])('answers a request with %s with -32602', async (_case, message) => {
    const session = open();
    session.send(message);
    await expect(session.next()).resolves.toEqual({
      error: { code: -32_602, message: expect.stringContaining('params._meta') },
      id: 1,
      jsonrpc: '2.0',
    });
    await session.close();
  });

  it('answers a request for another version with -32022 naming every version it serves', async () => {
    const session = open();
    session.send({
      id: 'a',
      jsonrpc: '2.0',
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/protocolVersion': '2025-11-25',
        },
      },
    });
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_022,
        data: { requested: '2025-11-25', supported: ['2026-07-28', '2025-11-25', '2025-06-18'] },
        message:
          "Unsupported protocol version. This server speaks MCP 2026-07-28 per request; send that version in every request's params._meta, or open the connection with initialize for MCP 2025-11-25 or 2025-06-18.",
      },
      id: 'a',
      jsonrpc: '2.0',
    });
    await session.close();
  });

  it('relies on no earlier request', async () => {
    const session = open();
    session.send(request(1, 'tools/list'));
    await expect(session.next()).resolves.toMatchObject({
      id: 1,
      result: { resultType: 'complete' },
    });
    await session.close();
  });
});

describe('methods the server does not serve', () => {
  it.each(['ping', 'resources/list', 'notifications/initialized'])(
    'answers %s with -32601',
    async (method) => {
      const session = open();
      session.send(request(1, method));
      await expect(session.next()).resolves.toEqual({
        error: {
          code: -32_601,
          message:
            'The method is not one this server serves. This server speaks MCP 2026-07-28; call server/discover, tools/list, tools/call, or subscriptions/listen.',
        },
        id: 1,
        jsonrpc: '2.0',
      });
      await session.close();
    },
  );

  it('answers an unserved method with -32601 before the per-request checks', async () => {
    const session = open();
    session.send({ id: 1, jsonrpc: '2.0', method: 'resources/list' });
    await expect(session.next()).resolves.toMatchObject({ error: { code: -32_601 }, id: 1 });
    await session.close();
  });

  it('ignores a notification other than a cancellation', async () => {
    const session = open();
    session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    session.send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } });
    session.send(request(1, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 1 });
    const { messages } = await session.close();
    expect(messages).toHaveLength(1);
  });
});
