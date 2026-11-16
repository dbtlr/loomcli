/*
 * Acceptance plan for a streamed message (docs/core/output.md#a-streamed-message, ADR-0163).
 *
 * Each semantic method takes an async iterable of its text. Each case runs an Application through
 * public APIs on a mock process in the test's own process, under Node and Bun:
 *
 * - The joined text decides. Off a terminal, the bytes each lane writes for a stream equal the
 *   bytes it writes for the joined text, with color on, so a style the debug and trace lanes keep
 *   open across a line break included, and on a Command that declares a result `print` moves to
 *   stderr with its stream.
 * - One write a line. Off a terminal each completed line is one write, a CRLF or an LF that two
 *   chunks split included, and a message written between two lines lands between them.
 * - An empty stream writes what the method writes for the empty string.
 * - Hidden. A stream the verbosity hides is read to its end and writes nothing; its call resolves
 *   when it ends and rejects when it throws.
 * - A throw. The text received stays, the message gets its one line break, and the call rejects
 *   with the thrown value; a throw no code observed fails the run through the ordinary failure path.
 * - A stop. An action that fails while its stream is open ends the message ahead of its failure
 *   report and the call resolves; a cancelled run ends every open stream, and the iterable is told
 *   to stop.
 * - The run waits for a stream no code awaited.
 * - On a terminal. At every chunk the screen shows what the method writes for the text so far, the
 *   unfinished row sits above an open live region, a message written meanwhile lands between the
 *   finished rows and the unfinished row, a trailing space never finishes a row the joined text lays
 *   out otherwise, a row longer than the screen is written a screen row at a time, a style kept
 *   across rows leaks into no other write, and the final screen equals the joined text's.
 * - At the process's end, the text an open stream received is written with its line break.
 */
import { Application, style } from '@loomcli/core';
import type { Lane, Out } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { replay } from '../../../scripts/test-screen.js';

/** An async iterable that yields each part in turn. */
async function* chunks(...parts: readonly string[]): AsyncGenerator<string> {
  for (const part of parts) {
    yield part;
  }
}

/** An async iterable that yields each part in turn, then throws. */
async function* broken(...parts: readonly string[]): AsyncGenerator<string> {
  yield* parts;
  throw new Error('The service hung up.');
}

/** An async iterable that yields its first part, and its second once a timer has fired. */
async function* slow(first: string, second: string): AsyncGenerator<string> {
  yield first;
  await new Promise((resolve) => setTimeout(resolve, 20));
  yield second;
}

/**
 * An iterable that yields `first`, then never answers again, and notes each time core tells it to
 * stop, as a model's stream waiting on the network does.
 */
function stalling(first: string) {
  const returned = vi.fn(async (): Promise<IteratorResult<string>> => ({
    done: true,
    value: undefined,
  }));
  let requests = 0;
  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<string>> => {
        requests += 1;
        return requests === 1
          ? { done: false, value: first }
          : await new Promise<never>(() => undefined);
      },
      return: returned,
    }),
  };
  return { iterable, returned };
}

/** An application that marks `-v` and `-q`, so a test can move the run's verbosity. */
function marked(name: string) {
  return new Application(name)
    .globalOption('verbose', { short: 'v', type: 'count', verbose: true })
    .globalOption('quiet', { quiet: true, short: 'q', type: 'count' });
}

/** What a run on a piped mock wrote, as bytes per stream and as the writes in order. */
async function piped(
  write: (out: Out) => Promise<void>,
  argv: readonly string[] = [],
  rendering: Rendering = {},
) {
  const mock = mockProcess({ argv: [...argv], env: {} });
  const code = await marked('streamed')
    .action(async ({ out }) => write(out))
    .run({ process: mock, rendering });
  return {
    code,
    stderr: mock.stderr.text,
    stdout: mock.stdout.text,
    writes: mock.transcript.map(({ stream, text }) => `${stream}:${text}`),
  };
}

/** The rendering policy a run takes. */
type Rendering = NonNullable<Parameters<Application['run']>[0]>['rendering'];

/** Color and modifiers forced on, so a style's bytes are written off a terminal too. */
const colored: Rendering = { color: 'always', modifiers: 'always' };

