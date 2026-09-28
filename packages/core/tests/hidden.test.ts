import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

type Graph = 'current' | 'graph' | 'root';

function invokeHidden(argv: string[], graph: Graph = 'graph') {
  return invoke(new URL('fixtures/hidden.mjs', import.meta.url), [graph, ...argv]);
}

/** The registered view serializes the routing failure, so a test reads its candidate list. */
function reported(argv: string[], graph: Graph = 'graph'): unknown {
  const result = invokeHidden(argv, graph);
  expect(result.stdout).toBe('resolved:2\n');
  expect(result.status).toBe(2);
  return JSON.parse(result.stderr);
}

test.each([
  [['debug'], 'debug'],
  [['cache', 'trace'], 'trace'],
  [['secrets', 'dump'], 'dump'],
  [['legacy'], 'legacy'],
  [['cache', 'purge'], 'purge'],
  [['secrets', 'leak'], 'leak'],
])(
  'a hidden or deprecated Command routes and runs like any other for the invocation %j',
  (argv, printed) => {
    const result = invokeHidden(argv);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${printed}\nresolved:0\n`);
  },
);

test('an unknown command offers the visible, current children alone', () => {
  expect(reported(['nope'])).toEqual({
    candidates: ['cache', 'secrets'],
    message: 'Unknown command "nope". Use one of: cache, secrets.',
    token: 'nope',
  });
});

test('a group offers the visible, current children alone', () => {
  expect(reported(['cache'])).toEqual({
    candidates: ['clear'],
    command: ['cache'],
    message: 'Command "cache" requires a subcommand. Use one of: clear.',
  });
});

test('a group whose children are all hidden or deprecated offers none and names the fix', () => {
  expect(reported(['secrets'])).toEqual({
    candidates: [],
    command: ['secrets'],
    message: 'Command "secrets" requires a subcommand. Supply the name of a declared subcommand.',
  });
});

test('an unknown command under a parent that offers none names the fix', () => {
  expect(reported(['secrets', 'nope'])).toEqual({
    candidates: [],
    message: 'Unknown command "nope". Supply the name of a declared command.',
    token: 'nope',
  });
});

test('the root group says a command is required and offers its current children', () => {
  expect(reported([], 'current')).toEqual({
    candidates: ['get'],
    command: [],
    message: 'A command is required. Use one of: get.',
  });
});

test('a root group that offers none says a command is required and names the fix', () => {
  expect(reported([], 'root')).toEqual({
    candidates: [],
    command: [],
    message: 'A command is required. Supply the name of a declared command.',
  });
});
