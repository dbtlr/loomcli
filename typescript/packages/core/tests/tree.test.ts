import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

test('a Command value is claimed per build, so repeated builds, separate Applications, and same-named values under different parents all build', async () => {
  const result = await invokeFixture(new URL('fixtures/tree.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    codes: [0, 0, 0, 0, 0],
    errors: [],
    lines: ['dispatched', 'dispatched', 'dispatched', 'dispatched', 'dispatched'],
  });
});
