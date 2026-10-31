import { expect, test } from 'vite-plus/test';
// Acceptance plan: see packages/core/tests/options.test.ts.

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/counted-implied.mjs', import.meta.url);

/** One run of an application the fixture builds. */
async function run(
  application: string,
  argv: string[],
  env: Record<string, string> = {},
  mode = 'run',
) {
  return await invokeFixture(fixture, [application, mode, ...argv], { env });
}

/** The values the action received, for an invocation that dispatched. */
async function received(application: string, argv: string[], env: Record<string, string> = {}) {
  const result = await run(application, argv, env);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('run:')) ?? '';
  return JSON.parse(line.slice('run:'.length));
}

/** The facts of the usage failure an invocation held, and the path routing reached. */
async function held(application: string, argv: string[]): Promise<unknown> {
  const result = await run(application, argv, {}, 'facts');
  expect(result.status).toBe(2);
  return JSON.parse(result.stderr);
}

/** The count `copyit` reads for `verbose`. */
const verbose = async (argv: string[], env: Record<string, string> = {}) =>
  await received('copyit', argv, env).then((fixtureResult) => fixtureResult.options.verbose);

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
  async (argv, count) => {
    await expect(verbose(argv)).resolves.toBe(count);
  },
);

test('a counted letter continues the walk, so a Boolean letter after it is set', async () => {
  await expect(
    received('copyit', ['-vtv']).then((fixtureResult) => fixtureResult.options),
  ).resolves.toMatchObject({ total: true, verbose: 2 });
});

test('a following plain word stays a positional input', async () => {
  await expect(
    received('copyit', ['-v', '3']).then((fixtureResult) => fixtureResult.args),
  ).resolves.toEqual({ files: ['3'] });
});

test.each([
  [['--verbose=3'], '--verbose'],
  [['-v=3'], '-v'],
  [['--chatty=3'], '--chatty'],
  [['-tv=3'], '-v'],
])(
  'a counted spelling with a value attached is the counted unexpected-value error %j',
  async (argv, spelling) => {
    await expect(run('copyit', argv)).resolves.toMatchObject({
      status: 2,
      stderr: `copyit: Counted option "${spelling}" does not accept a value. Repeat "${spelling}" to raise its count.\n`,
    });
  },
);

