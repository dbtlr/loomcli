import { describe, expect, it } from 'vite-plus/test';

import { meta, open, request } from './session.js';

/** A tools/call request whose `_meta` carries a progress token. */
function tracked(id: number, token: number | string, name: string, input: unknown = {}) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { _meta: { ...meta, progressToken: token }, arguments: input, name },
  };
}

/** One progress notification on a token, with the params the handler gave. */
function notification(progressToken: number | string, params: Record<string, unknown>) {
  return { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, ...params } };
}

const updates = [
  { message: 'one', progress: 1, total: 3 },
  { progress: 2 },
  { message: 'three', progress: 3 },
];

describe('progress', () => {
  it.each([['a string token', 'token-1'] as const, ['a number token', 7] as const])(
    'a call carrying %s writes one notifications/progress per call of its function, in order, before its answer',
    async (_name, token) => {
      const session = open();
      session.send(tracked(1, token, 'progress', { updates }));
      const written = [await session.next(), await session.next(), await session.next()];
      await expect(session.next()).resolves.toMatchObject({ id: 1, result: { isError: false } });
      const { stderr } = await session.close();
      expect(written).toEqual([
        notification(token, { message: 'one', progress: 1, total: 3 }),
        notification(token, { progress: 2 }),
        notification(token, { message: 'three', progress: 3 }),
      ]);
      expect(stderr).toBe('progress received\nresolved\n');
    },
  );

  it('a call without a token receives no progress function', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: { updates }, name: 'progress' }));
    await expect(session.next()).resolves.toMatchObject({ id: 1 });
    const { messages, stderr } = await session.close();
    expect(messages).toHaveLength(1);
    expect(stderr).toBe('progress absent\nresolved\n');
  });

  it('writes nothing after the call is answered', async () => {
    const session = open();
    session.send(tracked(1, 'late', 'late'));
    await expect(session.next()).resolves.toMatchObject({ id: 1 });
    await session.observed('sent late');
    session.send(request(2, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    const { messages } = await session.close();
    expect(messages.map((message) => message.id)).toEqual([1, 2]);
  });

  it('writes nothing after the client cancels the call', async () => {
    const session = open();
    session.send(tracked(1, 'cancelled', 'wait-progress'));
    await session.observed('started');
    session.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { reason: 'test', requestId: 1 },
    });
    await session.observed('aborted');
    session.send(request(2, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    const { messages } = await session.close();
    expect(messages.map((message) => message.id)).toEqual([2]);
  });

  it('writes nothing after shutdown aborts the call', async () => {
    const session = open();
    session.send(tracked(1, 'shutdown', 'wait-progress'));
    await session.observed('started');
    const { messages, stderr } = await session.close();
    expect(stderr).toContain('aborted\n');
    expect(messages).toEqual([]);
  });
});
