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

/** The lines one run printed under a label, such as the action's `run` or a validator's. */
function labeled(stdout: string, label: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith(`${label}:`))
    .map((line) => line.slice(label.length + 1));
}

/** What the action received, for an invocation that dispatched. */
async function received(argv: string[], env: Record<string, string> = {}, application = 'copyit') {
  const result = await run(application, argv, env);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(labeled(result.stdout, 'run')[0] ?? '');
}

/** The facts of the usage failure an invocation held, and the path routing reached. */
async function held(argv: string[], application = 'copyit'): Promise<unknown> {
  const result = await run(application, argv, {}, 'facts');
  expect(result.status).toBe(2);
  return JSON.parse(result.stderr);
}

test.each([
  [['--backup'], 'SIMPLE', []],
  [['-b'], 'SIMPLE', []],
  [['--backup', '--total'], 'SIMPLE', []],
  [['--backup=numbered'], 'NUMBERED', []],
  [['-bnumbered'], 'NUMBERED', []],
  [['-b=numbered'], 'NUMBERED', []],
  [['--backup', 'numbered'], 'SIMPLE', ['numbered']],
  [['-b', 'numbered'], 'SIMPLE', ['numbered']],
  [['a.txt'], undefined, ['a.txt']],
] satisfies [string[], string | undefined, string[]][])(
  'a bare spelling supplies the implied value and an attached one its own %j',
  async (argv, backup, files) => {
    const { args, options } = await received(argv);
    expect(options.backup).toBe(backup);
    expect(args.files).toEqual(files);
  },
);

test('a bare spelling at the end of the words supplies the implied value, never the missing-value error', async () => {
  await expect(
    received(['a.txt', '-b']).then((fixtureResult) => fixtureResult.options.backup),
  ).resolves.toBe('SIMPLE');
  await expect(
    received(['a.txt', '--backup']).then((fixtureResult) => fixtureResult.options.backup),
  ).resolves.toBe('SIMPLE');
});

test('an empty attached value supplies the empty string', async () => {
  await expect(
    received(['--suffix=']).then((fixtureResult) => fixtureResult.options.suffix),
  ).resolves.toBe('');
  const rejected = await run('copyit', ['-b=']);
  expect(rejected.status).toBe(2);
  expect(rejected.stderr).toBe('copyit: Option "--backup": Use none, simple, or numbered.\n');
  expect(labeled(rejected.stdout, 'validated')).toEqual(['default:simple', 'invocation:']);
});

test('in a short group the letter takes the rest of the word, and supplies the implied value when nothing remains', async () => {
  await expect(
    received(['-tb']).then((fixtureResult) => fixtureResult.options),
  ).resolves.toMatchObject({
    backup: 'SIMPLE',
    total: true,
  });
  const typo = await run('copyit', ['-bt']);
  expect(typo.status).toBe(2);
  expect(typo.stderr).toBe('copyit: Option "--backup": Use none, simple, or numbered.\n');
  expect(labeled(typo.stdout, 'validated')).toContain('invocation:t');
});

test('the implied value passes its validator once, before any token, and a bare spelling supplies that output', async () => {
  const result = await run('copyit', ['-b', '--backup=none']);
  expect(labeled(result.stdout, 'validated')).toEqual(['default:simple']);
  expect(result.stderr).toBe(
    'copyit: Option "--backup" can be supplied only once. Remove the repeated option.\n',
  );
  const bare = await run('copyit', ['-b']);
  expect(labeled(bare.stdout, 'validated')).toEqual(['default:simple']);
  const omitted = await run('copyit', []);
  expect(labeled(omitted.stdout, 'validated')).toEqual(['default:simple']);
});

test('a default fills an omitted option and the implied value a bare one', async () => {
  await expect(received([]).then((fixtureResult) => fixtureResult.options.suffix)).resolves.toBe(
    '~',
  );
  await expect(
    received(['--suffix']).then((fixtureResult) => fixtureResult.options.suffix),
  ).resolves.toBe('.bak');
  await expect(
    received(['--suffix=.orig']).then((fixtureResult) => fixtureResult.options.suffix),
  ).resolves.toBe('.orig');
});

