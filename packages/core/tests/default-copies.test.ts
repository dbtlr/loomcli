import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function copies(mode: string) {
  const result = invoke(new URL('fixtures/default-copies.mjs', import.meta.url), [mode]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

test('a declared array default is copied for each invocation and at authoring', () => {
  const line = '{"field":["a","b","x"],"tag":["one","y"]}\n';
  expect(copies('runs')).toBe(`${line}${line}`);
});

test('an inspected default is a frozen snapshot that no consumer can write through', () => {
  expect(JSON.parse(copies('inspect'))).toEqual({
    again: {
      field: ['a', 'b'],
      shape: { list: ['a'], nested: { key: 'value' } },
      tag: ['one'],
    },
    attempts: [
      { label: 'global', rejected: true },
      { label: 'array', rejected: true },
      { label: 'member', rejected: true },
      { label: 'nested', rejected: true },
    ],
  });
});
