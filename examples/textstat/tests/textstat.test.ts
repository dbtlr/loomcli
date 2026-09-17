import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('textstat prints one table for the counted files, with the total only when asked', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-total-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    writeFileSync(join(directory, 'two words.txt'), 'é');
    expect(
      invoke(new URL('../dist/src/main.js', import.meta.url), ['one.txt', 'two words.txt'], {
        cwd: directory,
      }),
    ).toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    6  one.txt\n    2  two words.txt\n',
    });
    expect(
      invoke(
        new URL('../dist/src/main.js', import.meta.url),
        ['one.txt', 'two words.txt', '--total'],
        {
          cwd: directory,
        },
      ),
    ).toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    6  one.txt\n    2  two words.txt\n    8  total\n',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat prints the header alone when the byte threshold filters every source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-filtered-'));
  try {
    writeFileSync(join(directory, 'small.txt'), 'é');
    writeFileSync(join(directory, 'large.txt'), 'hello');
    expect(
      invoke(
        new URL('../dist/src/main.js', import.meta.url),
        ['small.txt', 'large.txt', '--min-bytes', '6'],
        { cwd: directory },
      ),
    ).toEqual({ status: 0, stderr: '', stdout: 'COUNT  SOURCE\n' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  ['missing-fixture.txt', 'ENOENT'],
  ['.', 'EISDIR'],
])('textstat preserves the file-read reason for %s', (file, reason) => {
  const result = invoke(new URL('../dist/src/main.js', import.meta.url), [file]);
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
      new URL('../dist/src/main.js', import.meta.url),
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
      invoke(new URL('../dist/src/main.js', import.meta.url), ['big.txt'], { cwd: directory }),
    ).toEqual({ status: 0, stderr: '', stdout: ' COUNT  SOURCE\n123456  big.txt\n' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat uses the supplied cwd and supports an explicit hyphenated relative path', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['cwd'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    5  ./-notes.txt\n',
  });
});

test.each([
  [['words-across-chunks'], 'COUNT  SOURCE\n    2  stdin\n'],
  [['character-across-chunks', 'words'], 'COUNT  SOURCE\n    2  stdin\n'],
  [['character-across-chunks', 'bytes'], 'COUNT  SOURCE\n   12  stdin\n'],
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
    stdout: 'COUNT  SOURCE\n    1  stdin\n',
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
    stdout: 'COUNT  SOURCE\n    5  notes.txt\nreads: 0\n',
  });
});

