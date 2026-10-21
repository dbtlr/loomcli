// Acceptance plan: see packages/prompts/tests/interactive.test.ts.

import { expect, test } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';
import { launch, request } from '../../mcp/tests/session.js';

const fixture = new URL('fixtures/mcp.mjs', import.meta.url);

test('MCP lists conditional requiredness and resolves supplied questions without interaction', async () => {
  const session = launch(fixture, ['mcp'], { env: childEnvironment({}) });
  try {
    session.send(request(1, 'tools/list'));
    const listing = await session.next();
    expect(listing.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          inputSchema: expect.objectContaining({ required: ['port'] }),
          name: 'port',
        }),
      ]),
    });
    session.send(request(2, 'tools/call', { arguments: { port: '8080' }, name: 'port' }));
    const response1 = await session.next();
    expect(response1.result).toMatchObject({
      content: [{ text: '8080\n', type: 'text' }],
      isError: false,
    });
    session.send(request(3, 'tools/call', { arguments: {}, name: 'port' }));
    const response2 = await session.next();
    expect(response2.result).toMatchObject({
      isError: true,
      structuredContent: {
        exitCode: 2,
        failure: {
          message: 'Option "port" is required when input is not interactive. Supply a value.',
        },
      },
    });
    session.send(request(4, 'tools/call', { arguments: {}, name: 'question' }));
    const response3 = await session.next();
    expect(response3.result).toMatchObject({
      isError: true,
      structuredContent: { exitCode: 1, failure: { code: 'interaction-unavailable' } },
    });
  } finally {
    await session.close();
  }
});
