/*
 * Acceptance plan for a progress line's log (docs/libs/prompts.md#a-lines-log, ADR-0172). Each
 * line runs in an application on a mock terminal 60 columns wide, its clock and its frame timer
 * faked inside the action, so a frame draws only when the test moves the clock. An override of the
 * progress view notes each frame's data and the default view's plain text for it, and a headless
 * terminal emulator replays stderr where the test reads the screen.
 *
 * - The text. One line, several lines in one string, and an async iterable each add their lines;
 *   a CRLF split across two chunks is one line break, a lone `\r` starts the line over once text
 *   follows it, a final line break starts no line, and an open iterable's unfinished line shows as
 *   the newest row, without a high surrogate that ends it.
 * - The rows. The newest 5 rows show under the running line and older ones scroll out; `logRows`
 *   changes the count, and 0 shows none. The rows show at the line's next frame, not at `log()`.
 * - What a row draws. The plain text, two spaces in, with the child's controls and colors drawing
 *   nothing, tabs expanded, bidirectional controls escaped, and a row wider than the terminal
 *   clipped to its leading graphemes and the ellipsis.
 * - Each end. `end`, `skip`, `clear`, a resolved `track`, and a close for completion remove the
 *   rows and leave no blank row; `fail`, `warn`, a rejected `track`, a failing run, and a
 *   cancellation write the kept lines above the end line, through `out.error` or `out.warn`.
 * - The bound. The newest 1000 lines are kept, `logLimit` changes the count, and the sentence that
 *   opens the kept lines counts the finished lines they leave out. A line keeps its first 4096 code
 *   points and the ellipsis.
 * - Where the line does not draw. Piped, under `TERM=dumb`, CI, `ACCESSIBLE`, `--plain`, `-q`, and
 *   an invocation by name, nothing shows while the line runs, the kept lines print on failure, and
 *   nothing on success.
 * - The calls. A string's `log()` resolves at once and an iterable's at its end; an iterable that
 *   throws keeps its lines and rejects `log()` with the same value; two iterables interleave line
 *   by line; `log()` after an end does nothing for a string and reads an iterable to its end.
 * - The view's data. Every frame carries `log`, the rows on a running frame and none on an end
 *   frame, and data built without it draws no rows.
 *
 * `progress-log-pty.test.ts` proves the drawn rows, their removal, and the kept lines on a real
 * terminal.
 */
import { Application, FatalError, override, style } from '@loomcli/core';
import type { ActionContext, MessageArguments, Plugin } from '@loomcli/core';
import { plain as plainPlugin } from '@loomcli/plugins/plain';
import { theme } from '@loomcli/plugins/theme';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';
import { progress, progressStyle } from '../src/index.js';
import type { ProgressContext } from '../src/index.js';
import { progressLine } from '../src/views.js';
import type { ProgressLine } from '../src/views.js';
import { recording } from './support.js';

/** One frame the line drew: the data its view received and the default view's plain text for it. */
interface Drawn {
  readonly data: ProgressLine;
  readonly text: string;
}

/** What a script reads beside the action's context. */
interface Scene {
  /** Fires the line's frame timer once, which draws its next frame. */
  readonly tick: () => void;
  /** Notes a named point in the order of stderr's writes, once the writes issued before it land. */
  readonly mark: (name: string) => Promise<void>;
  /** Cancels the run, as an operator's Ctrl-C does. */
  readonly cancel: () => void;
  /** The lanes the line wrote through, in order, with the text of each call. */
  readonly lanes: (readonly [lane: string, text: string])[];
  /** The action's context with its `out` observed, so `lanes` records each message the line writes. */
  readonly observed: ProgressContext;
}

/** How a run's stderr is set up. */
interface Setup {
  readonly columns?: number;
  readonly terminal?: 'tty' | 'pipe' | 'invoke';
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly argv?: readonly string[];
  readonly plugins?: Plugin[];
}

/** What a run left: its frames, its stderr, its screen events, its messages, and its exit. */
interface Outcome {
  readonly code: number | string;
  readonly events: Recorded[];
  readonly frames: Drawn[];
  readonly lanes: readonly (readonly [string, string])[];
  readonly messages: string | undefined;
  readonly stderr: string;
}

/** A spinner of one frame, so a test reads a still line, whose timer fires each 100 ms. */
const spinner = { frames: ['◐'], interval: 100 };

/** The environment of a run with no color. */
const noColor = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' };

