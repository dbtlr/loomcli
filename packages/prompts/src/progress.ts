import { extension, plugin, readExtension } from '@loomcli/core';
import type {
  ActionContext,
  Out,
  Plugin,
  Region,
  RegionCloser,
  StandardSchemaV1,
} from '@loomcli/core';

import { controls } from './controls.js';
import { estimate } from './estimate.js';
import { keptLines, ProgressLog } from './log.js';
import { logLinesDropped } from './messages.js';
import { progressLine } from './views.js';
import type { ProgressLine } from './views.js';

/**
 * A spinner in the shape of a cli-spinners entry: frames drawn in turn, one each interval.
 *
 * @public
 */
interface Spinner {
  /** The frames drawn in turn, one each interval. */
  readonly frames: readonly string[];
  /** Milliseconds between frames. */
  readonly interval: number;
}

/**
 * The settings of one progress line: its label, an optional total that makes it a bar, an
 * optional spinner of its own, whether it shows its rate and time left, and how much of its log
 * it shows and keeps.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress
 * @public
 */
interface ProgressSettings {
  /** The text the line shows while it runs. */
  readonly label: string;
  /** A bar with counts; without it, a spinner. */
  readonly total?: number;
  /** This line's own spinner, over the application's style. */
  readonly spinner?: Spinner;
  /**
   * Whether the running line shows its rate and time left once there is enough progress, as in
   * `40/120 · 12.0s · 3.3/s · about 24s left`. Absent, false.
   */
  readonly estimate?: boolean;
  /** What the line counts, as the rate names it: `files` reads `3.3 files/s`. A marked string. */
  readonly unit?: string;
  /**
   * How many of the log's newest lines the running line shows under it, a whole number of 0 or
   * more. Absent, 5.
   */
  readonly logRows?: number;
  /**
   * How many of the log's newest lines the line keeps to write above its end line when it fails,
   * warns, or is cancelled, a whole number of 0 or more. Absent, 1000.
   */
  readonly logLimit?: number;
}

/**
 * A change to a running line: each field it states replaces the line's current one.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress
 * @public
 */
interface ProgressUpdate {
  /** The count of units done so far. */
  readonly completed?: number;
  /** The count of units the work has, which turns a spinner into a bar. */
  readonly total?: number;
  /** The text the line shows from now on. */
  readonly label?: string;
}

/**
 * The messages `track` ends a line with: one for the work's value and one for its failure.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress
 * @public
 */
interface TrackMessages<Value> {
  /** The end message, or a function of the work's value that returns it. */
  readonly done?: string | ((value: Value) => string);
  /** The failure message, or a function of the work's rejection that returns it. */
  readonly failed?: string | ((error: unknown) => string);
}

/**
 * The handle `progress()` returns for one line.
 *
 * @public
 * @sealed
 */
interface Progress {
  /** Changes the line's counts or label while it runs. */
  update(update: ProgressUpdate): void;
  /**
   * Adds lines to the line's log: one line, text that holds several, or an async iterable of
   * text, such as a child program's output. The text is a marked string. Where the line draws,
   * its newest lines show under it, dim; `end`, `skip`, and `clear` remove them, and `fail`,
   * `warn`, and a cancellation write the kept lines above the end line. Resolves at once for a
   * string, and for an iterable once it ends, or rejects with what it threw.
   */
  log(text: string | AsyncIterable<string>): Promise<void>;
  /** Ends the line as a success, with an optional message in place of the label. */
  end(message?: string): Promise<void>;
  /** Ends the line as a failure, with an optional message in place of the label. */
  fail(message?: string): Promise<void>;
  /**
   * Ends the line as skipped, with an optional message in place of the label. Where the line draws,
   * it leaves a dim line. Where it does not draw, it writes the line through `out.info`.
   */
  skip(message?: string): Promise<void>;
  /** Ends the line with a warning, with an optional message in place of the label. */
  warn(message?: string): Promise<void>;
  /**
   * Ends the line and removes it. Where the line draws, it leaves nothing, except a frame drawn
   * before the terminal was lent, which stays where it was drawn. Where the line does not draw, it
   * writes nothing after the start line, which stays.
   */
  clear(): Promise<void>;
  /** Ends the line by how the work settles and returns the work's value, or rethrows its rejection. */
  track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value>;
}

