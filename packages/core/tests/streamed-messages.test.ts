/*
 * Acceptance plan for a streamed message (docs/core/output.md#a-streamed-message, ADR-0163).
 *
 * Each semantic method takes an async iterable of its text. Each case runs an Application through
 * public APIs on a mock process in the test's own process, under Node and Bun:
 *
 * - The joined text decides. Off a terminal, the bytes each lane writes for a stream equal the
 *   bytes it writes for the joined text, with color on, so a style the debug and trace lanes keep
 *   open across a line break included, and on a Command that declares a result `print` moves to
 *   stderr with its stream. A text that ends with a line break writes the style close after that
 *   break wherever two chunks split it, so the next message starts with no style open.
 * - The lane view's context is read once a message.
 * - One write a line. Off a terminal each completed line is one write, a CRLF or an LF that two
 *   chunks split included, and a message written between two lines lands between them.
 * - An empty stream writes what the method writes for the empty string.
 * - Hidden. A stream the verbosity hides is read to its end and writes nothing; its call resolves
 *   when it ends and rejects when it throws.
 * - A throw. The text received stays, the message gets its one line break, and the call rejects
 *   with the thrown value; a throw no code observed fails the run through the ordinary failure path.
 *   A lane view that throws at the final layout does the same, off a terminal and on one.
 * - A stop. An action that fails while its stream is open ends the message ahead of its failure
 *   report and the call resolves; a cancelled run ends every open stream, and the iterable is told
 *   to stop, as it is after a write fails or a lane view throws at a chunk. A stream issued after
 *   the abort reads no chunk, and a chunk that arrives after a stop is discarded.
 * - The run waits for a stream no code awaited.
 * - On a terminal. At every chunk the screen shows what the method writes for the text so far, the
 *   unfinished row sits above an open live region, a message written meanwhile lands between the
 *   finished rows and the unfinished row, a trailing space never finishes a row the joined text lays
 *   out otherwise, a row longer than the screen is written a screen row at a time, a style kept
 *   across rows leaks into no other write, a question that closes beside the unfinished row moves
 *   into scrollback above it, and the final screen equals the joined text's.
 * - At the process's end, the text an open stream received is written with its line break, at the
 *   place its last write took among the queued writes.
 */
import { Application, lanes, override, style } from '@loomcli/core';
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

test('a suspend erases the unfinished row, and the resume draws it again', async () => {
  const mock = terminal(40);
  const screens: (readonly string[])[] = [];
  async function* text(): AsyncGenerator<string> {
    yield 'first\nsec';
    mock.signals.raise('SIGTSTP');
    screens.push(await shown(mock, 40));
    mock.signals.raise('SIGCONT');
    await new Promise((resolve) => setTimeout(resolve, 0));
    screens.push(await shown(mock, 40));
    yield 'ond';
  }
  const app = marked('suspend').action(async ({ out }) => {
    await out.print(text());
  });
  await app.run({ process: mock });
  expect(screens).toEqual([['first'], ['first', 'sec']]);
  await expect(shown(mock, 40)).resolves.toEqual(['first', 'second']);
});