test.each([
  [
    ['--metric', 'bytes', '--total'],
    'COUNT  SOURCE\n   12  one.txt\n   14  two.txt\n   26  total\n',
  ],
  [['-tm', 'words'], 'COUNT  SOURCE\n    2  one.txt\n    3  two.txt\n    5  total\n'],
  [['--metric=lines', '-t'], 'COUNT  SOURCE\n    1  one.txt\n    1  two.txt\n    2  total\n'],
] satisfies [string[], string][])(
  'textstat counts the selected metric and total for %j',
  (options, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-metrics-'));
    try {
      writeFileSync(join(directory, 'one.txt'), 'hello world\n');
      writeFileSync(join(directory, 'two.txt'), 'é\tthree\r\nlast');
      expect(
        invoke(
          new URL('../dist/src/main.js', import.meta.url),
          ['one.txt', ...options, 'two.txt'],
          {
            cwd: directory,
          },
        ),
      ).toEqual({ status: 0, stderr: '', stdout });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each([
  ['words', 'COUNT  SOURCE\n    0  empty.txt\n    0  total\n'],
  ['lines', 'COUNT  SOURCE\n    0  empty.txt\n    0  total\n'],
])('textstat counts empty content as zero for %s', (metric, stdout) => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-empty-'));
  try {
    writeFileSync(join(directory, 'empty.txt'), '');
    expect(
      invoke(
        new URL('../dist/src/main.js', import.meta.url),
        ['--metric', metric, 'empty.txt', '--total'],
        { cwd: directory },
      ),
    ).toEqual({ status: 0, stderr: '', stdout });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each(['unsupported', ''])('textstat rejects metric %j before file access', (metric) => {
  const result = invoke(new URL('../dist/src/main.js', import.meta.url), [
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
  ['0', 'COUNT  SOURCE\n    0  empty.txt\n    2  small.txt\n    5  large.txt\n    7  total\n'],
  ['0002', 'COUNT  SOURCE\n    2  small.txt\n    5  large.txt\n    7  total\n'],
  ['3', 'COUNT  SOURCE\n    5  large.txt\n    5  total\n'],
  ['6', 'COUNT  SOURCE\n    0  total\n'],
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
          new URL('../dist/src/main.js', import.meta.url),
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
    const result = invoke(new URL('../dist/src/main.js', import.meta.url), [
      `--min-bytes=${minimum}`,
      'missing-fixture.txt',
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Option "--min-bytes":');
    expect(result.stderr).not.toContain('Cannot read file');
  },
);

test.each(['-1', '1.5', '10KB'])(
  'textstat rejects %j on the deprecated spelling by the shared rule',
  (minimum) => {
    const result = invoke(new URL('../dist/src/main.js', import.meta.url), [
      `--minimum=${minimum}`,
      'missing-fixture.txt',
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Option "--minimum":');
    expect(result.stderr).not.toContain('Cannot read file');
  },
);

test.each([
  [['--minimum', '3'], 'COUNT  SOURCE\n    5  large.txt\n'],
  [['--min-bytes', '3', '--minimum', '1'], 'COUNT  SOURCE\n    5  large.txt\n'],
  [['--min-bytes', '1', '--minimum', '6'], 'COUNT  SOURCE\n'],
] satisfies [string[], string][])(
  'textstat drops a source below the larger of the two thresholds for %j',
  (options, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-minimum-'));
    try {
      writeFileSync(join(directory, 'small.txt'), 'é');
      writeFileSync(join(directory, 'large.txt'), 'hello');
      expect(
        invoke(
          new URL('../dist/src/main.js', import.meta.url),
          ['small.txt', 'large.txt', ...options],
          {
            cwd: directory,
          },
        ),
      ).toEqual({ status: 0, stderr: '', stdout });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test('textstat --timing reports the elapsed time on stderr after the rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-timing-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    const result = invoke(
      new URL('../dist/src/main.js', import.meta.url),
      ['one.txt', '--timing'],
      {
        cwd: directory,
        env: { TERM: 'xterm-256color' },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('COUNT  SOURCE\n    6  one.txt\n');
    // The number is a measurement, so the line shape is the whole assertion.
    expect(result.stderr).toMatch(/^ℹ elapsed: \d+ms\n$/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  [{ NO_COLOR: '1', TERM: 'xterm-256color' }, /^ℹ elapsed: \d+ms\n$/u],
  [{ NO_COLOR: '1', TERM: 'linux' }, /^i elapsed: \d+ms\n$/u],
])('textstat timing keeps the captured glyph under %j', (env, diagnostic) => {
  const result = invoke(new URL('../dist/src/main.js', import.meta.url), ['--timing'], {
    env: {
      CI: '',
      ConEmuTask: '',
      FORCE_COLOR: '',
      TERMINAL_EMULATOR: '',
      TERMINUS_SUBLIME: '',
      TERM_PROGRAM: '',
      WT_SESSION: '',
      ...env,
    },
    input: 'x',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('COUNT  SOURCE\n    1  stdin\n');
  expect(result.stderr).toMatch(diagnostic);
});

test('textstat preserves a filename that resembles valid style markup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-markers-'));
  const name = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  try {
    writeFileSync(join(directory, name), 'x');
    expect(
      invoke(new URL('../dist/src/main.js', import.meta.url), [name], { cwd: directory }),
    ).toEqual({ status: 0, stderr: '', stdout: `COUNT  SOURCE\n    1  ${name}\n` });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat renders an unreadable source name literally', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-error-markers-'));
  const name = '\uE000["style",[["foreground","red"]]]\uE001missing\uE002';
  try {
    const result = invoke(new URL('../dist/src/main.js', import.meta.url), [name], {
      cwd: directory,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Cannot read file: ${name}: `);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  [['--metric', 'words'], 'hello brave world\n', 'COUNT  SOURCE\n    3  stdin\n'],
  [
    ['--metric', 'words', '--total'],
    'hello brave world\n',
    'COUNT  SOURCE\n    3  stdin\n    3  total\n',
  ],
  [['--metric', 'lines'], 'one\ntwo\n', 'COUNT  SOURCE\n    2  stdin\n'],
  [[], 'hello\n', 'COUNT  SOURCE\n    6  stdin\n'],
  [['--total'], '', 'COUNT  SOURCE\n    0  stdin\n    0  total\n'],
  [['--min-bytes', '3', '--total'], 'hi', 'COUNT  SOURCE\n    0  total\n'],
  [['--min-bytes', '2', '--total'], 'hi', 'COUNT  SOURCE\n    2  stdin\n    2  total\n'],
] satisfies [string[], string, string][])(
  'textstat counts piped stdin for %j',
  (args, input, stdout) => {
    expect(invoke(new URL('../dist/src/main.js', import.meta.url), args, { input })).toEqual({
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
      invoke(new URL('../dist/src/main.js', import.meta.url), ['one.txt'], {
        cwd: directory,
        input: 'piped text that is longer',
      }),
    ).toEqual({ status: 0, stderr: '', stdout: 'COUNT  SOURCE\n    6  one.txt\n' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('the inspected graph reports the declared table and the formatter views on the root result', () => {
  const inspected = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(inspected.status).toBe(0);
  const graph: { root: { result: unknown } } = JSON.parse(inspected.stdout);
  expect(graph.root.result).toEqual({
    default: 'table',
    kind: 'rows',
    views: ['table', 'json', 'jsonl'],
  });
});