/**
 * What `progress()` reads: an action's, a middleware's, or a configuration source's context.
 *
 * @public
 */
type ProgressContext = Pick<ActionContext<unknown>, 'graph'> & {
  readonly out: Pick<Out, 'region' | 'info' | 'success' | 'warn' | 'error'>;
};

/**
 * The look `progressStyle()` sets for every progress line: a spinner and the cells of the bar.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress-style
 * @public
 */
interface ProgressStyleSettings {
  /** The spinner every line draws unless its own settings name one. */
  readonly spinner?: Spinner;
  /** The cells a bar draws for the done and the remaining share of the work. */
  readonly bar?: { readonly complete: string; readonly incomplete: string };
}

/** Cli-spinners' `circleHalves`, every 80 milliseconds. */
const defaultSpinner: Spinner = Object.freeze({
  frames: Object.freeze(['◐', '◓', '◑', '◒']),
  interval: 80,
});
const defaultBar = Object.freeze({ complete: '▰', incomplete: '▱' });

/** The style one application sets, as plain data the root Command carries. */
type StoredStyle = ProgressStyleSettings;

/** Whether a value is an object that may hold fields. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Whether a value holds a spinner's frames and interval. */
function isSpinner(value: unknown): value is Spinner {
  return (
    isRecord(value) &&
    Array.isArray(value.frames) &&
    value.frames.every((frame: unknown) => typeof frame === 'string') &&
    typeof value.interval === 'number'
  );
}

/** Whether a value holds a bar's two cells. */
function isBar(value: unknown): value is NonNullable<StoredStyle['bar']> {
  return (
    isRecord(value) && typeof value.complete === 'string' && typeof value.incomplete === 'string'
  );
}

/** The stored style read back from the extension value `progressStyle()` built, or none. */
function styleOf(value: unknown): StoredStyle | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { bar, spinner } = value;
  if ((spinner !== undefined && !isSpinner(spinner)) || (bar !== undefined && !isBar(bar))) {
    return undefined;
  }
  return { ...(spinner === undefined ? {} : { spinner }), ...(bar === undefined ? {} : { bar }) };
}

/** The extension's schema, the typed read of the style `progressStyle()` stores. */
const storedStyle: StandardSchemaV1<StoredStyle, StoredStyle> = {
  '~standard': {
    validate: (value) => {
      const style = styleOf(value);
      return style === undefined
        ? { issues: [{ message: 'Expected the style progressStyle() stores.' }] }
        : { value: style };
    },
    vendor: '@loomcli/prompts',
    version: 1,
  },
};

/** The application's progress style, carried on the root Command. The package does not export it. */
const progressStyleExtension = extension('@loomcli/prompts/progress-style', {
  schema: storedStyle,
  target: 'command',
});

/**
 * The optional plugin that sets how every progress line of an application looks: a spinner in the
 * cli-spinners shape and the bar's cells. Each setting it omits keeps the library's default.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { progressStyle } from '@loomcli/prompts';
 *
 * export const app = new Application('fetchit', {
 *   plugins: [progressStyle({ bar: { complete: '#', incomplete: '-' } })],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress-style
 * @public
 */
function progressStyle(settings?: ProgressStyleSettings): Plugin {
  const style: StoredStyle = {
    ...(settings?.spinner === undefined ? {} : { spinner: settings.spinner }),
    ...(settings?.bar === undefined ? {} : { bar: settings.bar }),
  };
  return plugin('@loomcli/prompts', {
    extensions: [progressStyleExtension],
    onCommandAttach: (command) =>
      command.name === null ? command.extend(progressStyleExtension(style)) : command,
  });
}

/** The message a tracked outcome ends with: the string, the function's answer, or the label. */
function trackedMessage<Value>(
  message: string | ((value: Value) => string) | undefined,
  value: Value,
): string | undefined {
  return typeof message === 'function' ? message(value) : message;
}

/** How tracked work settled: its value, or what it rejected with, unchanged. */
async function settle<Value>(
  work: PromiseLike<Value>,
): Promise<{ value: Value } | { error: unknown }> {
  try {
    return { value: await work };
  } catch (error) {
    return { error };
  }
}

