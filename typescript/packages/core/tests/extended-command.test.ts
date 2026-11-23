import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

async function run(mode: string) {
  const result = await invokeFixture(new URL('fixtures/extended-command.mjs', import.meta.url), [
    mode,
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

test('an imported-style completed Command accepts immutable whole-value extension replacement', async () => {
  expect(JSON.parse(await run('inspect'))).toEqual({
    after: { details: 'Application help.' },
    aliases: ['r'],
    before: { details: 'Library help.', examples: ['library'] },
    cloned: true,
    description: 'Reads a value.',
    frozen: true,
    identities: ['test/help', 'test/other'],
    other: 'retained',
    root: 'root',
  });
  expect(JSON.parse(await run('invoke'))).toEqual({
    args: { path: 'document' },
    options: { quiet: true, raw: true },
  });
});

test('a second value of one extension in one call replaces the first whole', async () => {
  expect(JSON.parse(await run('duplicate'))).toEqual({ details: 'Two.' });
});

test.each([
  ['invalid', 'holds an invalid "test/help" value'],
  [
    'twin',
    'Extension "test/help" is defined twice. Install one copy of the package that defines it.',
  ],
])('extension layering rejects %s', async (scenario, message) => {
  await expect(run(scenario)).resolves.toContain(message);
});
