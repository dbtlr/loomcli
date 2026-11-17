/*
 * Acceptance plan for how a run's open progress lines share the terminal's height
 * (docs/libs/prompts.md#a-lines-log, ADR-0172's The terminal's height). Lines run in an application
 * on a mock terminal of a stated height, their clock and frame timers faked inside the action, so
 * a frame draws only when the test moves the clock or calls `update`. An override of the progress
 * view notes each frame's data, and a headless terminal emulator of the same height replays stderr
 * where the test reads the screen and its scrollback.
 *
 * - The shares. The pure division of the budget among the lines with a need, the record's worked
 *   cases included.
 * - The stack. Two lines each logging 6 lines on 10 rows, and five lines on 24 rows, draw their
 *   shares, the stack is never taller than the terminal at any frame, and the screen and its
 *   scrollback hold each row once.
 * - Between frames. A line that ends frees its rows for the others' next frames; a line that opens
 *   beside a line drawing 5 rows on 6 rows makes it shrink first and draws no log row until it has;
 *   a third line that opens makes the two above draw again in the order they opened; a resize takes
 *   effect at each line's next frame.
 * - Who shares. Lines opened by a middleware and by the action share; two runs in one process do
 *   not; a context with no `host`, and `rows` that is `undefined` or 0, draw up to `logRows`.
 * - What it leaves alone. The view's data carries the fitted rows, which an override draws, and a
 *   failure writes every kept line, whatever the line drew.
 */
import { Application, override, plugin } from '@loomcli/core';
import type {
  ActionContext,
  MiddlewareContext,
  Plugin,
  SourceContext,
  ViewContext,
} from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';
import { logShares } from '../src/height.js';
import { progress, progressStyle } from '../src/index.js';
import type { Progress, ProgressContext } from '../src/index.js';
import { progressLine } from '../src/views.js';
import type { ProgressLine } from '../src/views.js';
import { recording } from './support.js';

/** A spinner of one frame, so a test reads a still line, whose timer fires each 100 ms. */
const spinner = { frames: ['◐'], interval: 100 };

/** A spinner whose timer never fires within a test, so only `update` draws a frame. */
const still = { frames: ['◐'], interval: 3_600_000 };

/** The environment of a run with no color. */
const noColor = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' };

/** What a script reads beside the action's context. */
interface Scene {
  /** Fires every line's frame timer once, which draws each line's next frame in opening order. */
  readonly tick: () => void;
  /** Notes a named point in the order of stderr's writes, once the writes issued before it land. */
  readonly mark: (name: string) => Promise<void>;
  /** Changes the terminal's height, as an operator resizing the window does. */
  readonly resize: (rows: number) => void;
}

/** How a run is set up. */
interface Setup {
  readonly rows?: number;
  readonly plugins?: readonly Plugin[];
  readonly spin?: { readonly frames: readonly string[]; readonly interval: number };
  readonly render?: (data: ProgressLine, context: ViewContext) => string;
}

/** What a run left: the data of each frame, its screen events, and its exit. */
interface Outcome {
  readonly code: number;
  readonly events: Recorded[];
  readonly frames: ProgressLine[];
  readonly rows: number;
}