const semantic: readonly Lane[] = ['print', 'info', 'success', 'warn', 'error', 'debug', 'trace'];

/** Text whose chunks split words, lines, and a blank line, and whose end has no line break. */
const pages = ['Fetched the ', 'first page.\nThen the sec', 'ond', ' page.\n', '\nDone'];

test.each(semantic)(
  'off a terminal, a stream on %s writes the bytes the joined text writes, with color on',
  async (lane) => {
    const streamed = await piped((out) => out[lane](chunks(...pages)), ['-vv'], colored);
    const joined = await piped((out) => out[lane](pages.join('')), ['-vv'], colored);
    expect({ stderr: streamed.stderr, stdout: streamed.stdout }).toEqual({
      stderr: joined.stderr,
      stdout: joined.stdout,
    });
    expect(`${streamed.stdout}${streamed.stderr}`).toContain('Done');
  },
);

test('off a terminal, a style a chunk keeps open across a line break writes the joined bytes', async () => {
  const streamed = await piped((out) => out.print(chunks(style.bold('a\nb'), 'c\nd')), [], colored);
  const joined = await piped((out) => out.print(`${style.bold('a\nb')}c\nd`), [], colored);
  expect(streamed.stdout).toBe('\u001B[1ma\nb\u001B[22mc\nd\n');
  expect(streamed.writes).toEqual(['stdout:\u001B[1ma\n', 'stdout:b\u001B[22mc\n', 'stdout:d\n']);
  expect(joined.stdout).toBe(streamed.stdout);
});

