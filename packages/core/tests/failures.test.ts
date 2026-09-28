import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function failures(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/failures.mjs', import.meta.url), [scenario, ...argv]);
}

/** The override serializes the failure, so a test reads the facts it received. */
function reported(argv: string[], scenario = 'usage', status = 2): unknown {
  const result = failures(scenario, argv);
  expect(result.stdout).toBe(`resolved:${status}\n`);
  expect(result.status).toBe(status);
  return JSON.parse(result.stderr);
}

test('an unknown command reaches the view with its token and the callable names', () => {
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
    ['-fhunter2', 'get', 'a'],
    {
      message:
        'Value option "-f" must be last in its short group. Supply its value in the next token.',
      name: 'ShortGroupError',
      reason: 'value-position',
      token: '-f',
    },
  ],
  [
    ['-qfhunter2', 'get', 'a'],
    {
      message:
        'Value option "-f" must be last in its short group. Supply its value in the next token.',
      name: 'ShortGroupError',
      reason: 'value-position',
      token: '-f',
    },
  ],
  [
    ['-qZ', '-f', 'x'],
    {
      message:
        'A short group mixes the global option "-q" with "-Z", which is not a global option. Supply global options as separate tokens, and local options after their command name.',
      name: 'ShortGroupError',
      reason: 'mixed-scope',
      token: '-qZ',
    },
  ],
  [
    ['-qmhunter2', '-f', 'x'],
    {
      message:
        'A short group mixes the global option "-q" with "-m", which is not a global option. Supply global options as separate tokens, and local options after their command name.',
      name: 'ShortGroupError',
      reason: 'mixed-scope',
      token: '-qmhunter2',
    },
  ],
  [
    ['-qm=hunter2', '-f', 'x'],
    {
      message:
        'A short group mixes the global option "-q" with "-m", which is not a global option. Supply global options as separate tokens, and local options after their command name.',
      name: 'ShortGroupError',
      reason: 'mixed-scope',
      token: '-qm=hunter2',
    },
  ],
] satisfies [string[], Record<string, unknown>][])(
  'a token fault reaches the view with the facts its sentence names for %j',
  (argv, expected) => {
    expect(reported(argv)).toEqual({ exitCode: 2, ...expected });
  },
);

