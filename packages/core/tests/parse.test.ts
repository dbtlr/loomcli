import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/parse.mjs', import.meta.url);

function kit(argv: string[], scenario = 'kit') {
  return invoke(fixture, [scenario, ...argv]);
}

/** What the routed action received, for an invocation that dispatched. */
function dispatched(argv: string[], scenario = 'kit'): unknown {
  const result = kit(argv, scenario);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const [line] = result.stdout.split('\n');
  return JSON.parse(line ?? '');
}

/** The facts of the usage failure an invocation held, and the path routing reached. */
function held(argv: string[], scenario = 'kit'): unknown {
  const result = kit(argv, scenario);
  expect(result.stdout).toBe('resolved:2\n');
  expect(result.status).toBe(2);
  return JSON.parse(result.stderr);
}

/** The global values every action receives when no word supplies one. */
const unset = { help: false, quiet: false };

test('a short group mixes a global letter with a letter of the routed Command', () => {
  expect(dispatched(['-f', 'data.json', 'get', 'a.b', '-qp'])).toEqual({
    args: { path: 'a.b' },
    command: ['get'],
    options: { ...unset, file: 'data.json', pretty: true, quiet: true, raw: false },
    passthrough: [],
  });
  expect(dispatched(['get', '-pq', 'a.b'])).toMatchObject({
    options: { pretty: true, quiet: true },
  });
});

test('routing reads global options between Command names, and a value wins over a name', () => {
  expect(dispatched(['--file', 'keys', 'get', 'name'])).toMatchObject({
    args: { path: 'name' },
    command: ['get'],
    options: { file: 'keys' },
  });
  expect(dispatched(['-q', 'cache', '-f', 'x', 'clear', '--force'])).toMatchObject({
    command: ['cache', 'clear'],
    options: { file: 'x', force: true, quiet: true },
  });
});

test('a global value letter takes the rest of its group under routing', () => {
  expect(dispatched(['-fp', 'get', 'a.b'])).toMatchObject({
    command: ['get'],
    options: { file: 'p', pretty: false },
  });
  expect(dispatched(['-qf=data.json', 'get', 'a.b'])).toMatchObject({
    options: { file: 'data.json', quiet: true },
  });
});

