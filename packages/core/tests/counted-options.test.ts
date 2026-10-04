import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/counted-implied.mjs', import.meta.url);

/** One run of an application the fixture builds. */
function run(application: string, argv: string[], env: Record<string, string> = {}, mode = 'run') {
  return invoke(fixture, [application, mode, ...argv], { env });
}

/** The values the action received, for an invocation that dispatched. */
function received(application: string, argv: string[], env: Record<string, string> = {}) {
  const result = run(application, argv, env);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('run:')) ?? '';
  return JSON.parse(line.slice('run:'.length));
}

/** The facts of the usage failure an invocation held, and the path routing reached. */
function held(application: string, argv: string[]): unknown {
  const result = run(application, argv, {}, 'facts');
  expect(result.status).toBe(2);
  return JSON.parse(result.stderr);
}

/** The count `copyit` reads for `verbose`. */
const verbose = (argv: string[], env: Record<string, string> = {}) =>
  received('copyit', argv, env).options.verbose;

test.each([
  [['-vvv'], 3],
  [['-v', '-v', '-v'], 3],
  [['--verbose', '-vv'], 3],
  [['-vv', '--verbose'], 3],
  [['--chatty', '-v', '--verbose'], 3],
  [['-tvv'], 2],
  [[], 0],
] satisfies [string[], number][])(
  'a counted option counts every occurrence of %j',
  (argv, count) => {
    expect(verbose(argv)).toBe(count);
  },
);

test('a counted letter continues the walk, so a Boolean letter after it is set', () => {
  expect(received('copyit', ['-vtv']).options).toMatchObject({ total: true, verbose: 2 });
});

test('a following plain word stays a positional input', () => {
  expect(received('copyit', ['-v', '3']).args).toEqual({ files: ['3'] });
});

test.each([
  [['--verbose=3'], '--verbose'],
  [['-v=3'], '-v'],
  [['--chatty=3'], '--chatty'],
  [['-tv=3'], '-v'],
])(
  'a counted spelling with a value attached is the counted unexpected-value error %j',
  (argv, spelling) => {
    expect(run('copyit', argv)).toMatchObject({
      status: 2,
      stderr: `copyit: Counted option "${spelling}" does not accept a value. Repeat "${spelling}" to raise its count.\n`,
    });
  },
);

test('a character after a counted letter is read as a letter', () => {
  expect(run('copyit', ['-v3']).stderr).toContain('copyit: Unknown option "-3".');
});

test('a global counted option adds its occurrences before and after the Command name', () => {
  expect(received('fetchit', ['-v', 'get', 'a.b', '-vv']).options.verbose).toBe(3);
  expect(received('fetchit', ['-vv', 'get', '-v', 'a.b']).options.verbose).toBe(3);
  expect(received('fetchit', ['get', 'a.b']).options.verbose).toBe(0);
  expect(received('fetchit', ['-v']).options.verbose).toBe(1);
});

test("a plugin's counted option and one a lifecycle hook declares count as any counted option does", () => {
  expect(received('fetchit', ['-qq', 'get', '-dqd', 'a.b']).options).toEqual({
    depth: 2,
    quiet: 3,
    verbose: 0,
  });
});

test.each([
  [{ VERBOSE: '3' }, 3],
  [{ VERBOSE: '0' }, 0],
  [{ VERBOSE: '007' }, 7],
  [{ VERBOSE: '12' }, 12],
  [{ VERBOSE: '' }, 0],
])(
  'a variable of decimal digits fills the count when no occurrence supplied it %j',
  (env, count) => {
    expect(verbose([], env)).toBe(count);
  },
);

test('one occurrence beats the variable', () => {
  expect(verbose(['-v'], { VERBOSE: '2' })).toBe(1);
});

test.each(['x', '-1', '1.5', ' 3', 'three'])(
  'a variable outside the count grammar fills nothing and is a usage failure (%j)',
  (value) => {
    expect(run('copyit', [], { VERBOSE: value })).toMatchObject({
      status: 2,
      stderr: 'copyit: Option "--verbose" (from VERBOSE): Use a whole number of 0 or more.\n',
    });
  },
);

test('a configuration answer of a whole number fills the count when nothing else supplied it', () => {
  const answered = { FIXTURE_SETTINGS: JSON.stringify({ verbose: 3 }) };
  expect(verbose([], answered)).toBe(3);
  expect(verbose(['-v'], answered)).toBe(1);
  expect(verbose([], { FIXTURE_SETTINGS: JSON.stringify({ verbose: 0 }) })).toBe(0);
});

test.each([['3'], [-1], [1.5], [true]])(
  'a configuration answer that is not a whole number of 0 or more is the source fault (%j)',
  (value) => {
    const result = run('copyit', [], { FIXTURE_SETTINGS: JSON.stringify({ verbose: value }) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Plugin "@fixture/settings" answered option "verbose" with a value that is not a whole number of 0 or more.',
    );
  },
);

/** The raw tokens a validator read, as the fixture's probe prints them. */
function suppliedLine(argv: string[]): string | undefined {
  return run('copyit', argv)
    .stdout.split('\n')
    .find((line) => line.startsWith('supplied:'));
}

test('a validator reads a counted option as its number of occurrences, and an omitted one as undefined', () => {
  expect(suppliedLine(['-vv'])).toContain('"verbose":2');
  expect(suppliedLine([])).toContain('supplied:');
  expect(suppliedLine([])).not.toContain('"verbose"');
});

test("a parent's own counted option rebinds to the routed Command's counted option and adds to its count", () => {
  expect(received('rebind', ['-c', 'count', 'a', '-c']).options.count).toBe(2);
  expect(received('rebind', ['-cc', 'count', 'a', '--count']).options.count).toBe(3);
});

test('inspection publishes a counted option as a count node with no value facts', () => {
  const result = run('fetchit', [], {}, 'inspect');
  expect(result.stderr).toBe('');
  const [verboseNode, quietNode, depthNode] = JSON.parse(result.stdout);
  expect(verboseNode).toEqual({
    aliases: [],
    deprecated: undefined,
    description: undefined,
    env: null,
    extensions: {},
    hidden: false,
    long: '--verbose',
    name: 'verbose',
    schema: null,
    short: '-v',
    type: 'count',
  });
  expect(Object.keys(quietNode).toSorted()).toEqual(Object.keys(verboseNode).toSorted());
  expect(depthNode).toMatchObject({ long: '--depth', name: 'depth', short: '-d', type: 'count' });
});

/** Where `locate` places the last of the words, read against `copyit`. */
function located(words: string[]): unknown {
  return JSON.parse(run('copyit', words, {}, 'locate').stdout);
}

test('locate reads a counted spelling as an option word, never awaiting a value', () => {
  expect(located(['-v', '--'])).toMatchObject({ kind: 'option', supplied: ['verbose'] });
  expect(located(['-vv', ''])).toMatchObject({ kind: 'argument' });
  expect(located(['--verbose='])).toEqual({ kind: 'none' });
  expect(located(['-v', '-v', '-t'])).toMatchObject({ kind: 'option', prefix: '-t' });
});

test('a held fault names the counted spelling', () => {
  expect(held('copyit', ['-vv=1'])).toMatchObject({
    name: 'UnexpectedValueError',
    spelling: '-v',
  });
});
