import { describe, expect, it } from 'vite-plus/test';

import { open, request, serverInfo } from './session.js';

const acknowledged = (id: number | string) => ({
  jsonrpc: '2.0',
  method: 'notifications/subscriptions/acknowledged',
  params: { _meta: { 'io.modelcontextprotocol/subscriptionId': id }, notifications: {} },
});

describe('subscriptions/listen', () => {
  it("is acknowledged first, with an empty filter and the subscription's id", async () => {
    const session = open();
    session.send(
      request('listen', 'subscriptions/listen', { notifications: { toolsListChanged: true } }),
    );
    await expect(session.next()).resolves.toEqual(acknowledged('listen'));
    await session.close();
  });

  it('checks its request like any other', async () => {
    const session = open();
    session.send({ id: 1, jsonrpc: '2.0', method: 'subscriptions/listen', params: {} });
    await expect(session.next()).resolves.toMatchObject({ error: { code: -32_602 }, id: 1 });
    await session.close();
  });

  it('ends with no response when the client cancels it', async () => {
    const session = open();
    session.send(request(1, 'subscriptions/listen'));
    await expect(session.next()).resolves.toEqual(acknowledged(1));
    session.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    session.send(request(2, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    const { messages, status } = await session.close();
    expect(messages).toHaveLength(2);
    expect(status).toBe(0);
  });
});

describe('shutdown when stdin ends', () => {
  it('aborts calls in flight, waits for each to settle, then closes each subscription with its id', async () => {
    const session = open();
    session.send(request(1, 'subscriptions/listen'));
    await expect(session.next()).resolves.toEqual(acknowledged(1));
    session.send(request(2, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }));
    await session.observed('started two');
    const { messages, status, stderr } = await session.close();
    expect(stderr).toBe('started two\naborted two\nresolved\n');
    expect(messages.slice(1)).toEqual([
      expect.objectContaining({ id: 2, result: expect.objectContaining({ isError: true }) }),
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
      {
        id: 1,
        jsonrpc: '2.0',
        result: {
          _meta: {
            'io.modelcontextprotocol/serverInfo': serverInfo,
            'io.modelcontextprotocol/subscriptionId': 1,
          },
          resultType: 'complete',
        },
      },
    ]);
    expect(status).toBe(0);
  });

  it('resolves at once with nothing in flight', async () => {
    const session = open();
    const { messages, status, stderr } = await session.close();
    expect({ messages, status, stderr }).toEqual({ messages: [], status: 0, stderr: 'resolved\n' });
  });

  it('serves a last message that ends without a line feed', async () => {
    const session = open();
    session.send(JSON.stringify(request(1, 'server/discover')));
    const { messages } = await session.close();
    expect(messages).toEqual([expect.objectContaining({ id: 1 })]);
  });
});

describe("the run's signal", () => {
  it('aborts every call and ends the run with nothing more written', async () => {
    const session = open();
    session.send(request(1, 'subscriptions/listen'));
    await expect(session.next()).resolves.toEqual(acknowledged(1));
    session.send(request(2, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }));
    await session.observed('started two');
    session.send(request(3, 'tools/call', { name: 'stop' }));
    // The run ends with stdin still open: aborting stops reading.
    const { messages, status, stderr } = await session.finish();
    expect(stderr).toBe('started two\naborted two\nresolved\n');
    expect(messages).toHaveLength(1);
    expect(status).toBe(0);
  });
});
