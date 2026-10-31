import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/global-option.mjs', import.meta.url);

test('globalOption derives an Application without changing its receiver', async () => {
  await expect(invokeFixture(fixture, ['original'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"quiet":false}\n',
  });
  await expect(invokeFixture(fixture, ['derived'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"quiet":false,"limit":"10"}\n',
  });
});

test('a global declared after a colliding root-local option throws from globalOption()', async () => {
  await expect(invokeFixture(fixture, ['local-first'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      'thrown:1: Option "quiet" is declared as a global option and as a local option on the root Command. Rename the local option.\n',
  });
});