test('at the exit event on a terminal, the unfinished row is written as a finished row', async () => {
  const mock = terminal(40);
  const on = vi.spyOn(mock.signals, 'on');
  async function* text(): AsyncGenerator<string> {
    yield 'first\nsec';
    for (const [event, listener] of on.mock.calls) {
      if (event === 'exit') {
        listener(1);
      }
    }
    yield 'ond';
  }
  const app = marked('exit').action(async ({ out }) => {
    const region = out.region();
    await region.draw(null, { render: () => 'Working' });
    await out.print(text());
  });
  await app.run({ process: mock });
  await expect(shown(mock, 40)).resolves.toEqual(['first', 'sec', 'Working']);
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

/** A text in segments: a string splits at any character, and a style call's text only at its edges. */
type Segment = string | { readonly styled: string };

/** Texts that end with a line break, so the joined text writes a style's close after that break. */
const endingTexts: readonly (readonly Segment[])[] = [
  ['Fetched the page.\n'],
  ['one\n\ntwo\n'],
  [{ styled: style.bold('Answer ready.\n') }],
  ['Then ', { styled: style.bold('bold\nend\n') }],
  [{ styled: style.bold('a\n') }, 'b\n'],
];

/** The text a segment holds. */
function segmentText(segment: Segment): string {
  return typeof segment === 'string' ? segment : segment.styled;
}

/** Every split of a text into two nonempty chunks that keeps each style call inside one chunk. */
function twoChunkSplits(segments: readonly Segment[]): (readonly [string, string])[] {
  const text = segments.map(segmentText).join('');
  const cuts = new Set<number>();
  let at = 0;
  for (const segment of segments) {
    const { length } = segmentText(segment);
    if (typeof segment === 'string') {
      for (let inside = 1; inside < length; inside += 1) {
        cuts.add(at + inside);
      }
    }
    at += length;
    cuts.add(at);
  }
  return [...cuts]
    .filter((cut) => cut < text.length)
    .map((cut) => [text.slice(0, cut), text.slice(cut)] as const);
}

test.each(semantic)(
  'off a terminal, a stream on %s whose text ends with a line break writes the joined bytes wherever two chunks split it',
  async (lane) => {
    for (const segments of endingTexts) {
      const joined = await piped(
        (out) => out[lane](segments.map(segmentText).join('')),
        ['-vv'],
        colored,
      );
      for (const [first, second] of twoChunkSplits(segments)) {
        const streamed = await piped((out) => out[lane](chunks(first, second)), ['-vv'], colored);
        expect({ first, stderr: streamed.stderr, stdout: streamed.stdout }).toEqual({
          first,
          stderr: joined.stderr,
          stdout: joined.stdout,
        });
      }
    }
  },
);

test('off a terminal, a message written after a stream that ends with a line break starts with no style open', async () => {
  const mock = mockProcess({ argv: ['-vv'], env: {} });
  await marked('closed')
    .action(async ({ out }) => {
      await out.trace(chunks('Fetched the page.\n'));
      await out.print(chunks(style.bold('Answer ready.\n')));
      await out.warn('Next message');
      await out.print('plain');
    })
    .run({ process: mock, rendering: colored });
  const next = [
    { message: 'Next message', opened: '\u001B[2m', stream: 'stderr' },
    { message: 'plain', opened: '\u001B[1m', stream: 'stdout' },
  ];
  for (const { message, opened, stream } of next) {
    const writes = mock.transcript.filter((write) => write.stream === stream);
    const before = writes
      .slice(
        0,
        writes.findIndex(({ text }) => text.includes(message)),
      )
      .map(({ text }) => text)
      .join('');
    // The stream opens a faint or bold attribute, and the bytes before the next message close it.
    expect({
      closed: before.endsWith('\n\u001B[22m'),
      opened: before.includes(opened),
      stream,
    }).toEqual({
      closed: true,
      opened: true,
      stream,
    });
  }
});

/**
 * An iterable whose `next` answers each request with `answer`, its requests counted from 1, and
 * which notes each time core tells it to stop.
 */
function scripted(answer: (request: number) => Promise<IteratorResult<string>>) {
  const returned = vi.fn(async (): Promise<IteratorResult<string>> => ({
    done: true,
    value: undefined,
  }));
  const requested = vi.fn();
  let requests = 0;
  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<string>> => {
        requests += 1;
        requested(requests);
        return answer(requests);
      },
      return: returned,
    }),
  };
  return { iterable, requested, returned };
}

/** An answer that never comes, as a stream waiting on the network gives. */
const never = async (): Promise<never> => await new Promise<never>(() => undefined);

/** The error an info lane view that refuses a text throws. */
const refusal = new Error('The view refused the text.');

/** An application whose info lane view throws on a text `refuses` names, and writes any other as it is. */
function refusing(name: string, refuses: (message: string) => boolean) {
  return new Application(name, {
    views: [
      override(lanes.info, {
        render: (message) => {
          if (refuses(message)) {
            throw refusal;
          }
          return message;
        },
      }),
    ],
  });
}

