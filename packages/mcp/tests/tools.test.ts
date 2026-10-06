import { describe, expect, it } from 'vite-plus/test';

import { open, request, serverInfo } from './session.js';

const tools = [
  {
    description: 'Answers the call it received.',
    inputSchema: { properties: { text: { type: 'string' } }, type: 'object' },
    name: 'echo',
  },
  { inputSchema: { type: 'object' }, name: 'wait' },
];

describe('tools/list', () => {
  it("answers the handler's tools in one page that no client caches", async () => {
    const session = open();
    session.send(request(1, 'tools/list'));
    await expect(session.next()).resolves.toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: {
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
        cacheScope: 'private',
        resultType: 'complete',
        tools,
        ttlMs: 0,
      },
    });
    await session.close();
  });

  it('answers a cursor with -32602', async () => {
    const session = open();
    session.send(request(1, 'tools/list', { cursor: 'page-2' }));
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_602,
        message: 'The cursor is not one this server issued. Call tools/list without a cursor.',
      },
      id: 1,
      jsonrpc: '2.0',
    });
    await session.close();
  });

  it('answers a listing that throws with -32603 and keeps serving', async () => {
    const session = open('list-throws');
    session.send(request(1, 'tools/list'));
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_603,
        message:
          "The server failed while handling tools/list. The failure is a defect in the server; report it to the server's author.",
      },
      id: 1,
      jsonrpc: '2.0',
    });
    session.send(request(2, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({
      id: 2,
      result: { resultType: 'complete' },
    });
    await session.close();
  });
});

describe('tools/call', () => {
  it("reaches the handler with the request's name and arguments and stamps its result", async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: { text: 'hello' }, name: 'echo' }));
    await expect(session.next()).resolves.toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: {
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
        content: [{ text: 'first line\nsecond line', type: 'text' }],
        isError: false,
        resultType: 'complete',
        structuredContent: { arguments: { text: 'hello' }, name: 'echo' },
      },
    });
    await session.close();
  });

  it('hands the handler arguments as the client sent them, absent included', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: [1, 2], name: 'echo' }));
    session.send(request(2, 'tools/call', { name: 'echo' }));
    await expect(session.next()).resolves.toMatchObject({
      result: { structuredContent: { arguments: [1, 2], name: 'echo' } },
    });
    await expect(session.next()).resolves.toMatchObject({
      result: { structuredContent: { name: 'echo' } },
    });
    await session.close();
  });

  it('answers a call that names no tool with -32602', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: {} }));
    await expect(session.next()).resolves.toEqual({
      error: { code: -32_602, message: expect.stringContaining('params.name') },
      id: 1,
      jsonrpc: '2.0',
    });
    await session.close();
  });

  it("answers a handler's protocol error with its code, message, and data", async () => {
    const session = open();
    session.send(request(1, 'tools/call', { name: 'refuse' }));
    await expect(session.next()).resolves.toEqual({
      error: { code: -32_602, data: { reason: 'fixture' }, message: 'Refused.' },
      id: 1,
      jsonrpc: '2.0',
    });
    await session.close();
  });

  it('answers a handler that throws with -32603 and keeps serving', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { name: 'throw' }));
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_603,
        message:
          "The server failed while handling tools/call. The failure is a defect in the server; report it to the server's author.",
      },
      id: 1,
      jsonrpc: '2.0',
    });
    session.send(request(2, 'tools/call', { name: 'echo' }));
    await expect(session.next()).resolves.toMatchObject({ id: 2, result: { isError: false } });
    await session.close();
  });
});