/** Lets every pending promise and iterable read settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Runs `script` as an action, the clock at 0 when it starts, and answers what the run left. */
async function logged(
  script: (context: ActionContext<unknown>, scene: Scene) => Promise<void>,
  { argv = [], columns = 60, env = {}, plugins = [], terminal = 'tty' }: Setup = {},
): Promise<Outcome> {
  const frames: Drawn[] = [];
  const lanes: (readonly [string, string])[] = [];
  const mock = mockProcess({
    argv: [...argv],
    env: { ...noColor, ...env },
    terminal: { columns, rows: 24, streams: terminal === 'tty' ? ['stderr'] : [] },
  });
  const screen = recording(mock);
  const caller = new AbortController();
  const app = new Application('install', {
    description: 'Show a progress line with a log.',
    plugins: [progressStyle({ spinner }), verbose(), plainPlugin(), ...plugins],
    views: [
      override(progressLine, {
        render: (data, context) => {
          const text = progressLine.render(data, context);
          frames.push({ data, text: context.plain(text) });
          return text;
        },
      }),
    ],
  }).action(async (context) => {
    // Scope the fake clock to the action so run setup and teardown keep real timers.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(0);
    const { out } = context;
    const observed: ProgressContext = {
      graph: context.graph,
      out: {
        error: (...call: MessageArguments) => {
          lanes.push(['error', typeof call[0] === 'string' ? call[0] : '']);
          return out.error(...call);
        },
        info: (...call: MessageArguments) => out.info(...call),
        region: (options) => out.region(options),
        success: (...call: MessageArguments) => out.success(...call),
        warn: (...call: MessageArguments) => {
          lanes.push(['warn', typeof call[0] === 'string' ? call[0] : '']);
          return out.warn(...call);
        },
      },
    };
    try {
      await script(context, {
        cancel: () => {
          caller.abort();
        },
        lanes,
        mark: async (name) => {
          await flush();
          screen.mark(name);
        },
        observed,
        tick: () => {
          vi.advanceTimersByTime(spinner.interval);
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
  let code: number | string = 0;
  let messages: string | undefined = undefined;
  if (terminal === 'invoke') {
    const outcome = await app.invoke([], {}, { process: mockProcess({ env: noColor }) });
    code = outcome.status;
    messages = outcome.status === 'cancelled' ? undefined : outcome.messages;
  } else {
    code = await app.run({ process: mock, signal: caller.signal });
  }
  return { code, events: screen.events(), frames, lanes, messages, stderr: mock.stderr.text };
}

/** The rows the emulator shows once it has taken every event up to the mark, or all of them. */
async function shown(outcome: Outcome, mark?: string, columns = 60): Promise<readonly string[]> {
  const screen = await replay(until(outcome.events, mark), { columns });
  return screen.lines;
}

/** The `log` of each running frame drawn after the opening one. */
function runningLogs(frames: readonly Drawn[]): (readonly string[] | undefined)[] {
  return frames
    .filter((frame) => frame.data.state === 'running')
    .slice(1)
    .map((frame) => frame.data.log);
}

/** The last frame the line drew. */
function last(frames: readonly Drawn[]): Drawn | undefined {
  return frames.at(-1);
}

/** An async iterable the test feeds chunk by chunk, which notes what was read from it. */
function channel() {
  const pending: ({ chunk: string } | { error: unknown } | { end: true })[] = [];
  let wake: (() => void) | undefined = undefined;
  const state = { pulled: 0, returned: false };
  const iterator: AsyncIterator<string> = {
    next: async () => {
      let item = pending.shift();
      while (item === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        item = pending.shift();
      }
      if ('error' in item) {
        throw item.error;
      }
      if ('end' in item) {
        return { done: true, value: undefined };
      }
      state.pulled += 1;
      return { done: false, value: item.chunk };
    },
    return: async () => {
      state.returned = true;
      return { done: true, value: undefined };
    },
  };
  const put = (item: (typeof pending)[number]) => {
    pending.push(item);
    wake?.();
  };
  return {
    end: () => {
      put({ end: true });
    },
    iterable: { [Symbol.asyncIterator]: () => iterator },
    push: (chunk: string) => {
      put({ chunk });
    },
    state,
    throw: (error: unknown) => {
      put({ error });
    },
  };
}

/** `count` numbered lines, `line 1` to `line <count>`, each ended with a line break. */
function numbered(count: number, from = 1): string {
  let text = '';
  for (let number = from; number < from + count; number += 1) {
    text += `line ${String(number)}\n`;
  }
  return text;
}

test('one line shows as a row under the running line at its next frame', async () => {
  const outcome = await logged(async (context, { mark, tick }) => {
    const line = progress(context, { label: 'Installing dependencies' });
    await line.log('Resolving packages');
    await mark('logged');
    tick();
    await mark('running');
    await line.end('Installed dependencies');
  });
  await expect(shown(outcome, 'logged')).resolves.toEqual(['◐ Installing dependencies · 0.0s']);
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Installing dependencies · 0.1s',
    '  Resolving packages',
  ]);
  expect(outcome.frames[1]?.text).toBe('◐ Installing dependencies · 0.1s\n  Resolving packages');
});

test('text that holds several lines adds each, a final line break starts no line, and a blank line is a line', async () => {
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Installing' });
    await line.log('first\n\nthird\n');
    await line.log('');
    await line.log('a\r\nb');
    tick();
    await line.end();
  });
  expect(runningLogs(outcome.frames)).toEqual([['first', '', 'third', 'a', 'b']]);
});

test('an iterable adds its lines as they arrive, joins a CRLF split across chunks, and shows its unfinished line as the newest row', async () => {
  const feed = channel();
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Installing' });
    const reading = line.log(feed.iterable);
    feed.push('npm http fetch GET 200 react\r');
    await flush();
    tick();
    feed.push('\nnpm http fe');
    await flush();
    tick();
    feed.push('tch GET 200 react-dom\nadded 2 packages');
    feed.end();
    await reading;
    tick();
    await line.end();
  });
  expect(runningLogs(outcome.frames)).toEqual([
    ['npm http fetch GET 200 react'],
    ['npm http fetch GET 200 react', 'npm http fe'],
    ['npm http fetch GET 200 react', 'npm http fetch GET 200 react-dom', 'added 2 packages'],
  ]);
});

