/*
 * Acceptance plan for what a streamed message costs as its text grows
 * (docs/core/output.md#a-streamed-message, ADR-0163).
 *
 * - A streamed message joins its action's live set while it is open, so the action's failure stops
 *   it, and leaves the set at its end: when its iterable ends, when it throws, and when a stop
 *   ends it. An action that streams many messages holds none of them once each has ended.
 * - A lane view core ships lays out each line of a streamed message a bounded number of times, so
 *   the characters it lays out over the message stay within a small multiple of its length, and
 *   twice the text takes about twice the layout. A lane view an author overrode is a function of
 *   the whole message, so it lays out the whole text so far at every chunk.
 * - A finished line that leaves the lines after it a raw color, a raw link, a pad frame, or a style
 *   that names a token the application's theme adds is not laid out again either, so the
 *   characters laid out stay within the same multiple of the message's length.
 * - A message that sets SGR attributes on every line carries only the commands that leave what
 *   they set, so the characters laid out stay within the same multiple of its length: a color
 *   that changes on every line and is never reset, modifiers toggled on and off so that more than
 *   one command is needed, and attributes Loom does not track, such as blink, double underline,
 *   underline color, and a font, which the terminal's default rendering strips.
 * - Off a terminal, the split of a message's text into finished lines reads the text once per
 *   chunk, so one long unbroken line costs each chunk work linear in the text so far, as it does on
 *   a terminal, and not the square.
 *
 * The cases run an Application from source on a mock process in the test's own process. They read
 * each live set the channel hands a semantic method through a spy on the output's `emit`, and the
 * characters the `info` lane view lays out on a terminal through a spy on the view context it
 * receives, whose `expandTabs` the view calls with the whole text it lays out. The split's cases
 * count the characters each `String.prototype.indexOf('\n')` search reads, through a pass-through
 * spy, so they measure the split alone and no other step on the line.
 */
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { Application, lanes, override, pad, plugin, style } from '../src/index.js';
import type { Out } from '../src/index.js';
import { Output } from '../src/output/output.js';

/** An async iterable that yields each part in turn. */
async function* chunks(...parts: readonly string[]): AsyncGenerator<string> {
  yield* parts;
}

/** An async iterable that yields each part in turn, then throws. */
async function* broken(...parts: readonly string[]): AsyncGenerator<string> {
  yield* parts;
  throw new Error('The service hung up.');
}

/** An iterable that yields `first` and never answers again, as a stream waiting on the network does. */
function stalling(first: string): AsyncIterable<string> {
  let requests = 0;
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<string>> => {
        requests += 1;
        return requests === 1
          ? { done: false, value: first }
          : await new Promise<never>(() => undefined);
      },
    }),
  };
}

/**
 * Runs `write` as an action on a piped mock and answers each live set a semantic method received,
 * with how many entries it held while the action ran and once the run ended.
 */
async function liveSets(write: (out: Out, sizes: () => number[]) => Promise<void>) {
  const emit = vi.spyOn(Output.prototype, 'emit');
  const sets = () => [...new Set(emit.mock.calls.map((call) => call[2].live))];
  const sizes = () => sets().map((live) => live?.size ?? -1);
  try {
    const code = await new Application('live')
      .action(async ({ out }) => write(out, sizes))
      .run({ process: mockProcess({ env: {} }) });
    return { code, ended: sizes() };
  } finally {
    emit.mockRestore();
  }
}

test('a streamed message is in its live set while it is open and leaves it when its iterable ends', async () => {
  const seen: number[][] = [];
  const run = await liveSets(async (out, sizes) => {
    const call = out.info(chunks('one ', 'two'));
    seen.push(sizes());
    await call;
    seen.push(sizes());
  });
  expect(seen).toEqual([[1], [0]]);
  expect(run).toEqual({ code: 0, ended: [0] });
});

