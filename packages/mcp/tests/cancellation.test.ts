import { describe, expect, it } from 'vite-plus/test';

import { open, request } from './session.js';

/** A cancellation the client sends for one request. */
function cancel(requestId: number | string) {
  return {
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { reason: 'test', requestId },
  };
}

describe('notifications/cancelled', () => {
  it("aborts the named call's signal and writes no response for it", async () => {
    const session = open();
    session.send(request('call-1', 'tools/call', { arguments: { label: 'one' }, name: 'wait' }));
    await session.observed('started one');
    session.send(cancel('call-1'));
    await session.observed('aborted one');
    session.send(request(2, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    const { messages } = await session.close();
    expect(messages.map((message) => message.id)).toEqual([2]);
  });

  it('leaves another call in flight running', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }));
    session.send(request(2, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }));
    await session.observed('started two');
    session.send(cancel(1));
    await session.observed('aborted one');
    session.send(request(3, 'tools/call', { name: 'echo' }));
    await expect(session.next()).resolves.toMatchObject({ id: 3 });
    const { messages, stderr } = await session.close();
    // Closing stdin aborts the call still in flight, which answers nothing.
    expect(stderr).toContain('aborted two\n');
    expect(messages.map((message) => message.id)).toEqual([3]);
  });

  it('changes nothing for an unknown or settled id', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { name: 'echo' }));
    await expect(session.next()).resolves.toMatchObject({ id: 1, result: { isError: false } });
    session.send(cancel(1));
    session.send(cancel(99));
    session.send(cancel('1'));
    session.send({ jsonrpc: '2.0', method: 'notifications/cancelled' });
    session.send(request(2, 'tools/call', { name: 'echo' }));
    await expect(session.next()).resolves.toMatchObject({ id: 2, result: { isError: false } });
    const { messages } = await session.close();
    expect(messages.map((message) => message.id)).toEqual([1, 2]);
  });

  it('matches a numeric id and a string id as different requests', async () => {
    const session = open();
    session.send(request(1, 'tools/call', { arguments: { label: 'number' }, name: 'wait' }));
    await session.observed('started number');
    session.send(cancel('1'));
    session.send(request(2, 'server/discover'));
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    const { messages, stderr } = await session.close();
    // The call ran until shutdown aborted it, and a call shutdown aborts answers nothing.
    expect(stderr.indexOf('aborted number')).toBeGreaterThan(-1);
    expect(messages.map((message) => message.id)).toEqual([2]);
  });
});
