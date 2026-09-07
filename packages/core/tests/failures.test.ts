import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function failures(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/failures.mjs', import.meta.url), [scenario, ...argv]);
}

/** The registered renderer serializes the failure, so a test reads the facts it received. */
function reported(argv: string[], status = 2): unknown {
  const result = failures('usage', argv);
  expect(result.stdout).toBe(`resolved:${status}\n`);
  expect(result.status).toBe(status);
  return JSON.parse(result.stderr);
}

test('an unknown command reaches the renderer with its token and the callable names', () => {
  expect(reported(['-f', 'x', 'nope'])).toEqual({
    candidates: ['get', 'cache'],
    exitCode: 2,
    message: 'Unknown command "nope". Use one of: get, cache.',
    name: 'UnknownCommandError',
    token: 'nope',
  });
});

test('a group names the routed path and the children that answer', () => {
  expect(reported(['-f', 'x', 'cache'])).toEqual({
    candidates: ['keys'],
    command: ['cache'],
    exitCode: 2,
    message: 'Command "cache" requires a subcommand. Use one of: keys.',
    name: 'NonCallableCommandError',
  });
});

test('extra positional tokens name the routed path, the count accepted, and the extras', () => {
  expect(reported(['-f', 'x', 'get', 'a', 'b'])).toEqual({
    accepted: 1,
    command: ['get'],
    exitCode: 2,
    extra: ['b'],
    message: 'Command "get" accepts 1 argument. Remove the extra values.',
    name: 'UnexpectedArgumentError',
  });
});

test.each([
  [
    ['-f', 'x', '--nope'],
    {
      message:
        'Unknown option "--nope". Supply a declared option; prefix a hyphenated path with "./".',
      name: 'UnknownOptionError',
      spelling: '--nope',
    },
  ],
  [
    ['-f'],
    {
      message: 'Option "-f" requires a value. Supply a value after "-f".',
      name: 'MissingValueError',
      spelling: '-f',
    },
  ],
  [
    ['-f', 'x', '--quiet=1'],
    {
      message: 'Boolean option "--quiet" does not accept a value. Supply the flag alone.',
      name: 'UnexpectedValueError',
      spelling: '--quiet',
      value: '1',
    },
  ],
  [
    ['-f', 'x', '-f', 'y'],
    {
      message: 'Option "-f" can be supplied only once. Remove the repeated option.',
      name: 'RepeatedOptionError',
      spelling: '-f',
    },
  ],
  [
    ['-f', 'x', 'get', 'a', '-dm', '1'],
    {
      message:
        'Value option "-d" must be last in its short group. Supply its value in the next token.',
      name: 'ShortGroupError',
      reason: 'value-position',
      token: '-d',
    },
  ],
  [
    ['-qZ', '-f', 'x'],
    {
      message:
        'Short group "-qZ" mixes the global option "-q" with "-Z", which is not a global option. Supply global options as separate tokens, and local options after their command name.',
      name: 'ShortGroupError',
      reason: 'mixed-scope',
      token: '-qZ',
    },
  ],
] satisfies [string[], Record<string, unknown>][])(
  'a token fault reaches the renderer with the facts its sentence names for %j',
  (argv, expected) => {
    expect(reported(argv)).toEqual({ exitCode: 2, ...expected });
  },
);

test('an omitted option and an omitted required argument aggregate as one input failure', () => {
  expect(reported(['get'])).toEqual({
    exitCode: 2,
    message:
      'Option "--file" is required. Supply a value.\nArgument "path" requires a value. Supply a value for "path".',
    name: 'InputError',
    problems: [
      {
        input: { global: true, kind: 'option', name: 'file' },
        reason: 'missing',
        spelling: '--file',
      },
      {
        input: { global: false, kind: 'argument', name: 'path' },
        reason: 'missing',
        spelling: 'path',
      },
    ],
  });
});

test('a rejected scalar carries its identity, spelling, and the issues the schema returned', () => {
  expect(reported(['-f', 'x', 'get', 'a', '-d', 'abc'])).toEqual({
    exitCode: 2,
    message: 'Option "--depth": Use decimal digits.',
    name: 'InputError',
    problems: [
      {
        input: { global: false, kind: 'option', name: 'depth' },
        issues: [{ message: 'Use decimal digits.' }],
        reason: 'invalid',
        spelling: '--depth',
      },
    ],
  });
});