test('a streamed print moves to stderr on a Command that declares a result', async () => {
  const mock = mockProcess();
  const app = new Application('result')
    .result<string>({ views: { text: { render: (value) => `${value}\n` } } })
    .action(async ({ out }) => {
      await out.print(chunks('no', 'te'));
      await out.results('value');
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect({ stderr: mock.stderr.text, stdout: mock.stdout.text }).toEqual({
    stderr: 'note\n',
    stdout: 'value\n',
  });
});

test('off a terminal, each completed line is one write, and the last comes at the end', async () => {
  const run = await piped((out) => out.print(chunks('ab', 'c\nde', 'f\ng', 'h')));
  expect(run.writes).toEqual(['stdout:abc\n', 'stdout:def\n', 'stdout:gh\n']);
});

test('a CRLF or an LF that two chunks split is one line break', async () => {
  const run = await piped((out) => out.print(chunks('one\r', '\ntwo', '\n', '\nthree\n')));
  expect(run.writes).toEqual(['stdout:one\r\n', 'stdout:two\n', 'stdout:\n', 'stdout:three\n']);
});

test('a message written between two lines of a stream lands between them, never inside one', async () => {
  const run = await piped(async (out) => {
    async function* answer(): AsyncGenerator<string> {
      yield 'first li';
      yield 'ne\nsecond';
      await out.print('between');
      yield ' line';
    }
    await out.print(answer());
  });
  expect(run.writes).toEqual(['stdout:first line\n', 'stdout:between\n', 'stdout:second line\n']);
});

test.each(semantic)('an empty stream on %s writes what the empty string writes', async (lane) => {
  const streamed = await piped((out) => out[lane](chunks()), ['-vv']);
  const joined = await piped((out) => out[lane](''), ['-vv']);
  expect(streamed.writes).toEqual(joined.writes);
});

test('a stream the verbosity hides is read to its end and writes nothing', async () => {
  const read: string[] = [];
  async function* recorded(): AsyncGenerator<string> {
    for (const part of ['one ', 'two']) {
      read.push(part);
      yield part;
    }
  }
  const run = await piped(
    async (out) => {
      await out.info(recorded());
      await out.debug(recorded());
    },
    ['-q'],
  );
  expect(read).toEqual(['one ', 'two', 'one ', 'two']);
  expect(run).toMatchObject({ code: 0, stderr: '', stdout: '' });
});

test('a hidden stream that throws rejects its call', async () => {
  let rejection: unknown = undefined;
  const run = await piped(async (out) => {
    rejection = await out.debug(broken('partial')).catch((error: unknown) => error);
  });
  expect(rejection).toEqual(new Error('The service hung up.'));
  expect(run).toMatchObject({ code: 0, stderr: '' });
});

test('a stream that throws keeps its text, ends with one line break, and rejects its call', async () => {
  let rejection: unknown = undefined;
  const run = await piped(async (out) => {
    rejection = await out.warn(broken('first\nsec', 'ond')).catch((error: unknown) => error);
  });
  expect(rejection).toEqual(new Error('The service hung up.'));
  expect(run.writes).toEqual(['stderr:⚠ first\n', 'stderr:  second\n']);
  expect(run.code).toBe(0);
});

test('a throw no code observed fails the run through the ordinary failure path', async () => {
  const run = await piped(async (out) => {
    void out.print(broken('partial'));
  });
  expect(run.code).toBe(1);
  expect(run.stdout).toBe('partial\n');
  expect(run.stderr).toContain('The service hung up.');
});

test('the run waits for a stream no code awaited', async () => {
  const run = await piped(async (out) => {
    void out.print(slow('one ', 'two'));
  });
  expect(run).toMatchObject({ code: 0, stdout: 'one two\n' });
});

test('an action that fails while its stream is open ends the message ahead of its failure report', async () => {
  const { iterable, returned } = stalling('Partial answer');
  const settled = vi.fn();
  const run = await piped(async (out) => {
    void out.print(chunks('Working\nPartial ', 'answer'));
    void out.info(iterable).then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw new Error('The action broke.');
  });
  expect(run.code).toBe(1);
  expect(run.stdout).toBe('Working\nPartial answer\n');
  const ended = run.stderr.indexOf('ℹ Partial answer\n');
  expect(ended).toBeGreaterThan(-1);
  expect(ended).toBeLessThan(run.stderr.indexOf('The action broke.'));
  // The call resolves, and the iterable is told to stop without core waiting for it.
  expect(settled).toHaveBeenCalledWith(undefined);
  expect(returned).toHaveBeenCalledOnce();
});

test('a cancelled run ends every open stream at once, and the iterable is told to stop', async () => {
  const { iterable, returned } = stalling('Partial');
  const mock = mockProcess();
  const settled = vi.fn();
  const app = new Application('cancel').action(async ({ cancel, out }) => {
    const call = out.print(iterable);
    await new Promise((resolve) => setTimeout(resolve, 10));
    cancel();
    settled(await call);
  });
  await app.run({ process: mock });
  expect(settled).toHaveBeenCalledWith(undefined);
  expect(returned).toHaveBeenCalledOnce();
  expect(mock.stdout.text).toBe('Partial\n');
});

/** A mock whose stdout and stderr are on one terminal `columns` wide, unless `streams` names fewer. */
function terminal(
  columns: number,
  streams: readonly ('stdout' | 'stderr')[] = ['stdout', 'stderr'],
): MockProcess {
  return mockProcess({
    env: { TERM: 'xterm-256color' },
    terminal: { columns, rows: 24, streams },
  });
}

/** What the emulator shows for the writes the mock recorded so far. */
async function shown(
  mock: MockProcess,
  columns: number,
  streams: readonly ('stdout' | 'stderr')[] = ['stdout', 'stderr'],
): Promise<readonly string[]> {
  const writes = mock.transcript.filter(({ stream }) => streams.includes(stream));
  const screen = await replay(
    writes.map(({ text }) => ({ write: text })),
    { columns },
  );
  return screen.lines;
}

/**
 * Runs `write` on a terminal and answers the screen after each chunk the iterable yielded, read
 * once the chunk's writes have reached the mock, and the screen once the run ended.
 */
async function onScreen(
  columns: number,
  parts: readonly string[],
  write: (out: Out, text: AsyncIterable<string>) => Promise<void>,
  streams?: readonly ('stdout' | 'stderr')[],
) {
  const mock = terminal(columns, streams);
  const screens: (readonly string[])[] = [];
  async function* text(): AsyncGenerator<string> {
    for (const part of parts) {
      yield part;
      // The writes of the chunk just yielded have completed before the next one is requested.
      screens.push(await shown(mock, columns));
    }
  }
  const code = await marked('screen')
    .action(async ({ out }) => write(out, text()))
    .run({ process: mock });
  return { code, end: await shown(mock, columns), mock, screens };
}

/** What a run that writes `text` whole shows on a terminal. */
async function wholeScreen(
  columns: number,
  write: (out: Out) => Promise<void>,
  streams?: readonly ('stdout' | 'stderr')[],
) {
  const mock = terminal(columns, streams);
  await marked('screen')
    .action(async ({ out }) => write(out))
    .run({ process: mock });
  return await shown(mock, columns);
}

test('on a terminal, each chunk shows the text so far, and the end shows the joined text', async () => {
  const answer = [
    'Loom is a toolkit for command',
    '-line applications. It parses, rou',
    'tes, and renders.',
  ];
  const run = await onScreen(44, answer, (out, text) => out.info(text));
  expect(run.screens).toEqual([
    ['ℹ Loom is a toolkit for command'],
    ['ℹ Loom is a toolkit for command-line', '  applications. It parses, rou'],
    [
      'ℹ Loom is a toolkit for command-line',
      '  applications. It parses, routes, and',
      '  renders.',
    ],
  ]);
  expect(run.end).toEqual(await wholeScreen(44, (out) => out.info(answer.join(''))));
});

/**
 * Texts whose spaces, line breaks, and long words fall at and around the end of a row, which is
 * 14 columns right of a glyph's gutter at 16 columns, and 16 for print.
 */
const layouts = [
  'aaaa bbbbbbbbb ccc dddddddddddd e f',
  'word    wordxx   word  w\n\nlast   ',
  'a verylongwordthatoverflows b c\r\nnext',
  'sixteen columns. and more',
];

test.each(['info', 'print', 'warn'] as const)(
  'on a terminal, %s ends on the joined text screen wherever two chunks split the text',
  async (lane) => {
    for (const text of layouts) {
      const joined = await wholeScreen(16, (out) => out[lane](text));
      for (let split = 1; split < text.length; split += 1) {
        const parts = [text.slice(0, split), text.slice(split)];
        const run = await onScreen(16, parts, (out, streamed) => out[lane](streamed));
        expect({ end: run.end, split }).toEqual({ end: joined, split });
      }
    }
  },
);

test('on a terminal, the unfinished row sits above an open live region', async () => {
  const run = await onScreen(40, ['one two', ' three\nfour', ' five'], async (out, text) => {
    const region = out.region();
    await region.draw(null, { render: () => 'Working' });
    await out.print(text);
    await region.end();
  });
  expect(run.screens).toEqual([
    ['one two', 'Working'],
    ['one two three', 'four', 'Working'],
    ['one two three', 'four five', 'Working'],
  ]);
  expect(run.end).toEqual(['one two three', 'four five', 'Working']);
});

test('on a terminal, a message written meanwhile lands between the finished rows and the unfinished row', async () => {
  const mock = terminal(40);
  const screens: (readonly string[])[] = [];
  const app = marked('meanwhile').action(async ({ out }) => {
    async function* text(): AsyncGenerator<string> {
      yield 'first\nsecond';
      await out.warn('A warning.');
      screens.push(await shown(mock, 40));
      yield ' half';
    }
    await out.print(text());
  });
  await app.run({ process: mock });
  expect(screens).toEqual([['first', '⚠ A warning.', 'second']]);
  await expect(shown(mock, 40)).resolves.toEqual(['first', '⚠ A warning.', 'second half']);
});

test('on a terminal, a trailing space never finishes a row the joined text lays out otherwise', async () => {
  const parts = ['aaaa bbbbbbb ', 'c'];
  const run = await onScreen(14, parts, (out, text) => out.info(text));
  expect(run.end).toEqual(await wholeScreen(14, (out) => out.info(parts.join(''))));
  expect(run.end).toEqual(['ℹ aaaa bbbbbbb', '  c']);
});

test('on a terminal, a print row longer than the screen is written a screen row at a time', async () => {
  const run = await onScreen(10, ['abcdefghij', 'klmnopqrstu', 'vw'], (out, text) =>
    out.print(text),
  );
  expect(run.screens).toEqual([
    ['abcdefghij'],
    ['abcdefghij', 'klmnopqrst', 'u'],
    ['abcdefghij', 'klmnopqrst', 'uvw'],
  ]);
  expect(run.end).toEqual(['abcdefghij', 'klmnopqrst', 'uvw']);
  // Only the last screen row is ever redrawn, so no write erases more than one row.
  expect(run.mock.stdout.text).not.toContain('\u001B[1A');
});

test('on a terminal, a style a chunk keeps across rows leaks into no write between them', async () => {
  const mock = terminal(40);
  const app = marked('bold').action(async ({ out }) => {
    async function* text(): AsyncGenerator<string> {
      yield style.bold('first\nsec');
      await out.warn('plain');
      yield 'ond';
    }
    await out.print(text());
  });
  await app.run({ process: mock, rendering: colored });
  const warning = mock.transcript.findIndex(({ text }) => text.includes('plain'));
  expect(warning).toBeGreaterThan(0);
  // Every write before the warning closes the bold it opens, so the warning takes none of it.
  const before = mock.transcript
    .slice(0, warning)
    .map(({ text }) => text)
    .join('');
  expect(before).toContain('\u001B[1m');
  expect(before.lastIndexOf('\u001B[1m')).toBeLessThan(before.lastIndexOf('\u001B[22m'));
  await expect(shown(mock, 40)).resolves.toEqual(['first', '⚠ plain', 'second']);
});

test('while an input region holds the frames still, the unfinished row goes on growing above the stack', async () => {
  const run = await onScreen(40, ['one', ' two'], async (out, text) => {
    const region = out.region();
    await region.draw(null, { render: () => 'Working' });
    const question = out.region({ input: true });
    await question.draw(null, { render: () => 'Continue?' });
    void region.draw(null, { render: () => 'Held' });
    await out.print(text);
    await question.end();
    await region.end();
  });
  expect(run.screens).toEqual([
    ['one', 'Working', 'Continue?'],
    ['one two', 'Working', 'Continue?'],
  ]);
  expect(run.end).toEqual(['one two', 'Continue?', 'Held']);
});

test('while the terminal is lent, a finished row is written as it is and no unfinished row is drawn', async () => {
  const mock = terminal(40);
  const app = marked('lend').action(async ({ out }) => {
    async function* text(): AsyncGenerator<string> {
      yield 'first\nsec';
      await out.lendTerminal(async () => {
        // The child program's own output lands where the cursor is.
        mock.stdout.write('child\n');
        await out.print('during');
      });
      yield 'ond';
    }
    await out.print(text());
  });
  await app.run({ process: mock });
  // The row drawn before the lend stays as drawn, and the lend's end starts a row of its own, as
  // It does for a frame, below which the unfinished row is drawn again.
  await expect(shown(mock, 40)).resolves.toEqual(['first', 'sec', 'child', 'during', '', 'second']);
});

test('with stdout alone on the terminal, a streamed print grows its unfinished row there', async () => {
  const mock = terminal(40, ['stdout']);
  const screens: (readonly string[])[] = [];
  const app = marked('stdout').action(async ({ out }) => {
    async function* text(): AsyncGenerator<string> {
      yield 'first\nsec';
      screens.push(await shown(mock, 40, ['stdout']));
      await out.print('between');
      await out.info('to the log');
      screens.push(await shown(mock, 40, ['stdout']));
      yield 'ond';
    }
    await out.print(text());
  });
  await app.run({ process: mock });
  expect(screens).toEqual([
    ['first', 'sec'],
    ['first', 'between', 'sec'],
  ]);
  await expect(shown(mock, 40, ['stdout'])).resolves.toEqual(['first', 'between', 'second']);
  expect(mock.stderr.text).toBe('ℹ to the log\n');
});

test('at the process exit event, the text an open stream received is written with its line break', async () => {
  const mock = mockProcess();
  const on = vi.spyOn(mock.signals, 'on');
  let atExit = '';
  async function* text(): AsyncGenerator<string> {
    yield 'Saved one\nSaved t';
    yield 'wo';
    for (const [event, listener] of on.mock.calls) {
      if (event === 'exit') {
        listener(1);
      }
    }
    atExit = mock.stdout.text;
    yield ' more';
  }
  const app = new Application('exit').action(async ({ out }) => {
    await out.print(text());
  });
  await app.run({ process: mock });
  expect(atExit).toBe('Saved one\nSaved two\n');
  expect(mock.stdout.text).toBe('Saved one\nSaved two\n');
});
