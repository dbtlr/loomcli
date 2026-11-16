/*
 * Acceptance plan for progress lines (docs/libs/prompts.md#progress).
 *
 * - The look. Against a headless terminal emulator, a fixture's counted line and spinner line read
 *   as the Progress view table shows, with color and with `NO_COLOR`, the spinner advancing one
 *   frame each interval, and each success, failure, and cancelled line replacing its frame and
 *   staying in scrollback. On a host that takes compat glyph forms, the failure line opens with
 *   `×`. Two lines stack in start order, a lane message written between their frames lands above
 *   both, and a question asked while they run holds them still and lets each catch up once when it
 *   is answered.
 * - The other ends (ADR-0170). A skipped line reads its message under `ℹ`, dim throughout, a warned
 *   line its message under `⚠`, the glyph alone in the warning token, and a line skipped with no
 *   message its label; compat forms read `i` and `‼`. A cleared line leaves nothing: the rows above
 *   and below it stay as they were with no blank row between. After any end, every end method and
 *   an update draw, write, and report nothing more. A line that fails, and a line cancelled with the
 *   run, keep their text when the author then clears them. An override of the view receives the
 *   skipped and warned states, and never a cleared line. `progress-pty.test.ts` proves the drawn
 *   ends on a real terminal.
 * - Counts and time. The default view, rendered directly, draws 3 complete cells for 1/3, 10 for
 *   12/10, and 10 for 0/0, reads `33%` for 1.5 of 4.5 and `0/5` for an absent `completed` of 5, and
 *   reads `59.9s` at 59 999 ms, `1m 05s` at 65 999 ms, and `1h 02m` at 3 779 999 ms. A skipped and a
 *   warned line draw no frame, bar, or counts.
 * - Tracking. `track` returns the work's value and ends with `done` from a function of it, and a
 *   rejection fails with `failed` from a function of the rejection and rethrows the same object. A
 *   line closed before its work settles draws nothing more.
 * - Failing and returning. An action that throws with two lines open writes both failure lines
 *   above the failure report, and one that returns with a line open writes its success line. A line
 *   a middleware opens before `next()` and leaves open is still running after the action returns
 *   and writes its success line once the chain has unwound.
 * - Cancellation. `SIGINT` writes each open line's cancelled line, the run resolves 130, and the
 *   process dies by the signal.
 * - Off a terminal. With stderr piped, the run writes exactly the plain lines the Progress section
 *   shows. On a terminal stderr whose `TERM` is `dumb`, with `CI` set, with `ACCESSIBLE` set, or
 *   with `--plain` from the plain plugin, it writes the same plain lines and no control sequence,
 *   and under `TERM=dumb` a question asked beside two lines asks line by line. Under `-q` with the verbose
 *   plugin, it writes only failure lines. Under `app.invoke`,
 *   the lines land in `messages`, and the observer reads every progress event in order. The end
 *   event of a line ended by `end`, `fail`, or `track` with a `done` or `failed` message carries
 *   that message as its label, and one ended with no message carries the line's last label. Where
 *   the line is not live (piped, `TERM=dumb`, `ACCESSIBLE`, `--plain`), a skipped line writes its
 *   end line through `info`, a warned line through `warn`, which alone prints under `-q`, and a
 *   cleared line writes nothing after its start line; their events read `skipped`, `warned`, and
 *   `ended`.
 * - Style. `progressStyle({ spinner: spinners.dots })` draws the dots frames at their interval, a
 *   call's own spinner wins for its line, and the defaults hold without the plugin.
 * - View. An override of `progressLine` changes every line's frame, and its data carries the state,
 *   counts, frame, bar cells, and elapsed time the Progress view section lists.
 * - Packed. `check:packed` installs the packed library, imports `progress` and `progressStyle` from
 *   `@loomcli/prompts` and `progressLine` from `@loomcli/prompts/views`, and compiles against their
 *   declarations under Node and Bun.
 */

import { Application, FatalError, override, plugin, style } from '@loomcli/core';
import type { ActionContext, MiddlewareContext, Plugin, ProgressEvent } from '@loomcli/core';
import { plain as plainPlugin } from '@loomcli/plugins/plain';
import { theme } from '@loomcli/plugins/theme';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { start } from '../../../scripts/test-process.js';
import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';
import { progress, progressStyle, text } from '../src/index.js';
import type { Progress } from '../src/index.js';
import { progressLine } from '../src/views.js';
import { observing, recording } from './support.js';

const signalFixture = new URL('fixtures/progress-signal.mjs', import.meta.url);

/** The values a scenario notes for its test to read. */
interface Notes {
  asked?: boolean;
  draws?: number;
  frames?: string[];
  progress?: ProgressEvent[];
  same?: boolean;
  seen?: Record<string, string>;
  value?: unknown;
}

