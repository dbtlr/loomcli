import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** Each word list's position, read against one fixture graph in one child process. */
function locateAll(cases: string[][], mode = 'own') {
  const result = invoke(new URL('fixtures/locate.mjs', import.meta.url), [
    JSON.stringify(cases),
    mode,
  ]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const none = { kind: 'none' };

test('reads the contract examples, reaching a Command through its alias', () => {
  expect(locateAll([['k'], ['ls', '--'], ['paths', '--format=j']])).toEqual([
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

test('reads an empty list as one empty word at the root', () => {
  expect(locateAll([[], ['']])).toEqual([
    { command: [], kind: 'command', own: true, prefix: '' },
    { command: [], kind: 'command', own: true, prefix: '' },
  ]);
});

test('reads every word after a bare delimiter as passthrough, a group included', () => {
  expect(
    locateAll([
      ['paths', 'a', '--', 'x'],
      ['--', '--'],
      ['--', '--file', ''],
      ['cache', '--', '-'],
    ]),
  ).toEqual([
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

test('reads the word after a string option that waits for its next token as its value', () => {
  expect(
    locateAll([
      ['--file', ''],
      ['keys', '-f', 'da'],
      ['keys', '--depth', '2'],
      ['keys', '-d', ''],
      ['keys', '-sd', ''],
      ['-qf', 'x'],
      ['keys', '-F', 'a', '--field', 'b'],
    ]),
  ).toEqual([
    awaiting([], 'file', ''),
    awaiting(['keys'], 'file', 'da'),
    awaiting(['keys'], 'depth', '2'),
    awaiting(['keys'], 'depth', ''),
    awaiting(['keys'], 'depth', ''),
    awaiting([], 'file', 'x'),
    awaiting(['keys'], 'field', 'b'),
  ]);
});

test('reads a nonempty hyphen word after a waiting option as no position', () => {
  expect(
    locateAll([
      ['--file', '-'],
      ['--file', '--x'],
      ['keys', '-d', '-s'],
    ]),
  ).toEqual([none, none, none]);
});

test('reads a long spelling with an equals sign as the value of a string option in scope', () => {
  expect(locateAll([['--file=da'], ['keys', '--file='], ['paths', '--format=a=b']])).toEqual([
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

test('reads an equals sign after a Boolean, unknown, or out-of-scope spelling as no position', () => {
  expect(
    locateAll([
      ['--color=x'],
      ['--no-color='],
      ['--nope=x'],
      ['--format=j'],
      ['keys', '--sort='],
      ['--='],
    ]),
  ).toEqual([none, none, none, none, none, none]);
});

test('reads any other hyphen word as an option spelling of the routed Command', () => {
  expect(locateAll([['-'], ['--'], ['---'], ['keys', '-s'], ['-f=x'], ['debug', '--']])).toEqual([
    { command: [], kind: 'option', own: true, prefix: '-', supplied: [] },
    { command: [], kind: 'option', own: true, prefix: '--', supplied: [] },
    { command: [], kind: 'option', own: true, prefix: '---', supplied: [] },
    { command: ['keys'], kind: 'option', own: true, prefix: '-s', supplied: [] },
    { command: [], kind: 'option', own: true, prefix: '-f=x', supplied: [] },
    { command: ['debug'], kind: 'option', own: true, prefix: '--', supplied: [] },
  ]);
});

test('reads a bare word as a child name until routing commits', () => {
  expect(
    locateAll([
      ['--file', 'keys', 'k'],
      ['-q', 'c'],
      ['cache', 'l'],
      ['--all', 'k'],
      ['cache', 'list', ''],
    ]),
  ).toEqual([
    { command: [], kind: 'command', own: true, prefix: 'k' },
    { command: [], kind: 'command', own: true, prefix: 'c' },
    { command: ['cache'], kind: 'command', own: true, prefix: 'l' },
    none,
    none,
  ]);
});

test('reads a bare word on a leaf as the argument the next positional fills', () => {
  expect(
    locateAll([
      ['paths', ''],
      ['paths', 'a', ''],
      ['paths', 'a', 'b', 'c'],
      ['paths', '--format', 'json', 'a', 'b'],
      ['keys', ''],
    ]),
  ).toEqual([
    { argument: 'root', command: ['paths'], kind: 'argument', own: true, prefix: '' },
    { argument: 'rest', command: ['paths'], kind: 'argument', own: true, prefix: '' },
    { argument: 'rest', command: ['paths'], kind: 'argument', own: true, prefix: 'c' },
    { argument: 'rest', command: ['paths'], kind: 'argument', own: true, prefix: 'b' },
    none,
  ]);
});

test('reads every structural fault among the earlier words as no position', () => {
  expect(
    locateAll([
      ['nope', ''],
      ['keys', '--nope', ''],
      ['keys', '--depth', '1', '--depth', '2', ''],
      ['--file', 'a', 'keys', '-f', 'b', ''],
      ['keys', '--depth', '-s', ''],
      ['keys', '--sort=x', ''],
      ['keys', '-ds', ''],
      ['-qs', 'keys', ''],
      ['keys', 'extra', ''],
      ['---', ''],
    ]),
  ).toEqual([none, none, none, none, none, none, none, none, none, none]);
});

test('lists the options earlier words supplied, globals and locals, in supplied order', () => {
  expect(
    locateAll([
      ['keys', '-s', '--file', 'x', '-q', '-F', 'a', '-F', 'b', '--'],
      ['--color', 'ls', '--depth', '1', '-'],
      ['--no-color', 'keys', '-sF', 'a', '--'],
      ['-qf', 'x', 'paths', '--format=j', '-'],
    ]),
  ).toEqual([
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
  ]);
});

test('answers synchronously and throws nothing for hostile word lists', () => {
  const hostile = [['--', '--'], ['-'], ['--='], ['---'], [''], [], ['-', ''], ['--=', '--=']];
  const answers: unknown[] = locateAll(hostile);
  expect(answers).toHaveLength(hostile.length);
  for (const answer of answers) {
    expect(answer).not.toHaveProperty('threw');
    expect(answer).not.toHaveProperty('async');
  }
});

test('rejects a graph core did not produce as an internal error', () => {
  expect(locateAll([['k']], 'foreign')).toEqual([{ threw: 'InternalError' }]);
});
