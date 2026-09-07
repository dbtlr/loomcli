import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

interface Report {
  args: Record<string, unknown>;
  command: string;
  options: Record<string, unknown>;
  passthrough: string[];
}

function invokeCommands(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return invoke(new URL('fixtures/commands.mjs', import.meta.url), ['invoke', ...argv]);
}

function report(argv: string[]): Report {
  const result = invokeCommands(argv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function invokeGraph(scenario: string, argv: string[] = []) {
  const result = invoke(new URL('fixtures/graph.mjs', import.meta.url), [scenario, ...argv]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test.each([
  [['--file', 'data.json'], 'root', {}, { file: 'data.json', pretty: false, quiet: false }],
  [
    ['--file', 'data.json', 'get', 'a.b'],
    'get',
    { path: 'a.b' },
    { file: 'data.json', quiet: false, raw: false },
  ],
  [['--file', 'data.json', 'keys'], 'keys', {}, { file: 'data.json', quiet: false }],
] satisfies [string[], string, Record<string, unknown>, Record<string, unknown>][])(
  'routes %j to its Command with the global and local values',
  (argv, command, args, options) => {
    expect(report(argv)).toEqual({ args, command, options, passthrough: [] });
  },
);

test.each([
  [['--file', 'data.json', 'get', 'a.b']],
  [['get', '--file', 'data.json', 'a.b']],
  [['get', 'a.b', '--file', 'data.json']],
  [['get', 'a.b', '--file=data.json']],
  [['-f', 'data.json', 'get', 'a.b']],
] satisfies [string[]][])('accepts a global before, between, or after routing in %j', (argv) => {
  expect(report(argv)).toEqual({
    args: { path: 'a.b' },
    command: 'get',
    options: { file: 'data.json', quiet: false, raw: false },
    passthrough: [],
  });
});

test('consumes an all-global short group and leaves local letters to the Command', () => {
  expect(report(['-qf', 'data.json', 'get', '-r', 'a.b'])).toEqual({
    args: { path: 'a.b' },
    command: 'get',
    options: { file: 'data.json', quiet: true, raw: true },
    passthrough: [],
  });
});

test('accepts a local option strictly after its own argument', () => {
  expect(report(['-qf', 'data.json', 'get', 'a.b', '-r'])).toEqual({
    args: { path: 'a.b' },
    command: 'get',
    options: { file: 'data.json', quiet: true, raw: true },
    passthrough: [],
  });
});

test('a local option on a root with children commits to the root action', () => {
  expect(report(['--file', 'data.json', '--pretty'])).toEqual({
    args: {},
    command: 'root',
    options: { file: 'data.json', pretty: true, quiet: false },
    passthrough: [],
  });
});

test('a global value wins over a token that also names a child', () => {
  expect(report(['--file', 'keys', 'get', 'name'])).toEqual({
    args: { path: 'name' },
    command: 'get',
    options: { file: 'keys', quiet: false, raw: false },
    passthrough: [],
  });
});

test('passthrough tokens keep global spellings out of the pre-scan', () => {
  expect(report(['--file', 'data.json', 'get', 'a.b', '--', '--file', 'other', '-qf'])).toEqual({
    args: { path: 'a.b' },
    command: 'get',
    options: { file: 'data.json', quiet: false, raw: false },
    passthrough: ['--file', 'other', '-qf'],
  });
});

test('a validated global reaches the action as its schema output', () => {
  expect(report(['--file', 'data.json', '--limit', '12', 'keys'])).toEqual({
    args: {},
    command: 'keys',
    options: { file: 'data.json', limit: 12, quiet: false },
    passthrough: [],
  });
});

test.each([
  [['--file', 'data.json', 'nope'], 'Unknown command "nope". Use one of: get, keys.'],
  [
    ['--file', 'data.json', '-r', 'get', 'a.b'],
    'Unknown option "-r". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  [
    ['--file', 'data.json', '-p', 'get', 'a.b'],
    'The root Command accepts no arguments. Remove the supplied values.',
  ],
  [['--file', 'data.json', 'get'], 'Argument "path" requires a value. Supply a value for "path".'],
  [
    ['--file', 'data.json', 'get', 'a.b', 'c.d'],
    'Command "get" accepts 1 argument. Remove the extra values.',
  ],
  [
    ['--file', 'data.json', 'keys', 'extra'],
    'Command "keys" accepts no arguments. Remove the supplied values.',
  ],
  [
    ['--file', 'one.json', 'get', 'a.b', '-f', 'two.json'],
    'Option "-f" can be supplied only once. Remove the repeated option.',
  ],
  [
    ['-qp', '--file', 'data.json', 'get', 'a.b'],
    'Short group "-qp" mixes the global option "-q" with "-p", which is not a global option. Supply global options as separate tokens, and local options after their command name.',
  ],
  [
    ['-qZ', '--file', 'data.json', 'get', 'a.b'],
    'Short group "-qZ" mixes the global option "-q" with "-Z", which is not a global option. Supply global options as separate tokens, and local options after their command name.',
  ],
  [
    ['--file', 'data.json', 'get', '--pretty', 'a.b'],
    'Unknown option "--pretty". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  [['--file'], 'Option "--file" requires a value. Supply a value after "--file".'],
  [['get', 'a.b'], 'Option "--file" is required. Supply a value.'],
  [
    ['--file', '--quiet', 'nope'],
    'Option "--file" requires a value. Supply a value after "--file".',
  ],
  [
    ['--file', 'data.json', '--limit', 'abc', 'nope'],
    'Unknown command "nope". Use one of: get, keys.',
  ],
  // Omission is a validation problem, so an omitted argument aggregates with a rejected value.
  [
    ['--file', 'data.json', '--limit', 'abc', 'get'],
    'Option "--limit": Use decimal digits.\nArgument "path" requires a value. Supply a value for "path".',
  ],
  [['--file', 'data.json', '--limit', 'abc', 'keys'], 'Option "--limit": Use decimal digits.'],
] satisfies [string[], string][])('rejects %j without dispatch', (argv, reason) => {
  const result = invokeCommands(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`Invalid input: ${reason}\n`);
});

function invokeAuthoring(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/authoring.mjs', import.meta.url), [scenario, ...argv]);
}

function authoringReport(scenario: string, argv: string[] = []) {
  const result = invokeAuthoring(scenario, argv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function invokeOrder(argv: string[]) {
  return invoke(new URL('fixtures/order.mjs', import.meta.url), argv);
}

test.each([
  ['root', ['--quiet'], { args: {}, command: 'root', options: { quiet: true } }],
  [
    'forked',
    ['--verbose'],
    { args: {}, command: 'root', options: { quiet: false, verbose: true } },
  ],
  ['composed', ['get', 'a.b'], { args: { path: 'a.b' }, command: 'get', options: {} }],
  ['composed', ['--quiet'], { args: {}, command: 'root', options: { quiet: true } }],
  ['shared', [], { args: {}, command: 'root', options: {} }],
  ['shared', ['leaf'], { args: {}, command: 'leaf', options: {} }],
  ['aliased', ['ls'], { args: {}, command: 'keys', options: {} }],
  ['plain', ['keys'], { args: {}, command: 'keys', options: {} }],
] satisfies [string, string[], Record<string, unknown>][])(
  'runs the %s declaration with %j',
  (scenario, argv, expected) => {
    expect(authoringReport(scenario, argv)).toEqual(expected);
  },
);

test.each([
  ['root', ['get'], 'The root Command accepts no arguments. Remove the supplied values.'],
  ['forked', ['get'], 'The root Command accepts no arguments. Remove the supplied values.'],
  [
    'composed',
    ['--verbose'],
    'Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".',
  ],
  ['plain', ['ls'], 'Unknown command "ls". Use one of: keys.'],
] satisfies [string, string[], string][])(
  'leaves the %s receiver without the later declaration for %j',
  (scenario, argv, reason) => {
    const result = invokeAuthoring(scenario, argv);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`Invalid input: ${reason}\n`);
  },
);

test('validation reports the globals in authoring order, then the Command declarations', () => {
  const result = invokeOrder(['order', '--alpha', 'a', '--beta', 'b', '--local', 'l', 'x']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(
    [
      'Invalid input: Option "--alpha": alpha rejected.',
      'Option "--beta": beta rejected.',
      'Option "--local": local rejected.',
      'Argument "path": path rejected.',
      '',
    ].join('\n'),
  );
});

test('scalar arguments bind the positional tokens in declaration order', () => {
  const result = invokeOrder(['pair', 'a', 'b']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('{"one":"a","two":"b"}\n');
});

test.each([
  [['pair', 'a'], 'Argument "two" requires a value. Supply a value for "two".'],
  [['pair', 'a', 'b', 'd'], 'Command "pair" accepts 2 arguments. Remove the extra values.'],
] satisfies [string[], string][])('rejects the scalar invocation %j', (argv, reason) => {
  const result = invokeOrder(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`Invalid input: ${reason}\n`);
});

test.each([
  [
    'arguments-and-children',
    'The root Command declares argument "files" and attaches child "get". Move the argument into a child Command or remove the children.',
  ],
  [
    'duplicate-children',
    'The root Command attaches two children named "get". Rename or remove one.',
  ],
  [
    'invalid-child-name',
    'The root Command attaches a child named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'empty-child-name',
    'The root Command attaches a child named "". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'hyphen-child-name',
    'The root Command attaches a child named "-get". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'equals-child-name',
    'The root Command attaches a child named "get=value". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'empty-argument-name',
    'The root Command declares an argument named "". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'hyphen-argument-name',
    'The root Command declares an argument named "--file". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'nonstring-argument-name',
    'Command "get" declares an argument named "1". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'foreign-child',
    'The root Command attaches a value that is not a Command. Attach the value returned by new Command(name).',
  ],
  [
    'foreign-globals-value',
    'The Application holds a value that is not a GlobalOptions declaration. Supply the value returned by new GlobalOptions().',
  ],
  [
    'null-globals',
    'The Application holds a value that is not a GlobalOptions declaration. Supply the value returned by new GlobalOptions().',
  ],
  [
    'foreign-globals',
    'Command "get" holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.',
  ],
  [
    'missing-globals',
    'Command "get" holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.',
  ],
  [
    'shared-option-key',
    'Option "file" is declared as a global option and as a local option on Command "get". Rename the local option.',
  ],
  [
    'root-option-collides',
    'Option "file" is declared as a global option and as a local option on the root Command. Rename the local option.',
  ],
  [
    'shared-short-spelling',
    'Option spelling "-f" is used by the global option "file" and the local option "force" on Command "get". Change one declaration.',
  ],
  [
    'shared-negative-spelling',
    'Option spelling "--no-total" is used by the global option "total" and the local option "no-total" on Command "get". Change one declaration.',
  ],
  ['child-actionless', 'Command "get" has no action. Register an action.'],
  ['child-multiple-actions', 'Command "get" has multiple actions. Register one action.'],
  [
    'child-duplicate-argument',
    'Argument "path" is declared more than once on Command "get". Remove or rename the duplicate.',
  ],
  [
    'child-variadic-not-last',
    'Argument "paths" is variadic and precedes argument "path" on Command "get". Declare the variadic argument last.',
  ],
  [
    'late-argument',
    'Command "get" declares argument "path" after its action. Declare arguments and options before action().',
  ],
  [
    'late-option',
    'Command "get" declares option "raw" after its action. Declare arguments and options before action().',
  ],
  [
    'late-root-argument',
    'The root Command declares argument "files" after its action. Declare arguments and options before action().',
  ],
  [
    'late-root-option',
    'The root Command declares option "pretty" after its action. Declare arguments and options before action().',
  ],
  [
    'late-root-child',
    'The root Command attaches child "get" after its action. Attach children before action().',
  ],
  [
    'late-two-options',
    'Command "get" declares option "raw" after its action. Declare arguments and options before action().',
  ],
  [
    'late-child-beside-argument',
    'The root Command attaches child "get" after its action. Attach children before action().',
  ],
  [
    'late-child-invalid-name',
    'The root Command attaches a child named "-get". Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'late-child-foreign',
    'The root Command attaches a value that is not a Command. Attach the value returned by new Command(name).',
  ],
] satisfies [string, string][])(
  'rejects the %s graph before reading tokens',
  (scenario, reason) => {
    expect(invokeGraph(scenario, ['get'])).toEqual({
      chunks: [`Invalid declaration: ${reason}\n`],
      code: 1,
    });
  },
);

test('a declared default on a child Command is validated before any token is parsed', () => {
  expect(invokeGraph('child-invalid-default')).toEqual({
    chunks: [
      'Invalid declaration: Option "depth" has an invalid default. Fix the default or its schema.\nOption "depth": Use decimal digits.\n',
    ],
    code: 1,
  });
});
