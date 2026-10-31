import { expect, test } from 'vite-plus/test';
// Acceptance plan: see packages/core/tests/options.test.ts.

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/parse.mjs', import.meta.url);

async function kit(argv: string[], scenario = 'kit') {
  return await invokeFixture(fixture, [scenario, ...argv]);
}

/** What the routed action received, for an invocation that dispatched. */
async function dispatched(argv: string[], scenario = 'kit'): Promise<unknown> {
  const result = await kit(argv, scenario);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const [line] = result.stdout.split('\n');
  return JSON.parse(line ?? '');
}

/** The facts of the usage failure an invocation held, and the path routing reached. */
async function held(argv: string[], scenario = 'kit'): Promise<unknown> {
  const result = await kit(argv, scenario);
  expect(result.stdout).toBe('resolved:2\n');
  expect(result.status).toBe(2);
  return JSON.parse(result.stderr);
}

/** The global values every action receives when no word supplies one. */
const unset = { help: false, quiet: false };

test('a short group mixes a global letter with a letter of the routed Command', async () => {
  await expect(dispatched(['-f', 'data.json', 'get', 'a.b', '-qp'])).resolves.toEqual({
    args: { path: 'a.b' },
    command: ['get'],
    options: { ...unset, file: 'data.json', pretty: true, quiet: true, raw: false },
    passthrough: [],
  });
  await expect(dispatched(['get', '-pq', 'a.b'])).resolves.toMatchObject({
    options: { pretty: true, quiet: true },
  });
});

test('routing reads global options between Command names, and a value wins over a name', async () => {
  await expect(dispatched(['--file', 'keys', 'get', 'name'])).resolves.toMatchObject({
    args: { path: 'name' },
    command: ['get'],
    options: { file: 'keys' },
  });
  await expect(dispatched(['-q', 'cache', '-f', 'x', 'clear', '--force'])).resolves.toMatchObject({
    command: ['cache', 'clear'],
    options: { file: 'x', force: true, quiet: true },
  });
});

test('a global value letter takes the rest of its group under routing', async () => {
  await expect(dispatched(['-fp', 'get', 'a.b'])).resolves.toMatchObject({
    command: ['get'],
    options: { file: 'p', pretty: false },
  });
  await expect(dispatched(['-qf=data.json', 'get', 'a.b'])).resolves.toMatchObject({
    options: { file: 'data.json', quiet: true },
  });
});

test('words after the first bare -- are never read, by routing or by the routed Command', async () => {
  await expect(dispatched(['get', 'a.b', '--', '-qp', '--file', 'x'])).resolves.toEqual({
    args: { path: 'a.b' },
    command: ['get'],
    options: { ...unset, pretty: false, raw: false },
    passthrough: ['-qp', '--file', 'x'],
  });
});

test.each([
  [
    ['-qp', '--file', 'data.json', 'get', 'a.b'],
    {
      commands: [['get']],
      message: 'Option "-p" belongs to command "get". Supply it after "get".',
      path: [],
      spelling: '-p',
    },
  ],
  [
    ['-r', 'get', 'a.b'],
    {
      commands: [['get'], ['keys']],
      message: 'Option "-r" belongs to commands get, keys. Supply it after the command name.',
      path: [],
      spelling: '-r',
    },
  ],
  [
    ['cache', '--force', 'clear'],
    {
      commands: [['cache', 'clear']],
      message: 'Option "--force" belongs to command "cache clear". Supply it after "cache clear".',
      path: ['cache'],
      spelling: '--force',
    },
  ],
] satisfies [string[], Record<string, unknown>][])(
  'an option word that stops routing names the Commands below that declare it, for %j',
  async (argv, expected) => {
    await expect(held(argv)).resolves.toEqual({
      ...expected,
      name: 'MisplacedOptionError',
    });
  },
);

test.each([
  [['-x', 'debug'], '-x', []],
  [['-y', 'fetch'], '-y', []],
  [['-z', 'get', 'a.b'], '-z', []],
  [['cache', '--verbose'], '--verbose', ['cache']],
  [['get', 'a.b', '-pz'], '-z', ['get']],
  [['get', 'a.b', '-pé'], '-é', ['get']],
] satisfies [string[], string, string[]][])(
  '%j is an unknown option, because no visible Command below declares it',
  async (argv, spelling, path) => {
    await expect(held(argv)).resolves.toEqual({
      message: `Unknown option "${spelling}". Supply a declared option; prefix a hyphenated path with "./".`,
      name: 'UnknownOptionError',
      path,
      spelling,
    });
  },
);

test("routing reads a parent's own option and carries on to the child, which receives it", async () => {
  await expect(dispatched(['-p', 'get', 'a.b'], 'rooted')).resolves.toEqual({
    args: { path: 'a.b' },
    command: ['get'],
    options: { dry: false, help: false, numbered: false, pretty: true, quiet: false, raw: false },
    passthrough: [],
  });
  await expect(dispatched(['-p'], 'rooted')).resolves.toMatchObject({
    command: [],
    options: { pretty: true },
  });
  await expect(dispatched(['-pq', 'get', '-r'], 'rooted')).resolves.toMatchObject({
    command: ['get'],
    options: { pretty: true, quiet: true, raw: true },
  });
});

