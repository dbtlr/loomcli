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