test('a character after a counted letter is read as a letter', async () => {
  await expect(
    run('copyit', ['-v3']).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toContain('copyit: Unknown option "-3".');
});

test('a global counted option adds its occurrences before and after the Command name', async () => {
  await expect(
    received('fetchit', ['-v', 'get', 'a.b', '-vv']).then(
      (fixtureResult) => fixtureResult.options.verbose,
    ),
  ).resolves.toBe(3);
  await expect(
    received('fetchit', ['-vv', 'get', '-v', 'a.b']).then(
      (fixtureResult) => fixtureResult.options.verbose,
    ),
  ).resolves.toBe(3);
  await expect(
    received('fetchit', ['get', 'a.b']).then((fixtureResult) => fixtureResult.options.verbose),
  ).resolves.toBe(0);
  await expect(
    received('fetchit', ['-v']).then((fixtureResult) => fixtureResult.options.verbose),
  ).resolves.toBe(1);
});

test("a plugin's counted option and one a lifecycle hook declares count as any counted option does", async () => {
  await expect(
    received('fetchit', ['-qq', 'get', '-dqd', 'a.b']).then(
      (fixtureResult) => fixtureResult.options,
    ),
  ).resolves.toEqual({
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
  async (env, count) => {
    await expect(verbose([], env)).resolves.toBe(count);
  },
);

test('one occurrence beats the variable', async () => {
  await expect(verbose(['-v'], { VERBOSE: '2' })).resolves.toBe(1);
});

test.each(['x', '-1', '1.5', ' 3', 'three'])(
  'a variable outside the count grammar fills nothing and is a usage failure (%j)',
  async (value) => {
    await expect(run('copyit', [], { VERBOSE: value })).resolves.toMatchObject({
      status: 2,
      stderr: 'copyit: Option "--verbose" (from VERBOSE): Use a whole number of 0 or more.\n',
    });
  },
);

test('a configuration answer of a whole number fills the count when nothing else supplied it', async () => {
  const answered = { FIXTURE_SETTINGS: JSON.stringify({ verbose: 3 }) };
  await expect(verbose([], answered)).resolves.toBe(3);
  await expect(verbose(['-v'], answered)).resolves.toBe(1);
  await expect(verbose([], { FIXTURE_SETTINGS: JSON.stringify({ verbose: 0 }) })).resolves.toBe(0);
});

test.each([['3'], [-1], [1.5], [true]])(
  'a configuration answer that is not a whole number of 0 or more is the source fault (%j)',
  async (value) => {
    const result = await run('copyit', [], {
      FIXTURE_SETTINGS: JSON.stringify({ verbose: value }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Plugin "@fixture/settings" answered option "verbose" with a value that is not a whole number of 0 or more.',
    );
  },
);

/** The raw tokens a validator read, as the fixture's probe prints them. */
async function suppliedLine(argv: string[]): Promise<string | undefined> {
  return await run('copyit', argv).then((fixtureResult) =>
    fixtureResult.stdout.split('\n').find((line) => line.startsWith('supplied:')),
  );
}

test('a validator reads a counted option as its number of occurrences, and an omitted one as undefined', async () => {
  await expect(suppliedLine(['-vv'])).resolves.toContain('"verbose":2');
  await expect(suppliedLine([])).resolves.toContain('supplied:');
  await expect(suppliedLine([])).resolves.not.toContain('"verbose"');
});

test("a parent's own counted option rebinds to the routed Command's counted option and adds to its count", async () => {
  await expect(
    received('rebind', ['-c', 'count', 'a', '-c']).then(
      (fixtureResult) => fixtureResult.options.count,
    ),
  ).resolves.toBe(2);
  await expect(
    received('rebind', ['-cc', 'count', 'a', '--count']).then(
      (fixtureResult) => fixtureResult.options.count,
    ),
  ).resolves.toBe(3);
});

test('inspection publishes a counted option as a count node with no value facts', async () => {
  const result = await run('fetchit', [], {}, 'inspect');
  expect(result.stderr).toBe('');
  const [verboseNode, quietNode, depthNode] = JSON.parse(result.stdout);
  expect(verboseNode).toEqual({
    aliases: [],
    control: false,
    deprecated: undefined,
    description: undefined,
    env: [],
    extensions: {},
    hidden: false,
    long: '--verbose',
    name: 'verbose',
    quiet: false,
    schema: null,
    short: '-v',
    type: 'count',
    verbose: false,
  });
  expect(Object.keys(quietNode).toSorted()).toEqual(Object.keys(verboseNode).toSorted());
  expect(depthNode).toMatchObject({ long: '--depth', name: 'depth', short: '-d', type: 'count' });
});

/** Where `locate` places the last of the words, read against `copyit`. */
async function located(words: string[]): Promise<unknown> {
  return JSON.parse(
    await run('copyit', words, {}, 'locate').then((fixtureResult) => fixtureResult.stdout),
  );
}

test('locate reads a counted spelling as an option word, never awaiting a value', async () => {
  await expect(located(['-v', '--'])).resolves.toMatchObject({
    kind: 'option',
    supplied: ['verbose'],
  });
  await expect(located(['-vv', ''])).resolves.toMatchObject({ kind: 'argument' });
  await expect(located(['--verbose='])).resolves.toEqual({ kind: 'none' });
  await expect(located(['-v', '-v', '-t'])).resolves.toMatchObject({
    kind: 'option',
    prefix: '-t',
  });
});

test("an option position counts each counted option's earlier occurrences across every spelling", async () => {
  await expect(located(['-v', '-vv', '--chatty', '-t', '--'])).resolves.toMatchObject({
    counts: { verbose: 4 },
    kind: 'option',
    supplied: ['verbose', 'total'],
  });
  await expect(located(['--'])).resolves.toMatchObject({
    counts: {},
    kind: 'option',
  });
});

test('a held fault names the counted spelling', async () => {
  await expect(held('copyit', ['-vv=1'])).resolves.toMatchObject({
    name: 'UnexpectedValueError',
    spelling: '-v',
  });
});
