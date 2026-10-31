import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

interface Report {
  args: Record<string, unknown>;
  command: string;
  options: Record<string, unknown>;
  passthrough: string[];
}

async function invokeNested(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return await invokeFixture(new URL('fixtures/nested.mjs', import.meta.url), ['invoke', ...argv]);
}

async function invokeNestedRoot(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return await invokeFixture(new URL('fixtures/nested-root.mjs', import.meta.url), [
    'invoke',
    ...argv,
  ]);
}

async function report(argv: string[]): Promise<Report> {
  const result = await invokeNested(argv);
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
  async (argv, command, options) => {
    await expect(report(['--file', 'data.json', ...argv])).resolves.toEqual({
      args: {},
      command,
      options: { file: 'data.json', ...options },
      passthrough: [],
    });
  },
);

test.each([
  [['cache', 'ls'], 'list', {}],
  [['cache', 'l'], 'list', {}],
  [['c', 'list'], 'list', {}],
  [['c', 'ls'], 'list', {}],
  [['c', 'clear', '--force'], 'clear', { force: true }],
] satisfies [string[], string, Record<string, unknown>][])(
  'routes %j through an alias to the Command its canonical name selects',
  async (argv, command, options) => {
    await expect(report(['--file', 'data.json', ...argv])).resolves.toEqual({
      args: {},
      command,
      options: { file: 'data.json', ...options },
      passthrough: [],
    });
  },
);

test('one alias namespace belongs to one parent, so two parents each spend "ls" on a child', async () => {
  const shared = { args: {}, options: { file: 'data.json' }, passthrough: [] };
  await expect(report(['--file', 'data.json', 'cache', 'ls'])).resolves.toEqual({
    ...shared,
    command: 'list',
  });
  await expect(report(['--file', 'data.json', 'store', 'ls'])).resolves.toEqual({
    ...shared,
    command: 'put',
  });
});

test.each([
  [['c'], 'Command "cache" requires a subcommand. Use one of: clear, list.'],
  [['cache', 'nope'], 'Unknown command "nope". Use one of: clear, list.'],
  [['c', 'nope'], 'Unknown command "nope". Use one of: clear, list.'],
  [['cache', 'ls', 'extra'], 'Command "list" accepts no arguments. Remove the supplied values.'],
] satisfies [string[], string][])(
  'reports canonical names alone for the aliased invocation %j',
  async (argv, reason) => {
    const result = await invokeNested(argv);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`nested: ${reason}\n`);
  },
);

test.each([
  ['leaf-actionless', 'Command "clear" has no action. Register an action.'],
  [
    'duplicate-nested-children',
    'Command "cache" attaches two children named "clear". Rename or remove one.',
  ],
  [
    'invalid-nested-child-name',
    'Command name "bad name" is invalid. Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".',
  ],
  [
    'nested-shared-option-key',
    'Option "file" is declared as a global option and as a local option on Command "clear". Rename the local option.',
  ],
  [
    'alias-sibling-name',
    'The root Command attaches child "keys" with alias "get", which is also the name of child "get". Rename or remove one.',
  ],
  [
    'alias-before-sibling-name',
    'The root Command attaches child "keys" with alias "get", which is also the name of child "get". Rename or remove one.',
  ],
  [
    'alias-sibling-alias',
    'The root Command attaches child "keys" with alias "ls", which is also an alias of child "select". Rename or remove one.',
  ],
  [
    'invalid-alias-name',
    'Command "keys" declares an alias named "bad name". Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".',
  ],
  [
    'dot-alias-name',
    'Command "keys" declares an alias named ".ls". Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".',
  ],
  [
    'slash-alias-name',
    'Command "keys" declares an alias named "ls/all". Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".',
  ],
  [
    'colon-alias-name',
    'Command "keys" declares an alias named "ls:all". Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".',
  ],
  [
    'nested-alias-sibling-name',
    'Command "cache" attaches child "list" with alias "clear", which is also the name of child "clear". Rename or remove one.',
  ],
  [
    'shared-child',
    'The root Command attaches child "clear", which Command "cache" also attaches. Attach a Command value at one point; create a new Command for each placement.',
  ],
] satisfies [string, string][])(
  'the call or attach that makes the %s graph wrong throws at its depth',
  async (scenario, reason) => {
    await expect(
      invokeFixture(new URL('fixtures/nested-graph.mjs', import.meta.url), [
        scenario,
        'cache',
        'clear',
      ]),
    ).resolves.toEqual({ status: 0, stderr: '', stdout: `thrown:1: ${reason}\n` });
  },
);

test.each([
  ['portable-alias-name', '_Ls.v2-all'],
  ['digit-alias-name', '9Go_x'],
  ['repeated-alias', 'ls'],
  ['alias-own-name', 'keys'],
] satisfies [string, string][])('the %s alias routes to its Command', async (scenario, alias) => {
  await expect(
    invokeFixture(new URL('fixtures/nested-graph.mjs', import.meta.url), [scenario, alias]),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\n{"chunks":[],"code":0}\n',
  });
});

test('a Command three levels below the root routes and runs', async () => {
  await expect(
    invokeFixture(new URL('fixtures/nested-graph.mjs', import.meta.url), [
      'three-levels',
      'store',
      'cache',
      'clear',
    ]),
  ).resolves.toEqual({ status: 0, stderr: '', stdout: 'dispatched\n{"chunks":[],"code":0}\n' });
});

test.each([
  [['cache'], 'Command "cache" requires a subcommand. Use one of: clear, list.'],
  // A structural fault ranks ahead of the missing subcommand.
  [
    ['cache', '--verbose'],
    'Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  [
    ['cache', '-v'],
    'Unknown option "-v". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  [['cache', 'nope'], 'Unknown command "nope". Use one of: clear, list.'],
  [
    ['cache', 'list', '--force'],
    'Unknown option "--force". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  [
    ['cache', 'clear', 'extra'],
    'Command "clear" accepts no arguments. Remove the supplied values.',
  ],
] satisfies [string[], string][])('rejects the nested invocation %j', async (argv, reason) => {
  const result = await invokeNested(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`nested: ${reason}\n`);
});

test('a root group dispatches the child a bare token selects', async () => {
  const result = await invokeNestedRoot(['--file', 'data.json', 'get', 'a.b']);
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
  [[], 'A command is required. Use one of: get, keys.'],
  [
    ['--verbose'],
    'Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  [['--file', 'data.json'], 'A command is required. Use one of: get, keys.'],
] satisfies [string[], string][])('rejects the root group invocation %j', async (argv, reason) => {
  const result = await invokeNestedRoot(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`nested-root: ${reason}\n`);
});

test.each([
  [[], 'root', {}],
  [['store'], 'store', { pretty: false }],
  [['store', '--pretty'], 'store', { pretty: true }],
] satisfies [string[], string, Record<string, unknown>][])(
  'runs the action of the Command %j selects, children and all',
  async (argv, command, options) => {
    await expect(report(['--file', 'data.json', ...argv])).resolves.toEqual({
      args: {},
      command,
      options: { file: 'data.json', ...options },
      passthrough: [],
    });
  },
);
