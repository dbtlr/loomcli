import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('a Command value is claimed per build, so repeated builds, separate Applications, and same-named values under different parents all build', () => {
  const result = invoke(new URL('fixtures/tree.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    codes: [0, 0, 0, 0, 0],
    errors: [],
    lines: ['dispatched', 'dispatched', 'dispatched', 'dispatched', 'dispatched'],
  });
});
