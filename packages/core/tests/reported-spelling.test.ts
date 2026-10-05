import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('reportedSpelling names each option by the spelling a reported problem names it by', () => {
  const result = invoke(new URL('fixtures/reported-spelling.mjs', import.meta.url), []);
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
