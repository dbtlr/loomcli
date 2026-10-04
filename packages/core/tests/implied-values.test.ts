import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/counted-implied.mjs', import.meta.url);

/** One run of an application the fixture builds. */
function run(application: string, argv: string[], env: Record<string, string> = {}, mode = 'run') {
  return invoke(fixture, [application, mode, ...argv], { env });
}

/** The lines one run printed under a label, such as the action's `run` or a validator's. */
function labeled(stdout: string, label: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith(`${label}:`))
    .map((line) => line.slice(label.length + 1));
}

/** What the action received, for an invocation that dispatched. */
function received(argv: string[], env: Record<string, string> = {}, application = 'copyit') {
  const result = run(application, argv, env);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(labeled(result.stdout, 'run')[0] ?? '');
}

/** The facts of the usage failure an invocation held, and the path routing reached. */
function held(argv: string[], application = 'copyit'): unknown {
  const result = run(application, argv, {}, 'facts');
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
  (argv, backup, files) => {
    const { args, options } = received(argv);
    expect(options.backup).toBe(backup);
    expect(args.files).toEqual(files);
  },
);

test('a bare spelling at the end of the words supplies the implied value, never the missing-value error', () => {
  expect(received(['a.txt', '-b']).options.backup).toBe('SIMPLE');
  expect(received(['a.txt', '--backup']).options.backup).toBe('SIMPLE');
});

test('an empty attached value supplies the empty string', () => {
  expect(received(['--suffix=']).options.suffix).toBe('');
  const rejected = run('copyit', ['-b=']);
  expect(rejected.status).toBe(2);
  expect(rejected.stderr).toBe('copyit: Option "--backup": Use none, simple, or numbered.\n');
  expect(labeled(rejected.stdout, 'validated')).toEqual(['default:simple', 'invocation:']);
});

test('in a short group the letter takes the rest of the word, and supplies the implied value when nothing remains', () => {
  expect(received(['-tb']).options).toMatchObject({ backup: 'SIMPLE', total: true });
  const typo = run('copyit', ['-bt']);
  expect(typo.status).toBe(2);
  expect(typo.stderr).toBe('copyit: Option "--backup": Use none, simple, or numbered.\n');
  expect(labeled(typo.stdout, 'validated')).toContain('invocation:t');
});

test('the implied value passes its validator once, before any token, and a bare spelling supplies that output', () => {
  const result = run('copyit', ['-b', '--backup=none']);
  expect(labeled(result.stdout, 'validated')).toEqual(['default:simple']);
  expect(result.stderr).toBe(
    'copyit: Option "--backup" can be supplied only once. Remove the repeated option.\n',
  );
  const bare = run('copyit', ['-b']);
  expect(labeled(bare.stdout, 'validated')).toEqual(['default:simple']);
  const omitted = run('copyit', []);
  expect(labeled(omitted.stdout, 'validated')).toEqual(['default:simple']);
});

test('a default fills an omitted option and the implied value a bare one', () => {
  expect(received([]).options.suffix).toBe('~');
  expect(received(['--suffix']).options.suffix).toBe('.bak');
  expect(received(['--suffix=.orig']).options.suffix).toBe('.orig');
});

test('a multiple option collects each bare occurrence as the implied value in its place', () => {
  expect(received(['--tag', '-g=x', '-g']).options.tag).toEqual(['all', 'x', 'all']);
  expect(received(['-gy', '--tag=', '--tag']).options.tag).toEqual(['y', '', 'all']);
  expect(received([]).options.tag).toEqual([]);
});

test('a validator reads a bare spelling as the raw implied string', () => {
  const [supplied] = labeled(run('copyit', ['-b', '-g', '-g=x']).stdout, 'supplied');
  expect(JSON.parse(supplied ?? '')).toMatchObject({ backup: 'simple', tag: ['all', 'x'] });
});

test('an input source supplies explicit values alone, never the implied value', () => {
  expect(received([], { BACKUP: 'numbered' }).options.backup).toBe('NUMBERED');
  expect(received([], { BACKUP: '' }).options.backup).toBeUndefined();
  expect(
    received([], { FIXTURE_SETTINGS: JSON.stringify({ backup: 'none' }) }).options.backup,
  ).toBe('NONE');
  expect(received(['-b'], { BACKUP: 'numbered' }).options.backup).toBe('SIMPLE');
});

test('a rejected implied value fails run() with exit 1 before any token is read, with or without a bare spelling', () => {
  for (const argv of [[], ['--color'], ['--bogus']]) {
    const result = run('rejected', argv);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Option "color" has an invalid implied value.\nOption "color": Use none, simple, or numbered.',
    );
    expect(result.stderr).toContain('@loomcli/core/invalid-implied');
  }
});

test('an option with an implied value occurs once, whichever spelling supplied it', () => {
  expect(held(['--backup', '-b=numbered'])).toMatchObject({
    name: 'RepeatedOptionError',
    spelling: '-b',
  });
});

/** The misplaced-option fault on the `other` Command for one spelling. */
function misplaced(spelling: string) {
  return {
    commands: [['other']],
    message: `Option "${spelling}" belongs to command "other". Supply it after "other".`,
    name: 'MisplacedOptionError',
    path: ['other'],
    spelling,
  };
}

test("a parent's own option rebinds to the child's option of the same value class", () => {
  expect(received(['-f', '-v', '-b', '-n', 'x', 'same', 'a'], {}, 'rebind')).toEqual({
    args: { path: 'a' },
    command: ['same'],
    options: { backup: 'numbered', flag: true, name: 'x', verbose: 1 },
  });
  expect(received(['--backup=none', 'same'], {}, 'rebind').options.backup).toBe('none');
});

test.each([['-f'], ['-v'], ['-b'], ['--backup'], ['-n', 'x']])(
  "a parent's own option is misplaced before a child that declares its spelling with another value class %j",
  (...words) => {
    expect(held([...words, 'other', 'a'], 'rebind')).toEqual(misplaced(words[0] ?? ''));
  },
);

test('inspection publishes the implied value on the string node and null where none is declared', () => {
  const result = run('copyit', [], {}, 'inspect');
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
function located(words: string[]): unknown {
  return JSON.parse(run('copyit', words, {}, 'locate').stdout);
}

test('locate reads a bare spelling as complete and an attached value as the value position', () => {
  expect(located(['--backup', ''])).toMatchObject({ kind: 'argument', prefix: '' });
  expect(located(['-b', 'n'])).toMatchObject({ kind: 'argument', prefix: 'n' });
  expect(located(['--backup='])).toEqual({
    kind: 'value',
    lead: '--backup=',
    option: 'backup',
    prefix: '',
  });
  expect(located(['--backup=n'])).toMatchObject({ kind: 'value', lead: '--backup=', prefix: 'n' });
  expect(located(['-bn'])).toMatchObject({ kind: 'value', lead: '-b', option: 'backup' });
  expect(located(['-tb='])).toMatchObject({ kind: 'value', lead: '-tb=', prefix: '' });
  expect(located(['-b'])).toMatchObject({ kind: 'option', prefix: '-b' });
  expect(located(['-b', '-'])).toMatchObject({ kind: 'option', supplied: ['backup'] });
});