test("a lone carriage return starts the line over once text follows it, so a child's own progress shows its latest state", async () => {
  const feed = channel();
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Fetching' });
    const reading = line.log(feed.iterable);
    feed.push('Fetching 10%\r');
    await flush();
    tick();
    feed.push('Fetching 20%\r');
    await flush();
    tick();
    feed.push('Fetching 30%\nFetched\r');
    feed.end();
    await reading;
    tick();
    await line.end();
  });
  expect(runningLogs(outcome.frames)).toEqual([
    ['Fetching 10%'],
    ['Fetching 20%'],
    ['Fetching 30%', 'Fetched'],
  ]);
});

test('an unfinished row leaves out a high surrogate that ends it until its second half arrives', async () => {
  const feed = channel();
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Writing' });
    const reading = line.log(feed.iterable);
    feed.push('done \uD83D');
    await flush();
    tick();
    feed.push('\uDE00 ok\n');
    feed.end();
    await reading;
    tick();
    await line.end();
  });
  expect(runningLogs(outcome.frames)).toEqual([['done '], ['done 😀 ok']]);
});

test('the newest 5 rows show, the oldest on top, and older ones scroll out', async () => {
  const outcome = await logged(async (context, { mark, tick }) => {
    const line = progress(context, { label: 'Installing' });
    await line.log(numbered(3));
    tick();
    await line.log(numbered(4, 4));
    tick();
    await mark('running');
    await line.end();
  });
  expect(runningLogs(outcome.frames)).toEqual([
    ['line 1', 'line 2', 'line 3'],
    ['line 3', 'line 4', 'line 5', 'line 6', 'line 7'],
  ]);
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Installing · 0.2s',
    '  line 3',
    '  line 4',
    '  line 5',
    '  line 6',
    '  line 7',
  ]);
});

test('logRows sets how many rows show, and logRows: 0 shows none while the line keeps its lines', async () => {
  const outcome = await logged(async (context, { tick }) => {
    const two = progress(context, { label: 'Two', logRows: 2 });
    await two.log(numbered(4));
    tick();
    await two.end();
    const none = progress(context, { label: 'None', logRows: 0 });
    await none.log(numbered(4));
    tick();
    await none.fail();
  });
  const logs = outcome.frames
    .filter((frame) => frame.data.state === 'running')
    .map((frame) => frame.data.log);
  expect(logs).toEqual([[], ['line 3', 'line 4'], [], []]);
  await expect(shown(outcome)).resolves.toEqual([
    '✔ Two · 0.1s',
    '  line 1',
    '  line 2',
    '  line 3',
    '  line 4',
    '✘ None · 0.1s',
  ]);
});

test("a row draws the line's plain text: the child's colors and controls draw nothing, tabs expand, and bidirectional controls are escaped", async () => {
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Building' });
    await line.log(
      context.style.escape(
        '\u001b[31merror\u001b[0m in a\u0007b\u0008c\n\tindented\tcell\nright\u202eleft\nx\u2028y\n',
      ),
    );
    await line.log(context.style.bold('marked'));
    tick();
    await line.end();
  });
  expect(outcome.frames[1]?.text).toBe(
    [
      '◐ Building · 0.1s',
      '  error in abc',
      '          indented        cell',
      String.raw`  right\u202eleft`,
      String.raw`  x\u2028y`,
      '  marked',
    ].join('\n'),
  );
});

test.each([
  { columns: 20, row: '  abcdefghijklmnopq…' },
  { columns: 30, row: '  abcdefghijklmnopqrstuvwxyz' },
  { columns: 3, row: '  …' },
])('on a terminal $columns columns wide, a row reads "$row"', async ({ columns, row }) => {
  const outcome = await logged(
    async (context, { tick }) => {
      const line = progress(context, { label: 'B' });
      await line.log('abcdefghijklmnopqrstuvwxyz');
      tick();
      await line.end();
    },
    { columns },
  );
  expect(outcome.frames[1]?.text.split('\n')[1]).toBe(row);
});

