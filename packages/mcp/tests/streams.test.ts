import { PassThrough } from 'node:stream';

import { expect, test } from 'vite-plus/test';

import { McpServer } from '../src/index.js';
import { meta } from './session.js';

test('serves over Node streams and resolves when the input ends', async () => {
  const input = new PassThrough();
  const output = new PassThrough({ encoding: 'utf8' });
  let written = '';
  output.on('data', (chunk: string) => {
    written += chunk;
  });
  const server = new McpServer({
    callTool: () => ({ content: [] }),
    identity: { name: 'streams', version: '0.0.0' },
    listTools: () => [],
  });
  const running = server.run(input, output);
  input.end(
    `${JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list', params: { _meta: meta } })}\n`,
  );
  await running;
  expect(JSON.parse(written)).toEqual({
    id: 1,
    jsonrpc: '2.0',
    result: {
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'streams', version: '0.0.0' } },
      cacheScope: 'private',
      resultType: 'complete',
      tools: [],
      ttlMs: 0,
    },
  });
});

test('resolves at once and reads nothing when the signal has already aborted', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = new McpServer({
    callTool: () => ({ content: [] }),
    identity: { name: 'streams', version: '0.0.0' },
    listTools: () => [],
  });
  await server.run(input, output, { signal: AbortSignal.abort() });
  expect(output.read()).toBeNull();
});

test('decodes a character split across two chunks once', async () => {
  const input = new PassThrough();
  const output = new PassThrough({ encoding: 'utf8' });
  let written = '';
  output.on('data', (chunk: string) => {
    written += chunk;
  });
  const server = new McpServer({
    callTool: ({ arguments: received }) => ({
      content: [{ text: JSON.stringify(received), type: 'text' }],
    }),
    identity: { name: 'streams', version: '0.0.0' },
    listTools: () => [],
  });
  const running = server.run(input, output);
  const line = Buffer.from(
    `${JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/call', params: { _meta: meta, arguments: { text: 'é' }, name: 'echo' } })}\n`,
  );
  const split = line.indexOf(Buffer.from('é')) + 1;
  input.write(line.subarray(0, split));
  input.end(line.subarray(split));
  await running;
  expect(JSON.parse(written)).toMatchObject({
    result: { content: [{ text: '{"text":"é"}', type: 'text' }] },
  });
});