test('words after the first bare -- are never read, by routing or by the routed Command', () => {
  expect(dispatched(['get', 'a.b', '--', '-qp', '--file', 'x'])).toEqual({
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
  (argv, expected) => {
    expect(held(argv)).toEqual({ ...expected, name: 'MisplacedOptionError' });
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
  (argv, spelling, path) => {
    expect(held(argv)).toEqual({
      message: `Unknown option "${spelling}". Supply a declared option; prefix a hyphenated path with "./".`,
      name: 'UnknownOptionError',
      path,
      spelling,
    });
  },
);

test("routing reads a parent's own option and carries on to the child, which receives it", () => {
  expect(dispatched(['-p', 'get', 'a.b'], 'rooted')).toEqual({
    args: { path: 'a.b' },
    command: ['get'],
    options: { help: false, numbered: false, pretty: true, quiet: false, raw: false },
    passthrough: [],
  });
  expect(dispatched(['-p'], 'rooted')).toMatchObject({ command: [], options: { pretty: true } });
  expect(dispatched(['-pq', 'get', '-r'], 'rooted')).toMatchObject({
    command: ['get'],
    options: { pretty: true, quiet: true, raw: true },
  });
});

test("a parent's own option reaches the Command routing reaches, at every depth", () => {
  expect(dispatched(['-p', 'cache', '--deep', 'list'], 'rooted')).toMatchObject({
    command: ['cache', 'list'],
    options: { deep: true, plain: true },
  });
  expect(dispatched(['cache', '--deep'], 'rooted')).toMatchObject({
    command: ['cache'],
    options: { deep: true },
  });
});

test("a parent's own option the routed Command does not declare is an unknown option", () => {
  expect(held(['--verbose', 'get', 'a.b'], 'rooted')).toEqual({
    message:
      'Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".',
    name: 'UnknownOptionError',
    path: ['get'],
    spelling: '--verbose',
  });
  // The parent's option precedes the later global fault in word order, so it is the one held.
  expect(held(['--verbose', '--quiet=1', 'get', 'a.b'], 'rooted')).toMatchObject({
    spelling: '--verbose',
  });
});

test('a value class the routed Command declares differently is misplaced, and never guessed', () => {
  expect(held(['-n', 'x', 'get', 'a.b'], 'rooted')).toEqual({
    commands: [['get']],
    message: 'Option "-n" belongs to command "get". Supply it after "get".',
    name: 'MisplacedOptionError',
    path: ['get'],
    spelling: '-n',
  });
});

test("a plain word after a parent's own option that names no child is the unknown command", () => {
  expect(held(['-p', 'nope'], 'rooted')).toEqual({
    message: 'Unknown command "nope". Use one of: get, cache.',
    name: 'UnknownCommandError',
    path: [],
  });
});

test("an option word the routed Command's table lacks is misplaced, wherever routing stopped", () => {
  expect(held(['-p', '-r', 'get'], 'rooted')).toEqual({
    commands: [['get']],
    message: 'Option "-r" belongs to command "get". Supply it after "get".',
    name: 'MisplacedOptionError',
    path: [],
    spelling: '-r',
  });
});

test('a deprecated group hides the letters below it, until routing reaches it', () => {
  expect(held(['-x', 'old', 'sub'])).toEqual({
    message: 'Unknown option "-x". Supply a declared option; prefix a hyphenated path with "./".',
    name: 'UnknownOptionError',
    path: [],
    spelling: '-x',
  });
  expect(held(['old', '-x', 'sub'])).toEqual({
    commands: [['old', 'sub']],
    message: 'Option "-x" belongs to command "old sub". Supply it after "old sub".',
    name: 'MisplacedOptionError',
    path: ['old'],
    spelling: '-x',
  });
});

test('a repeated letter ends its walk, so routing never reads the letters after it', () => {
  const repeated = {
    message: 'Option "-q" can be supplied only once. Remove the repeated option.',
    name: 'RepeatedOptionError',
    path: ['get'],
    spelling: '-q',
  };
  expect(held(['-q', '-qp', 'get', 'a.b'])).toEqual(repeated);
  expect(held(['-qqp', 'get', 'a.b'])).toEqual(repeated);
  expect(held(['get', 'a.b', '-p', '-ph'])).toMatchObject({
    name: 'RepeatedOptionError',
    spelling: '-p',
  });
});

test('a misplaced option is held, so help takes it over on the Command routing reached', () => {
  expect(kit(['-qp', '-f', 'data.json', 'get', 'a.b', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:[]\nresolved:0\n',
  });
  expect(kit(['cache', '--verbose', '-h']).stdout).toBe('help:[cache]\nresolved:0\n');
});

test('an unknown command is raised before the chain, so help never takes it over', () => {
  expect(held(['nope', '--help'])).toEqual({
    message: 'Unknown command "nope". Use one of: get, keys, cache.',
    name: 'UnknownCommandError',
    path: [],
  });
  expect(held(['cache', 'nope', '-h'])).toMatchObject({ path: ['cache'] });
});

test('a structural fault on a global option is held, and routing continues past it', () => {
  expect(held(['--file'])).toEqual({
    message: 'Option "--file" requires a value. Supply a value after "--file".',
    name: 'MissingValueError',
    path: [],
    spelling: '--file',
  });
  expect(held(['--file', '-q', 'get', 'a.b'])).toEqual({
    message:
      'Option "--file" requires a value. Supply a value after "--file", or attach one that starts with a hyphen as "--file=<value>".',
    name: 'MissingValueError',
    path: ['get'],
    spelling: '--file',
  });
  expect(held(['get', 'a.b', '-f', '--'])).toMatchObject({
    message:
      'Option "-f" requires a value. Supply a value after "-f", or attach one that starts with a hyphen as "-f=<value>".',
    spelling: '-f',
  });
  expect(held(['--quiet=1', 'get', 'a.b'])).toEqual({
    message: 'Boolean option "--quiet" does not accept a value. Supply the flag alone.',
    name: 'UnexpectedValueError',
    path: ['get'],
    spelling: '--quiet',
  });
  expect(held(['--file', 'one.json', 'get', 'a.b', '-f', 'two.json'])).toEqual({
    message: 'Option "-f" can be supplied only once. Remove the repeated option.',
    name: 'RepeatedOptionError',
    path: ['get'],
    spelling: '-f',
  });
});

test('parsing continues past a fault, so help after it still takes the invocation over', () => {
  for (const argv of [
    ['--file', '--help'],
    ['--help', '--help'],
    ['-hx'],
    ['get', '--nope', '-h'],
  ]) {
    expect(kit(argv).stdout).toMatch(/^help:\[[a-z ]*\]\nresolved:0\n$/u);
  }
});

test('a faulted occurrence supplies nothing, and the letters after a faulted letter are not read', () => {
  expect(held(['--help=x'])).toMatchObject({ name: 'UnexpectedValueError', spelling: '--help' });
  expect(held(['-xh'])).toMatchObject({ name: 'UnknownOptionError', spelling: '-x' });
  expect(held(['get', 'a.b', '-ph=1'])).toMatchObject({
    name: 'UnexpectedValueError',
    spelling: '-h',
  });
});

test('the first structural fault in word order is held, and each outranks a missing input', () => {
  expect(held(['get', 'a.b', 'extra', '--nope'])).toEqual({
    message: 'Command "get" accepts 1 argument. Remove the extra values.',
    name: 'UnexpectedArgumentError',
    path: ['get'],
  });
  expect(held(['get', 'a.b', '--nope', 'extra'])).toMatchObject({
    name: 'UnknownOptionError',
    spelling: '--nope',
  });
  expect(held(['get', '--nope'])).toMatchObject({ name: 'UnknownOptionError' });
  expect(held(['get'])).toMatchObject({ name: 'InputError', path: ['get'] });
});

test("a group's missing subcommand ranks after every structural fault", () => {
  expect(held(['cache'])).toEqual({
    message: 'Command "cache" requires a subcommand. Use one of: clear, list.',
    name: 'NonCallableCommandError',
    path: ['cache'],
  });
  expect(held(['cache', '-q'])).toMatchObject({ name: 'NonCallableCommandError' });
  expect(held(['cache', '--verbose'])).toMatchObject({ name: 'UnknownOptionError' });
});

test('options is null when a global option faults, and a fault on a local option leaves it set', () => {
  const values = '{"quiet":false,"help":false}';
  expect(kit(['get', 'a.b'], 'observed').stdout.startsWith(`observed:${values}:request\n`)).toBe(
    true,
  );
  expect(kit(['get', 'a.b', '--nope'], 'observed').stdout).toBe(
    `observed:${values}:null\nresolved:2\n`,
  );
  expect(kit(['cache'], 'observed').stdout).toBe(`observed:${values}:null\nresolved:2\n`);
  for (const argv of [
    ['get', 'a.b', '-q', '-q'],
    ['--quiet=yes', 'get', 'a.b'],
    ['get', 'a.b', '--nope', '--file'],
  ]) {
    expect(kit(argv, 'observed').stdout).toBe('observed:null:null\nresolved:2\n');
  }
});