/** Lane views that accept every layout before the end and throw at the final one, off a terminal. */
const finalLayouts = [
  {
    name: 'an empty stream whose view throws on the empty string',
    parts: [],
    refuses: (message: string) => message === '',
    written: '\n',
  },
  {
    name: 'a joined text that differs from every earlier layout only by a trailing space',
    parts: ['Hello', ' '],
    refuses: (message: string) => message.endsWith(' '),
    written: 'Hello\n',
  },
  {
    name: 'a view that rejects the finished text',
    parts: ['first\nsec', 'ond.\t'],
    refuses: (message: string) => message === 'first\nsecond.\t',
    written: 'first\nsecond.\n',
  },
];

test.each(finalLayouts)(
  'off a terminal, $name keeps the text, ends with one line break, and rejects the call',
  async ({ parts, refuses, written }) => {
    const mock = mockProcess();
    let rejection: unknown = undefined;
    const code = await refusing('final', refuses)
      .action(async ({ out }) => {
        rejection = await out.info(chunks(...parts)).catch((error: unknown) => error);
      })
      .run({ process: mock });
    expect({ code, rejection, stderr: mock.stderr.text }).toEqual({
      code: 0,
      rejection: refusal,
      stderr: written,
    });
  },
);

test.each(finalLayouts)(
  'off a terminal, $name that no code observed fails the run as the same call with a string does',
  async ({ parts, refuses, written }) => {
    async function run(write: (out: Out) => Promise<void>) {
      const mock = mockProcess();
      const code = await refusing('unobserved', refuses)
        .action(async ({ out }) => {
          void write(out);
        })
        .run({ process: mock });
      return { code, stderr: mock.stderr.text };
    }
    const streamed = await run((out) => out.info(chunks(...parts)));
    const whole = await run((out) => out.info(parts.join('')));
    expect(whole.code).not.toBe(0);
    expect(streamed.code).toBe(whole.code);
    expect(streamed.stderr).toBe(`${written}${whole.stderr}`);
    expect(streamed.stderr).toContain(refusal.message);
  },
);

test('on a terminal, a lane view that rejects the finished text keeps the rows shown and rejects the call', async () => {
  const mock = terminal(40);
  let rejection: unknown = undefined;
  const code = await refusing('final', (message) => message === 'first\nsecond.\t')
    .action(async ({ out }) => {
      rejection = await out.info(chunks('first\nsec', 'ond.\t')).catch((error: unknown) => error);
      await out.info('after');
    })
    .run({ process: mock });
  expect({ code, rejection }).toEqual({ code: 0, rejection: refusal });
  await expect(shown(mock, 40)).resolves.toEqual(['first', 'second.', 'after']);
});