/** The state a line takes when core closes its region. */
const closedState: Readonly<Record<RegionCloser, Exclude<ProgressLine['state'], 'running'>>> = {
  cancellation: 'cancelled',
  completion: 'ended',
  end: 'ended',
  failure: 'failed',
};

/** The state a line's own end takes, each of which draws its own last line. */
type EndState = Exclude<ProgressLine['state'], 'running' | 'cancelled'>;

/** The rows a running line shows of its log when its settings name no count. */
const LOG_ROWS = 5;
/** The lines a line keeps of its log to write when it fails when its settings name no count. */
const LOG_LIMIT = 1000;

/** What one line shows and how it changes, which its view reads at each frame. */
interface LineState {
  state: ProgressLine['state'];
  label: string;
  completed: number | undefined;
  total: number | undefined;
  tick: number;
}

/**
 * One progress line in its own live region: a spinner while the work has no total, and a bar with
 * counts once it has one. While the region is live the line animates on its own unref'd timer,
 * which it clears when the region's signal aborts, and draws its success, failure, or cancelled
 * line as the region's last frame, or its skipped or warned line. A cleared line draws an empty
 * last frame, so it leaves nothing. A line whose region closed as it opened draws nothing, writes
 * nothing, and runs no timer. Off a terminal it writes one start line through `info` and one
 * end line through `success`, `error`, `info` for a skipped line, or `warn`, and a cleared line
 * writes no end line. It reports at its start, at each update, and at its close. With `estimate`,
 * a running line also draws its rate and time left, computed from the counts its updates report
 * and the clock it reads for the elapsed time. Its `log()` adds lines, such as a child program's
 * output, whose newest rows show dim under the running line; an end, a skip, or a clear removes
 * them, and a failure, a warning, or a cancellation writes the kept lines above the end line,
 * where the line draws and where it does not.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { progress } from '@loomcli/prompts';
 *
 * export const fetchAll = new Command('fetch').action(async (context) => {
 *   const line = progress(context, { label: 'Fetching records', total: 10 });
 *   for (let completed = 1; completed <= 10; completed += 1) {
 *     line.update({ completed });
 *   }
 *   await line.end('Fetched 10 records');
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress
 * @public
 */