test("a parent's own option reaches the Command routing reaches, at every depth", async () => {
  await expect(dispatched(['-p', 'cache', '--deep', 'list'], 'rooted')).resolves.toMatchObject({
    command: ['cache', 'list'],
    options: { deep: true, plain: true },
  });
  await expect(dispatched(['cache', '--deep'], 'rooted')).resolves.toMatchObject({
    command: ['cache'],
    options: { deep: true },
  });
});

test("a parent's own option the routed Command does not declare is an unknown option", async () => {
  await expect(held(['--verbose', 'get', 'a.b'], 'rooted')).resolves.toEqual({
    message:
      'Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".',
    name: 'UnknownOptionError',
    path: ['get'],
    spelling: '--verbose',
  });
  // The parent's option precedes the later global fault in word order, so it is the one held.
  await expect(held(['--verbose', '--quiet=1', 'get', 'a.b'], 'rooted')).resolves.toMatchObject({
    spelling: '--verbose',
  });
});

test('a value class the routed Command declares differently is misplaced, and never guessed', async () => {
  await expect(held(['-n', 'x', 'get', 'a.b'], 'rooted')).resolves.toEqual({
    commands: [['get']],
    message: 'Option "-n" belongs to command "get". Supply it after "get".',
    name: 'MisplacedOptionError',
    path: ['get'],
    spelling: '-n',
  });
});

/** The fault a spelling `get` declares with another value class than the root reports. */
function misplacedOnGet(spelling: string) {
  return {
    commands: [['get']],
    message: `Option "${spelling}" belongs to command "get". Supply it after "get".`,
    name: 'MisplacedOptionError',
    path: ['get'],
    spelling,
  };
}

test("a parent's own option that faulted under its declaration is misplaced when the routed Command declares another class", async () => {
  await expect(held(['--level=3', 'get', 'a.b'], 'rooted')).resolves.toEqual(
    misplacedOnGet('--level'),
  );
  await expect(held(['--dry', '-q', 'get', 'a.b'], 'rooted')).resolves.toEqual(
    misplacedOnGet('--dry'),
  );
  await expect(held(['--dry', '-q', '--quiet=1', 'get', 'a.b'], 'rooted')).resolves.toEqual(
    misplacedOnGet('--dry'),
  );
  // The same class keeps the fault the parent's declaration found.
  await expect(held(['--pretty=1', 'get', 'a.b'], 'rooted')).resolves.toMatchObject({
    name: 'UnexpectedValueError',
    path: ['get'],
    spelling: '--pretty',
  });
  await expect(held(['--verbose=1', 'get', 'a.b'], 'rooted')).resolves.toMatchObject({
    name: 'UnknownOptionError',
    spelling: '--verbose',
  });
});

test("a plain word after a parent's own option that names no child is the unknown command", async () => {
  await expect(held(['-p', 'nope'], 'rooted')).resolves.toEqual({
    message: 'Unknown command "nope". Use one of: get, cache.',
    name: 'UnknownCommandError',
    path: [],
  });
});

test("an option word the routed Command's table lacks is misplaced, wherever routing stopped", async () => {
  await expect(held(['-p', '-r', 'get'], 'rooted')).resolves.toEqual({
    commands: [['get']],
    message: 'Option "-r" belongs to command "get". Supply it after "get".',
    name: 'MisplacedOptionError',
    path: [],
    spelling: '-r',
  });
});

test('a deprecated group hides the letters below it, until routing reaches it', async () => {
  await expect(held(['-x', 'old', 'sub'])).resolves.toEqual({
    message: 'Unknown option "-x". Supply a declared option; prefix a hyphenated path with "./".',
    name: 'UnknownOptionError',
    path: [],
    spelling: '-x',
  });
  await expect(held(['old', '-x', 'sub'])).resolves.toEqual({
    commands: [['old', 'sub']],
    message: 'Option "-x" belongs to command "old sub". Supply it after "old sub".',
    name: 'MisplacedOptionError',
    path: ['old'],
    spelling: '-x',
  });
});

test('a repeated letter ends its walk, so routing never reads the letters after it', async () => {
  const repeated = {
    message: 'Option "-q" can be supplied only once. Remove the repeated option.',
    name: 'RepeatedOptionError',
    path: ['get'],
    spelling: '-q',
  };
  await expect(held(['-q', '-qp', 'get', 'a.b'])).resolves.toEqual(repeated);
  await expect(held(['-qqp', 'get', 'a.b'])).resolves.toEqual(repeated);
  await expect(held(['get', 'a.b', '-p', '-ph'])).resolves.toMatchObject({
    name: 'RepeatedOptionError',
    spelling: '-p',
  });
});