test('a streamed message that throws leaves its live set', async () => {
  const seen: number[][] = [];
  const run = await liveSets(async (out, sizes) => {
    await out.warn(broken('partial')).catch(() => undefined);
    seen.push(sizes());
  });
  expect(seen).toEqual([[0]]);
  expect(run).toEqual({ code: 0, ended: [0] });
});

test("a streamed message the action's failure stops leaves its live set", async () => {
  const run = await liveSets(async (out) => {
    void out.print(stalling('Partial answer'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw new Error('The action broke.');
  });
  expect(run).toEqual({ code: 1, ended: [0] });
});

test('an action that streams many messages holds none of them once each has ended', async () => {
  const run = await liveSets(async (out) => {
    for (let index = 0; index < 20; index += 1) {
      await out.print(chunks(`Answer ${String(index)}`, '.\n'));
    }
  });
  expect(run).toEqual({ code: 0, ended: [0] });
});

/** A line of 78 characters, which a terminal 100 columns wide shows on one row beside a lane's glyph. */
const sentence = 'Loom lays out each chunk of a streamed answer as it arrives from the model now.';

/**
 * The text of `lines` such lines, as a model streams it: one word a chunk, with its space or line
 * break. `first` dresses the first line's first word, as a raw sequence or a style call does.
 */
function answer(lines: number, first: (word: string) => string = (word) => word): string[] {
  const words = sentence.split(' ');
  return Array.from({ length: lines }, (_line, line) =>
    words.map((word, index) => {
      const shown = line === 0 && index === 0 ? first(word) : word;
      return index === words.length - 1 ? `${shown}\n` : `${shown} `;
    }),
  ).flat();
}

/**
 * Streams `parts` on the `info` lane on a terminal 100 columns wide and answers the length of the
 * text and the characters the lane view laid out over the whole message. The run's output is the
 * one its start configured last, and from the action on each context it hands out counts what the
 * lane view passes its `expandTabs`. With `themed`, the application's theme adds the token `accent`.
 */
async function laidOut(parts: readonly string[], { themed = false } = {}) {
  const configure = vi.spyOn(Output.prototype, 'configure');
  let laid = 0;
  const count = (): void => {
    const output = configure.mock.contexts.at(-1);
    if (!(output instanceof Output)) {
      throw new TypeError('The run configured no output.');
    }
    vi.spyOn(output, 'context').mockImplementation((destination) => {
      const real = Output.prototype.context.call(output, destination);
      return Object.freeze({
        ...real,
        expandTabs: (text: string) => {
          laid += text.length;
          return real.expandTabs(text);
        },
      });
    });
  };
  const mock = mockProcess({
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 100, rows: 24, streams: ['stdout', 'stderr'] },
  });
  const plugins = themed ? [plugin('fixture/theme', { theme: { accent: style.cyan } })] : [];
  try {
    const code = await new Application('laid', { plugins })
      .action(async ({ out }) => {
        count();
        await out.info(chunks(...parts));
      })
      .run({ process: mock });
    return { code, laid, length: parts.join('').length, stderr: mock.stderr.text };
  } finally {
    configure.mockRestore();
  }
}

test('a lane view core ships lays out a streamed message in work that grows with its length, not its square', async () => {
  const single = await laidOut(answer(50));
  const double = await laidOut(answer(100));
  expect(single).toMatchObject({ code: 0 });
  expect(single.stderr).toContain(`  ${sentence}\n`);
  expect(single.laid).toBeLessThan(single.length * 12);
  expect(double.laid).toBeLessThan(single.laid * 2.2);
});

const leftOpen: readonly {
  readonly name: string;
  readonly first: (word: string) => string;
  readonly themed?: boolean;
}[] = [
  { first: (word) => `\u001B[31m${word}\u001B[0m`, name: 'a raw color reset on its own line' },
  {
    first: (word) => `\u001B[31m${word}`,
    name: 'a raw color left open for the rest of the message',
  },
  {
    first: (word) => `\u001B]8;;https://example.com\u001B\\${word}\u001B]8;;\u001B\\`,
    name: 'a raw link',
  },
  { first: (word) => pad(word, 8), name: 'a pad frame' },
  {
    // The frame the context's `style.accent` writes, which the root style cannot name.
    first: (word) => `\uE000["style",[["token","accent"]]]\uE001${word}\uE002`,
    name: "a style that names a token the application's theme adds",
    themed: true,
  },
];

test.each(leftOpen)(
  'a first line that holds $name is not laid out again, so the work grows with the length',
  async ({ first, themed }) => {
    const single = await laidOut(answer(50, first), { themed });
    const double = await laidOut(answer(100, first), { themed });
    expect(single).toMatchObject({ code: 0 });
    expect(single.laid).toBeLessThan(single.length * 12);
    expect(double.laid).toBeLessThan(single.laid * 2.2);
  },
);

/** What a line opens with and closes with before its break, given its index. */
interface Dress {
  readonly name: string;
  readonly on: (line: number) => string;
  readonly off: (line: number) => string;
}

/** The text of `lines` such lines, each opened with `on` and closed with `off` before its break. */
function dressed(lines: number, { on, off }: Dress): string[] {
  let line = 0;
  return answer(lines).map((part, index, parts) => {
    const opened =
      index === 0 || parts[index - 1]?.endsWith('\n') === true ? `${on(line)}${part}` : part;
    if (!opened.endsWith('\n')) {
      return opened;
    }
    line += 1;
    return `${opened.slice(0, -1)}${off(line - 1)}\n`;
  });
}

const everyLine: readonly Dress[] = [
  {
    name: 'a color that changes on every line and is never reset',
    off: () => '',
    on: (line) => `\u001B[38;5;${String(line % 256)}m`,
  },
  {
    // Bold, italic, and underline stay set at each line's end, which no single command leaves.
    name: 'modifiers toggled on and off',
    off: () => '\u001B[23m\u001B[3m\u001B[4m',
    on: () => '\u001B[22m\u001B[1m\u001B[24m',
  },
  { name: 'blink reset by its own command', off: () => '\u001B[25m', on: () => '\u001B[5m' },
  { name: 'blink reset by a full reset', off: () => '\u001B[0m', on: () => '\u001B[5m' },
  { name: 'a double underline', off: () => '\u001B[24m', on: () => '\u001B[21m' },
  {
    name: 'an underline color',
    off: () => '\u001B[59m',
    on: (line) => `\u001B[58;5;${String(line % 256)}m`,
  },
  { name: 'an alternative font', off: () => '\u001B[10m', on: () => '\u001B[11m' },
];

test.each(everyLine)(
  'a message that sets $name carries a bounded state, so the work grows with the length',
  async (dress) => {
    const single = await laidOut(dressed(50, dress));
    const double = await laidOut(dressed(100, dress));
    expect(single).toMatchObject({ code: 0 });
    // The commands on every line are laid out with it, so the multiple is a little larger.
    expect(single.laid).toBeLessThan(single.length * 16);
    expect(double.laid).toBeLessThan(single.laid * 2.2);
  },
);

test('a lane view an author overrode lays out the whole text so far at every chunk', async () => {
  const laid: string[] = [];
  const app = new Application('overridden', {
    views: [
      override(lanes.info, {
        render: (message) => {
          laid.push(message);
          return `[${message}]`;
        },
      }),
    ],
  }).action(async ({ out }) => out.info(chunks('one\n', 'two\n', 'three')));
  const mock = mockProcess({ env: {} });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(laid).toEqual(['one\n', 'one\ntwo\n', 'one\ntwo\nthree', 'one\ntwo\nthree']);
  expect(mock.stderr.text).toBe('[one\ntwo\nthree]\n');
});

/** Everything `write` writes on a piped mock with color and modifiers forced on. */
async function colored(write: (out: Out) => Promise<void>): Promise<string> {
  const mock = mockProcess({ env: {} });
  const code = await new Application('colored')
    .action(async ({ out }) => write(out))
    .run({ process: mock, rendering: { color: 'always', modifiers: 'always' } });
  expect(code).toBe(0);
  return mock.stderr.text;
}

/** The text cut after each of its line breaks, so each chunk ends one line. */
function byLine(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}

/** The bytes the `info` lane writes for `text` streamed a line a chunk, and for `text` as one string. */
async function streamedAndWhole(text: string) {
  return {
    streamed: await colored(async (out) => out.info(chunks(...byLine(text)))),
    whole: await colored(async (out) => out.info(text)),
  };
}

test('a style frame left open across chunks that each break a line writes the bytes of the whole text', async () => {
  const { streamed, whole } = await streamedAndWhole(style.bold('aa\nbb\ncc\ndd ee ff gg'));
  expect(streamed).toBe(whole);
});

test('nested style frames open across chunks write the bytes of the whole text', async () => {
  const { streamed, whole } = await streamedAndWhole(
    style.red(`x one\n${style.bold('y two\nz three\nq')}\nw four\nv`),
  );
  expect(streamed).toBe(whole);
});

test('a raw SGR sequence left open across line breaks writes the bytes of the whole text', async () => {
  const { streamed, whole } = await streamedAndWhole('a\u001B[31mred\nstill\nmore\nlast');
  expect(streamed).toBe(whole);
});

/**
 * Runs `run` while counting what the line split searches: the characters from where each search for
 * a line break starts to the end of the text it searches, over texts longer than a screen row. A
 * split that finds line breaks with a pattern searches by no call this spy sees, so it counts none.
 */
async function searchedForLineBreaks(run: () => unknown): Promise<number> {
  const spy = vi.spyOn(String.prototype, 'indexOf');
  try {
    await run();
    return spy.mock.calls.reduce((searched, [needle, from], call) => {
      const text = String(spy.mock.contexts[call]);
      return needle === '\n' && text.length > 1000
        ? searched + text.length - (from ?? 0)
        : searched;
    }, 0);
  } finally {
    spy.mockRestore();
  }
}

test('the line split reads a text with no line break once, so its work grows with the text', async () => {
  const { completeLines } = await import('../src/output/complete-lines.js');
  const small = 'a'.repeat(8000);
  const large = 'a'.repeat(16_000);
  const one = await searchedForLineBreaks(() => completeLines(small));
  const two = await searchedForLineBreaks(() => completeLines(large));
  expect(one).toBeGreaterThanOrEqual(small.length);
  expect(one).toBeLessThanOrEqual(small.length * 2);
  expect(two).toBeLessThanOrEqual(one * 2.2);
  expect(completeLines('one\ntwo\n\nrest')).toEqual({
    lines: ['one\n', 'two\n', '\n'],
    tail: 'rest',
  });
  expect(completeLines('')).toEqual({ lines: [], tail: '' });
});

/** Streams 16 KB of text with no line break into a pipe in `count` chunks and answers the search work. */
async function pipedUnbroken(count: number) {
  const size = 16_000 / count;
  const parts = Array.from({ length: count }, () => 'x'.repeat(size));
  const mock = mockProcess({ env: {} });
  const searched = await searchedForLineBreaks(async () => {
    await new Application('piped')
      .action(async ({ out }) => out.print(chunks(...parts)))
      .run({ process: mock });
  });
  return { searched, stdout: mock.stdout.text };
}

test('the line split of a long unbroken line off a terminal reads the text so far once per chunk', async () => {
  const few = await pipedUnbroken(100);
  const many = await pipedUnbroken(200);
  expect(few.stdout).toBe(`${'x'.repeat(16_000)}\n`);
  expect(few.searched).toBeGreaterThan(0);
  expect(many.searched).toBeLessThanOrEqual(few.searched * 2.2);
});
