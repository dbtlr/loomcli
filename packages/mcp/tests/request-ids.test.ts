import { describe, expect, it } from 'vite-plus/test';

import { open, request } from './session.js';

describe('a request id in use', () => {
  it('answers a request that reuses the id of a call in flight with -32600, and leaves the call running', async () => {
    const session = open();
    session.send(request(7, 'tools/call', { arguments: { label: 'first' }, name: 'wait' }));
    await session.observed('started first');
    session.send(request(7, 'tools/call', { name: 'echo' }));
    await expect(session.next()).resolves.toEqual({
      error: {
        code: -32_600,
        message:
          'The request id 7 is in use by a request still in flight. Send each request with an id no request in flight holds.',
      },
      id: 7,
      jsonrpc: '2.0',
    });
    session.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } });
    await session.observed('aborted first');
    const { messages, status, stderr } = await session.close();
    expect(stderr).toBe('started first\naborted first\nresolved\n');
    expect(messages).toHaveLength(1);
    expect(status).toBe(0);
  });

  it('answers a request that reuses the id of an open subscription with -32600', async () => {
    const session = open();
    session.send(request('listen', 'subscriptions/listen'));
    await expect(session.next()).resolves.toMatchObject({
      method: 'notifications/subscriptions/acknowledged',
    });
    session.send(request('listen', 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({
      error: {
        code: -32_600,
        message:
          'The request id "listen" is in use by a request still in flight. Send each request with an id no request in flight holds.',
      },
      id: 'listen',
    });
    const { messages } = await session.close();
    // The subscription is still open, so shutdown closes it once.
    expect(messages.slice(2)).toEqual([
      expect.objectContaining({ method: 'notifications/cancelled' }),
      expect.objectContaining({ id: 'listen', result: expect.any(Object) }),
    ]);
  });

  it('serves an id again once its request has settled or been cancelled', async () => {
    const session = open();
    session.send(request(1, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 1, result: expect.any(Object) });
    session.send(request(1, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 1, result: expect.any(Object) });
    session.send(request(2, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }));
    await session.observed('started two');
    session.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
    session.send(request(2, 'tools/call', { name: 'echo' }));
    await expect(session.next()).resolves.toMatchObject({ id: 2, result: { isError: false } });
    await session.close();
  });
});