test('the default view clips a row to its leading columns at 2 columns or fewer, and to 80 columns where the destination has no width', async () => {
  const base: ProgressLine = {
    bar: { complete: '#', incomplete: '-' },
    completed: undefined,
    elapsed: 0,
    frame: '*',
    label: 'W',
    log: ['wide 😀 text', 'y'.repeat(100)],
    state: 'running',
    total: undefined,
  };
  const texts: string[] = [];
  for (const columns of [2, 1, undefined]) {
    const mock = mockProcess({
      env: noColor,
      terminal: {
        columns: columns ?? 80,
        rows: 24,
        streams: columns === undefined ? [] : ['stdout'],
      },
    });
    await new Application('rows', { description: 'Draw progress data.' })
      .action(async ({ out }) => {
        await out.render(base, {
          render: (data, context) => `${progressLine.render(data, context)}\n`,
        });
      })
      .run({ process: mock });
    texts.push(mock.stdout.text);
  }
  expect(texts).toEqual([
    '* W · 0.0s\n  \n  \n',
    '* W · 0.0s\n \n \n',
    `* W · 0.0s\n  wide 😀 text\n  ${'y'.repeat(77)}…\n`,
  ]);
});

test('end, skip, clear, a resolved track, and a close for completion remove the rows and leave no blank row', async () => {
  const outcome = await logged(async (context, { mark, tick }) => {
    await context.out.info('lane line');
    const ending = progress(context, { label: 'Ending' });
    const skipping = progress(context, { label: 'Skipping' });
    const clearing = progress(context, { label: 'Clearing' });
    const tracking = progress(context, { label: 'Tracking' });
    const open = progress(context, { label: 'Open' });
    for (const line of [ending, skipping, clearing, tracking, open]) {
      await line.log('a row\nanother row');
    }
    tick();
    await mark('running');
    await ending.end('Ended');
    await skipping.skip('Skipped');
    await clearing.clear();
    await tracking.track(Promise.resolve(3), { done: 'Tracked' });
    await mark('ended');
  });
  const running = await shown(outcome, 'running');
  expect(running).toHaveLength(16);
  expect(running.slice(0, 4)).toEqual([
    'ℹ lane line',
    '◐ Ending · 0.1s',
    '  a row',
    '  another row',
  ]);
  await expect(shown(outcome, 'ended')).resolves.toEqual([
    'ℹ lane line',
    '✔ Ended · 0.1s',
    'ℹ Skipped · 0.1s',
    '✔ Tracked · 0.1s',
    '◐ Open · 0.1s',
    '  a row',
    '  another row',
  ]);
  const closed = await shown(outcome);
  expect(closed.slice(0, 4)).toEqual([
    'ℹ lane line',
    '✔ Ended · 0.1s',
    'ℹ Skipped · 0.1s',
    '✔ Tracked · 0.1s',
  ]);
  // Core closes the open line after the action, where the clock is real again.
  expect(closed[4]).toMatch(/^✔ Open · /u);
  expect(closed).toHaveLength(5);
  expect(outcome.lanes).toEqual([]);
});

test('fail and a rejected track write the kept lines through out.error, and warn through out.warn, above the end line', async () => {
  const rejection = new Error('npm exited with code 1');
  const outcome = await logged(async (context, { observed, tick }) => {
    const failing = progress(observed, { label: 'Installing' });
    await failing.log('npm error code E404\nnpm error 404 Not Found');
    tick();
    await failing.fail();
    const tracking = progress(observed, { label: 'Tracking' });
    await tracking.log('tracked line');
    await expect(tracking.track(Promise.reject(rejection))).rejects.toBe(rejection);
    const warning = progress(observed, { label: 'Auditing' });
    await warning.log('2 moderate vulnerabilities');
    await warning.warn('Installed with 2 warnings');
  });
  await expect(shown(outcome)).resolves.toEqual([
    '  npm error code E404',
    '  npm error 404 Not Found',
    '✘ Installing · 0.1s',
    '  tracked line',
    '✘ Tracking · 0.0s',
    '  2 moderate vulnerabilities',
    '⚠ Installed with 2 warnings · 0.0s',
  ]);
  expect(outcome.lanes).toEqual([
    ['error', 'npm error code E404\nnpm error 404 Not Found'],
    ['error', 'tracked line'],
    ['warn', '2 moderate vulnerabilities'],
  ]);
});

test('a failing run writes the kept lines above its failure line, and the failure report after them', async () => {
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Installing' });
    await line.log('npm error code E404');
    tick();
    throw new FatalError('npm could not install the dependencies.');
  });
  expect(outcome.code).toBe(1);
  const rows = await shown(outcome);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toBe('  npm error code E404');
  // The run fails after the action, where the clock is real again, so the elapsed time is not fixed.
  expect(rows[1]).toMatch(/^✘ Installing · /u);
  expect(rows[2]).toBe('npm could not install the dependencies.');
});

