import { extension, plugin, readExtension } from '@loomcli/core';
import type {
  ActionContext,
  Out,
  Plugin,
  Region,
  RegionCloser,
  StandardSchemaV1,
} from '@loomcli/core';

import { progressLine } from './views.js';
import type { ProgressLine } from './views.js';

/** A spinner in the shape of a cli-spinners entry: frames drawn in turn, one each interval. */
interface Spinner {
  readonly frames: readonly string[];
  /** Milliseconds between frames. */
  readonly interval: number;
}

interface ProgressSettings {
  readonly label: string;
  /** A bar with counts; without it, a spinner. */
  readonly total?: number;
  /** This line's own spinner, over the application's style. */
  readonly spinner?: Spinner;
}

interface ProgressUpdate {
  readonly completed?: number;
  readonly total?: number;
  readonly label?: string;
}

interface TrackMessages<Value> {
  readonly done?: string | ((value: Value) => string);
  readonly failed?: string | ((error: unknown) => string);
}

/** The handle `progress()` returns for one line. */
interface Progress {
  update(update: ProgressUpdate): void;
  end(message?: string): Promise<void>;
  fail(message?: string): Promise<void>;
  track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value>;
}

/** What `progress()` reads: an action's, a middleware's, or a configuration source's context. */
type ProgressContext = Pick<ActionContext<unknown>, 'graph'> & {
  readonly out: Pick<Out, 'region' | 'info' | 'success' | 'error'>;
};

interface ProgressStyleSettings {
  readonly spinner?: Spinner;
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
const closedState: Readonly<Record<RegionCloser, ProgressLine['state']>> = {
  cancellation: 'cancelled',
  completion: 'ended',
  end: 'ended',
  failure: 'failed',
};

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
 * line as the region's last frame. A line whose region closed as it opened draws nothing, writes
 * nothing, and runs no timer. Off a terminal it writes one start line through `info` and one
 * end line through `success` or `error`. It reports at its start, at each update, and at its close.
 */
function progress(context: ProgressContext, settings: ProgressSettings): Progress {
  const { label, total } = settings;
  const own = settings.spinner;
  const style = readExtension(context.graph.root, progressStyleExtension);
  const spinner = own ?? style?.spinner ?? defaultSpinner;
  const bar = style?.bar ?? defaultBar;
  const region: Region = context.out.region();
  const started = Date.now();
  const line: LineState = {
    completed: total === undefined ? undefined : 0,
    label,
    state: 'running',
    tick: 0,
    total,
  };
  const frame = (): ProgressLine => ({
    bar,
    completed: line.completed,
    elapsed: Date.now() - started,
    frame: spinner.frames[line.tick % spinner.frames.length] ?? '',
    label: line.label,
    state: line.state,
    total: line.total,
  });
  region.report(total === undefined ? { label } : { completed: 0, label, total });
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  if (region.closedBy !== undefined) {
    // A region opened after the run's cancellation closed as it opened, so the line starts closed.
    line.state = closedState[region.closedBy];
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
      if (region.live) {
        void region.draw(frame(), progressLine);
      } else if (line.state === 'ended') {
        void context.out.success(line.label);
      } else if (line.state === 'failed') {
        void context.out.error(line.label);
      }
    },
    { once: true },
  );
  const finish = async (state: 'ended' | 'failed', message: string | undefined): Promise<void> => {
    if (line.state !== 'running') {
      return;
    }
    line.state = state;
    line.label = message ?? line.label;
    clearInterval(timer);
    if (region.live) {
      await region.draw(frame(), progressLine);
    } else if (state === 'ended') {
      await context.out.success(line.label);
    } else {
      await context.out.error(line.label);
    }
    await region.end(state, message);
  };
  return {
    end: (message) => finish('ended', message),
    fail: (message) => finish('failed', message),
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
