import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function copies(mode: string) {
  const result = invoke(new URL('fixtures/default-copies.mjs', import.meta.url), [mode]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

test('a declared array default is copied for each invocation and at authoring', () => {
  const line = '{"field":["a","b","x"],"files":["a","extra"],"mark":["m","z"],"tag":["one","y"]}\n';
  const declared = '{"files":["a"],"mark":["m"]}\n';
  expect(copies('runs')).toBe(`${line}${line}${declared}`);
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

/** What the cycles fixture reports for one mode. */
function cycles(mode: string): unknown {
  const result = invoke(new URL('fixtures/default-cycles.mjs', import.meta.url), [mode]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('a cyclic default is a frozen copy holding the same cycle, and its validator receives that copy', () => {
  const copied = { authors: false, cycle: true, frozen: true, validated: true };
  expect(cycles('cycle')).toEqual({ list: copied, shape: copied });
});

test('a getter on a default runs once, at the declaring call, across a run and an inspection', () => {
  expect(cycles('once')).toEqual({ default: 1, nested: 1 });
});