test('a cancelled run writes the kept lines above the cancelled line through out.warn', async () => {
  const outcome = await logged(async (context, { cancel, observed, tick }) => {
    const line = progress(observed, { label: 'Installing' });
    await line.log('npm http fetch GET 200 react');
    tick();
    cancel();
  });
  expect(outcome.code).toBe(130);
  await expect(shown(outcome)).resolves.toEqual([
    '  npm http fetch GET 200 react',
    '■ Installing (cancelled)',
  ]);
  expect(outcome.lanes).toEqual([['warn', 'npm http fetch GET 200 react']]);
});

test('a line whose log is empty writes no kept lines when it fails', async () => {
  const outcome = await logged(async (context, { observed }) => {
    await progress(observed, { label: 'Installing' }).fail();
  });
  expect(outcome.lanes).toEqual([]);
});

test('the line keeps the newest 1000 lines and opens them with a sentence that counts the earlier ones', async () => {
  const outcome = await logged(
    async (context) => {
      const line = progress(context, { label: 'Installing' });
      await line.log(numbered(2203));
      await line.fail();
    },
    { terminal: 'pipe' },
  );
  const lines = outcome.stderr.split('\n');
  expect(lines.slice(0, 4)).toEqual([
    'ℹ Installing',
    '  1203 earlier lines were dropped.',
    '  line 1204',
    '  line 1205',
  ]);
  expect(lines.slice(-3)).toEqual(['  line 2203', '✘ Installing', '']);
  expect(lines).toHaveLength(1004);
});

test.each([
  {
    count: 4,
    kept: ['line 2', 'line 3', 'line 4'],
    rows: undefined,
    sentence: '1 earlier line was dropped.',
  },
  {
    count: 20,
    kept: ['line 18', 'line 19', 'line 20'],
    rows: undefined,
    sentence: '17 earlier lines were dropped.',
  },
  {
    count: 20,
    kept: ['line 18', 'line 19', 'line 20'],
    rows: 10,
    sentence: '17 earlier lines were dropped.',
  },
  { count: 3, kept: ['line 1', 'line 2', 'line 3'], rows: undefined, sentence: undefined },
])(
  'with logLimit 3 and logRows $rows, $count finished lines write $kept',
  async ({ count, kept, rows, sentence }) => {
    const outcome = await logged(
      async (context) => {
        const line = progress(context, {
          label: 'Installing',
          logLimit: 3,
          ...(rows === undefined ? {} : { logRows: rows }),
        });
        await line.log(numbered(count));
        await line.fail();
      },
      { terminal: 'pipe' },
    );
    const written = [...(sentence === undefined ? [] : [sentence]), ...kept];
    expect(outcome.stderr).toBe(
      ['ℹ Installing', ...written.map((row) => `  ${row}`), '✘ Installing', ''].join('\n'),
    );
  },
);

test('logLimit: 0 keeps no line, so a failure writes no log line and no sentence, while the rows still show', async () => {
  const outcome = await logged(async (context, { observed, tick }) => {
    const line = progress(observed, { label: 'Installing', logLimit: 0 });
    await line.log(numbered(7));
    tick();
    await line.fail();
  });
  expect(runningLogs(outcome.frames)).toEqual([['line 3', 'line 4', 'line 5', 'line 6', 'line 7']]);
  expect(outcome.lanes).toEqual([]);
});

