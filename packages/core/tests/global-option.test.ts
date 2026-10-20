import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/global-option.mjs', import.meta.url);

test('globalOption derives an Application without changing its receiver', () => {
  expect(invoke(fixture, ['original'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"quiet":false}\n',
  });
  expect(invoke(fixture, ['derived'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"quiet":false,"limit":"10"}\n',
  });
});

test('a global declared after a colliding root-local option throws from globalOption()', () => {
  expect(invoke(fixture, ['local-first'])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'thrown:1: Option "quiet" is declared as a global option and as a local option on the root Command. Rename the local option.\n',
  });
});
