import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function reshaped(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/result-views.mjs', import.meta.url), [scenario, mode]);
}

/** The result fact one scenario publishes, read back from the node the reshaping sits on. */
function fact(scenario: string) {
  const { status, stderr, stdout } = reshaped(scenario, 'inspect');
  expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
  return JSON.parse(stdout.slice('assembled\n'.length));
}

/** The bytes one scenario's default view wrote, which is how a run reads the merged record. */
function written(scenario: string) {
  const { status, stderr, stdout } = reshaped(scenario, 'run');
  expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
  return stdout.slice('assembled\n'.length, -'resolved:0\n'.length);
}

/** The sequence the declaration's own row view writes, which no reshaping in these cases changed. */
const sequence = 'PATHS\n0: one.txt\n1: two words.txt\nEND\n';

test('a replaced key keeps the position the declaration gave it', () => {
  expect(fact('replace')).toEqual({
    default: 'list',
    kind: 'rows',
    views: ['list', 'table'],
  });
  expect(written('replace')).toBe('- one.txt\n- two words.txt\n');
});

test('a key the declaration does not hold is appended, and the default stays the first', () => {
  expect(fact('append')).toEqual({
    default: 'list',
    kind: 'rows',
    views: ['list', 'table', 'wide'],
  });
  expect(written('append')).toBe(sequence);
});

test('default names the view a run renders, appended in the same call', () => {
  expect(fact('move-default')).toEqual({
    default: 'wide',
    kind: 'rows',
    views: ['list', 'table', 'wide'],
  });
  expect(written('move-default')).toBe('wide 2\n');
});

test('a default once named persists through a later call that names none', () => {
  expect(fact('persist-default')).toEqual({
    default: 'wide',
    kind: 'rows',
    views: ['list', 'table', 'wide', 'narrow'],
  });
  expect(written('persist-default')).toBe('wide 2\n');
});

test('the same call reads on the Application, which declares the root result', () => {
  expect(fact('root')).toEqual({
    default: 'wide',
    kind: 'rows',
    views: ['list', 'table', 'wide'],
  });
  expect(written('root')).toBe('wide 2\n');
});

test('the call is published before the action too, and merges the same way', () => {
  expect(fact('before-action')).toEqual({
    default: 'list',
    kind: 'rows',
    views: ['list', 'table', 'wide'],
  });
  expect(written('before-action')).toBe(sequence);
});

// A views() call stays callable and can add keys, so the attach that makes the Command final judges it.
test('a default that names no key after the merge throws from the attach', () => {
  expect(reshaped('missing-default', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'thrown:1: Command "paths" selects default view "narrow", which it does not name. Name the view or select a named one.\n',
  });
});
