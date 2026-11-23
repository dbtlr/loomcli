import { extension, plugin, readExtension } from '@loomcli/core';
import type { ActionContext, Out, OutputTerminal, Plugin, StandardSchemaV1 } from '@loomcli/core';

import { openRoot } from './tree.js';

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
 * optional spinner of its own, whether it shows its rate and time left, how much of its log it
 * shows and keeps, and whether its tasks stay when it succeeds.
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
   * How many of the log's newest lines the running line shows under it at most, a whole number
   * of 0 or more, and fewer when the terminal's height leaves the line less. Absent, 5.
   */
  readonly logRows?: number;
  /**
   * How many of the log's newest lines the line keeps to write above its end line when it fails,
   * warns, or is cancelled, a whole number of 0 or more. Absent, 1000.
   */
  readonly logLimit?: number;
  /**
   * Whether the line's tasks stay under it when it ends as a success or a skip, as they stay when
   * it fails, warns, or is cancelled. Absent, false: its tasks go and its own end line stays.
   * A task's own tasks follow the task's setting, not this one.
   */
  readonly keepTasks?: boolean;
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
 * The handle `progress()` returns for one line, and `task()` for one task.
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
   * its newest lines show under it, dim, and `end`, `skip`, and `clear` remove them. `fail`,
   * `warn`, and a cancellation keep them to write above the end line. A root writes them at its
   * end. A task whose tree draws holds them and writes them with its tree when the tree's tasks
   * stay, so they go when a group above the task succeeds or the task is cleared. A task whose
   * tree does not draw writes them at its own end, and they stay. Resolves at once for a string,
   * and for an iterable once it ends, or rejects with what it threw.
   */
  log(text: string | AsyncIterable<string>): Promise<void>;
  /**
   * Opens a task under this line: a progress line with a handle of its own, drawn indented under
   * this line, after the tasks that opened before it. A task still open when this line ends
   * takes this line's end. When this line ends as a success or a skip its tasks go, unless its
   * `keepTasks` keeps them, and when it fails, warns, or is cancelled they stay under it. Once
   * this line has ended, the task returned has ended too.
   */
  task(settings: ProgressSettings): Progress;
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
   * Ends the line and removes it, with its tasks. Where the line draws, it leaves nothing, except
   * a frame drawn before the terminal was lent, which stays where it was drawn. Where the line
   * does not draw, it writes nothing after the start line, which stays.
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
  /**
   * The run's output: `region` for each line and task, the lanes for plain lines and kept log
   * lines, and `draw` for the end lines of a tree whose tasks stay.
   */
  readonly out: Pick<Out, 'region' | 'draw' | 'info' | 'success' | 'warn' | 'error'>;
  /**
   * The run's host, whose stderr's `rows` the line reads at each frame to share the terminal's
   * height with the run's other open lines. Absent, the line draws up to its `logRows`.
   */
  readonly host?: { readonly terminal: { readonly stderr: Pick<OutputTerminal, 'rows'> } };
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

/**
 * One progress line in a live region of its own: a spinner while the work has no total, and a bar
 * with counts once it has one. While the region is live the line animates on its own unref'd
 * timer, which it clears when the region's signal aborts, and draws its success, failure, or
 * cancelled line as the region's last frame, or its skipped or warned line. A cleared line draws an
 * empty last frame, so it leaves nothing. A line whose region closed as it opened draws nothing,
 * writes nothing, and runs no timer. Off a terminal it writes one start line through `info` and one
 * end line through `success`, `error`, `info` for a skipped line, or `warn`, and a cleared line
 * writes no end line. It reports at its start, at each update, and at its close. With `estimate`,
 * a running line also draws its rate and time left, computed from the counts its updates report
 * and the clock it reads for the elapsed time. Its `log()` adds lines, such as a child program's
 * output, whose newest rows show dim under the running line, as many as its share of the
 * terminal's height leaves it beside the run's other open lines; an end, a skip, or a clear removes
 * them, and a failure, a warning, or a cancellation writes the kept lines above the end line,
 * where the line draws and where it does not. Its `task()` opens a task under it, a line drawn
 * indented under it in one tree, which collapses when the group succeeds and stays when it fails.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { progress } from '@loomcli/prompts';
 *
 * export const deploy = new Command('deploy').action(async (context) => {
 *   const deploying = progress(context, { label: 'Deploying' });
 *   const building = deploying.task({ label: 'Building the image', total: 10 });
 *   for (let completed = 1; completed <= 10; completed += 1) {
 *     building.update({ completed });
 *   }
 *   await building.end('Built the image');
 *   await deploying.end('Deployed');
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress
 * @public
 */
function progress(context: ProgressContext, settings: ProgressSettings): Progress {
  const style = readExtension(context.graph.root, progressStyleExtension);
  return openRoot(
    context,
    {
      bar: style?.bar ?? defaultBar,
      spinner: (own) => own ?? style?.spinner ?? defaultSpinner,
    },
    settings,
  );
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
