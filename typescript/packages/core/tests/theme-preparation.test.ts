import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

test.each(['root', 'hook'])(
  'a validated theme reaches the failure view when the %s build fails',
  async (scenario) => {
    await expect(
      invokeFixture(new URL('fixtures/theme-preparation.mjs', import.meta.url), [scenario]),
    ).resolves.toEqual({
      status: 1,
      stderr: '\u001b[36minvalid\u001b[39m\n',
      stdout: '',
    });
  },
);