test('a shortOnly option is named by the spelling an operator would type', () => {
  expect(reported(['-f', 'x', 'get', 'a', '-m', 'fast'])).toEqual({
    exitCode: 2,
    message: 'Option "-m": Use fast or slow.',
    name: 'InputError',
    problems: [
      {
        input: { global: false, kind: 'option', name: 'mode' },
        issues: [{ message: 'Use fast or slow.' }],
        reason: 'invalid',
        spelling: '-m',
      },
    ],
  });
});

test('a rejected item in a collection keeps the path its schema reported', () => {
  expect(reported(['-f', 'x', 'get', 'a', '-F', 'ok', '-F', ''])).toEqual({
    exitCode: 2,
    message: 'Option "--field" at 1: Supply a field name.',
    name: 'InputError',
    problems: [
      {
        input: { global: false, kind: 'option', name: 'field' },
        issues: [{ message: 'Supply a field name.', path: [1] }],
        reason: 'invalid',
        spelling: '--field',
      },
    ],
  });
});

test('resolution takes the most derived registration and falls back to the base one', () => {
  expect(failures('derived', ['get'])).toEqual({
    status: 2,
    stderr:
      'input: Option "--file" is required. Supply a value.\nArgument "path" requires a value. Supply a value for "path".\n',
    stdout: 'resolved:2\n',
  });
  expect(failures('derived', ['-f', 'x', 'nope'])).toEqual({
    status: 2,
    stderr: 'usage: Unknown command "nope". Use one of: get, cache.\n',
    stdout: 'resolved:2\n',
  });
});

test('a registration for a fatal subclass answers it without answering the base', () => {
  expect(failures('fatal')).toEqual({
    status: 1,
    stderr: 'config: Config is unreadable.\n',
    stdout: 'resolved:1\n',
  });
  expect(failures('fatal-base')).toEqual({
    status: 1,
    stderr: 'Expected failure.\n',
    stdout: 'resolved:1\n',
  });
});

test.each([
  ['internal', 'internal: Unexpected failure.\n'],
  [
    'declaration',
    'declaration: Argument "files" is variadic and precedes argument "extras" on the root Command. Declare the variadic argument last.\n',
  ],
])('an author-facing %s failure reaches its registered renderer', (scenario, stderr) => {
  expect(failures(scenario)).toEqual({ status: 1, stderr, stdout: 'resolved:1\n' });
});

test('a renderer failure inside the action is reported through the registry with its cause', () => {
  expect(failures('render-failure')).toEqual({
    status: 1,
    stderr:
      'internal: Rendering output failed: Cannot render the failure. (cause: Cannot render the failure.)\n',
    stdout: 'resolved:1\n',
  });
});

test('two registrations for one class are a declaration error in core rendering', () => {
  expect(failures('duplicate', ['get'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: The Application registers two failure renderers for "InputError". Remove one registration.\n',
    stdout: 'resolved:1\n',
  });
});

test('a value that is not a registration is a declaration error', () => {
  const result = failures('foreign', ['get']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('resolved:1\n');
  expect(result.stderr).toBe(
    'Invalid declaration: The Application holds a value that is not a failure renderer. Supply the value returned by renderFailure(type, renderer).\n',
  );
});

test('a schema that rejects without an explanation reports the placeholder issue', () => {
  expect(failures('empty-issues', ['--tag', 'x'])).toEqual({
    status: 2,
    stderr: 'issue: The schema rejected this value without an explanation.\n',
    stdout: 'resolved:2\n',
  });
});

test('a broken renderer on a usage class writes the default text and returns 1', () => {
  expect(failures('broken-usage', ['-f', 'x', 'nope'])).toEqual({
    status: 1,
    stderr:
      'Invalid input: Unknown command "nope". Use one of: get, cache.\nInternal error: Rendering the failure failed: Cannot render the failure.\n',
    stdout: 'resolved:1\n',
  });
});

test.each([
  ['broken', 'Cannot render the failure.'],
  ['broken-nonstring', 'The renderer returned number instead of a string.'],
  ['broken-rejecting', 'The renderer returned object instead of a string.'],
])(
  'a failure renderer that %s falls back to the default text and a diagnostic',
  (scenario, reason) => {
    expect(failures(scenario)).toEqual({
      status: 1,
      stderr: `Expected failure.\nInternal error: Rendering the failure failed: ${reason}\n`,
      stdout: 'resolved:1\n',
    });
  },
);

test('an unusable fallback destination still resolves the failure status', () => {
  expect(failures('broken-fallback')).toEqual({
    status: 1,
    stderr: '',
    stdout: 'resolved:1\n',
  });
});