/** Lets every pending promise settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Runs `script` as an action on a terminal 60 columns wide, the clock at 0 when it starts. */
async function stacked(
  script: (context: ActionContext<unknown>, scene: Scene) => Promise<void>,
  { plugins = [], render, rows = 10, spin = spinner }: Setup = {},
): Promise<Outcome> {
  const frames: ProgressLine[] = [];
  const mock = mockProcess({
    env: noColor,
    terminal: { columns: 60, rows, streams: ['stderr'] },
  });
  const screen = recording(mock);
  const app = new Application('install', {
    description: 'Show progress lines with logs on a short terminal.',
    plugins: [progressStyle({ spinner: spin }), ...plugins],
    views: [
      override(progressLine, {
        render: (data, context) => {
          frames.push(data);
          return render === undefined ? progressLine.render(data, context) : render(data, context);
        },
      }),
    ],
  }).action(async (context) => {
    // Scope the fake clock to the action so run setup and teardown keep real timers.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(0);
    try {
      await script(context, {
        mark: async (name) => {
          await flush();
          screen.mark(name);
        },
        resize: (height) => {
          mock.resize(60, height);
        },
        tick: () => {
          vi.advanceTimersByTime(spinner.interval);
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
  const code = await app.run({ process: mock });
  return { code, events: screen.events(), frames, rows };
}

/** Every row the emulator holds, scrollback first, once it has taken the events up to the mark. */
async function held(outcome: Outcome, mark?: string): Promise<readonly string[]> {
  const screen = await replay(until(outcome.events, mark), { columns: 60, rows: outcome.rows });
  return screen.lines;
}

/** The rows that appear more than once among `rows`, blank rows aside. */
function repeated(rows: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const line of rows.filter((row) => row !== '')) {
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([line]) => line);
}

/**
 * The height of the stack after each frame: each open line's own row and the log rows of its
 * latest frame. A line's end frame leaves the stack, because its region closes in the same tick.
 */
function heights(frames: readonly ProgressLine[]): number[] {
  const stack = new Map<string, number>();
  return frames.map((frame) => {
    if (frame.state === 'running') {
      stack.set(frame.label, 1 + (frame.log ?? []).length);
    } else {
      stack.delete(frame.label);
    }
    return [...stack.values()].reduce((sum, rows) => sum + rows, 0);
  });
}

/** The count of log rows of each running frame a line drew, in order, by its label. */
function drawn(frames: readonly ProgressLine[], label: string): number[] {
  return frames
    .filter((frame) => frame.label === label && frame.state === 'running')
    .map((frame) => (frame.log ?? []).length);
}

/** `count` lines named for a line, `<name> line 1` to `<name> line <count>`. */
function numbered(name: string, count: number): string {
  const rows: string[] = [];
  for (let number = 1; number <= count; number += 1) {
    rows.push(`${name} line ${String(number)}`);
  }
  return rows.join('\n');
}

/** Opens one line for each name and logs 6 lines into each. */
async function openLogged(context: ProgressContext, names: readonly string[]): Promise<Progress[]> {
  const opened = names.map((name) => progress(context, { label: name }));
  for (const [index, line] of opened.entries()) {
    await line.log(numbered(names[index] ?? '', 6));
  }
  return opened;
}

test.each([
  ['two lines needing 5 on a 10-row terminal', 8, [5, 5], [4, 4]],
  [
    'five lines needing 5 on 24 rows, the remainder to the first',
    19,
    [5, 5, 5, 5, 5],
    [4, 4, 4, 4, 3],
  ],
  ['a need below the share gives its rows to the other', 4, [1, 5], [1, 3]],
  ['a line with no need between two that need 5', 7, [5, 0, 5], [4, 0, 3]],
  ['an empty log or logRows of 0 takes none', 6, [0, 0, 2], [0, 0, 2]],
  ['every need met with rows to spare', 20, [2, 5, 1], [2, 5, 1]],
  ['a budget of 0', 0, [5, 5, 5], [0, 0, 0]],
  ['a budget below 0', -3, [5, 5], [0, 0]],
  ['a remainder of 2 over three lines', 8, [5, 5, 5], [3, 3, 2]],
  ['a remainder once a small need is met', 8, [5, 5, 1], [4, 3, 1]],
  ['no line', 5, [], []],
] satisfies [string, number, number[], number[]][])(
  'the budget divides into shares: %s',
  (_name, budget, needs, shares) => {
    expect(logShares(budget, needs)).toEqual(shares);
  },
);

test('two lines each logging 6 lines on a 10-row terminal draw 4 rows each and leave no row twice in scrollback', async () => {
  const outcome = await stacked(async (context, { mark, tick }) => {
    await context.out.info('header from the action');
    const opened = await openLogged(context, ['install 1', 'install 2']);
    for (let frame = 0; frame < 12; frame += 1) {
      tick();
    }
    await mark('running');
    for (const line of opened) {
      await line.end();
    }
  });
  expect(outcome.code).toBe(0);
  expect(drawn(outcome.frames, 'install 1').slice(1)).toEqual(Array.from({ length: 12 }, () => 4));
  expect(drawn(outcome.frames, 'install 2').slice(1)).toEqual(Array.from({ length: 12 }, () => 4));
  expect(Math.max(...heights(outcome.frames))).toBeLessThanOrEqual(10);
  const running = await held(outcome, 'running');
  expect(repeated(running)).toEqual([]);
  expect(running).toEqual([
    'ℹ header from the action',
    '◐ install 1 · 1.2s',
    '  install 1 line 3',
    '  install 1 line 4',
    '  install 1 line 5',
    '  install 1 line 6',
    '◐ install 2 · 1.2s',
    '  install 2 line 3',
    '  install 2 line 4',
    '  install 2 line 5',
    '  install 2 line 6',
  ]);
  const after = await held(outcome);
  expect(repeated(after)).toEqual([]);
  expect(after).toEqual(['ℹ header from the action', '✔ install 1 · 1.2s', '✔ install 2 · 1.2s']);
});

test('five lines each logging 6 lines on 24 rows draw 4, 4, 4, 4, and 3 rows, and the stack is never taller than the terminal', async () => {
  const names = ['install 1', 'install 2', 'install 3', 'install 4', 'install 5'];
  const outcome = await stacked(
    async (context, { mark, tick }) => {
      const opened = await openLogged(context, names);
      for (let frame = 0; frame < 12; frame += 1) {
        tick();
      }
      await mark('running');
      for (const line of opened) {
        await line.end();
      }
    },
    { rows: 24 },
  );
  expect(names.map((name) => drawn(outcome.frames, name).at(-1))).toEqual([4, 4, 4, 4, 3]);
  expect(Math.max(...heights(outcome.frames))).toBeLessThanOrEqual(24);
  const running = await held(outcome, 'running');
  expect(running).toHaveLength(24);
  expect(repeated(running)).toEqual([]);
  const after = await held(outcome);
  expect(repeated(after)).toEqual([]);
  expect(after).toEqual(names.map((name) => `✔ ${name} · 1.2s`));
});

test('a line that ends frees its rows, and the others grow at their next frames with no frame taller than the terminal', async () => {
  const outcome = await stacked(async (context, { mark, tick }) => {
    const [first, second, third] = await openLogged(context, ['first', 'second', 'third']);
    tick();
    tick();
    await first?.end();
    tick();
    tick();
    await mark('grown');
    await second?.end();
    await third?.end();
  });
  // Three lines on 10 rows share a budget of 7, and two share 8 once the first has ended.
  expect(drawn(outcome.frames, 'first')).toEqual([0, 3, 3]);
  expect(drawn(outcome.frames, 'second')).toEqual([0, 2, 2, 4, 4]);
  expect(drawn(outcome.frames, 'third')).toEqual([0, 2, 2, 4, 4]);
  for (const height of heights(outcome.frames)) {
    expect(height).toBeLessThanOrEqual(10);
  }
  // The first line's end line has scrolled above the 10 rows the two lines now draw.
  const grown = await held(outcome, 'grown');
  expect(grown).toHaveLength(11);
  expect(repeated(grown)).toEqual([]);
});

test('a line that opens beside a line drawing 5 rows on a 6-row terminal draws no log row until the first has shrunk', async () => {
  const outcome = await stacked(
    async (context, { mark, tick }) => {
      const first = progress(context, { label: 'first' });
      await first.log(numbered('first', 6));
      tick();
      const second = progress(context, { label: 'second' });
      await second.log(numbered('second', 6));
      // The second line draws a frame of its own before the first line's timer fires.
      second.update({});
      tick();
      tick();
      await mark('settled');
      await first.end();
      await second.end();
    },
    { rows: 6 },
  );
  // The first line draws again at the second's opening, to its share of 4 beside the second's row.
  expect(drawn(outcome.frames, 'first')).toEqual([0, 5, 4, 2, 2]);
  expect(drawn(outcome.frames, 'second')).toEqual([0, 0, 2, 2]);
  for (const height of heights(outcome.frames)) {
    expect(height).toBeLessThanOrEqual(6);
  }
  const settled = await held(outcome, 'settled');
  expect(repeated(settled)).toEqual([]);
  expect(settled).toEqual([
    '◐ first · 0.3s',
    '  first line 5',
    '  first line 6',
    '◐ second · 0.2s',
    '  second line 5',
    '  second line 6',
  ]);
});

test('a third line that opens on a full 7-row terminal makes the two lines above draw again in the order they opened', async () => {
  const outcome = await stacked(
    async (context, { tick }) => {
      const [first, second] = await openLogged(context, ['first', 'second']);
      tick();
      const third = progress(context, { label: 'third' });
      tick();
      await first?.end();
      await second?.end();
      await third.end();
    },
    { rows: 7 },
  );
  // Two lines on 7 rows share a budget of 5 as 3 and 2, and three lines share 4 as 2 and 2.
  // The first line draws again before the second, so the second finds 2 rows left, not 1.
  expect(drawn(outcome.frames, 'first')).toEqual([0, 3, 2, 2]);
  expect(drawn(outcome.frames, 'second')).toEqual([0, 2, 2, 2]);
  expect(drawn(outcome.frames, 'third')).toEqual([0, 0]);
  for (const height of heights(outcome.frames)) {
    expect(height).toBeLessThanOrEqual(7);
  }
});

test('a resize to fewer rows takes effect at each line’s next frame, and one to more rows lets the lines grow', async () => {
  const outcome = await stacked(async (context, { resize, tick }) => {
    const opened = await openLogged(context, ['first', 'second']);
    tick();
    resize(6);
    tick();
    tick();
    resize(24);
    tick();
    for (const line of opened) {
      await line.end();
    }
  });
  // On 6 rows the first line's next frame leaves the 4 rows the second still drew, so it draws none.
  expect(drawn(outcome.frames, 'first')).toEqual([0, 4, 0, 2, 5]);
  expect(drawn(outcome.frames, 'second')).toEqual([0, 4, 2, 2, 5]);
});

test('a cleared line frees its rows for the line beside it at its next frame', async () => {
  const outcome = await stacked(
    async (context, { tick }) => {
      const [first, second] = await openLogged(context, ['first', 'second']);
      tick();
      await first?.clear();
      tick();
      await second?.end();
    },
    { rows: 6 },
  );
  expect(drawn(outcome.frames, 'first')).toEqual([0, 2]);
  expect(drawn(outcome.frames, 'second')).toEqual([0, 2, 5]);
});

test('a line with logRows of 0 takes no share, so the line beside it draws its whole need', async () => {
  const outcome = await stacked(
    async (context, { tick }) => {
      const quiet = progress(context, { label: 'quiet', logRows: 0 });
      await quiet.log(numbered('quiet', 6));
      const loud = progress(context, { label: 'loud' });
      await loud.log(numbered('loud', 6));
      tick();
      await quiet.end();
      await loud.end();
    },
    { rows: 7 },
  );
  expect(drawn(outcome.frames, 'quiet')).toEqual([0, 0]);
  expect(drawn(outcome.frames, 'loud')).toEqual([0, 5]);
});

test('a context with no host, and a host whose rows are undefined or 0, draw up to logRows as before', async () => {
  const outcome = await stacked(async (context, { tick }) => {
    const bare: ProgressContext = { graph: context.graph, out: context.out };
    const unknown: ProgressContext = {
      ...bare,
      host: { terminal: { stderr: { rows: undefined } } },
    };
    const none: ProgressContext = { ...bare, host: { terminal: { stderr: { rows: 0 } } } };
    const opened = [
      ...(await openLogged(bare, ['bare 1', 'bare 2'])),
      ...(await openLogged(unknown, ['unknown 1', 'unknown 2'])),
      ...(await openLogged(none, ['none 1', 'none 2'])),
    ];
    tick();
    for (const line of opened) {
      await line.end();
    }
  });
  for (const name of ['bare 1', 'bare 2', 'unknown 1', 'unknown 2', 'none 1', 'none 2']) {
    expect(drawn(outcome.frames, name)).toEqual([0, 5]);
  }
});

test("a line a middleware opens shares the terminal's height with a line the action opens", async () => {
  const handles: { around: Progress | undefined } = { around: undefined };
  const outcome = await stacked(
    async (context) => {
      const [line] = await openLogged(context, ['action']);
      line?.update({});
      handles.around?.update({});
      await line?.end();
    },
    {
      plugins: [
        plugin('@fixture/around', {
          middleware: {
            activate: 'always',
            load: async () => ({
              default: async (context: MiddlewareContext) => {
                const [line] = await openLogged(context, ['middleware']);
                handles.around = line;
                await context.next();
                await line?.end();
              },
            }),
          },
        }),
      ],
      spin: still,
    },
  );
  expect(drawn(outcome.frames, 'action')).toEqual([0, 4]);
  expect(drawn(outcome.frames, 'middleware')).toEqual([0, 4]);
});

test("a line core closes at the action's return leaves the lines that share, so a middleware's line grows into its rows", async () => {
  const outcome = await stacked(
    async (context) => {
      const [line] = await openLogged(context, ['action']);
      line?.update({});
    },
    {
      plugins: [
        plugin('@fixture/around', {
          middleware: {
            activate: 'always',
            load: async () => ({
              default: async (context: MiddlewareContext) => {
                const [line] = await openLogged(context, ['middleware']);
                await context.next();
                line?.update({});
                await line?.end();
              },
            }),
          },
        }),
      ],
      spin: still,
    },
  );
  expect(drawn(outcome.frames, 'action')).toEqual([0, 4]);
  expect(drawn(outcome.frames, 'middleware')).toEqual([0, 5]);
});

test('two runs in one process do not share a height', async () => {
  const both = { opened: 0, updated: 0 };
  const wake: (() => void)[] = [];
  const together = async (key: 'opened' | 'updated') => {
    both[key] += 1;
    if (both[key] === 2) {
      for (const resolve of wake.splice(0)) {
        resolve();
      }
      return;
    }
    await new Promise<void>((resolve) => {
      wake.push(resolve);
    });
  };
  const run = async () => {
    const frames: ProgressLine[] = [];
    const app = new Application('install', {
      description: 'Show one progress line with a log.',
      plugins: [progressStyle({ spinner: still })],
      views: [
        override(progressLine, {
          render: (data, context) => {
            frames.push(data);
            return progressLine.render(data, context);
          },
        }),
      ],
    }).action(async (context) => {
      const [line] = await openLogged(context, ['alone']);
      await together('opened');
      line?.update({});
      await together('updated');
      await line?.end();
    });
    await app.run({
      process: mockProcess({
        env: noColor,
        terminal: { columns: 60, rows: 6, streams: ['stderr'] },
      }),
    });
    return drawn(frames, 'alone');
  };
  await expect(Promise.all([run(), run()])).resolves.toEqual([
    [0, 5],
    [0, 5],
  ]);
});

test("the view's data carries the fitted rows, and an override draws them within the height", async () => {
  const outcome = await stacked(
    async (context, { mark, tick }) => {
      const opened = await openLogged(context, ['first', 'second']);
      tick();
      await mark('running');
      for (const line of opened) {
        await line.end();
      }
    },
    {
      render: (data) => [data.label, ...(data.log ?? []).map((entry) => `> ${entry}`)].join('\n'),
    },
  );
  expect(outcome.frames.findLast((frame) => frame.state === 'running')?.log).toEqual([
    'second line 3',
    'second line 4',
    'second line 5',
    'second line 6',
  ]);
  await expect(held(outcome, 'running')).resolves.toEqual([
    'first',
    '> first line 3',
    '> first line 4',
    '> first line 5',
    '> first line 6',
    'second',
    '> second line 3',
    '> second line 4',
    '> second line 5',
    '> second line 6',
  ]);
});

test('a line whose drawn rows were cut to 1 still writes every kept line when it fails', async () => {
  const outcome = await stacked(
    async (context, { tick }) => {
      const [first, second, third] = await openLogged(context, ['first', 'second', 'third']);
      tick();
      await third?.fail();
      await first?.end();
      await second?.end();
    },
    { rows: 6 },
  );
  expect(drawn(outcome.frames, 'third')).toEqual([0, 1]);
  const after = await held(outcome);
  expect(after.slice(0, 7)).toEqual([
    '  third line 1',
    '  third line 2',
    '  third line 3',
    '  third line 4',
    '  third line 5',
    '  third line 6',
    '✘ third · 0.1s',
  ]);
});

test('an action’s, a middleware’s, and a source’s context satisfy ProgressContext, and so does one built by hand without host', () => {
  const contexts: ((context: never) => ProgressContext)[] = [
    (context: ActionContext<unknown>) => context,
    (context: MiddlewareContext) => context,
    (context: SourceContext) => context,
    (context: ActionContext<unknown>) => ({ graph: context.graph, out: context.out }),
  ];
  expect(contexts).toHaveLength(4);
});
