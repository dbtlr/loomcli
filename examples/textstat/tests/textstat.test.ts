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
    expect(stdout).toBe('BYTES  SOURCE\n    6  one.txt\n    2  two words.txt\n');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat prints one table for the counted files and their total', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-total-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    writeFileSync(join(directory, 'two words.txt'), 'é');
    expect(
      invoke(new URL('../dist/main.js', import.meta.url), ['one.txt', 'two words.txt', '--total'], {
        cwd: directory,
      }),
    ).toEqual({
      status: 0,
      stderr: '',
      stdout: 'BYTES  SOURCE\n    6  one.txt\n    2  two words.txt\n    8  total\n',
    });
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

test('textstat prints no table when a later source cannot be read', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-partial-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    const result = invoke(
      new URL('../dist/main.js', import.meta.url),
      ['one.txt', 'missing-fixture.txt', '--total'],
      { cwd: directory },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Cannot read file: missing-fixture.txt: ');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat widens the count column past the header for a large count', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-wide-'));
  try {
    writeFileSync(join(directory, 'big.txt'), 'a'.repeat(123_456));
    expect(
      invoke(new URL('../dist/main.js', import.meta.url), ['big.txt'], { cwd: directory }),
    ).toEqual({ status: 0, stderr: '', stdout: ' BYTES  SOURCE\n123456  big.txt\n' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat uses the supplied cwd and supports an explicit hyphenated relative path', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['cwd'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'BYTES  SOURCE\n    5  ./-notes.txt\n',
  });
});

test.each([
  [['words-across-chunks'], 'WORDS  SOURCE\n    2  stdin\n'],
  [['character-across-chunks', 'words'], 'WORDS  SOURCE\n    2  stdin\n'],
  [['character-across-chunks', 'bytes'], 'BYTES  SOURCE\n   12  stdin\n'],
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
    stdout: 'WORDS  SOURCE\n    1  stdin\n',
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
    stdout: 'BYTES  SOURCE\n    5  notes.txt\nreads: 0\n',
  });
});

test.each([
  [
    ['--metric', 'bytes', '--total'],
    'BYTES  SOURCE\n   12  one.txt\n   14  two.txt\n   26  total\n',
  ],
  [['-tm', 'words'], 'WORDS  SOURCE\n    2  one.txt\n    3  two.txt\n    5  total\n'],
  [['--metric=lines', '-t'], 'LINES  SOURCE\n    1  one.txt\n    1  two.txt\n    2  total\n'],
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

test.each([
  ['words', 'WORDS  SOURCE\n    0  empty.txt\n    0  total\n'],
  ['lines', 'LINES  SOURCE\n    0  empty.txt\n    0  total\n'],
])('textstat counts empty content as zero for %s', (metric, stdout) => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-empty-'));
  try {
    writeFileSync(join(directory, 'empty.txt'), '');
    expect(
      invoke(
        new URL('../dist/main.js', import.meta.url),
        ['--metric', metric, 'empty.txt', '--total'],
        { cwd: directory },
      ),
    ).toEqual({ status: 0, stderr: '', stdout });
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
  ['0', 'BYTES  SOURCE\n    0  empty.txt\n    2  small.txt\n    5  large.txt\n    7  total\n'],
  ['0002', 'BYTES  SOURCE\n    2  small.txt\n    5  large.txt\n    7  total\n'],
  ['3', 'BYTES  SOURCE\n    5  large.txt\n    5  total\n'],
  ['6', 'BYTES  SOURCE\n    0  total\n'],
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
  [['--metric', 'words'], 'hello brave world\n', 'WORDS  SOURCE\n    3  stdin\n'],
  [
    ['--metric', 'words', '--total'],
    'hello brave world\n',
    'WORDS  SOURCE\n    3  stdin\n    3  total\n',
  ],
  [['--metric', 'lines'], 'one\ntwo\n', 'LINES  SOURCE\n    2  stdin\n'],
  [[], 'hello\n', 'BYTES  SOURCE\n    6  stdin\n'],
  [['--total'], '', 'BYTES  SOURCE\n    0  stdin\n    0  total\n'],
  [['--min-bytes', '3', '--total'], 'hi', 'BYTES  SOURCE\n    0  total\n'],
  [['--min-bytes', '2', '--total'], 'hi', 'BYTES  SOURCE\n    2  stdin\n    2  total\n'],
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
    ).toEqual({ status: 0, stderr: '', stdout: 'BYTES  SOURCE\n    6  one.txt\n' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
