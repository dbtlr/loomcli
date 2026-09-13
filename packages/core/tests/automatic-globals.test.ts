import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('an independently declared Command receives the Application globals and schema outputs', () => {
  const result = invoke(new URL('fixtures/automatic-globals.mjs', import.meta.url), [
    'read',
    'document',
    '--raw',
    '--quiet',
    '--limit',
    '12',
  ]);
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":"document"},"options":{"quiet":true,"limit":12,"raw":true}}\n',
  });
});