test('an omitted option and an omitted required argument aggregate as one input failure', () => {
  expect(reported(['get'], 'required')).toEqual({
    exitCode: 2,
    message:
      'Argument "path" requires a value. Supply a value for "path".\nOption "--depth" is required. Supply a value.',
    name: 'InputError',
    problems: [
      {
        input: { global: false, kind: 'argument', name: 'path' },
        reason: 'missing',
        spelling: 'path',
      },
      {
        input: { global: false, kind: 'option', name: 'depth' },
        reason: 'missing',
        spelling: '--depth',
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

test('a rejected value in a multiple option is reported at its position, with its own fields', () => {
  expect(reported(['-f', 'x', 'get', 'a', '-F', 'ok', '-F', ''])).toEqual({
    exitCode: 2,
    message: 'Option "--field" at 1: Supply a field name.',
    name: 'InputError',
    problems: [
      {
        input: { global: false, kind: 'option', name: 'field' },
        // Zod's own issue fields survive, and core rewrites only the path.
        issues: [
          {
            code: 'too_small',
            inclusive: true,
            message: 'Supply a field name.',
            minimum: 1,
            origin: 'string',
            path: [1],
          },
        ],
        reason: 'invalid',
        spelling: '--field',
      },
    ],
  });
});

test('resolution takes the most derived override and falls back to the base one', () => {
  expect(failures('derived', ['get'])).toEqual({
    status: 2,
    stderr: 'input: Argument "path" requires a value. Supply a value for "path".\n',
    stdout: 'resolved:2\n',
  });
  expect(failures('derived', ['-f', 'x', 'nope'])).toEqual({
    status: 2,
    stderr: 'usage: Unknown command "nope". Use one of: get, cache.\n',
    stdout: 'resolved:2\n',
  });
});

test('an override for a fatal subclass answers it without answering the base', () => {
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
  ['declaration', 'declaration: The root Command has no action. Register an action.\n'],
])('an author-facing %s failure reaches its override', (scenario, stderr) => {
  expect(failures(scenario)).toEqual({ status: 1, stderr, stdout: 'resolved:1\n' });
});

test('a view failure inside the action is reported through the registry with its cause', () => {
  expect(failures('render-failure')).toEqual({
    status: 1,
    stderr:
      'internal: Rendering output failed: Cannot render the failure. (cause: Cannot render the failure.)\n',
    stdout: 'resolved:1\n',
  });
});

test('two overrides for one class throw from the Application constructor', () => {
  expect(failures('duplicate', ['get'])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'thrown:1: The Application overrides the view for "InputError" twice. Remove one override.\n',
  });
});

test('a value that is not an override throws from the Application constructor', () => {
  expect(failures('foreign', ['get'])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'thrown:1: The Application holds a value that is not a view override. Supply the value returned by override(key, view).\n',
  });
});

test('a validator that rejects without an explanation reports the placeholder issue', () => {
  expect(failures('empty-issues', ['--tag', 'x'])).toEqual({
    status: 2,
    stderr:
      'issue: The validator rejected this value without an explanation. Supply a different value.\n',
    stdout: 'resolved:2\n',
  });
});

/** A right-to-left override, which would reorder the rest of a line on a terminal. */
const rightToLeft = '\u{202e}';

/** The escape a sentence writes in the override's place, backslash included. */
const rightToLeftEscape = String.raw`\u202e`;

/** A developer emoji: a zero-width joiner between two emoji, which is ordinary text. */
const developer = '\u{1f469}\u{200d}\u{1f4bb}';

test('the default text opens a usage failure with the application name', () => {
  expect(failures('default', ['-f', 'x', 'nope'])).toEqual({
    status: 2,
    stderr: 'failures: Unknown command "nope". Use one of: get, cache.\n',
    stdout: 'resolved:2\n',
  });
});

test.each([
  [
    'an unknown command',
    [`a${rightToLeft}b`],
    `failures: Unknown command "a${rightToLeftEscape}b". Use one of: get, cache.\n`,
  ],
  [
    'an unknown option',
    ['get', 'x', `--a${rightToLeft}b`],
    `failures: Unknown option "--a${rightToLeftEscape}b". Supply a declared option; prefix a hyphenated path with "./".\n`,
  ],
  [
    'a mixed short group',
    [`-q${rightToLeft}`],
    `failures: A short group mixes the global option "-q" with "-${rightToLeftEscape}", which is not a global option. Supply global options as separate tokens, and local options after their command name.\n`,
  ],
  [
    'an issue path',
    ['get', 'x', '--key', `a${rightToLeft}b`],
    `failures: Option "--key" at a${rightToLeftEscape}b: Supply a known key.\n`,
  ],
])('the default text escapes a right-to-left override in %s', (_subject, argv, stderr) => {
  expect(failures('default', argv)).toEqual({ status: 2, stderr, stdout: 'resolved:2\n' });
});

test('the default text keeps a zero-width joiner inside an emoji as it is', () => {
  expect(failures('default', [developer])).toEqual({
    status: 2,
    stderr: `failures: Unknown command "${developer}". Use one of: get, cache.\n`,
    stdout: 'resolved:2\n',
  });
});

test('a failure keeps the raw token while its sentence escapes it', () => {
  expect(reported([`a${rightToLeft}b`])).toEqual({
    candidates: ['get', 'cache'],
    exitCode: 2,
    message: `Unknown command "a${rightToLeftEscape}b". Use one of: get, cache.`,
    name: 'UnknownCommandError',
    token: `a${rightToLeft}b`,
  });
  expect(reported([`-q${rightToLeft}`])).toMatchObject({
    name: 'ShortGroupError',
    reason: 'mixed-scope',
    token: `-q${rightToLeft}`,
  });
  expect(reported(['get', 'x', `--a${rightToLeft}`])).toMatchObject({
    message: `Unknown option "--a${rightToLeftEscape}". Supply a declared option; prefix a hyphenated path with "./".`,
    name: 'UnknownOptionError',
    spelling: `--a${rightToLeft}`,
  });
  expect(reported(['get', 'x', '--key', `a${rightToLeft}b`])).toMatchObject({
    problems: [{ issues: [{ path: [`a${rightToLeft}b`] }] }],
  });
});

test('a broken view on a usage class writes the default text and returns 1', () => {
  expect(failures('broken-usage', ['-f', 'x', 'nope'])).toEqual({
    status: 1,
    stderr:
      'failures: Unknown command "nope". Use one of: get, cache.\nInternal error: Rendering the failure failed: Cannot render the failure.\n',
    stdout: 'resolved:1\n',
  });
});

test.each([
  ['broken', 'Cannot render the failure.'],
  ['broken-nonstring', 'The view returned number instead of a string.'],
  ['broken-rejecting', 'The view returned object instead of a string.'],
])('a failure view that %s falls back to the default text and a diagnostic', (scenario, reason) => {
  expect(failures(scenario)).toEqual({
    status: 1,
    stderr: `Expected failure.\nInternal error: Rendering the failure failed: ${reason}\n`,
    stdout: 'resolved:1\n',
  });
});

test('an unusable fallback destination still resolves the failure status', () => {
  expect(failures('broken-fallback')).toEqual({
    status: 1,
    stderr: '',
    stdout: 'resolved:1\n',
  });
});
