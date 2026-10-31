// Acceptance plan: see packages/plugins/tests/suggestions.test.ts.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { expect, test } from 'vite-plus/test';

import { inspection, run, runWithStdin } from './run.js';

/** A connection that delivers exactly the supplied chunks, so a boundary falls where a case wants it. */
function chunkStream(chunks: (Buffer | string)[]) {
  let index = 0;
  return new Readable({
    read() {
      this.push(index < chunks.length ? chunks[index++] : null);
    },
  });
}

/** The scenarios that need a host stream of their own: split, failing, and terminal stdin. */
async function host(scenario: string, metric = 'words') {
  if (scenario === 'cwd') {
    const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
    try {
      writeFileSync(join(directory, '-notes.txt'), 'three');
      return await run(['./-notes.txt'], { cwd: directory });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }
  if (scenario === 'words-across-chunks') {
    return runWithStdin(['--metric', 'words'], chunkStream(['hel', 'lo world']));
  }
  if (scenario === 'character-across-chunks') {
    // The split falls inside the two bytes of "ï", so a decoder that forgets it would count twice.
    const text = Buffer.from('naïve café');
    return runWithStdin(['--metric', metric], chunkStream([text.subarray(0, 3), text.subarray(3)]));
  }
  if (scenario === 'terminal' || scenario === 'terminal-hyphen') {
    return runWithStdin(scenario === 'terminal-hyphen' ? ['-'] : [], chunkStream([]), {
      keyboard: true,
    });
  }
  if (scenario === 'long-token') {
    // One unbroken token across many chunks, so a counter that keeps the open word grows with it.
    const chunk = 'a'.repeat(64 * 1024);
    let remaining = 128;
    const stdin = new Readable({
      read() {
        remaining -= 1;
        this.push(remaining >= 0 ? chunk : null);
      },
    });
    return runWithStdin(['--metric', 'words'], stdin);
  }
  if (scenario === 'closed-early') {
    // A connection destroyed without an error emits "close" and never "end".
    let sent = false;
    const stdin = new Readable({
      read() {
        if (sent) {
          this.destroy();
          return;
        }
        sent = true;
        this.push('one two');
      },
    });
    return runWithStdin(['--metric', 'words'], stdin);
  }
  if (scenario === 'unreadable') {
    const stdin = new Readable({
      read() {
        this.destroy(new Error('The connection failed.'));
      },
    });
    return runWithStdin([], stdin);
  }
  // Terminal-files: a terminal's stdin stays unread when files are supplied.
  let reads = 0;
  const stdin = new Readable({
    read() {
      reads++;
      this.push(null);
    },
  });
  const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
  try {
    writeFileSync(join(directory, 'notes.txt'), 'three');
    const result = await runWithStdin(['notes.txt'], stdin, { cwd: directory, keyboard: true });
    return { ...result, stdout: `${result.stdout}reads: ${reads}\n` };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('textstat prints one table for the counted files, with the total only when asked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-total-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    writeFileSync(join(directory, 'two words.txt'), 'é');
    await expect(
      run(['one.txt', 'two words.txt'], {
        cwd: directory,
      }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    6  one.txt\n    2  two words.txt\n    0  stdin\n',
    });
    await expect(
      run(['one.txt', 'two words.txt', '--total'], {
        cwd: directory,
      }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    6  one.txt\n    2  two words.txt\n    0  stdin\n    8  total\n',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat logs one record for each run through the logging plugin, and prints nothing more', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-logged-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    const home = join(directory, 'home');
    const state = join(directory, 'state');
    // The directory the plugin picks on the platform the run states, which is linux.
    const logDirectory = join(state, 'textstat');
    const result = await run(['one.txt'], {
      cwd: directory,
      env: { HOME: home, XDG_STATE_HOME: state },
      platform: 'linux',
    });
    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    6  one.txt\n    0  stdin\n',
    });
    const records = readFileSync(join(logDirectory, 'textstat.jsonl'), 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toMatchObject([
      {
        fields: { kept: 2, metric: 'bytes', sources: 2 },
        level: 'info',
        message: 'Counted the sources.',
        path: [],
      },
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each(['--min-bytes', '-b'])(
  'textstat %s filters sources below the byte threshold',
  async (spelling) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-filtered-'));
    try {
      writeFileSync(join(directory, 'small.txt'), 'é');
      writeFileSync(join(directory, 'large.txt'), 'hello');
      await expect(
        run(['small.txt', 'large.txt', spelling, '6'], { cwd: directory }),
      ).resolves.toEqual({
        status: 0,
        stderr: '',
        stdout: 'COUNT  SOURCE\n',
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each(['missing-fixture.txt', '.'])(
  'textstat rejects unreadable file source %s during preparation',
  async (file) => {
    const result = await run([file]);
    expect(result).toEqual({
      status: 2,
      stderr:
        'textstat: Argument "files" at 0: Expected a readable file that exists.\nRun "textstat --help" to see the usage.\n',
      stdout: '',
    });
  },
);

test('textstat prints no table when a later source cannot be read', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-partial-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    const result = await run(['one.txt', 'missing-fixture.txt', '--total'], { cwd: directory });
    expect(result).toEqual({
      status: 2,
      stderr:
        'textstat: Argument "files" at 1: Expected a readable file that exists.\nRun "textstat --help" to see the usage.\n',
      stdout: '',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat widens the count column past the header for a large count', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-wide-'));
  try {
    writeFileSync(join(directory, 'big.txt'), 'a'.repeat(123_456));
    await expect(run(['big.txt'], { cwd: directory })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: ' COUNT  SOURCE\n123456  big.txt\n     0  stdin\n',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat uses the supplied cwd and supports an explicit hyphenated relative path', async () => {
  await expect(host('cwd')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    5  ./-notes.txt\n    0  stdin\n',
  });
});

test.each([
  [['words-across-chunks'], 'COUNT  SOURCE\n    2  stdin\n'],
  [['character-across-chunks', 'words'], 'COUNT  SOURCE\n    2  stdin\n'],
  [['character-across-chunks', 'bytes'], 'COUNT  SOURCE\n   12  stdin\n'],
] satisfies [string[], string][])(
  'textstat counts the split stdin stream %j once',
  async (args, stdout) => {
    const [scenario = '', metric] = args;
    await expect(host(scenario, metric)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  },
);

test('textstat asks for files or piped text when stdin is a terminal', async () => {
  await expect(host('terminal')).resolves.toEqual({
    status: 2,
    stderr:
      'textstat: Argument "files": Expected at least 1 readable source.\nRun "textstat --help" to see the usage.\n',
    stdout: '',
  });
});

test('textstat rejects explicit stdin at a terminal before reading it', async () => {
  await expect(host('terminal-hyphen')).resolves.toEqual({
    status: 2,
    stderr:
      'textstat: Argument "files" at 0: Expected piped or redirected stdin.\nRun "textstat --help" to see the usage.\n',
    stdout: '',
  });
});

test('textstat counts one unbroken token that spans many chunks', async () => {
  await expect(host('long-token')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    1  stdin\n',
  });
});

test('textstat reports a stdin connection that closed before it ended', async () => {
  const result = await host('closed-early');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(
    /^Cannot read stdin: .+[^.]\. Supply readable files, or pipe text to stdin\.\n$/u,
  );
});

test('textstat reports the reason a stdin read failed', async () => {
  const result = await host('unreadable');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  // The reason already ends with a period, so the fix follows it with no second one.
  expect(result.stderr).toBe(
    'Cannot read stdin: The connection failed. Supply readable files, or pipe text to stdin.\n',
  );
});

test('textstat leaves terminal stdin unread when files are supplied', async () => {
  await expect(host('terminal-files')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    5  notes.txt\nreads: 0\n',
  });
});

test.each([
  [
    ['--metric', 'bytes', '--total'],
    'COUNT  SOURCE\n   12  one.txt\n   14  two.txt\n    0  stdin\n   26  total\n',
  ],
  [['-tm', 'words'], 'COUNT  SOURCE\n    2  one.txt\n    3  two.txt\n    0  stdin\n    5  total\n'],
  [
    ['--metric=lines', '-t'],
    'COUNT  SOURCE\n    1  one.txt\n    1  two.txt\n    0  stdin\n    2  total\n',
  ],
  [
    ['-mwords', '-t'],
    'COUNT  SOURCE\n    2  one.txt\n    3  two.txt\n    0  stdin\n    5  total\n',
  ],
  [
    ['-m=words', '-t'],
    'COUNT  SOURCE\n    2  one.txt\n    3  two.txt\n    0  stdin\n    5  total\n',
  ],
  [['-tmwords'], 'COUNT  SOURCE\n    2  one.txt\n    3  two.txt\n    0  stdin\n    5  total\n'],
] satisfies [string[], string][])(
  'textstat counts the selected metric and total for %j',
  async (options, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-metrics-'));
    try {
      writeFileSync(join(directory, 'one.txt'), 'hello world\n');
      writeFileSync(join(directory, 'two.txt'), 'é\tthree\r\nlast');
      await expect(
        run(['one.txt', ...options, 'two.txt'], {
          cwd: directory,
        }),
      ).resolves.toEqual({ status: 0, stderr: '', stdout });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each([
  ['words', 'COUNT  SOURCE\n    0  empty.txt\n    0  stdin\n    0  total\n'],
  ['lines', 'COUNT  SOURCE\n    0  empty.txt\n    0  stdin\n    0  total\n'],
])('textstat counts empty content as zero for %s', async (metric, stdout) => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-empty-'));
  try {
    writeFileSync(join(directory, 'empty.txt'), '');
    await expect(
      run(['--metric', metric, 'empty.txt', '--total'], { cwd: directory }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each(['unsupported', ''])(
  'textstat aggregates metric %j and file preparation failures',
  async (metric) => {
    const result = await run(['--metric', metric, 'missing-fixture.txt']);
    expect(result).toEqual({
      status: 2,
      stderr:
        'textstat: Argument "files" at 0: Expected a readable file that exists.\ntextstat: Option "--metric": Expected one of: bytes, words, lines.\nRun "textstat --help" to see the usage.\n',
      stdout: '',
    });
  },
);

test('textstat -m= hands the metric validator the empty string', async () => {
  await expect(run(['-m=', 'missing-fixture.txt'])).resolves.toEqual({
    status: 2,
    stderr:
      'textstat: Argument "files" at 0: Expected a readable file that exists.\ntextstat: Option "--metric": Expected one of: bytes, words, lines.\nRun "textstat --help" to see the usage.\n',
    stdout: '',
  });
});

test('textstat --totl one.txt suggests the near option and points at the help and explain pages', async () => {
  const result = await run(['--totl', 'one.txt']);
  expect(result).toEqual({
    status: 2,
    stderr:
      'textstat: Unknown option "--totl". Did you mean "--total"?\nRun "textstat --help" to see the usage.\nRun "textstat --explain" to explain this command.\n',
    stdout: '',
  });
});

// `--minimun` is near only `--minimum`, an alias of `--min-bytes`, and too far from `--min-bytes`.
// `--timin` is near only the hidden `--timing`.
// Neither an alias nor a hidden option is offered as the fix, so both keep core's text.
test.each(['--minimun', '--timin'])(
  'textstat %s one.txt finds no offered near option and keeps the default text',
  async (option) => {
    const result = await run([option, 'one.txt']);
    expect(result).toEqual({
      status: 2,
      stderr: `textstat: Unknown option "${option}". Supply a declared option; prefix a hyphenated path with "./".\nRun "textstat --help" to see the usage.\nRun "textstat --explain" to explain this command.\n`,
      stdout: '',
    });
  },
);

test.each([
  [
    '0',
    'COUNT  SOURCE\n    0  empty.txt\n    2  small.txt\n    5  large.txt\n    0  stdin\n    7  total\n',
  ],
  ['0002', 'COUNT  SOURCE\n    2  small.txt\n    5  large.txt\n    7  total\n'],
  ['3', 'COUNT  SOURCE\n    5  large.txt\n    5  total\n'],
  ['6', 'COUNT  SOURCE\n    0  total\n'],
])(
  'textstat uses transformed minimum %s with inclusive byte filtering and retained totals',
  async (minimum, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-schema-'));
    try {
      writeFileSync(join(directory, 'empty.txt'), '');
      writeFileSync(join(directory, 'small.txt'), 'é');
      writeFileSync(join(directory, 'large.txt'), 'hello');
      await expect(
        run(['empty.txt', 'small.txt', 'large.txt', '--min-bytes', minimum, '--total'], {
          cwd: directory,
        }),
      ).resolves.toEqual({ status: 0, stderr: '', stdout });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each(['', '-1', '1.5', ' 2 ', '1e3', '10KB', '9007199254740992'])(
  'textstat aggregates minimum %j and file preparation failures',
  async (minimum) => {
    const result = await run([`--min-bytes=${minimum}`, 'missing-fixture.txt']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Option "--min-bytes":');
    expect(result.stderr).toContain('Argument "files" at 0: Expected a readable file that exists.');
    expect(result.stderr).not.toContain('Cannot read file');
  },
);

test.each(['-1', '1.5', '10KB'])(
  'textstat rejects %j through the --minimum alias as a value of --min-bytes',
  async (minimum) => {
    const result = await run([`--minimum=${minimum}`, 'missing-fixture.txt']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Option "--min-bytes":');
    expect(result.stderr).toContain('Argument "files" at 0: Expected a readable file that exists.');
    expect(result.stderr).not.toContain('Cannot read file');
  },
);

// `--minimum` is the threshold's earlier name, so it is `--min-bytes` and the typed flag wins.
test.each([
  [['--minimum', '3'], {}, 'COUNT  SOURCE\n    5  large.txt\n'],
  [
    ['--minimum', '1'],
    { TEXTSTAT_MIN_BYTES: '5' },
    'COUNT  SOURCE\n    2  small.txt\n    5  large.txt\n',
  ],
] satisfies [string[], Record<string, string>, string][])(
  'textstat reads %j as --min-bytes',
  async (options, env, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-minimum-'));
    try {
      writeFileSync(join(directory, 'small.txt'), 'é');
      writeFileSync(join(directory, 'large.txt'), 'hello');
      await expect(
        run(['small.txt', 'large.txt', ...options], { cwd: directory, env }),
      ).resolves.toEqual({
        status: 0,
        stderr: '',
        stdout,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test('textstat rejects --minimum beside --min-bytes, because both supply one option', async () => {
  const result = await run(['--min-bytes', '3', '--minimum', '1', 'missing-fixture.txt']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'textstat: Option "--minimum" can be supplied only once. Remove the repeated option.',
  );
});

test('textstat --timing reports the elapsed time on stderr after the rows', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-timing-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    const result = await run(['one.txt', '--timing'], {
      cwd: directory,
      env: { TERM: 'xterm-256color' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('COUNT  SOURCE\n    6  one.txt\n    0  stdin\n');
    // The number is a measurement, so the line shape is the whole assertion.
    expect(result.stderr).toMatch(/^ℹ elapsed: \d+ms\n$/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  [{ NO_COLOR: '1', TERM: 'xterm-256color' }, /^ℹ elapsed: \d+ms\n$/u],
  [{ NO_COLOR: '1', TERM: 'linux' }, /^i elapsed: \d+ms\n$/u],
])('textstat timing keeps the captured glyph under %j', async (env, diagnostic) => {
  const result = await run(['--timing'], {
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

test('textstat preserves a filename that resembles valid style markup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-markers-'));
  const name = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  try {
    writeFileSync(join(directory, name), 'x');
    await expect(run([name], { cwd: directory })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: `COUNT  SOURCE\n    1  ${name}\n    0  stdin\n`,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('textstat rejects an unreadable source whose name resembles style markup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-error-markers-'));
  const name = '\uE000["style",[["foreground","red"]]]\uE001missing\uE002';
  try {
    const result = await run([name], {
      cwd: directory,
    });
    expect(result).toEqual({
      status: 2,
      stderr:
        'textstat: Argument "files" at 0: Expected a readable file that exists.\nRun "textstat --help" to see the usage.\n',
      stdout: '',
    });
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
  async (args, input, stdout) => {
    await expect(run(args, { input })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  },
);

test('textstat appends piped text after the supplied files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-stdin-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    await expect(
      run(['one.txt'], {
        cwd: directory,
        input: 'piped text that is longer',
      }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    6  one.txt\n   25  stdin\n',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  [['-', 'one.txt'], 'COUNT  SOURCE\n    2  stdin\n    6  one.txt\n'],
  [['one.txt', '-'], 'COUNT  SOURCE\n    6  one.txt\n    2  stdin\n'],
  [['-', 'one.txt', '-'], 'COUNT  SOURCE\n    2  stdin\n    6  one.txt\n    0  stdin\n'],
] satisfies [string[], string][])(
  'textstat preserves explicit stdin placement and shared reads for %j',
  async (argv, stdout) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-placement-'));
    try {
      writeFileSync(join(directory, 'one.txt'), 'hello\n');
      await expect(run(argv, { cwd: directory, input: 'hi' })).resolves.toEqual({
        status: 0,
        stderr: '',
        stdout,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test('textstat reads a literal file named hyphen through an explicit relative path', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-hyphen-'));
  try {
    writeFileSync(join(directory, '-'), 'abc');
    await expect(run(['./-'], { cwd: directory, input: 'hi' })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    3  ./-\n    2  stdin\n',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the inspected graph publishes native content facts and the catalog validators' input schemas", async () => {
  const inspected = inspection();
  const graph: {
    root: {
      arguments: unknown[];
      options: { aliases: string[]; name: string; schema: unknown }[];
    };
  } = JSON.parse(inspected);
  expect(graph.root.arguments).toEqual([
    {
      description: 'The files and piped text to count. Use - to place stdin.',
      extensions: {},
      name: 'files',
      required: true,
      schema: { minLength: 1, type: 'string' },
      stdin: true,
      type: 'content',
      validateOmitted: false,
      validated: true,
      variadic: true,
    },
  ]);
  const schemaOf = (name: string) =>
    graph.root.options.find((entry) => entry.name === name)?.schema;
  const draft = { $schema: 'https://json-schema.org/draft/2020-12/schema' };
  expect(schemaOf('metric')).toEqual({
    ...draft,
    enum: ['bytes', 'words', 'lines'],
    type: 'string',
  });
  expect(schemaOf('min-bytes')).toEqual({ ...draft, minimum: 0, type: 'integer' });
  expect(graph.root.options.find((entry) => entry.name === 'min-bytes')?.aliases).toEqual([
    'minimum',
  ]);
  expect(schemaOf('minimum')).toBeUndefined();
});

test('the inspected graph reports the declared table and the formatter views on the root result', async () => {
  const inspected = inspection();
  const graph: { root: { result: unknown } } = JSON.parse(inspected);
  expect(graph.root.result).toEqual({
    default: 'table',
    kind: 'rows',
    mediaTypes: { json: 'application/json', jsonl: 'application/jsonl', table: null },
    views: ['table', 'json', 'jsonl'],
  });
});

test('the inspected graph marks --config, --help, --version, --manifest, and --format as control options', async () => {
  const inspected = inspection();
  const graph: {
    globals: { name: string; control: boolean }[];
    root: { options: { name: string; control: boolean }[] };
  } = JSON.parse(inspected);
  const marks = Object.fromEntries(
    [...graph.globals, ...graph.root.options].map((option) => [option.name, option.control]),
  );
  expect(marks).toMatchObject({
    config: true,
    explain: true,
    format: true,
    help: true,
    manifest: true,
    metric: false,
    timing: false,
    version: true,
  });
});

test.each([
  [{ COLORTERM: '', FORCE_COLOR: '1', TERM: 'xterm', TERM_PROGRAM: '' }, '90', '33'],
  [
    { COLORTERM: '', FORCE_COLOR: '1', TERM: 'xterm-256color', TERM_PROGRAM: '' },
    '38;5;245',
    '38;5;172',
  ],
  [
    { COLORTERM: 'truecolor', FORCE_COLOR: '1', TERM: 'xterm' },
    '38;2;139;147;163',
    '38;2;201;123;54',
  ],
])(
  'textstat highlights the summary, never a file named total, at %j',
  async (env, dim, highlight) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-palette-'));
    try {
      writeFileSync(join(directory, 'total'), 'abc');
      const result = await run(['total', '--total'], {
        cwd: directory,
        env,
      });
      expect(result).toEqual({
        status: 0,
        stderr: '',
        stdout: `\u001b[${dim}mCOUNT\u001b[39m  \u001b[${dim}mSOURCE\u001b[39m\n    3  total\n    0  stdin\n    \u001b[${highlight}m3\u001b[39m  \u001b[${highlight}mtotal\u001b[39m\n`,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each(['json', 'jsonl'])(
  'summary styling leaves the %s result fields unchanged',
  async (format) => {
    const result = await run(['--total', '--format', format], {
      env: { FORCE_COLOR: '1' },
      input: 'abc',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b');
    const rows: unknown =
      format === 'json'
        ? JSON.parse(result.stdout)
        : result.stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
    expect(rows).toEqual([
      { count: 3, source: 'stdin' },
      { count: 3, source: 'total' },
    ]);
  },
);

test('NO_COLOR keeps the total row content and layout without foreground escapes', async () => {
  await expect(
    run(['--total'], {
      env: { COLORTERM: 'truecolor', FORCE_COLOR: '', NO_COLOR: '1' },
      input: 'abc',
    }),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    3  stdin\n    3  total\n',
  });
});
