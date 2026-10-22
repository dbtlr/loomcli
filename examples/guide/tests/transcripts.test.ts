import { tmpdir } from 'node:os';

import { Application } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import {
  findApplication,
  parseCommandLine,
  parseTranscript,
  runTranscript,
  splitWords,
} from './transcripts.js';

test('words split on blanks, and quotes group a word without being part of it', () => {
  expect(splitWords('a  b\tc')).toEqual(['a', 'b', 'c']);
  expect(splitWords(`--name 'two words' "and 'more'" x"y"'z'`)).toEqual([
    '--name',
    'two words',
    "and 'more'",
    'xyz',
  ]);
  expect(splitWords(`'' "" end`)).toEqual(['', '', 'end']);
});

test('a backslash escapes the next character outside quotes and quote or backslash inside double quotes', () => {
  expect(splitWords(String.raw`a\ b "c\"d" "e\\f" "g\h" 'i\j'`)).toEqual([
    'a b',
    'c"d',
    String.raw`e\f`,
    String.raw`g\h`,
    String.raw`i\j`,
  ]);
});

test('an unterminated quote is an error', () => {
  expect(() => splitWords(`a 'b`)).toThrow('unterminated');
  expect(() => splitWords('a "b')).toThrow('unterminated');
});

test('a command line has leading environment assignments, the program name, and its arguments', () => {
  expect(parseCommandLine('$ pace')).toEqual({ argv: [], env: {} });
  expect(parseCommandLine(`$ NO_COLOR=1 NAME="a b" pace --time=5 'x y' B=2`)).toEqual({
    argv: ['--time=5', 'x y', 'B=2'],
    env: { NAME: 'a b', NO_COLOR: '1' },
  });
  expect(parseCommandLine('$ EMPTY= pace')).toEqual({ argv: [], env: { EMPTY: '' } });
});

test('a command line that does not start with "$ " or does not run pace is an error', () => {
  expect(() => parseCommandLine('pace')).toThrow('"$ "');
  expect(() => parseCommandLine('$ other --x')).toThrow('"pace"');
  expect(() => parseCommandLine('$ A=1')).toThrow('"pace"');
});

test('a transcript is its command line, then the exact output, and the file name sets the status', () => {
  expect(parseTranscript('ok.txt', '$ pace --x\nline one\nline two\n')).toEqual({
    argv: ['--x'],
    env: {},
    output: 'line one\nline two\n',
    status: 0,
  });
  expect(parseTranscript('missing-time.exit-2.txt', '$ pace\n')).toMatchObject({
    output: '',
    status: 2,
  });
  expect(parseTranscript('x.exit-10.txt', '$ pace')).toMatchObject({ output: '', status: 10 });
});

const application = new Application('pace')
  .option('time', { env: 'PACE_TIME', type: 'string' })
  .action(async ({ options, out }) => {
    await out.print(`time ${options.time ?? 'none'}`);
    await out.error('late');
  });

test('running a transcript returns the combined output in write order and the status', async () => {
  const run = await runTranscript(
    application,
    parseTranscript('t.txt', '$ pace --time 5\n'),
    tmpdir(),
  );
  expect(run).toEqual({ output: 'time 5\n✘ late\n', status: 0 });
});

test('the environment of a run holds only the transcript assignments', async () => {
  const bare = await runTranscript(application, parseTranscript('t.txt', '$ pace\n'), tmpdir());
  expect(bare.output).toMatch(/^time none\n/u);
  const assigned = await runTranscript(
    application,
    parseTranscript('t.txt', '$ PACE_TIME=7 pace\n'),
    tmpdir(),
  );
  expect(assigned.output).toMatch(/^time 7\n/u);
});

test('a run reads the working directory it is given', async () => {
  const where = new Application('pace').action(({ host, out }) => out.print(host.cwd));
  const run = await runTranscript(where, parseTranscript('t.txt', '$ pace\n'), tmpdir());
  expect(run.output).toBe(`${tmpdir()}\n`);
});

test('the application of a snapshot is its only Application export', () => {
  expect(findApplication({ count: 1, label: 'x', pace: application }, 'snap')).toBe(application);
  expect(() => findApplication({ count: 1 }, 'snap')).toThrow('snap');
  expect(() => findApplication({ one: application, two: application }, 'snap')).toThrow(
    'exactly one',
  );
});