test('a line keeps its first 4096 code points and the ellipsis, and a lone carriage return after them starts it over', async () => {
  const feed = channel();
  const outcome = await logged(
    async (context) => {
      const line = progress(context, { label: 'Installing' });
      const reading = line.log(feed.iterable);
      feed.push('x'.repeat(3000));
      feed.push(`${'x'.repeat(3000)}\n${'😀'.repeat(4097)}\n${'z'.repeat(4096)}\n`);
      feed.push(`${'w'.repeat(5000)}\rshort\n`);
      feed.end();
      await reading;
      await line.fail();
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr.split('\n')).toEqual([
    'ℹ Installing',
    `  ${'x'.repeat(4096)}…`,
    `  ${'😀'.repeat(4096)}…`,
    `  ${'z'.repeat(4096)}`,
    '  short',
    '✘ Installing',
    '',
  ]);
});

const notLive = [
  { name: 'piped', setup: { terminal: 'pipe' } },
  { name: 'under TERM=dumb', setup: { env: { TERM: 'dumb' } } },
  { name: 'under CI', setup: { env: { CI: 'true' } } },
  { name: 'with ACCESSIBLE set', setup: { env: { ACCESSIBLE: '1' } } },
  { name: 'with --plain', setup: { argv: ['--plain'] } },
] as const;

test.each(notLive)(
  '$name, nothing shows while the line runs, a success writes no log line, and a failure writes the kept lines above its end line',
  async ({ setup }) => {
    const outcome = await logged(async (context, { tick }) => {
      const ok = progress(context, { label: 'Installing' });
      await ok.log('npm http fetch GET 200 react');
      ok.update({ completed: 1 });
      tick();
      await ok.end('Installed');
      const failing = progress(context, { label: 'Building' });
      await failing.log('tsc error TS2304\n\tat src/main.ts');
      tick();
      await failing.fail();
      const warning = progress(context, { label: 'Auditing' });
      await warning.log('2 moderate');
      await warning.warn();
    }, setup);
    expect(outcome.frames).toEqual([]);
    expect(outcome.stderr).toBe(
      [
        'ℹ Installing',
        '✔ Installed',
        'ℹ Building',
        '  tsc error TS2304',
        '          at src/main.ts',
        '✘ Building',
        'ℹ Auditing',
        '  2 moderate',
        '⚠ Auditing',
        '',
      ].join('\n'),
    );
  },
);

test('under -q the kept lines print with the failure line, and nothing else does', async () => {
  const outcome = await logged(
    async (context) => {
      const ok = progress(context, { label: 'Installing' });
      await ok.log('fetched');
      await ok.end();
      const failing = progress(context, { label: 'Building' });
      await failing.log('tsc error TS2304');
      await failing.fail();
    },
    { argv: ['-q'] },
  );
  expect(outcome.stderr).toBe('  tsc error TS2304\n✘ Building\n');
});

test('piped, a cancelled line writes its kept lines alone', async () => {
  const outcome = await logged(
    async (context, { cancel }) => {
      const line = progress(context, { label: 'Installing' });
      await line.log('npm http fetch GET 200 react');
      cancel();
    },
    { terminal: 'pipe' },
  );
  expect(outcome.code).toBe(130);
  expect(outcome.stderr).toBe('ℹ Installing\n  npm http fetch GET 200 react\n');
});

test('under app.invoke the kept lines land in messages above the failure line', async () => {
  const outcome = await logged(
    async (context) => {
      const ok = progress(context, { label: 'Installing' });
      await ok.log('fetched');
      await ok.end();
      const failing = progress(context, { label: 'Building' });
      await failing.log('tsc error TS2304');
      await failing.fail();
    },
    { terminal: 'invoke' },
  );
  expect(outcome.messages).toBe(
    'ℹ Installing\n✔ Installing\nℹ Building\n  tsc error TS2304\n✘ Building\n',
  );
});

test("a string's log() resolves at once and an iterable's once it ends", async () => {
  const feed = channel();
  const settled: string[] = [];
  await logged(async (context) => {
    const line = progress(context, { label: 'Installing' });
    const string = line.log('one');
    const iterable = line.log(feed.iterable);
    void string.then(() => settled.push('string'));
    void iterable.then(() => settled.push('iterable'));
    await flush();
    expect(settled).toEqual(['string']);
    feed.push('two\n');
    await flush();
    expect(settled).toEqual(['string']);
    feed.end();
    await flush();
    expect(settled).toEqual(['string', 'iterable']);
    await line.end();
  });
});

test('an iterable that throws keeps its lines, finishes its unfinished line, and rejects log() with the same value while the line runs on', async () => {
  const feed = channel();
  const thrown = new Error('the child stream broke');
  const outcome = await logged(
    async (context, { tick }) => {
      const line = progress(context, { label: 'Installing' });
      const reading = line.log(feed.iterable);
      feed.push('first\nunfinished');
      feed.throw(thrown);
      await expect(reading).rejects.toBe(thrown);
      tick();
      await line.log('after the throw');
      await line.fail();
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr).toBe(
    'ℹ Installing\n  first\n  unfinished\n  after the throw\n✘ Installing\n',
  );
});

test('two iterables open at once interleave line by line, and each unfinished line shows after the finished ones in call order', async () => {
  const first = channel();
  const second = channel();
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Building', logRows: 4 });
    const logs = [line.log(first.iterable), line.log(second.iterable)];
    first.push('a1\na');
    second.push('b1\nb');
    await flush();
    tick();
    second.push('2\n');
    first.push('2\n');
    await flush();
    tick();
    first.push('a3');
    second.push('b3');
    await flush();
    tick();
    first.end();
    second.end();
    await Promise.all(logs);
    await line.fail();
  });
  expect(runningLogs(outcome.frames)).toEqual([
    ['a1', 'b1', 'a', 'b'],
    ['a1', 'b1', 'b2', 'a2'],
    ['b2', 'a2', 'a3', 'b3'],
  ]);
  await expect(shown(outcome)).resolves.toEqual([
    '  a1',
    '  b1',
    '  b2',
    '  a2',
    '  a3',
    '  b3',
    '✘ Building · 0.3s',
  ]);
});

