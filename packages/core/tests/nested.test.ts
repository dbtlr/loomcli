import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

interface Report {
  args: Record<string, unknown>;
  command: string;
  options: Record<string, unknown>;
  passthrough: string[];
}

function invokeNested(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return invoke(new URL('fixtures/nested.mjs', import.meta.url), ['invoke', ...argv]);
}

function invokeNestedRoot(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return invoke(new URL('fixtures/nested-root.mjs', import.meta.url), ['invoke', ...argv]);
}

function report(argv: string[]): Report {
  const result = invokeNested(argv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test.each([
  [['cache', 'clear'], 'clear', { force: false }],
  [['cache', 'clear', '--force'], 'clear', { force: true }],
  [['cache', 'clear', '-F'], 'clear', { force: true }],
  [['cache', 'list'], 'list', {}],
  [['store', 'put'], 'put', {}],
] satisfies [string[], string, Record<string, unknown>][])(
  'routes %j through the named levels to its leaf with the globals and its own locals',
  (argv, command, options) => {
    expect(report(['--file', 'data.json', ...argv])).toEqual({
      args: {},
      command,
      options: { file: 'data.json', ...options },
      passthrough: [],
    });
  },
);

function invokeNestedGraph(scenario: string, argv: string[] = []) {
  const result = invoke(new URL('fixtures/nested-graph.mjs', import.meta.url), [scenario, ...argv]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test.each([
  [
    'group-option',
    'Command "cache" declares option "verbose" but registers no action to receive it. Register an action or remove the option.',
  ],
  [
    'root-group-option',
    'The root Command declares option "verbose" but registers no action to receive it. Register an action or remove the option.',
  ],
  ['leaf-actionless', 'Command "clear" has no action. Register an action.'],
  [
    'nested-foreign-globals',
    'Command "clear" holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.',
  ],
  [
    'nested-missing-globals',
    'Command "clear" holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.',
  ],
  [
    'duplicate-nested-children',
    'Command "cache" attaches two children named "clear". Rename or remove one.',
  ],
  [
    'invalid-nested-child-name',
    'Command "cache" attaches a child named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'late-nested-child',
    'Command "cache" attaches child "clear" after its action. Attach children before action().',
  ],
  [
    'nested-shared-option-key',
    'Option "file" is declared as a global option and as a local option on Command "clear". Rename the local option.',
  ],
  [
    'shared-child',
    'Command "cache" attaches child "clear", which the root Command also attaches. Attach a Command value at one point; create a new Command for each placement.',
  ],
  [
    'shared-child-same-parent-name',
    'Command "cache" attaches child "clear", which Command "cache" also attaches. Attach a Command value at one point; create a new Command for each placement.',
  ],
] satisfies [string, string][])(
  'rejects the %s graph at its depth before reading tokens',
  (scenario, reason) => {
    expect(invokeNestedGraph(scenario, ['cache', 'clear'])).toEqual({
      chunks: [`Invalid declaration: ${reason}\n`],
      code: 1,
    });
  },
);

test.each([
  [['cache'], 'Command "cache" requires a subcommand. Use one of: clear, list.'],
  [['cache', '--verbose'], 'Command "cache" requires a subcommand. Use one of: clear, list.'],
  [['cache', '-v'], 'Command "cache" requires a subcommand. Use one of: clear, list.'],
  [['cache', 'nope'], 'Unknown command "nope". Use one of: clear, list.'],
  [
    ['cache', 'list', '--force'],
    'Unknown option "--force". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  [
    ['cache', 'clear', 'extra'],
    'Command "clear" accepts no arguments. Remove the supplied values.',
  ],
] satisfies [string[], string][])('rejects the nested invocation %j', (argv, reason) => {
  const result = invokeNested(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`Invalid input: ${reason}\n`);
});

test('a root group dispatches the child a bare token selects', () => {
  const result = invokeNestedRoot(['--file', 'data.json', 'get', 'a.b']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    args: { path: 'a.b' },
    command: 'get',
    options: { file: 'data.json' },
    passthrough: [],
  });
});

test.each([
  [[], 'The root Command requires a subcommand. Use one of: get, keys.'],
  [['--verbose'], 'The root Command requires a subcommand. Use one of: get, keys.'],
  [['--file', 'data.json'], 'The root Command requires a subcommand. Use one of: get, keys.'],
] satisfies [string[], string][])('rejects the root group invocation %j', (argv, reason) => {
  const result = invokeNestedRoot(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`Invalid input: ${reason}\n`);
});

test.each([
  [[], 'root', {}],
  [['store'], 'store', { pretty: false }],
  [['store', '--pretty'], 'store', { pretty: true }],
] satisfies [string[], string, Record<string, unknown>][])(
  'runs the action of the Command %j selects, children and all',
  (argv, command, options) => {
    expect(report(['--file', 'data.json', ...argv])).toEqual({
      args: {},
      command,
      options: { file: 'data.json', ...options },
      passthrough: [],
    });
  },
);