interface Run {
  code: number | string;
  events: Recorded[];
  messages?: string;
  notes: Notes;
  stderr: string;
  stdout: string;
}

/** The environment of a run with no color variable, and NO_COLOR unless a test asks for color. */
const plain = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' };

/** What a scenario's action reads and writes while it runs. */
interface Scene {
  readonly argv: string[];
  readonly caller: AbortController;
  /** What a scenario still runs after the run resolves, which the run awaits before it reads. */
  lingering: Promise<void>;
  readonly notes: Notes;
  readonly screen: ReturnType<typeof recording>;
}

/** The context an action hands to a line and to a question beside it. */
type Context = ActionContext<unknown>;

interface Scenario {
  readonly action: (context: Context) => Promise<void>;
  readonly plugins?: Plugin[];
  readonly views?: NonNullable<ConstructorParameters<typeof Application>[1]>['views'];
}

/** A spinner that never advances while a test reads the screen. */
const still = { frames: ['◐', '◓', '◑', '◒'], interval: 60_000 };

/** Resolves after `ms` milliseconds. */
function after(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Calls every end method of a line once more, each with a message where it takes one. */
async function endAgain(line: Progress): Promise<void> {
  await line.end('Ended again');
  await line.fail('Failed again');
  await line.skip('Skipped again');
  await line.warn('Warned again');
  await line.clear();
}

/** A plugin whose middleware runs `body` around the rest of the chain. */
function around(body: (context: MiddlewareContext) => Promise<void>) {
  return plugin('@fixture/around', {
    middleware: { activate: 'always', load: async () => ({ default: body }) },
  });
}

/** Each scenario: the plugins and view overrides it installs, and its action. */
const scenarios: Record<string, (scene: Scene) => Scenario> = {
  /** A spinner whose frames the view records as it advances. */
  advance: (scene) => ({
    action: async (context) => {
      // Scope the fake clock to the action so run setup and teardown keep real timers.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const line = progress(context, {
          label: 'Spinning',
          spinner: { frames: ['a', 'b', 'c'], interval: 15 },
        });
        for (let step = 0; step < 4; step += 1) {
          vi.advanceTimersByTime(15);
        }
        await line.end();
      } finally {
        vi.useRealTimers();
      }
    },
    views: [
      override(progressLine, {
        render: (data, context) => {
          scene.notes.frames = [...(scene.notes.frames ?? []), data.frame];
          return progressLine.render(data, context);
        },
      }),
    ],
  }),
  /** Each end of a line, then every end method once more after it. */
  again: () => ({
    action: async (context) => {
      for (const [label, ending] of [
        ['Ended', (line: Progress) => line.end()],
        ['Failed', (line: Progress) => line.fail()],
        ['Skipped', (line: Progress) => line.skip()],
        ['Warned', (line: Progress) => line.warn()],
        ['Cleared', (line: Progress) => line.clear()],
      ] as const) {
        const line = progress(context, { label });
        await ending(line);
        await endAgain(line);
        line.update({ completed: 3, label: 'Updated again' });
      }
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** One line open when the run is cancelled. */
  cancel: (scene) => ({
    action: async (context) => {
      progress(context, { label: 'Waiting' });
      await context.out.info('started');
      scene.caller.abort();
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** One line open when the run is cancelled, which the action then clears. */
  cancelClear: (scene) => ({
    action: async (context) => {
      const line = progress(context, { label: 'Waiting' });
      await context.out.info('started');
      scene.caller.abort();
      await line.clear();
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** Three lines with a lane line above them, the middle one cleared while the others run. */
  clear: (scene) => ({
    action: async (context) => {
      await context.out.info('lane line');
      const above = progress(context, { label: 'Above' });
      const reading = progress(context, { label: 'Reading the cache' });
      const below = progress(context, { label: 'Below', total: 4 });
      // The first frames queue as the lines open, so the scenario waits for them to reach the terminal.
      await after(10);
      scene.screen.mark('running');
      await reading.clear();
      scene.screen.mark('cleared');
      await above.end();
      await below.end();
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** Work tracked to its value, with a done message from a function of it. */
  done: (scene) => ({
    action: async (context) => {
      scene.notes.value = await progress(context, { label: 'Indexing' }).track(
        Promise.resolve(812),
        { done: (count) => `Indexed ${count} records` },
      );
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /**
   * A skipped line with a message, a counted line warned with one, a line skipped with none, and
   * a cleared line.
   */
  ends: () => ({
    action: async (context) => {
      await progress(context, { label: 'Fetching records' }).skip(
        'Fetched nothing: the cache is fresh',
      );
      const counted = progress(context, { label: 'Fetching more', total: 120 });
      counted.update({ completed: 118 });
      await counted.warn('Fetched 118 of 120 records');
      await progress(context, { label: 'Checking' }).skip();
      await progress(context, { label: 'Reading the cache' }).clear();
    },
    // The dim token is faint and the warning token yellow, so a test reads each from a cell.
    plugins: [
      progressStyle({ spinner: still }),
      theme({ dim: style.faint, warning: style.yellow }),
    ],
  }),
  /** A line that fails and then is cleared, which keeps its failure line. */
  failClear: () => ({
    action: async (context) => {
      const line = progress(context, { label: 'Uploading' });
      await line.fail('Upload refused');
      await line.clear();
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** A line that fails with a message, and tracked work that rejects under a failed message. */
  failMessages: () => ({
    action: async (context) => {
      await progress(context, { label: 'Uploading' }).fail('Upload refused');
      await progress(context, { label: 'Syncing' })
        .track(Promise.reject(new Error('offline')), {
          failed: (error) => `Sync failed: ${error instanceof Error ? error.message : ''}`,
        })
        .catch(() => undefined);
    },
  }),
  /** Work that rejects, with a failed message from a function of the rejection. */
  failed: (scene) => ({
    action: async (context) => {
      const cause = new Error('the host is down');
      try {
        await progress(context, { label: 'Fetching' }).track(Promise.reject(cause), {
          failed: (error) => `Could not fetch: ${error instanceof Error ? error.message : ''}`,
        });
      } catch (error) {
        scene.notes.same = error === cause;
      }
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** A line opened after the run's cancellation, with every draw call on its region counted. */
  late: (scene) => ({
    action: async (context) => {
      const { out } = context;
      scene.notes.draws = 0;
      // A frame counts when its draw call returns, and a closed region draws none.
      const counted = {
        ...context,
        out: observing(out, () => {
          scene.notes.draws = (scene.notes.draws ?? 0) + 1;
        }),
      };
      scene.caller.abort();
      const line = progress(counted, {
        label: 'Late',
        spinner: { frames: ['a', 'b'], interval: 10 },
      });
      await line.end();
      await line.fail();
      await line.skip();
      await line.warn();
      await line.clear();
      // The run is read once the line has had time for several frames.
      scene.lingering = after(100);
    },
  }),
  /** A counted line and a spinner line, a lane line between their frames, then each end. */
  look: (scene) => ({
    action: async (context) => {
      const counted = progress(context, { label: 'Fetching records', total: 10 });
      counted.update({ completed: 6 });
      const spinning = progress(context, { label: 'Building the index' });
      const reading = progress(context, { label: 'Reading rows' });
      reading.update({ completed: 1204 });
      await context.out.info('lane line');
      scene.screen.mark('running');
      await counted.end('Fetched 10 records');
      await spinning.fail();
      await reading.end();
      scene.screen.mark('ended');
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** A line a middleware opens before next() and leaves open. */
  middleware: () => ({
    action: async ({ out }) => {
      await out.info('action ran');
    },
    plugins: [
      progressStyle({ spinner: still }),
      around(async (context) => {
        progress(context, { label: 'Around the run' });
        await context.next();
        await context.out.info('after next');
      }),
    ],
  }),
  /** An override of the progress view, which every line draws through. */
  override: (scene) => ({
    action: async (context) => {
      const line = progress(context, { label: 'Counting', total: 4 });
      line.update({ completed: 1 });
      // An update returns nothing, so the scenario waits for its frame to reach the terminal.
      await after(10);
      scene.screen.mark('running');
      await line.end('Counted');
    },
    plugins: [progressStyle({ bar: { complete: '#', incomplete: '-' }, spinner: still })],
    views: [
      override(progressLine, {
        render: (data) =>
          [
            data.state,
            data.label,
            data.completed,
            data.total,
            data.frame,
            `${data.bar.complete}${data.bar.incomplete}`,
            typeof data.elapsed,
          ].join('|'),
      }),
    ],
  }),
  /** An override of the progress view that notes every end it draws, for each new end. */
  overrideEnds: (scene) => ({
    action: async (context) => {
      await progress(context, { label: 'Fetching records' }).skip('Nothing to do');
      await progress(context, { label: 'Fetching more' }).warn();
      await progress(context, { label: 'Reading the cache' }).clear();
    },
    plugins: [progressStyle({ spinner: still })],
    views: [
      override(progressLine, {
        render: (data) => {
          scene.notes.frames = [...(scene.notes.frames ?? []), `${data.state}|${data.label}`];
          return `${data.state} ${data.label}`;
        },
      }),
    ],
  }),
  /** The plain lines of the documented example, and a failing line. */
  plain: () => ({
    action: async (context) => {
      const fetching = progress(context, { label: 'Fetching records', total: 10 });
      for (let index = 0; index < 10; index += 1) {
        fetching.update({ completed: index + 1 });
      }
      await fetching.end('Fetched 10 records');
      await progress(context, { label: 'Building the index' }).track(Promise.resolve(812), {
        done: (count) => `Indexed ${count} records`,
      });
      await progress(context, { label: 'Uploading' }).fail();
    },
  }),
  /** Two lines that a question asked meanwhile holds still, each catching up once it is answered. */
  question: (scene) => ({
    action: async (context) => {
      const first = progress(context, { label: 'First' });
      const second = progress(context, { label: 'Second', total: 4 });
      // The answer is already typed, so the question's first frame waits for the lines to move.
      const asked = {
        ...context,
        out: observing(context.out, async ({ options }) => {
          if (options?.input && !scene.notes.asked) {
            scene.notes.asked = true;
            first.update({ label: 'First moved' });
            second.update({ completed: 3 });
            await after(10);
            scene.screen.mark('asking');
          }
        }),
      };
      await text(asked, { message: 'Continue' });
      scene.screen.mark('answered');
      await first.end();
      await second.end();
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** An action that returns with a line open. */
  return: () => ({
    action: async (context) => {
      progress(context, { label: 'Left open' });
      await context.out.info('returning');
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** A line ended before the work it tracks settles. */
  settled: (scene) => ({
    action: async (context) => {
      const line = progress(context, { label: 'Settling' });
      await line.end('Ended early');
      scene.notes.value = await line.track(
        after(5).then(() => 'late'),
        { done: 'Never drawn' },
      );
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** The style's spinner, a call's own spinner over it, and the default without the plugin. */
  style: (scene) => ({
    action: async (context) => {
      const styled = progress(context, { label: 'Styled' });
      const own = progress(context, { label: 'Own', spinner: { frames: ['+'], interval: 60_000 } });
      await styled.end();
      await own.end();
    },
    plugins:
      scene.argv[0] === 'default'
        ? []
        : [progressStyle({ spinner: { frames: ['⠋', '⠙'], interval: 60_000 } })],
    views: [
      override(progressLine, {
        render: (data, context) => {
          scene.notes.seen = { ...scene.notes.seen, [data.label]: data.frame };
          return progressLine.render(data, context);
        },
      }),
    ],
  }),
  /** An action that throws with two lines open. */
  throw: () => ({
    action: async (context) => {
      progress(context, { label: 'First' });
      progress(context, { label: 'Second' });
      await context.out.info('working');
      throw new FatalError('It failed.');
    },
    plugins: [progressStyle({ spinner: still })],
  }),
  /** Data the default view renders, written one value per line to stdout. */
  view: () => ({
    action: async ({ out }) => {
      const bar = { complete: '#', incomplete: '-' };
      const base = { bar, elapsed: 0, frame: '*', label: 'Work', state: 'running' } as const;
      const rows = [
        { ...base, completed: 1, total: 3 },
        { ...base, completed: 12, total: 10 },
        { ...base, completed: 0, total: 0 },
        { ...base, completed: 1.5, total: 4.5 },
        { ...base, completed: undefined, total: 5 },
        { ...base, completed: undefined, elapsed: 59_999, total: undefined },
        { ...base, completed: undefined, elapsed: 65_999, total: undefined },
        { ...base, completed: undefined, elapsed: 3_779_999, total: undefined },
        { ...base, completed: 3, elapsed: 300, state: 'skipped', total: 4 },
        { ...base, completed: 118, elapsed: 3200, state: 'warned', total: 120 },
      ] as const;
      for (const row of rows) {
        await out.render(row, {
          render: (data, context) => `${progressLine.render(data, context)}\n`,
        });
      }
    },
  }),
};

/**
 * One run of a scenario on a recorded terminal, `tty` unless named, with the command line after
 * it. `pipe` is a stderr that is not a terminal, and `invoke` an invocation by name. Every write to
 * stderr is recorded in order as an event a headless terminal emulator replays.
 */
async function lines(
  scenario: string,
  terminal = 'tty',
  argv: string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<Run> {
  const tty = terminal === 'tty';
  // Only the question scenario asks, and its answer is typed with the key.
  const mock = mockProcess({
    argv: scenario === 'style' ? [] : argv,
    env: { ...plain, ...env },
    terminal: {
      columns: 60,
      keys: scenario === 'question' ? ['yes\r'] : [],
      rows: 24,
      streams: tty ? ['stderr'] : [],
    },
  });
  const scene: Scene = {
    argv,
    caller: new AbortController(),
    lingering: Promise.resolve(),
    notes: {},
    screen: recording(mock),
  };
  const chosen = scenarios[scenario]?.(scene);
  if (chosen === undefined) {
    throw new Error(`No scenario named ${scenario}.`);
  }
  const app = new Application('progress', {
    description: 'Show progress lines.',
    plugins: [...(chosen.plugins ?? []), verbose(), plainPlugin()],
    views: chosen.views ?? [],
  }).action(chosen.action);
  let code: number | string = 0;
  let messages: string | undefined = undefined;
  if (terminal === 'invoke') {
    scene.notes.progress = [];
    const outcome = await app.invoke(
      [],
      {},
      {
        onProgress: (event) => {
          scene.notes.progress?.push(event);
        },
        process: mockProcess({ env: { ...plain, ...env } }),
      },
    );
    code = outcome.status;
    messages = outcome.status === 'cancelled' ? undefined : outcome.messages;
  } else {
    code = await app.run({ process: mock, signal: scene.caller.signal });
  }
  await scene.lingering;
  return {
    code,
    events: scene.screen.events(),
    ...(messages === undefined ? {} : { messages }),
    notes: scene.notes,
    stderr: mock.stderr.text,
    stdout: mock.stdout.text,
  };
}

/** The rows the emulator shows once it has taken every event up to the mark, or all of them. */
async function screen(run: Run, mark?: string): Promise<readonly string[]> {
  const shown = await replay(until(run.events, mark), { columns: 60 });
  return shown.lines;
}

/** One elapsed time as the view writes it under a minute. */
const seconds = String.raw`\d+\.\ds`;

test('a counted line, a spinner line, and a count without a total draw below a lane line', async () => {
  const shown = await screen(await lines('look'), 'running');
  expect(shown[0]).toBe('ℹ lane line');
  expect(shown[1]).toMatch(new RegExp(`^◐ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · ${seconds}$`, 'u'));
  expect(shown[2]).toMatch(new RegExp(`^◐ Building the index · ${seconds}$`, 'u'));
  expect(shown[3]).toMatch(new RegExp(`^◐ Reading rows 1204 · ${seconds}$`, 'u'));
  expect(shown).toHaveLength(4);
});

test('each success and failure line replaces its frame and stays in scrollback', async () => {
  const shown = await screen(await lines('look'), 'ended');
  expect(shown).toHaveLength(4);
  expect(shown[1]).toMatch(new RegExp(`^✔ Fetched 10 records · ${seconds}$`, 'u'));
  expect(shown[2]).toMatch(new RegExp(`^✘ Building the index · ${seconds}$`, 'u'));
  expect(shown[3]).toMatch(new RegExp(`^✔ Reading rows · ${seconds}$`, 'u'));
});

test('a skipped line, a warned line, and a line skipped with no message replace their frames, and a cleared line leaves nothing', async () => {
  const run = await lines('ends');
  expect(run.stdout).toBe('');
  const shown = await screen(run);
  expect(shown).toHaveLength(3);
  expect(shown[0]).toMatch(new RegExp(`^ℹ Fetched nothing: the cache is fresh · ${seconds}$`, 'u'));
  expect(shown[1]).toMatch(new RegExp(`^⚠ Fetched 118 of 120 records · ${seconds}$`, 'u'));
  expect(shown[2]).toMatch(new RegExp(`^ℹ Checking · ${seconds}$`, 'u'));
});

test('with color, the skipped line is dim throughout and the warned line colors only its glyph', async () => {
  const run = await lines('ends', 'tty', [], { NO_COLOR: undefined });
  const shown = await replay(until(run.events), { columns: 60 });
  expect(shown.dim[0]).toBe(shown.lines[0]);
  const message = '⚠ Fetched 118 of 120 records ';
  expect(shown.dim[1]).toMatch(new RegExp(`^ {${String(message.length)}}· ${seconds}$`, 'u'));
  expect(shown.colored[1]).toBe('⚠');
});

test('a cleared line leaves the rows above and below it as they were, with no blank row between', async () => {
  const run = await lines('clear');
  const running = await screen(run, 'running');
  expect(running).toHaveLength(4);
  expect(running[2]).toMatch(/^◐ Reading the cache · /u);
  const cleared = await screen(run, 'cleared');
  expect(cleared[0]).toBe('ℹ lane line');
  expect(cleared[1]).toMatch(new RegExp(`^◐ Above · ${seconds}$`, 'u'));
  expect(cleared[2]).toMatch(new RegExp(`^◐ Below ▱▱▱▱▱▱▱▱▱▱ 0/4 · ${seconds}$`, 'u'));
  expect(cleared).toHaveLength(3);
  const ended = await screen(run);
  expect(ended.slice(1).map((row) => row.split(' · ')[0])).toEqual(['✔ Above', '✔ Below']);
  expect(ended).toHaveLength(3);
});

test('after any end, every end method and an update do nothing more', async () => {
  const shown = await screen(await lines('again'));
  expect(shown.map((row) => row.split(' · ')[0])).toEqual([
    '✔ Ended',
    '✘ Failed',
    'ℹ Skipped',
    '⚠ Warned',
  ]);
});

test('a line that fails keeps its failure line when it is then cleared', async () => {
  const shown = await screen(await lines('failClear'));
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatch(new RegExp(`^✘ Upload refused · ${seconds}$`, 'u'));
});

test('a line cancelled with the run keeps its cancelled line when it is then cleared', async () => {
  const run = await lines('cancelClear');
  expect(run.code).toBe(130);
  await expect(screen(run)).resolves.toEqual(['ℹ started', '■ Waiting (cancelled)']);
});

test('on a host that takes compat glyph forms, the skipped line opens with i and the warned line with ‼', async () => {
  const shown = await screen(await lines('ends', 'tty', [], { TERM: 'linux' }));
  expect(shown[0]).toMatch(/^i Fetched nothing: the cache is fresh · /u);
  expect(shown[1]).toMatch(/^‼ Fetched 118 of 120 records · /u);
});

test('an override of the progress view draws the skipped and warned ends, and never a cleared line', async () => {
  const run = await lines('overrideEnds');
  expect(run.notes.frames?.filter((frame) => !frame.startsWith('running|'))).toEqual([
    'skipped|Nothing to do',
    'warned|Fetching more',
  ]);
  await expect(screen(run)).resolves.toEqual(['skipped Nothing to do', 'warned Fetching more']);
});

test('on a host that takes compat glyph forms, the failure line opens with ×', async () => {
  const shown = await screen(await lines('look', 'tty', [], { TERM: 'linux' }), 'ended');
  expect(shown[2]).toMatch(/^× Building the index · /u);
});

test('with color, the spinner frame and the complete cells are styled and the text is the same', async () => {
  const run = await lines('look', 'tty', [], { NO_COLOR: undefined });
  expect(run.stderr).toContain(String.fromCodePoint(27));
  const shown = await screen(run, 'running');
  expect(shown[1]).toMatch(new RegExp(`^◐ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · ${seconds}$`, 'u'));
});

test('a line open when the run is cancelled draws its cancelled line and writes no report', async () => {
  const run = await lines('cancel');
  expect(run.code).toBe(130);
  await expect(screen(run)).resolves.toEqual(['ℹ started', '■ Waiting (cancelled)']);
});

test("a line opened after the run's cancellation draws no frame and starts no frame timer", async () => {
  const run = await lines('late');
  expect(run.code).toBe(130);
  expect(run.notes).toEqual({ draws: 0 });
});

test('the spinner advances one frame each interval, in order', async () => {
  const { notes } = await lines('advance');
  const { frames } = notes;
  const running = (Array.isArray(frames) ? frames : []).slice(0, -1);
  expect(running).toEqual(['a', 'b', 'c', 'a', 'b']);
});

test("the style's spinner draws, and a call's own spinner wins for its line", async () => {
  const run = await lines('style');
  expect(run.notes.seen).toEqual({ Own: '+', Styled: '⠋' });
});

test('without the style plugin a line draws the default circle halves', async () => {
  const run = await lines('style', 'tty', ['default']);
  expect(run.notes.seen).toEqual({ Own: '+', Styled: '◐' });
});

test("an override of the progress view draws every frame, and its data carries the line's facts", async () => {
  const run = await lines('override');
  await expect(screen(run, 'running')).resolves.toEqual(['running|Counting|1|4|◐|#-|number']);
  await expect(screen(run)).resolves.toEqual(['ended|Counted|1|4|◐|#-|number']);
});

test('a question asked while two lines run holds them still and lets each catch up once', async () => {
  const run = await lines('question');
  const asking = await screen(run, 'asking');
  expect(asking[0]).toMatch(/^◐ First · /u);
  expect(asking[1]).toMatch(/^◐ Second ▱▱▱▱▱▱▱▱▱▱ 0\/4 · /u);
  expect(asking[2]).toBe('? Continue ›');
  const answered = await screen(run, 'answered');
  expect(answered[0]).toBe('? Continue · yes');
  expect(answered[1]).toMatch(/^◐ First moved · /u);
  expect(answered[2]).toMatch(/^◐ Second ▰▰▰▰▰▰▰▱▱▱ 3\/4 · /u);
});

test('the default view draws the bar cells, the counts, and the elapsed time, and no bar or counts on a skipped or warned line', async () => {
  const run = await lines('view', 'pipe');
  expect(run.stderr).toBe('');
  expect(run.stdout.split('\n').slice(0, 10)).toEqual([
    '* Work ###------- 1/3 · 0.0s',
    '* Work ########## 12/10 · 0.0s',
    '* Work ########## 0/0 · 0.0s',
    '* Work ###------- 33% · 0.0s',
    '* Work ---------- 0/5 · 0.0s',
    '* Work · 59.9s',
    '* Work · 1m 05s',
    '* Work · 1h 02m',
    'ℹ Work · 0.3s',
    '⚠ Work · 3.2s',
  ]);
});

test('track returns the value and ends with done from a function of it', async () => {
  const run = await lines('done');
  expect(run.notes).toEqual({ value: 812 });
  const [line] = await screen(run);
  expect(line).toMatch(new RegExp(`^✔ Indexed 812 records · ${seconds}$`, 'u'));
});

test('a rejection fails the line with failed from a function of it and rethrows the same object', async () => {
  const run = await lines('failed');
  expect(run.notes).toEqual({ same: true });
  const [line] = await screen(run);
  expect(line).toMatch(new RegExp(`^✘ Could not fetch: the host is down · ${seconds}$`, 'u'));
});

test('a line closed before its work settles draws nothing more and track returns the value', async () => {
  const run = await lines('settled');
  expect(run.notes).toEqual({ value: 'late' });
  const shown = await screen(run);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatch(/^✔ Ended early · /u);
});

test('an action that throws with two lines open writes both failure lines above the report', async () => {
  const run = await lines('throw');
  expect(run.code).toBe(1);
  const shown = await screen(run);
  expect(shown[0]).toBe('ℹ working');
  expect(shown[1]).toMatch(/^✘ First · /u);
  expect(shown[2]).toMatch(/^✘ Second · /u);
  expect(shown[3]).toBe('It failed.');
  expect(shown).toHaveLength(4);
});

test('an action that returns with a line open writes its success line', async () => {
  const shown = await screen(await lines('return'));
  expect(shown[0]).toBe('ℹ returning');
  expect(shown[1]).toMatch(/^✔ Left open · /u);
});

test("a middleware's line stays open through the action and ends once the chain has unwound", async () => {
  const shown = await screen(await lines('middleware'));
  expect(shown.slice(0, 2)).toEqual(['ℹ action ran', 'ℹ after next']);
  expect(shown[2]).toMatch(/^✔ Around the run · /u);
});

test('with stderr piped, the run writes one start line and one end line per progress line', async () => {
  const run = await lines('plain', 'pipe');
  expect(run.stderr).toBe(
    'ℹ Fetching records\n✔ Fetched 10 records\nℹ Building the index\n✔ Indexed 812 records\nℹ Uploading\n✘ Uploading\n',
  );
});

test.each([
  { argv: [], env: { TERM: 'dumb' } },
  { argv: [], env: { CI: 'true' } },
  { argv: [], env: { ACCESSIBLE: '1' } },
  { argv: ['--plain'], env: {} },
])(
  'on a terminal stderr with argv $argv and $env, the run writes the plain lines and no control sequence',
  async ({ argv, env }) => {
    const run = await lines('plain', 'tty', argv, env);
    expect(run.stderr).toBe(
      'ℹ Fetching records\n✔ Fetched 10 records\nℹ Building the index\n✔ Indexed 812 records\nℹ Uploading\n✘ Uploading\n',
    );
  },
);

/** The plain lines of the ends scenario: a skipped end through info, a warned end through warn, and a cleared line's start line alone. */
const plainEnds =
  'ℹ Fetching records\nℹ Fetched nothing: the cache is fresh\nℹ Fetching more\n⚠ Fetched 118 of 120 records\nℹ Checking\nℹ Checking\nℹ Reading the cache\n';

test.each([
  { argv: [], env: {}, terminal: 'pipe' },
  { argv: [], env: { TERM: 'dumb' }, terminal: 'tty' },
  { argv: [], env: { ACCESSIBLE: '1' }, terminal: 'tty' },
  { argv: ['--plain'], env: {}, terminal: 'tty' },
])(
  'on $terminal with argv $argv and $env, a skipped line writes through info, a warned line through warn, and a cleared line nothing more',
  async ({ argv, env, terminal }) => {
    const run = await lines('ends', terminal, argv, env);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe(plainEnds);
  },
);

test('under -q a warned line prints with the warn lane and a skipped line hides with the info lane', async () => {
  const run = await lines('ends', 'pipe', ['-q']);
  expect(run.stderr).toBe('⚠ Fetched 118 of 120 records\n');
});

test('where the line is not live, an end after an end writes nothing more', async () => {
  const run = await lines('again', 'pipe');
  expect(run.stderr).toBe(
    'ℹ Ended\n✔ Ended\nℹ Failed\n✘ Failed\nℹ Skipped\nℹ Skipped\nℹ Warned\n⚠ Warned\nℹ Cleared\n',
  );
});

test('where the line is not live, a line that fails keeps its failure line when it is then cleared', async () => {
  const run = await lines('failClear', 'pipe');
  expect(run.stderr).toBe('ℹ Uploading\n✘ Upload refused\n');
});

test('under app.invoke a skipped and a warned end read skipped and warned with their messages, and a cleared line reads ended with its label', async () => {
  const run = await lines('ends', 'invoke');
  expect(run.messages).toBe(plainEnds);
  const reported = [Object(run.notes.progress)].flat();
  expect(
    reported.map(({ completed, id, label, state, total }) => [id, state, label, completed, total]),
  ).toEqual([
    [1, 'started', 'Fetching records', undefined, undefined],
    [1, 'skipped', 'Fetched nothing: the cache is fresh', undefined, undefined],
    [2, 'started', 'Fetching more', 0, 120],
    [2, 'updated', 'Fetching more', 118, 120],
    [2, 'warned', 'Fetched 118 of 120 records', 118, 120],
    [3, 'started', 'Checking', undefined, undefined],
    [3, 'skipped', 'Checking', undefined, undefined],
    [4, 'started', 'Reading the cache', undefined, undefined],
    [4, 'ended', 'Reading the cache', undefined, undefined],
  ]);
});

test('under app.invoke an end after an end reports nothing more', async () => {
  const run = await lines('again', 'invoke');
  const reported = [Object(run.notes.progress)].flat();
  expect(reported.map(({ id, state }) => [id, state])).toEqual([
    [1, 'started'],
    [1, 'ended'],
    [2, 'started'],
    [2, 'failed'],
    [3, 'started'],
    [3, 'skipped'],
    [4, 'started'],
    [4, 'warned'],
    [5, 'started'],
    [5, 'ended'],
  ]);
});

test('on a terminal stderr whose TERM is dumb, a question asked beside two plain lines asks line by line', async () => {
  const run = await lines('question', 'tty', [], { TERM: 'dumb' });
  expect(run.code).toBe(0);
  // The question echoes the answer and its Enter, so the end lines follow on rows of their own.
  expect(run.stderr).toBe('ℹ First\nℹ Second\nContinue: yes\n✔ First moved\n✔ Second\n');
});

test('under -q only the failure lines print', async () => {
  const run = await lines('plain', 'tty', ['-q']);
  expect(run.stderr).toBe('✘ Uploading\n');
});

test('under app.invoke the lines land in messages', async () => {
  const run = await lines('plain', 'invoke');
  expect(run.messages).toBe(
    'ℹ Fetching records\n✔ Fetched 10 records\nℹ Building the index\n✔ Indexed 812 records\nℹ Uploading\n✘ Uploading\n',
  );
});

test('under app.invoke the observer reads every progress event of every line in order', async () => {
  const run = await lines('plain', 'invoke');
  const reported = [Object(run.notes.progress)].flat();
  const counted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((completed) => [1, 'updated', completed]);
  expect(reported.map(({ completed, id, state }) => [id, state, completed])).toEqual([
    [1, 'started', 0],
    ...counted,
    [1, 'ended', 10],
    [2, 'started', undefined],
    [2, 'ended', undefined],
    [3, 'started', undefined],
    [3, 'failed', undefined],
  ]);
});

test("under app.invoke a line's end and track's done message is its end event's label, and a fail with no message keeps the label", async () => {
  const run = await lines('plain', 'invoke');
  const reported = [Object(run.notes.progress)].flat();
  expect(reported.map(({ label }) => label)).toEqual([
    ...Array.from({ length: 11 }, () => 'Fetching records'),
    'Fetched 10 records',
    'Building the index',
    'Indexed 812 records',
    'Uploading',
    'Uploading',
  ]);
});

test("under app.invoke a line's fail and track's failed message is its failed event's label", async () => {
  const run = await lines('failMessages', 'invoke');
  const reported = [Object(run.notes.progress)].flat();
  expect(reported.map(({ id, label, state }) => [id, state, label])).toEqual([
    [1, 'started', 'Uploading'],
    [1, 'failed', 'Upload refused'],
    [2, 'started', 'Syncing'],
    [2, 'failed', 'Sync failed: offline'],
  ]);
});

test("SIGINT writes the line's cancelled line, the run resolves 130, and the process dies by it", async () => {
  const running = start(signalFixture, [], { env: plain });
  await running.announced('READY');
  running.child.kill('SIGINT');
  const exit = await running.exit;
  // The code after `run()` reports before the shutdown ends and re-raises the signal.
  expect(exit.signal).toBe('SIGINT');
  const run: Run = JSON.parse(exit.stdout.slice(exit.stdout.indexOf('{')));
  expect(run.code).toBe(130);
  await expect(screen(run)).resolves.toEqual(['■ Waiting for SIGINT (cancelled)']);
});