function progress(context: ProgressContext, settings: ProgressSettings): Progress {
  const { label, total } = settings;
  const own = settings.spinner;
  const style = readExtension(context.graph.root, progressStyleExtension);
  const spinner = own ?? style?.spinner ?? defaultSpinner;
  const bar = style?.bar ?? defaultBar;
  const region: Region = context.out.region();
  const started = Date.now();
  // The rate and time left read the reports and the clock the elapsed time reads, and no timer.
  const pace = estimate();
  const book = new ProgressLog(settings.logRows ?? LOG_ROWS, settings.logLimit ?? LOG_LIMIT);
  const line: LineState = {
    completed: total === undefined ? undefined : 0,
    label,
    state: 'running',
    tick: 0,
    total,
  };
  const frame = (): ProgressLine => {
    const now = Date.now();
    return {
      bar,
      completed: line.completed,
      elapsed: now - started,
      estimate: settings.estimate ?? false,
      frame: spinner.frames[line.tick % spinner.frames.length] ?? '',
      label: line.label,
      log: line.state === 'running' ? book.rows() : [],
      rate: pace.rate(),
      remaining: pace.remaining(line.total, now),
      state: line.state,
      total: line.total,
      unit: settings.unit,
    };
  };
  region.report(total === undefined ? { label } : { completed: 0, label, total });
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  if (region.closedBy !== undefined) {
    // A region opened after the run's cancellation closed as it opened, so the line starts closed.
    line.state = closedState[region.closedBy];
    book.close();
  } else if (region.live) {
    void region.draw(frame(), progressLine);
    timer = setInterval(() => {
      line.tick += 1;
      void region.draw(frame(), progressLine);
    }, spinner.interval);
    timer.unref();
  } else {
    void context.out.info(label);
  }
  // Where the region is not live, each end writes its line through the lane of its level.
  const plainLine: Readonly<Record<EndState, (text: string) => Promise<void>>> = {
    ended: (text) => context.out.success(text),
    failed: (text) => context.out.error(text),
    skipped: (text) => context.out.info(text),
    warned: (text) => context.out.warn(text),
  };
  // A failed, warned, or cancelled line writes its kept log lines as one message above its end line.
  // The message goes through the lane of the end's level, and a line with no kept line writes none.
  const writeKept = (state: 'failed' | 'warned' | 'cancelled'): Promise<void> => {
    const { dropped, lines } = book.kept();
    if (lines.length === 0) {
      return Promise.resolve();
    }
    const message = [...(dropped > 0 ? [logLinesDropped(dropped)] : []), ...lines].join('\n');
    return state === 'failed'
      ? context.out.error(message, keptLines)
      : context.out.warn(message, keptLines);
  };
  // Core closes the region for the action's return, a failure, or cancellation.
  // The line draws its closing frame inside the abort, so that frame is the region's last.
  region.signal.addEventListener(
    'abort',
    () => {
      clearInterval(timer);
      if (line.state !== 'running') {
        return;
      }
      line.state = closedState[region.closedBy ?? 'completion'];
      book.close();
      if (line.state === 'failed' || line.state === 'cancelled') {
        void writeKept(line.state);
      }
      if (region.live) {
        void region.draw(frame(), progressLine);
      } else if (line.state !== 'cancelled') {
        void plainLine[line.state](line.label);
      }
    },
    { once: true },
  );
  const finish = async (state: EndState, message: string | undefined): Promise<void> => {
    if (line.state !== 'running') {
      return;
    }
    line.state = state;
    line.label = message ?? line.label;
    clearInterval(timer);
    book.close();
    // The kept lines, the end line, and the close are issued in one tick, in that order.
    // Core's queue keeps the order, so nothing another writer writes lands between them.
    const kept = state === 'failed' || state === 'warned' ? writeKept(state) : Promise.resolve();
    const ended = region.live ? region.draw(frame(), progressLine) : plainLine[state](line.label);
    const closed = region.end(state, message);
    await Promise.all([kept, ended, closed]);
  };
  return {
    // A cleared line ends as ended, but its last frame is the library's empty one, never the view's.
    async clear() {
      if (line.state !== 'running') {
        return;
      }
      line.state = 'ended';
      clearInterval(timer);
      book.close();
      if (region.live) {
        await region.draw('', controls);
      }
      await region.end('ended');
    },
    end: (message) => finish('ended', message),
    fail: (message) => finish('failed', message),
    // A string joins the log at once, and an iterable is read to its end.
    // Its text is discarded once the line has ended, and the line never stops an iterable, so a child writing into it never blocks.
    async log(text) {
      if (typeof text === 'string') {
        book.add(text);
        return;
      }
      const feed = book.open();
      try {
        for await (const chunk of text) {
          if (feed !== undefined) {
            book.write(feed, chunk);
          }
        }
      } finally {
        if (feed !== undefined) {
          book.end(feed);
        }
      }
    },
    skip: (message) => finish('skipped', message),
    async track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value> {
      const outcome = await settle(work);
      if ('error' in outcome) {
        if (line.state === 'running') {
          await finish('failed', trackedMessage(messages?.failed, outcome.error));
        }
        throw outcome.error;
      }
      if (line.state === 'running') {
        await finish('ended', trackedMessage(messages?.done, outcome.value));
      }
      return outcome.value;
    },
    update({ completed, label: nextLabel, total: nextTotal }) {
      if (line.state !== 'running') {
        return;
      }
      line.completed = completed ?? line.completed;
      if (completed !== undefined) {
        pace.report(Date.now(), completed);
      }
      line.total = nextTotal ?? line.total;
      line.label = nextLabel ?? line.label;
      region.report({
        ...(completed === undefined ? {} : { completed }),
        ...(nextLabel === undefined ? {} : { label: nextLabel }),
        ...(nextTotal === undefined ? {} : { total: nextTotal }),
      });
      if (region.live) {
        void region.draw(frame(), progressLine);
      }
    },
    warn: (message) => finish('warned', message),
  };
}

export { progress, progressStyle };
export type {
  Progress,
  ProgressContext,
  ProgressSettings,
  ProgressStyleSettings,
  ProgressUpdate,
  Spinner,
  TrackMessages,
};
