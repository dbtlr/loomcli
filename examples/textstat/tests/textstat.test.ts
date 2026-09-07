import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('textstat counts file bytes through the built public package', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    writeFileSync(join(directory, 'two words.txt'), 'é');
    const stdout = execFileSync(
      process.env.LOOM_TEST_RUNTIME ?? 'node',
      [fileURLToPath(new URL('../dist/main.js', import.meta.url)), 'one.txt', 'two words.txt'],
      { cwd: directory, encoding: 'utf8' },
    );
    expect(stdout).toBe('6\tone.txt\n2\ttwo words.txt\n');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  ['missing-fixture.txt', 'ENOENT'],
  ['.', 'EISDIR'],
])('textstat preserves the file-read reason for %s', (file, reason) => {
  const result = invoke(new URL('../dist/main.js', import.meta.url), [file]);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(`Cannot read file: ${file}: `);
  expect(result.stderr).toContain(reason);
});

test('textstat uses the supplied cwd and supports an explicit hyphenated relative path', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['cwd'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '5\t./-notes.txt\n',
  });
});

test.each([
  [['words-across-chunks'], '2\tstdin\n'],
  [['character-across-chunks', 'words'], '2\tstdin\n'],
  [['character-across-chunks', 'bytes'], '12\tstdin\n'],
] satisfies [string[], string][])(
  'textstat counts the split stdin stream %j once',
  (args, stdout) => {
    expect(invoke(new URL('fixtures/host.mjs', import.meta.url), args)).toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  },
);

test('textstat asks for files or piped text when stdin is a terminal', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['terminal'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Argument "files": Supply file arguments or pipe text to stdin.\n',
    stdout: '',
  });
});

test('textstat counts one unbroken token that spans many chunks', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['long-token'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '1\tstdin\n',
  });
});

test('textstat reports a stdin connection that closed before it ended', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['closed-early']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/^Cannot read stdin: .+\n$/u);
});

test('textstat reports the reason a stdin read failed', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['unreadable']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Cannot read stdin: The connection failed.\n');
});

test('textstat never reads stdin when files are supplied', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['files-only'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '5\tnotes.txt\n0\treads\n',
  });
});

test.each([
  [['--metric', 'bytes', '--total'], '12\tone.txt\n14\ttwo.txt\n26\ttotal\n'],
  [['-tm', 'words'], '2\tone.txt\n3\ttwo.txt\n5\ttotal\n'],
  [['--metric=lines', '-t'], '1\tone.txt\n1\ttwo.txt\n2\ttotal\n'],
] satisfies [string[], string][])(
  'textstat counts the selected metric and total for %j',
  (options, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-metrics-'));
    try {
      writeFileSync(join(directory, 'one.txt'), 'hello world\n');
      writeFileSync(join(directory, 'two.txt'), 'é\tthree\r\nlast');
      expect(
        invoke(new URL('../dist/main.js', import.meta.url), ['one.txt', ...options, 'two.txt'], {
          cwd: directory,
        }),
      ).toEqual({ status: 0, stderr: '', stdout });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each(['words', 'lines'])('textstat counts empty content as zero for %s', (metric) => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-empty-'));
  try {
    writeFileSync(join(directory, 'empty.txt'), '');
    expect(
      invoke(
        new URL('../dist/main.js', import.meta.url),
        ['--metric', metric, 'empty.txt', '--total'],
        { cwd: directory },
      ),
    ).toEqual({
      status: 0,
      stderr: '',
      stdout: '0\tempty.txt\n0\ttotal\n',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each(['unsupported', ''])('textstat rejects metric %j before file access', (metric) => {
  const result = invoke(new URL('../dist/main.js', import.meta.url), [
    '--metric',
    metric,
    'missing-fixture.txt',
  ]);
  expect(result).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--metric": Use bytes, words, or lines.\n',
    stdout: '',
  });
});

test.each([
  ['0', '0\tempty.txt\n2\tsmall.txt\n5\tlarge.txt\n7\ttotal\n'],
  ['0002', '2\tsmall.txt\n5\tlarge.txt\n7\ttotal\n'],
  ['3', '5\tlarge.txt\n5\ttotal\n'],
  ['6', '0\ttotal\n'],
])(
  'textstat uses transformed minimum %s with inclusive byte filtering and retained totals',
  (minimum, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-schema-'));
    try {
      writeFileSync(join(directory, 'empty.txt'), '');
      writeFileSync(join(directory, 'small.txt'), 'é');
      writeFileSync(join(directory, 'large.txt'), 'hello');
      expect(
        invoke(
          new URL('../dist/main.js', import.meta.url),
          ['empty.txt', 'small.txt', 'large.txt', '--min-bytes', minimum, '--total'],
          { cwd: directory },
        ),
      ).toEqual({ status: 0, stderr: '', stdout });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each(['', '-1', '1.5', ' 2 ', '1e3', '10KB', '9007199254740992'])(
  'textstat rejects minimum %j before file access',
  (minimum) => {
    const result = invoke(new URL('../dist/main.js', import.meta.url), [
      `--min-bytes=${minimum}`,
      'missing-fixture.txt',
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Option "--min-bytes":');
    expect(result.stderr).not.toContain('Cannot read file');
  },
);

test.each([
  [['--metric', 'words'], 'hello brave world\n', '3\tstdin\n'],
  [['--metric', 'words', '--total'], 'hello brave world\n', '3\tstdin\n3\ttotal\n'],
  [['--metric', 'lines'], 'one\ntwo\n', '2\tstdin\n'],
  [[], 'hello\n', '6\tstdin\n'],
  [['--total'], '', '0\tstdin\n0\ttotal\n'],
  [['--min-bytes', '3', '--total'], 'hi', '0\ttotal\n'],
  [['--min-bytes', '2', '--total'], 'hi', '2\tstdin\n2\ttotal\n'],
] satisfies [string[], string, string][])(
  'textstat counts piped stdin for %j',
  (args, input, stdout) => {
    expect(invoke(new URL('../dist/main.js', import.meta.url), args, { input })).toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  },
);

test('textstat counts the supplied files and leaves the piped text unread', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-stdin-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    expect(
      invoke(new URL('../dist/main.js', import.meta.url), ['one.txt'], {
        cwd: directory,
        input: 'piped text that is longer',
      }),
    ).toEqual({ status: 0, stderr: '', stdout: '6\tone.txt\n' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