test('a multiple option collects each bare occurrence as the implied value in its place', async () => {
  await expect(
    received(['--tag', '-g=x', '-g']).then((fixtureResult) => fixtureResult.options.tag),
  ).resolves.toEqual(['all', 'x', 'all']);
  await expect(
    received(['-gy', '--tag=', '--tag']).then((fixtureResult) => fixtureResult.options.tag),
  ).resolves.toEqual(['y', '', 'all']);
  await expect(received([]).then((fixtureResult) => fixtureResult.options.tag)).resolves.toEqual(
    [],
  );
});

test('a validator reads a bare spelling as the raw implied string', async () => {
  const [supplied] = labeled(
    await run('copyit', ['-b', '-g', '-g=x']).then((fixtureResult) => fixtureResult.stdout),
    'supplied',
  );
  expect(JSON.parse(supplied ?? '')).toMatchObject({ backup: 'simple', tag: ['all', 'x'] });
});

test('an input source supplies explicit values alone, never the implied value', async () => {
  await expect(
    received([], { BACKUP: 'numbered' }).then((fixtureResult) => fixtureResult.options.backup),
  ).resolves.toBe('NUMBERED');
  await expect(
    received([], { BACKUP: '' }).then((fixtureResult) => fixtureResult.options.backup),
  ).resolves.toBeUndefined();
  await expect(
    received([], { FIXTURE_SETTINGS: JSON.stringify({ backup: 'none' }) }).then(
      (fixtureResult) => fixtureResult.options.backup,
    ),
  ).resolves.toBe('NONE');
  await expect(
    received(['-b'], { BACKUP: 'numbered' }).then((fixtureResult) => fixtureResult.options.backup),
  ).resolves.toBe('SIMPLE');
});

test('a rejected implied value fails run() with exit 1 before any token is read, with or without a bare spelling', async () => {
  for (const argv of [[], ['--color'], ['--bogus']]) {
    const result = await run('rejected', argv);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Option "color" has an invalid implied value.\nOption "color": Use none, simple, or numbered.',
    );
    expect(result.stderr).toContain('@loomcli/core/invalid-implied');
  }
});

test('an option with an implied value occurs once, whichever spelling supplied it', async () => {
  await expect(held(['--backup', '-b=numbered'])).resolves.toMatchObject({
    name: 'RepeatedOptionError',
    spelling: '-b',
  });
});

test('inspection publishes the implied value on the string node and null where none is declared', async () => {
  const result = await run('copyit', [], {}, 'inspect');
  expect(result.stderr).toBe('');
  const nodes: { name: string; implied?: unknown }[] = JSON.parse(result.stdout);
  const implied = Object.fromEntries(nodes.map((node) => [node.name, node.implied]));
  expect(implied).toEqual({
    backup: 'simple',
    probe: null,
    suffix: '.bak',
    tag: 'all',
    total: undefined,
    verbose: undefined,
  });
});

/** Where `locate` places the last of the words, read against `copyit`. */
async function located(words: string[]): Promise<unknown> {
  return JSON.parse(
    await run('copyit', words, {}, 'locate').then((fixtureResult) => fixtureResult.stdout),
  );
}

test('locate reads a bare spelling as complete and an attached value as the value position', async () => {
  await expect(located(['--backup', ''])).resolves.toMatchObject({
    kind: 'argument',
    prefix: '',
  });
  await expect(located(['-b', 'n'])).resolves.toMatchObject({
    kind: 'argument',
    prefix: 'n',
  });
  await expect(located(['--backup='])).resolves.toEqual({
    kind: 'value',
    lead: '--backup=',
    option: 'backup',
    prefix: '',
  });
  await expect(located(['--backup=n'])).resolves.toMatchObject({
    kind: 'value',
    lead: '--backup=',
    prefix: 'n',
  });
  await expect(located(['-bn'])).resolves.toMatchObject({
    kind: 'value',
    lead: '-b',
    option: 'backup',
  });
  await expect(located(['-tb='])).resolves.toMatchObject({
    kind: 'value',
    lead: '-tb=',
    prefix: '',
  });
  await expect(located(['-b'])).resolves.toMatchObject({
    kind: 'option',
    prefix: '-b',
  });
  await expect(located(['-b', '-'])).resolves.toMatchObject({
    kind: 'option',
    supplied: ['backup'],
  });
});
