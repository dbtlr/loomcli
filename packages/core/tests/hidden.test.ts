import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function invokeHidden(argv: string[], graph: 'graph' | 'root' = 'graph') {
  return invoke(new URL('fixtures/hidden.mjs', import.meta.url), [graph, ...argv]);
}

/** The registered renderer serializes the routing failure, so a test reads its candidate list. */
function reported(argv: string[], graph: 'graph' | 'root' = 'graph'): unknown {
  const result = invokeHidden(argv, graph);
  expect(result.stdout).toBe('resolved:2\n');
  expect(result.status).toBe(2);
  return JSON.parse(result.stderr);
}

test.each([
  [['debug'], 'debug'],
  [['cache', 'trace'], 'trace'],
  [['secrets', 'dump'], 'dump'],
])('a hidden Command routes and runs like any other for the invocation %j', (argv, printed) => {
  const result = invokeHidden(argv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${printed}\nresolved:0\n`);
});

test('an unknown command offers the visible children alone', () => {
  expect(reported(['nope'])).toEqual({
    candidates: ['cache', 'secrets'],
    message: 'Unknown command "nope". Use one of: cache, secrets.',
    token: 'nope',
  });
});

test('a group offers the visible children alone', () => {
  expect(reported(['cache'])).toEqual({
    candidates: ['clear'],
    command: ['cache'],
    message: 'Command "cache" requires a subcommand. Use one of: clear.',
  });
});

test('a group whose children are all hidden offers none, and its diagnostic ends there', () => {
  expect(reported(['secrets'])).toEqual({
    candidates: [],
    command: ['secrets'],
    message: 'Command "secrets" requires a subcommand.',
  });
});

test('an unknown command under an all-hidden parent offers none', () => {
  expect(reported(['secrets', 'nope'])).toEqual({
    candidates: [],
    message: 'Unknown command "nope".',
    token: 'nope',
  });
});

test('a root group whose children are all hidden offers none', () => {
  expect(reported([], 'root')).toEqual({
    candidates: [],
    command: [],
    message: 'The root Command requires a subcommand.',
  });
});