test("at an end, an open iterable's unfinished line joins the kept lines, and its later text is read to its end and discarded", async () => {
  const feed = channel();
  const outcome = await logged(
    async (context) => {
      const line = progress(context, { label: 'Installing' });
      const reading = line.log(feed.iterable);
      feed.push('done\npartial');
      await flush();
      await line.fail();
      feed.push(' more\nlater\n');
      feed.push('even later\n');
      feed.end();
      await reading;
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr).toBe('ℹ Installing\n  done\n  partial\n✘ Installing\n');
  expect(feed.state).toEqual({ pulled: 3, returned: false });
});

test('after an end, log() with a string does nothing, and an iterable is read to its end and discarded, or rejects when it throws', async () => {
  const late = channel();
  const broken = channel();
  const thrown = new Error('broken after the end');
  const outcome = await logged(
    async (context) => {
      const line = progress(context, { label: 'Installing' });
      await line.fail();
      await expect(line.log('too late')).resolves.toBeUndefined();
      const reading = line.log(late.iterable);
      late.push('one\n');
      late.push('two\n');
      late.end();
      await expect(reading).resolves.toBeUndefined();
      const rejecting = line.log(broken.iterable);
      broken.push('three\n');
      broken.throw(thrown);
      await expect(rejecting).rejects.toBe(thrown);
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr).toBe('ℹ Installing\n✘ Installing\n');
  expect(late.state).toEqual({ pulled: 2, returned: false });
});

test('every frame carries log: none at the opening, the rows while the line runs, and none on an end frame', async () => {
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Installing' });
    await line.log('a row');
    line.update({ label: 'Still installing' });
    tick();
    await line.fail();
  });
  expect(outcome.frames.map(({ data }) => [data.state, data.log])).toEqual([
    ['running', []],
    ['running', ['a row']],
    ['running', ['a row']],
    ['failed', []],
  ]);
  expect(last(outcome.frames)?.text).toBe('✘ Still installing · 0.1s');
});

test('the default view draws the rows of hand-built data in every state, and data without log draws none', async () => {
  const mock = mockProcess({ env: noColor });
  const base = {
    bar: { complete: '#', incomplete: '-' },
    completed: undefined,
    elapsed: 0,
    frame: '*',
    label: 'Work',
    total: undefined,
  } as const;
  const rows: ProgressLine[] = [
    { ...base, state: 'running' },
    { ...base, log: [], state: 'running' },
    { ...base, log: ['a', 'b'], state: 'failed' },
  ];
  await new Application('rows', { description: 'Draw progress data.' })
    .action(async ({ out }) => {
      for (const row of rows) {
        await out.render(row, {
          render: (data, context) => `${progressLine.render(data, context)}\n`,
        });
      }
    })
    .run({ process: mock });
  expect(mock.stdout.text).toBe('* Work · 0.0s\n* Work · 0.0s\n✘ Work · 0.0s\n  a\n  b\n');
});

test('an override of the progress view draws the rows it chooses from log', async () => {
  const mock = mockProcess({
    env: noColor,
    terminal: { columns: 60, rows: 24, streams: ['stderr'] },
  });
  const screen = recording(mock);
  await new Application('install', {
    description: 'Show a progress line with a log.',
    plugins: [progressStyle({ spinner })],
    views: [
      override(progressLine, {
        render: (data) =>
          [`${data.state} ${data.label}`, ...(data.log ?? []).map((row) => `> ${row}`)].join('\n'),
      }),
    ],
  })
    .action(async (context) => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      try {
        const line = progress(context, { label: 'Installing' });
        await line.log('one\ntwo');
        vi.advanceTimersByTime(spinner.interval);
        await flush();
        screen.mark('running');
        await line.end();
      } finally {
        vi.useRealTimers();
      }
    })
    .run({ process: mock });
  const events = screen.events();
  await expect(replay(until(events, 'running'), { columns: 60 })).resolves.toMatchObject({
    lines: ['running Installing', '> one', '> two'],
  });
  await expect(replay(until(events), { columns: 60 })).resolves.toMatchObject({
    lines: ['ended Installing'],
  });
});

test('with color, the rows and the kept lines are dim, and the end line is not', async () => {
  const outcome = await logged(
    async (context, { mark, tick }) => {
      const line = progress(context, { label: 'Installing' });
      await line.log('dim row');
      tick();
      await mark('running');
      await line.fail();
    },
    { env: { NO_COLOR: undefined }, plugins: [theme({ dim: style.faint })] },
  );
  const running = await replay(until(outcome.events, 'running'), { columns: 60 });
  expect(running.dim[1]).toBe('  dim row');
  const ended = await replay(until(outcome.events), { columns: 60 });
  expect(ended.lines[0]).toBe('  dim row');
  expect(ended.dim[0]).toBe('  dim row');
  expect(ended.dim[1]).toMatch(/^ {13}· 0\.1s$/u);
});

