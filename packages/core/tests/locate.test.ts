import { expect, test } from 'vite-plus/test';
// Acceptance plan: see packages/core/tests/options.test.ts.

import { invoke as invokeFixture } from './run-fixture.ts';

/** Each word list's position, read against one fixture graph in one child process. */
async function locateAll(cases: string[][], mode = 'own') {
  const result = await invokeFixture(new URL('fixtures/locate.mjs', import.meta.url), [
    JSON.stringify(cases),
    mode,
  ]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const none = { kind: 'none' };

test('reads the contract examples, reaching a Command through its alias', async () => {
  await expect(locateAll([['k'], ['ls', '--'], ['paths', '--format=j']])).resolves.toEqual([
    { command: [], kind: 'command', own: true, prefix: 'k' },
    { command: ['keys'], kind: 'option', own: true, prefix: '--', supplied: [] },
    {
      command: ['paths'],
      kind: 'value',
      lead: '--format=',
      option: 'format',
      own: true,
      prefix: 'j',
    },
  ]);
});

test('an option position holds the value the earlier words gave each Boolean option', async () => {
  await expect(
    locateAll(
      [
        ['--no-color', '-q', 'keys', '-s', '--'],
        ['keys', '--'],
        ['-a', '--'],
      ],
      'booleans',
    ),
  ).resolves.toEqual([
    {
      booleans: { color: false, quiet: true, sort: true },
      command: ['keys'],
      kind: 'option',
      own: true,
      prefix: '--',
      supplied: ['color', 'quiet', 'sort'],
    },
    { booleans: {}, command: ['keys'], kind: 'option', own: true, prefix: '--', supplied: [] },
    // Routing still holds the root's own -a unbound, which gives the root's entry true.
    {
      booleans: { all: true },
      command: [],
      kind: 'option',
      own: true,
      prefix: '--',
      supplied: ['all'],
    },
  ]);
});

test('reads an empty list as one empty word at the root', async () => {
  await expect(locateAll([[], ['']])).resolves.toEqual([
    { command: [], kind: 'command', own: true, prefix: '' },
    { command: [], kind: 'command', own: true, prefix: '' },
  ]);
});

test('reads every word after a bare delimiter as passthrough, a group included', async () => {
  await expect(
    locateAll([
      ['paths', 'a', '--', 'x'],
      ['--', '--'],
      ['--', '--file', ''],
      ['cache', '--', '-'],
    ]),
  ).resolves.toEqual([
    { command: ['paths'], kind: 'passthrough', own: true, prefix: 'x' },
    { command: [], kind: 'passthrough', own: true, prefix: '--' },
    { command: [], kind: 'passthrough', own: true, prefix: '' },
    { command: ['cache'], kind: 'passthrough', own: true, prefix: '-' },
  ]);
});

/** The value position of an option whose spelling ended the earlier words. */
function awaiting(command: string[], option: string, prefix: string) {
  return { command, kind: 'value', lead: '', option, own: true, prefix };
}

test('reads the word after a string option that waits for its next token as its value', async () => {
  await expect(
    locateAll([
      ['--file', ''],
      ['keys', '-f', 'da'],
      ['keys', '--depth', '2'],
      ['keys', '-d', ''],
      ['keys', '-sd', ''],
      ['-qf', 'x'],
      ['keys', '-F', 'a', '--field', 'b'],
    ]),
  ).resolves.toEqual([
    awaiting([], 'file', ''),
    awaiting(['keys'], 'file', 'da'),
    awaiting(['keys'], 'depth', '2'),
    awaiting(['keys'], 'depth', ''),
    awaiting(['keys'], 'depth', ''),
    awaiting([], 'file', 'x'),
    awaiting(['keys'], 'field', 'b'),
  ]);
});

test('reads an option word or -- after a waiting option as no position, and any other word as its value', async () => {
  await expect(
    locateAll([
      ['--file', '--x'],
      ['keys', '-d', '-s'],
      ['--file', '--'],
      ['--file', '-'],
      ['keys', '-d', '-5'],
    ]),
  ).resolves.toEqual([
    none,
    none,
    none,
    awaiting([], 'file', '-'),
    awaiting(['keys'], 'depth', '-5'),
  ]);
});

test('reads a short group whose walk reaches a value letter with characters after it as that value', async () => {
  await expect(
    locateAll([['keys', '-sdfoo'], ['keys', '-sd=fo'], ['-qf=da'], ['-f=x'], ['ls', '-qsF', '']]),
  ).resolves.toEqual([
    { command: ['keys'], kind: 'value', lead: '-sd', option: 'depth', own: true, prefix: 'foo' },
    { command: ['keys'], kind: 'value', lead: '-sd=', option: 'depth', own: true, prefix: 'fo' },
    { command: [], kind: 'value', lead: '-qf=', option: 'file', own: true, prefix: 'da' },
    { command: [], kind: 'value', lead: '-f=', option: 'file', own: true, prefix: 'x' },
    awaiting(['keys'], 'field', ''),
  ]);
});

test('reads a short group the walk cannot read as no position, and any other as an option spelling', async () => {
  await expect(
    locateAll([['keys', '-sx'], ['keys', '-s=1'], ['-s'], ['keys', '-qs'], ['keys', '-sd']]),
  ).resolves.toEqual([
    none,
    none,
    none,
    { command: ['keys'], kind: 'option', own: true, prefix: '-qs', supplied: [] },
    { command: ['keys'], kind: 'option', own: true, prefix: '-sd', supplied: [] },
  ]);
});

test('reads a long spelling with an equals sign as the value of a string option in scope', async () => {
  await expect(
    locateAll([['--file=da'], ['keys', '--file='], ['paths', '--format=a=b']]),
  ).resolves.toEqual([
    { command: [], kind: 'value', lead: '--file=', option: 'file', own: true, prefix: 'da' },
    { command: ['keys'], kind: 'value', lead: '--file=', option: 'file', own: true, prefix: '' },
    {
      command: ['paths'],
      kind: 'value',
      lead: '--format=',
      option: 'format',
      own: true,
      prefix: 'a=b',
    },
  ]);
});

test('reads an equals sign after a Boolean, unknown, or out-of-scope spelling as no position', async () => {
  await expect(
    locateAll([
      ['--color=x'],
      ['--no-color='],
      ['--nope=x'],
      ['--format=j'],
      ['keys', '--sort='],
      ['--='],
    ]),
  ).resolves.toEqual([none, none, none, none, none, none]);
});

test('reads any other hyphen word as an option spelling of the routed Command', async () => {
  await expect(
    locateAll([['-'], ['--'], ['---'], ['keys', '-s'], ['--nop'], ['debug', '--']]),
  ).resolves.toEqual([
    { command: [], kind: 'option', own: true, prefix: '-', supplied: [] },
    { command: [], kind: 'option', own: true, prefix: '--', supplied: [] },
    { command: [], kind: 'option', own: true, prefix: '---', supplied: [] },
    { command: ['keys'], kind: 'option', own: true, prefix: '-s', supplied: [] },
    { command: [], kind: 'option', own: true, prefix: '--nop', supplied: [] },
    { command: ['debug'], kind: 'option', own: true, prefix: '--', supplied: [] },
  ]);
});

test('reads a bare word as a child name until routing commits', async () => {
  await expect(
    locateAll([
      ['--file', 'keys', 'k'],
      ['-q', 'c'],
      ['cache', 'l'],
      ['--all', 'k'],
      ['cache', 'list', ''],
    ]),
  ).resolves.toEqual([
    { command: [], kind: 'command', own: true, prefix: 'k' },
    { command: [], kind: 'command', own: true, prefix: 'c' },
    { command: ['cache'], kind: 'command', own: true, prefix: 'l' },
    { command: [], kind: 'command', own: true, prefix: 'k' },
    none,
  ]);
});

test("leaves a parent's own option unbound while routing is still open, so a plain last word names a child", async () => {
  await expect(
    locateAll([
      ['-a', 'cache', ''],
      ['-a', 'cache', 'l'],
      ['-a', ''],
      ['-a', 'cache', 'list', ''],
      ['-a', 'cache', '-'],
      ['-a', 'cache', '--h'],
      ['-a', 'cache', '-qf=x'],
      ['-a', '-'],
    ]),
  ).resolves.toEqual([
    { command: ['cache'], kind: 'command', own: true, prefix: '' },
    { command: ['cache'], kind: 'command', own: true, prefix: 'l' },
    { command: [], kind: 'command', own: true, prefix: '' },
    none,
    { command: ['cache'], kind: 'option', own: true, prefix: '-', supplied: [] },
    { command: ['cache'], kind: 'option', own: true, prefix: '--h', supplied: [] },
    { command: ['cache'], kind: 'value', lead: '-qf=', option: 'file', own: true, prefix: 'x' },
    { command: [], kind: 'option', own: true, prefix: '-', supplied: ['all'] },
  ]);
  // An unbound option of a parent lists the name the reached Command's own entry gives its spelling.
  await expect(
    locateAll([
      ['-qa', 'mid', '-'],
      ['-a', 'mid', ''],
    ]),
  ).resolves.toEqual([
    { command: ['mid'], kind: 'option', own: true, prefix: '-', supplied: ['quiet', 'any'] },
    { command: ['mid'], kind: 'command', own: true, prefix: '' },
  ]);
});

test("reads a parent's own option and carries routing on to the child that receives it", async () => {
  await expect(
    locateAll([
      ['--all', 'paths', '--'],
      ['-a', 'keys', ''],
      ['-aq', 'paths', '-'],
    ]),
  ).resolves.toEqual([
    { command: ['paths'], kind: 'option', own: true, prefix: '--', supplied: ['all'] },
    none,
    { command: ['paths'], kind: 'option', own: true, prefix: '-', supplied: ['all', 'quiet'] },
  ]);
});

test('reads a bare word on a leaf as the argument the next positional fills', async () => {
  await expect(
    locateAll([
      ['paths', ''],
      ['paths', 'a', ''],
      ['paths', 'a', 'b', 'c'],
      ['paths', '--format', 'json', 'a', 'b'],
      ['keys', ''],
    ]),
  ).resolves.toEqual([
    { argument: 'root', command: ['paths'], kind: 'argument', own: true, prefix: '' },
    { argument: 'rest', command: ['paths'], kind: 'argument', own: true, prefix: '' },
    { argument: 'rest', command: ['paths'], kind: 'argument', own: true, prefix: 'c' },
    { argument: 'rest', command: ['paths'], kind: 'argument', own: true, prefix: 'b' },
    none,
  ]);
});

test('reads every structural fault among the earlier words as no position', async () => {
  await expect(
    locateAll([
      ['nope', ''],
      ['keys', '--nope', ''],
      ['keys', '--depth', '1', '--depth', '2', ''],
      ['--file', 'a', 'keys', '-f', 'b', ''],
      ['keys', '--depth', '-s', ''],
      ['keys', '--sort=x', ''],
      ['keys', '-sx', ''],
      ['-qs', 'keys', ''],
      ['-s', 'keys', ''],
      ['keys', 'extra', ''],
      ['---', ''],
      ['-f', 'x', '-f', ''],
      ['keys', '-d', '1', '-d', ''],
      ['keys', '-s', '-sd', ''],
    ]),
  ).resolves.toEqual([
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
  ]);
  // A multiple option repeats, so its next occurrence still waits for a value.
  await expect(locateAll([['keys', '-F', 'a', '-F', '']])).resolves.toEqual([
    awaiting(['keys'], 'field', ''),
  ]);
});

test('reads a last word that repeats an option that is not multiple as nothing to complete', async () => {
  await expect(
    locateAll([
      ['keys', '-d', '1', '--depth=x'],
      ['keys', '-d', '1', '-dx'],
      ['keys', '-ss'],
    ]),
  ).resolves.toEqual([none, none, none]);
  // A long spelling with no "=" may still grow into another spelling, so it stays an option.
  await expect(
    locateAll([['keys', '-s', '--sort']]).then((fixtureResult) => fixtureResult[0]),
  ).resolves.toMatchObject({
    kind: 'option',
    prefix: '--sort',
  });
});

test('lists the options earlier words supplied, globals and locals, in supplied order', async () => {
  await expect(
    locateAll([
      ['keys', '-s', '--file', 'x', '-q', '-F', 'a', '-F', 'b', '--'],
      ['--color', 'ls', '--depth', '1', '-'],
      ['--no-color', 'keys', '-sF', 'a', '--'],
      ['-qf', 'x', 'paths', '--format=j', '-'],
      ['-aq', '--'],
    ]),
  ).resolves.toEqual([
    {
      command: ['keys'],
      kind: 'option',
      own: true,
      prefix: '--',
      supplied: ['sort', 'file', 'quiet', 'field'],
    },
    { command: ['keys'], kind: 'option', own: true, prefix: '-', supplied: ['color', 'depth'] },
    {
      command: ['keys'],
      kind: 'option',
      own: true,
      prefix: '--',
      supplied: ['color', 'sort', 'field'],
    },
    {
      command: ['paths'],
      kind: 'option',
      own: true,
      prefix: '-',
      supplied: ['quiet', 'file', 'format'],
    },
    { command: [], kind: 'option', own: true, prefix: '--', supplied: ['all', 'quiet'] },
  ]);
});

test('answers synchronously and throws nothing for hostile word lists', async () => {
  const hostile = [['--', '--'], ['-'], ['--='], ['---'], [''], [], ['-', ''], ['--=', '--=']];
  const answers: unknown[] = await locateAll(hostile);
  expect(answers).toHaveLength(hostile.length);
  for (const answer of answers) {
    expect(answer).not.toHaveProperty('threw');
    expect(answer).not.toHaveProperty('async');
  }
});

test('reads 200000 words without exhausting the call stack', async () => {
  await expect(locateAll([], 'long')).resolves.toEqual([
    { command: [], kind: 'passthrough', own: true, prefix: '' },
    { argument: 'rest', command: ['paths'], kind: 'argument', own: true, prefix: '' },
  ]);
});

test('rejects a graph core did not produce as an internal error', async () => {
  await expect(locateAll([['k']], 'foreign')).resolves.toEqual([{ threw: 'InternalError' }]);
});