test('a misplaced option is held, so help takes it over on the Command routing reached', async () => {
  await expect(kit(['-qp', '-f', 'data.json', 'get', 'a.b', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:[]\nresolved:0\n',
  });
  await expect(
    kit(['cache', '--verbose', '-h']).then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe('help:[cache]\nresolved:0\n');
});

test('an unknown command is raised before the chain, so help never takes it over', async () => {
  await expect(held(['nope', '--help'])).resolves.toEqual({
    message: 'Unknown command "nope". Use one of: get, keys, cache.',
    name: 'UnknownCommandError',
    path: [],
  });
  await expect(held(['cache', 'nope', '-h'])).resolves.toMatchObject({
    path: ['cache'],
  });
});

test('a structural fault on a global option is held, and routing continues past it', async () => {
  await expect(held(['--file'])).resolves.toEqual({
    message: 'Option "--file" requires a value. Supply a value after "--file".',
    name: 'MissingValueError',
    path: [],
    spelling: '--file',
  });
  await expect(held(['--file', '-q', 'get', 'a.b'])).resolves.toEqual({
    message:
      'Option "--file" requires a value. Supply a value after "--file", or attach one that starts with a hyphen as "--file=<value>".',
    name: 'MissingValueError',
    path: ['get'],
    spelling: '--file',
  });
  await expect(held(['get', 'a.b', '-f', '--'])).resolves.toMatchObject({
    message:
      'Option "-f" requires a value. Supply a value after "-f", or attach one that starts with a hyphen as "-f=<value>".',
    spelling: '-f',
  });
  await expect(held(['--quiet=1', 'get', 'a.b'])).resolves.toEqual({
    message: 'Boolean option "--quiet" does not accept a value. Supply the flag alone.',
    name: 'UnexpectedValueError',
    path: ['get'],
    spelling: '--quiet',
  });
  await expect(held(['--file', 'one.json', 'get', 'a.b', '-f', 'two.json'])).resolves.toEqual({
    message: 'Option "-f" can be supplied only once. Remove the repeated option.',
    name: 'RepeatedOptionError',
    path: ['get'],
    spelling: '-f',
  });
});

test('parsing continues past a fault, so help after it still takes the invocation over', async () => {
  for (const argv of [
    ['--file', '--help'],
    ['--help', '--help'],
    ['-hx'],
    ['get', '--nope', '-h'],
  ]) {
    await expect(kit(argv).then((fixtureResult) => fixtureResult.stdout)).resolves.toMatch(
      /^help:\[[a-z ]*\]\nresolved:0\n$/u,
    );
  }
});

test('a faulted occurrence supplies nothing, and the letters after a faulted letter are not read', async () => {
  await expect(held(['--help=x'])).resolves.toMatchObject({
    name: 'UnexpectedValueError',
    spelling: '--help',
  });
  await expect(held(['-xh'])).resolves.toMatchObject({
    name: 'UnknownOptionError',
    spelling: '-x',
  });
  await expect(held(['get', 'a.b', '-ph=1'])).resolves.toMatchObject({
    name: 'UnexpectedValueError',
    spelling: '-h',
  });
});

test('the first structural fault in word order is held, and each outranks a missing input', async () => {
  await expect(held(['get', 'a.b', 'extra', '--nope'])).resolves.toEqual({
    message: 'Command "get" accepts 1 argument. Remove the extra values.',
    name: 'UnexpectedArgumentError',
    path: ['get'],
  });
  await expect(held(['get', 'a.b', '--nope', 'extra'])).resolves.toMatchObject({
    name: 'UnknownOptionError',
    spelling: '--nope',
  });
  await expect(held(['get', '--nope'])).resolves.toMatchObject({
    name: 'UnknownOptionError',
  });
  await expect(held(['get'])).resolves.toMatchObject({
    name: 'InputError',
    path: ['get'],
  });
});

test("a group's missing subcommand ranks after every structural fault", async () => {
  await expect(held(['cache'])).resolves.toEqual({
    message: 'Command "cache" requires a subcommand. Use one of: clear, list.',
    name: 'NonCallableCommandError',
    path: ['cache'],
  });
  await expect(held(['cache', '-q'])).resolves.toMatchObject({
    name: 'NonCallableCommandError',
  });
  await expect(held(['cache', '--verbose'])).resolves.toMatchObject({
    name: 'UnknownOptionError',
  });
});

test('options is null when a global option faults, and a fault on a local option leaves it set', async () => {
  const values = '{"quiet":false,"help":false}';
  await expect(
    kit(['get', 'a.b'], 'observed').then((fixtureResult) =>
      fixtureResult.stdout.startsWith(`observed:${values}:request\n`),
    ),
  ).resolves.toBe(true);
  await expect(
    kit(['get', 'a.b', '--nope'], 'observed').then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe(`observed:${values}:null\nresolved:2\n`);
  await expect(
    kit(['cache'], 'observed').then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe(`observed:${values}:null\nresolved:2\n`);
  for (const argv of [
    ['get', 'a.b', '-q', '-q'],
    ['--quiet=yes', 'get', 'a.b'],
    ['get', 'a.b', '--nope', '--file'],
  ]) {
    await expect(kit(argv, 'observed').then((fixtureResult) => fixtureResult.stdout)).resolves.toBe(
      'observed:null:null\nresolved:2\n',
    );
  }
});