/** What a run writes when its action cancels the run and then calls `write`. */
async function afterAbort(write: (out: Out) => Promise<void>) {
  const mock = mockProcess();
  await new Application('late')
    .action(async ({ cancel, out, signal }) => {
      cancel();
      expect(signal.aborted).toBe(true);
      await write(out);
    })
    .run({ process: mock });
  return { stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test('a stream issued after the run signal aborted reads no chunk and ends as the empty message does', async () => {
  const { iterable, requested } = scripted(async (request) =>
    request === 1 ? { done: false, value: 'late\n' } : { done: true, value: undefined },
  );
  const streamed = await afterAbort((out) => out.print(iterable));
  expect(requested).not.toHaveBeenCalled();
  expect(streamed).toEqual(await afterAbort((out) => out.print('')));
});

test('a write that fails ends the stream, rejects its call, and the iterable is told to stop', async () => {
  const mock = mockProcess();
  const { iterable, returned } = scripted(async (request) => {
    if (request === 2) {
      mock.stderr.destroy(new Error('The terminal hung up.'));
    }
    return request <= 2 ? { done: false, value: `line ${String(request)}\n` } : await never();
  });
  let rejection: unknown = undefined;
  await new Application('failed')
    .action(async ({ out }) => {
      rejection = await out.info(iterable).catch((error: unknown) => error);
    })
    .run({ process: mock });
  expect(rejection).toBeInstanceOf(Error);
  expect(returned).toHaveBeenCalledOnce();
});

test('a lane view that throws at a chunk ends the stream, and the iterable is told to stop', async () => {
  const { iterable, returned } = scripted(async (request) =>
    request === 1 ? { done: false, value: 'refused' } : await never(),
  );
  let rejection: unknown = undefined;
  await refusing('view', (message) => message === 'refused')
    .action(async ({ out }) => {
      rejection = await out.info(iterable).catch((error: unknown) => error);
    })
    .run({ process: mockProcess() });
  expect(rejection).toBe(refusal);
  expect(returned).toHaveBeenCalledOnce();
});

test('a stream reads the view context once, at its first layout', async () => {
  const contexts = new Set<unknown>();
  const app = new Application('context', {
    views: [
      override(lanes.info, {
        render: (message, context) => {
          contexts.add(context);
          return message;
        },
      }),
    ],
  }).action(async ({ out }) => {
    await out.info(chunks('one ', 'two ', 'three'));
  });
  await app.run({ process: mockProcess() });
  expect(contexts.size).toBe(1);
});

test('at the exit event, the rest of an open stream takes the place its last write took among the queued writes', async () => {
  const mock = mockProcess();
  const on = vi.spyOn(mock.signals, 'on');
  const { iterable } = scripted(async (request) =>
    request === 1 ? { done: false, value: 'Saved one\nSaved t' } : await never(),
  );
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  // A row sequence that waits holds its place in stdout's order, so every later stdout write stays queued.
  async function* waiting(): AsyncGenerator<string> {
    await held;
    yield* [];
  }
  let atExit = '';
  const app = new Application('exit').action(async ({ out }) => {
    // The sequence yields no row, so its row view is never called.
    void out.render(waiting(), { row: () => '' });
    void out.print('before');
    void out.print(iterable);
    await new Promise((resolve) => setTimeout(resolve, 10));
    void out.print('after');
    for (const [event, listener] of on.mock.calls) {
      if (event === 'exit') {
        listener(1);
      }
    }
    atExit = mock.stdout.text;
    gate.release?.();
  });
  await app.run({ process: mock });
  expect(atExit).toBe('before\nSaved one\nSaved t\nafter\n');
});

test('a chunk that arrives after a stop is discarded', async () => {
  // The stop comes a growing number of microtasks after the chunk arrives.
  // One of those delays lands the stop between the chunk's arrival and core taking it.
  for (let delay = 0; delay < 12; delay += 1) {
    const mock = mockProcess();
    const app = new Application('late').action(async ({ cancel, out }) => {
      const { iterable } = scripted((request) => {
        if (request > 1) {
          return never();
        }
        let stop = Promise.resolve();
        for (let step = 0; step < delay; step += 1) {
          stop = stop.then(() => undefined);
        }
        void stop.then(cancel);
        return Promise.resolve({ done: false, value: 'Partial\nmore\n' });
      });
      await out.print(iterable);
    });
    await app.run({ process: mock });
    // The chunk is either taken before the stop or discarded whole, never taken after the end.
    expect({ delay, stdout: mock.stdout.text }).toEqual({
      delay,
      stdout: expect.stringMatching(/^(?:\n|Partial\nmore\n)$/u),
    });
  }
});

test('a question that closes beside an unfinished row moves into scrollback above it', async () => {
  const mock = terminal(40);
  const app = marked('question').action(async ({ out }) => {
    const question = out.region({ input: true });
    await question.draw(null, { render: () => 'Continue?' });
    async function* text(): AsyncGenerator<string> {
      yield 'one';
      await question.end();
      yield ' two';
    }
    await out.print(text());
  });
  await app.run({ process: mock });
  await expect(shown(mock, 40)).resolves.toEqual(['Continue?', 'one two']);
});
