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
 *
 * The cases run an Application from source on a mock process in the test's own process. They read
 * each live set the channel hands a semantic method through a spy on the output's `emit`, and the
 * characters the `info` lane view lays out on a terminal through a spy on the view context it
 * receives, whose `expandTabs` the view calls with the whole text it lays out.
 */
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { Application, lanes, override } from '../src/index.js';
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

/** The text of `lines` such lines, as a model streams it: one word a chunk, with its space or line break. */
function answer(lines: number): string[] {
  const words = sentence.split(' ');
  return Array.from({ length: lines }, () =>
    words.map((word, index) => (index === words.length - 1 ? `${word}\n` : `${word} `)),
  ).flat();
}

/**
 * Streams `parts` on the `info` lane on a terminal 100 columns wide and answers the length of the
 * text and the characters the lane view laid out over the whole message. The run's output is the
 * one its start configured last, and from the action on each context it hands out counts what the
 * lane view passes its `expandTabs`.
 */
async function laidOut(parts: readonly string[]) {
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
  try {
    const code = await new Application('laid')
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
