import { Readable, Writable } from 'node:stream';

import { Application, FatalError, override, plugin } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';

import { progress, progressStyle, text } from '../../dist/index.js';
import { progressLine } from '../../dist/views.js';

/**
 * Progress lines on a recorded terminal. argv[2] names the scenario and argv[3] the terminal:
 * `tty` (the default) for a stderr that reports a terminal of 60 columns, `pipe` for one that does
 * not, or `invoke` for an invocation by name. The rest of argv is the command line. Every write to
 * stderr is recorded in order as an event a headless terminal emulator replays, and `mark`
 * records a named point in that order. The fixture prints { code, events, messages, notes, stderr }.
 */
const [scenario, terminal = 'tty', ...argv] = process.argv.slice(2);

const events = [];
const notes = {};
let stderrText = '';
let messages = undefined;
/** What a scenario still runs after the run resolves, which the fixture awaits before it prints. */
let lingering = Promise.resolve();

/** Records a named point in the event order. */
function mark(name) {
  events.push({ mark: name });
}

/** A spinner that never advances while a test reads the screen. */
const still = { frames: ['◐', '◓', '◑', '◒'], interval: 60_000 };

/** Resolves after `ms` milliseconds. */
function after(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class Keyboard extends Readable {
  _read() {}
  setRawMode() {
    return this;
  }
}
const keyboard = new Keyboard();
const caller = new AbortController();

/** A plugin whose middleware runs `body` around the rest of the chain. */
function around(body) {
  return plugin('@fixture/around', {
    middleware: { activate: 'always', load: async () => ({ default: body }) },
  });
}

/** Each scenario: the plugins and view overrides it installs, and its action. */
const scenarios = {
  /** A spinner whose frames the view records as it advances. */
  advance: {
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
          notes.frames = [...(notes.frames ?? []), data.frame];
          return progressLine.render(data, context);
        },
      }),
    ],
  },
  /** One line open when the run is cancelled. */
  cancel: {
    action: async (context) => {
      progress(context, { label: 'Waiting' });
      await context.out.info('started');
      caller.abort();
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** Work tracked to its value, with a done message from a function of it. */
  done: {
    action: async (context) => {
      notes.value = await progress(context, { label: 'Indexing' }).track(Promise.resolve(812), {
        done: (count) => `Indexed ${count} records`,
      });
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** Work that rejects, with a failed message from a function of the rejection. */
  failed: {
    action: async (context) => {
      const cause = new Error('the host is down');
      try {
        await progress(context, { label: 'Fetching' }).track(Promise.reject(cause), {
          failed: (error) => `Could not fetch: ${error.message}`,
        });
      } catch (error) {
        notes.same = error === cause;
      }
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** One malformed setting, named by argv[0]. */
  fault: {
    action: async (context) => {
      const calls = {
        bar: () => progressStyle({ bar: { complete: '', incomplete: '-' } }),
        completed: () => progress(context, { label: 'Fetching records' }).update({ completed: -1 }),
        done: () =>
          progress(context, { label: 'Fetching records' }).track(Promise.resolve(1), { done: 1 }),
        end: () => progress(context, { label: 'Fetching records' }).end(3),
        failed: () =>
          progress(context, { label: 'Fetching records' }).track(Promise.resolve(1), {
            failed: 1,
          }),
        frame: () => progressStyle({ spinner: { frames: ['a', 2], interval: 80 } }),
        frames: () => progress(context, { label: 'Spin', spinner: { frames: [], interval: 80 } }),
        incomplete: () => progressStyle({ bar: { complete: '#', incomplete: '' } }),
        interval: () => progressStyle({ spinner: { frames: ['a'], interval: 0 } }),
        label: () => progress(context, { label: 3 }),
        settings: () => progressStyle('dots'),
        total: () => progress(context, { label: 'Fetching records', total: Number.NaN }),
        update: () => progress(context, { label: 'Fetching records' }).update(3),
      };
      try {
        await calls[argv[0]]();
      } catch (error) {
        notes.name = error.name;
        notes.rule = error.rule?.identity;
        notes.message = `${error.sentence} ${error.correction}`;
      }
    },
  },
  /** A line opened after the run's cancellation, with every draw call on its region counted. */
  late: {
    action: async (context) => {
      const { out } = context;
      notes.draws = 0;
      const counted = {
        ...context,
        out: {
          ...out,
          region: (options) => {
            const region = out.region(options);
            return {
              get closedBy() {
                return region.closedBy;
              },
              draw: (data, view) => {
                notes.draws += 1;
                return region.draw(data, view);
              },
              end: (state) => region.end(state),
              get live() {
                return region.live;
              },
              report: (report) => region.report(report),
              signal: region.signal,
            };
          },
        },
      };
      caller.abort();
      progress(counted, { label: 'Late', spinner: { frames: ['a', 'b'], interval: 10 } });
      // The fixture prints once the line has had time for several frames.
      lingering = after(100);
    },
  },
  /** A counted line and a spinner line, a lane line between their frames, then each end. */
  look: {
    action: async (context) => {
      const counted = progress(context, { label: 'Fetching records', total: 10 });
      counted.update({ completed: 6 });
      const spinning = progress(context, { label: 'Building the index' });
      const reading = progress(context, { label: 'Reading rows' });
      reading.update({ completed: 1204 });
      await context.out.info('lane line');
      mark('running');
      await counted.end('Fetched 10 records');
      await spinning.fail();
      await reading.end();
      mark('ended');
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** A line a middleware opens before next() and leaves open. */
  middleware: {
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
  },
  /** An override of the progress view, which every line draws through. */
  override: {
    action: async (context) => {
      const line = progress(context, { label: 'Counting', total: 4 });
      line.update({ completed: 1 });
      // An update returns nothing, so the fixture waits for its frame to reach the terminal.
      await after(10);
      mark('running');
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
  },
  /** The plain lines of the documented example, and a failing line. */
  plain: {
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
  },
  /** Two lines that a question asked meanwhile holds still, each catching up once it is answered. */
  question: {
    action: async (context) => {
      const first = progress(context, { label: 'First' });
      const second = progress(context, { label: 'Second', total: 4 });
      const { out } = context;
      const asked = {
        ...context,
        out: {
          ...out,
          region: (options) => {
            const region = out.region(options);
            return {
              get closedBy() {
                return region.closedBy;
              },
              draw: async (data, view) => {
                await region.draw(data, view);
                if (options?.input && !notes.asked) {
                  notes.asked = true;
                  first.update({ label: 'First moved' });
                  second.update({ completed: 3 });
                  await after(10);
                  mark('asking');
                  keyboard.push('yes\r');
                }
              },
              end: (state) => region.end(state),
              live: region.live,
              report: (report) => region.report(report),
              signal: region.signal,
            };
          },
        },
      };
      await text(asked, { message: 'Continue' });
      mark('answered');
      await first.end();
      await second.end();
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** An action that returns with a line open. */
  return: {
    action: async (context) => {
      progress(context, { label: 'Left open' });
      await context.out.info('returning');
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** A line ended before the work it tracks settles. */
  settled: {
    action: async (context) => {
      const line = progress(context, { label: 'Settling' });
      await line.end('Ended early');
      notes.value = await line.track(
        after(5).then(() => 'late'),
        { done: 'Never drawn' },
      );
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** A run held open by a line until the operator's SIGINT. */
  signal: {
    action: async (context) => {
      progress(context, { label: 'Waiting for SIGINT' });
      process.stdout.write('READY\n');
      // The fixture's own timer holds the process open until the signal; the line's timer never does.
      const hold = setInterval(() => undefined, 1000);
      await new Promise((resolve) => {
        context.signal.addEventListener(
          'abort',
          () => {
            clearInterval(hold);
            resolve();
          },
          { once: true },
        );
      });
    },
    plugins: [
      progressStyle({ spinner: still }),
      plugin('@fixture/signals', { signals: ['SIGINT'] }),
    ],
  },
  /** The style's spinner, a call's own spinner over it, and the default without the plugin. */
  style: {
    action: async (context) => {
      const styled = progress(context, { label: 'Styled' });
      const own = progress(context, { label: 'Own', spinner: { frames: ['+'], interval: 60_000 } });
      await styled.end();
      await own.end();
    },
    plugins:
      argv[0] === 'default'
        ? []
        : [progressStyle({ spinner: { frames: ['⠋', '⠙'], interval: 60_000 } })],
    views: [
      override(progressLine, {
        render: (data, context) => {
          notes.seen = { ...notes.seen, [data.label]: data.frame };
          return progressLine.render(data, context);
        },
      }),
    ],
  },
  /** An action that throws with two lines open. */
  throw: {
    action: async (context) => {
      progress(context, { label: 'First' });
      progress(context, { label: 'Second' });
      await context.out.info('working');
      throw new FatalError('It failed.');
    },
    plugins: [progressStyle({ spinner: still })],
  },
  /** Data the default view renders, written one value per line to stdout. */
  view: {
    action: async ({ out }) => {
      const bar = { complete: '#', incomplete: '-' };
      const base = { bar, elapsed: 0, frame: '*', label: 'Work', state: 'running' };
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
  },
};

const chosen = scenarios[scenario];
const app = new Application('progress', {
  description: 'Show progress lines.',
  plugins: [...(chosen.plugins ?? []), verbose()],
  views: chosen.views ?? [],
}).action(chosen.action);

const tty = terminal === 'tty';
const stderr = new Writable({
  write(chunk, _encoding, done) {
    stderrText += chunk.toString();
    events.push({ write: chunk.toString() });
    done();
  },
});
let code = 0;
if (terminal === 'invoke') {
  notes.progress = [];
  const outcome = await app.invoke(
    [],
    {},
    {
      onProgress: (event) => {
        notes.progress.push(event);
      },
    },
  );
  code = outcome.status;
  messages = outcome.messages;
} else {
  code = await app.run({
    host: {
      argv: scenario === 'fault' || scenario === 'style' ? [] : argv,
      env: { NO_COLOR: process.env.NO_COLOR, TERM: process.env.TERM },
      stderr,
      stdin: keyboard,
      terminal: {
        stderr: { columns: tty ? 60 : undefined, isTTY: tty, rows: 24 },
        stdin: { isTTY: true },
        stdout: { columns: undefined, isTTY: false, rows: undefined },
      },
    },
    signal: caller.signal,
  });
}
await lingering;
process.stdout.write(`${JSON.stringify({ code, events, messages, notes, stderr: stderrText })}\n`);
