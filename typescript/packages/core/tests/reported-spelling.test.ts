import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

test('reportedSpelling names each option by the spelling a reported problem names it by', async () => {
  const result = await invokeFixture(
    new URL('fixtures/reported-spelling.mjs', import.meta.url),
    [],
  );
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    color: '--color',
    exact: '-x',
    file: '--file',
    keep: '-k',
    'min-bytes': '--min-bytes',
    quiet: '--no-quiet',
    verbose: '--verbose',
  });
});