test("when the action throws, an open iterable's unfinished line joins the kept lines above the failure line", async () => {
  const feed = channel();
  const outcome = await logged(async (context) => {
    const line = progress(context, { label: 'Installing' });
    void line.log(feed.iterable);
    feed.push('done\npartial');
    await flush();
    throw new FatalError('npm could not install the dependencies.');
  });
  const rows = await shown(outcome);
  expect(rows.slice(0, 2)).toEqual(['  done', '  partial']);
  expect(rows[2]).toMatch(/^✘ Installing · /u);
});

test("when the run is cancelled, an open iterable's unfinished line joins the kept lines above the cancelled line", async () => {
  const feed = channel();
  const outcome = await logged(async (context, { cancel }) => {
    const line = progress(context, { label: 'Installing' });
    void line.log(feed.iterable);
    feed.push('done\npartial');
    await flush();
    cancel();
  });
  expect(outcome.code).toBe(130);
  await expect(shown(outcome)).resolves.toEqual([
    '  done',
    '  partial',
    '■ Installing (cancelled)',
  ]);
});

test("logRows: 0 hides an open iterable's unfinished line on every frame", async () => {
  const feed = channel();
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Installing', logRows: 0 });
    const reading = line.log(feed.iterable);
    feed.push('done\npartial');
    await flush();
    tick();
    tick();
    feed.end();
    await reading;
    await line.end();
  });
  const logs = runningLogs(outcome.frames);
  expect(logs.length).toBeGreaterThan(1);
  expect(logs).toEqual(logs.map(() => []));
});

test('a row exactly as wide as the terminal draws whole, and one column wider is clipped with the ellipsis', async () => {
  const outcome = await logged(
    async (context, { tick }) => {
      const line = progress(context, { label: 'W' });
      await line.log(`${'a'.repeat(38)}\n${'b'.repeat(39)}`);
      tick();
      await line.end();
    },
    { columns: 40 },
  );
  expect(outcome.frames[1]?.text.split('\n').slice(1)).toEqual([
    `  ${'a'.repeat(38)}`,
    `  ${'b'.repeat(37)}…`,
  ]);
});

test('an unfinished row that ends in a whole astral character keeps it', async () => {
  const feed = channel();
  const outcome = await logged(async (context, { tick }) => {
    const line = progress(context, { label: 'Writing' });
    const reading = line.log(feed.iterable);
    feed.push('done \u{1F600}');
    await flush();
    tick();
    feed.end();
    await reading;
    await line.end();
  });
  expect(runningLogs(outcome.frames)).toEqual([['done \u{1F600}']]);
});

test('two lines that end in the same moment each keep their lines directly above their own end line', async () => {
  const outcome = await logged(async (context) => {
    const api = progress(context, { label: 'api' });
    const web = progress(context, { label: 'web' });
    await api.log('api: build step 3 of 7 failed');
    await web.log('web: 2 deprecated packages');
    await Promise.all([api.fail('api failed'), web.warn('web installed with warnings')]);
  });
  await expect(shown(outcome)).resolves.toEqual([
    '  api: build step 3 of 7 failed',
    '✘ api failed · 0.0s',
    '  web: 2 deprecated packages',
    '⚠ web installed with warnings · 0.0s',
  ]);
});

test('two tracked works that reject together each keep their lines directly above their own failure line', async () => {
  const outcome = await logged(async (context) => {
    const api = progress(context, { label: 'api' });
    const web = progress(context, { label: 'web' });
    await api.log('api: connection refused');
    await web.log('web: timed out');
    const settled = await Promise.allSettled([
      api.track(Promise.reject(new Error('api'))),
      web.track(Promise.reject(new Error('web'))),
    ]);
    expect(settled.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
  });
  await expect(shown(outcome)).resolves.toEqual([
    '  api: connection refused',
    '✘ api · 0.0s',
    '  web: timed out',
    '✘ web · 0.0s',
  ]);
});

test('a message another writer writes while a line fails lands after its end line, not between its kept lines and it', async () => {
  const outcome = await logged(async (context) => {
    const api = progress(context, { label: 'api' });
    await api.log('api: build step 3 of 7 failed');
    const pending = api.fail('api failed');
    void context.out.info('web: build step 3 of 7 done');
    await pending;
  });
  await expect(shown(outcome)).resolves.toEqual([
    '  api: build step 3 of 7 failed',
    '✘ api failed · 0.0s',
    'ℹ web: build step 3 of 7 done',
  ]);
});

test('where the lines do not draw, two lines that end in the same moment write each its kept lines directly above its end line', async () => {
  const outcome = await logged(
    async (context) => {
      const api = progress(context, { label: 'api' });
      const web = progress(context, { label: 'web' });
      await api.log('api: build step 3 of 7 failed');
      await web.log('web: 2 deprecated packages');
      await Promise.all([api.fail('api failed'), web.warn('web installed with warnings')]);
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr).toBe(
    [
      'ℹ api',
      'ℹ web',
      '  api: build step 3 of 7 failed',
      '✘ api failed',
      '  web: 2 deprecated packages',
      '⚠ web installed with warnings',
      '',
    ].join('\n'),
  );
});
