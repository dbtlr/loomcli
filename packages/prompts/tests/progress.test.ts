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
 * - Counts and time. The default view, rendered directly, draws 3 complete cells for 1/3, 10 for
 *   12/10, and 10 for 0/0, reads `33%` for 1.5 of 4.5 and `0/5` for an absent `completed` of 5, and
 *   reads `59.9s` at 59 999 ms, `1m 05s` at 65 999 ms, and `1h 02m` at 3 779 999 ms.
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
 *   shows. On a terminal stderr whose `TERM` is `dumb`, or with `CI` set, it writes
 *   the same plain lines and no control sequence, and a question asked beside two lines still asks. Under `-q` with the verbose plugin, it writes only failure lines. Under `app.invoke`,
 *   the lines land in `messages`, and the observer reads every progress event in order. The end
 *   event of a line ended by `end`, `fail`, or `track` with a `done` or `failed` message carries
 *   that message as its label, and one ended with no message carries the line's last label.
 * - Style. `progressStyle({ spinner: spinners.dots })` draws the dots frames at their interval, a
 *   call's own spinner wins for its line, and the defaults hold without the plugin.
 * - View. An override of `progressLine` changes every line's frame, and its data carries the state,
 *   counts, frame, bar cells, and elapsed time the Progress view section lists.
 * - Packed. `check:packed` installs the packed library, imports `progress` and `progressStyle` from
 *   `@loomcli/prompts` and `progressLine` from `@loomcli/prompts/views`, and compiles against their
 *   declarations under Node and Bun.
 */

import { Application, FatalError, override, plugin } from '@loomcli/core';
import type { ActionContext, MiddlewareContext, Plugin, ProgressEvent } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { start } from '../../../scripts/test-process.js';
import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';
import { progress, progressStyle, text } from '../src/index.js';
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
      const line = progress(context, {
        label: 'Spinning',
        spinner: { frames: ['a', 'b', 'c'], interval: 15 },
      });
      await after(120);
      await line.end();
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
  /** One line open when the run is cancelled. */
  cancel: (scene) => ({
    action: async (context) => {
      progress(context, { label: 'Waiting' });
      await context.out.info('started');
      scene.caller.abort();
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
      progress(counted, { label: 'Late', spinner: { frames: ['a', 'b'], interval: 10 } });
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
      ];
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
    plugins: [...(chosen.plugins ?? []), verbose()],
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
  expect(running.length).toBeGreaterThanOrEqual(3);
  expect(running.slice(0, 4)).toEqual(['a', 'b', 'c', 'a'].slice(0, Math.min(4, running.length)));
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

test('the default view draws the bar cells, the counts, and the elapsed time', async () => {
  const run = await lines('view', 'pipe');
  expect(run.stderr).toBe('');
  expect(run.stdout.split('\n').slice(0, 8)).toEqual([
    '* Work ###------- 1/3 · 0.0s',
    '* Work ########## 12/10 · 0.0s',
    '* Work ########## 0/0 · 0.0s',
    '* Work ###------- 33% · 0.0s',
    '* Work ---------- 0/5 · 0.0s',
    '* Work · 59.9s',
    '* Work · 1m 05s',
    '* Work · 1h 02m',
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

test.each([{ TERM: 'dumb' }, { CI: 'true' }])(
  'on a terminal stderr with %o, the run writes the plain lines and no control sequence',
  async (env) => {
    const run = await lines('plain', 'tty', [], env);
    expect(run.stderr).toBe(
      'ℹ Fetching records\n✔ Fetched 10 records\nℹ Building the index\n✔ Indexed 812 records\nℹ Uploading\n✘ Uploading\n',
    );
  },
);

test('on a terminal stderr whose TERM is dumb, a question asked beside two plain lines still asks', async () => {
  const run = await lines('question', 'tty', [], { TERM: 'dumb' });
  expect(run.notes.asked).toBe(true);
  const shown = await screen(run);
  expect(shown.slice(0, 5)).toEqual([
    'ℹ First',
    'ℹ Second',
    '? Continue · yes',
    '✔ First moved',
    '✔ Second',
  ]);
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
