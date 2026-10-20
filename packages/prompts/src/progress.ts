import { DeclarationError, diagnosticRule, extension, plugin, readExtension } from '@loomcli/core';
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

const progressRule = diagnosticRule('@loomcli/prompts/progress', {
  explanation:
    'A progress line takes a string label, counts that are finite numbers of 0 or more, and a spinner whose frames are strings drawn every interval milliseconds. Its style takes the same spinner and a bar whose cells are nonempty strings.',
  headline: 'Invalid progress line',
});

/** A malformed progress setting is an authoring fault at its call. */
function invalid(sentence: string, correction: string): never {
  throw new DeclarationError(progressRule, { correction, sentence });
}

/** Cli-spinners' `circleHalves`, every 80 milliseconds. */
const defaultSpinner: Spinner = Object.freeze({
  frames: Object.freeze(['◐', '◓', '◑', '◒']),
  interval: 80,
});
const defaultBar = Object.freeze({ complete: '▰', incomplete: '▱' });

/** Whether a value is an object that may hold settings. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** A label, an update's label, or an end message, which is a marked string. */
function checkLabel(label: unknown): string {
  if (typeof label !== 'string') {
    invalid('The progress line received a label that is not a string.', 'Supply a string label.');
  }
  return label;
}

/** A `total` or `completed`, which is a finite number of 0 or more when it is given. */
function checkCount(
  label: string,
  name: 'total' | 'completed',
  value: unknown,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalid(
      `The progress line "${label}" received a ${name} that is not a finite number of 0 or more.`,
      'Supply a finite number of 0 or more.',
    );
  }
  return value;
}

/** A spinner's frames and interval, copied as plain data. */
function checkSpinner(spinner: unknown): Spinner {
  const frames: unknown = isRecord(spinner) ? spinner.frames : undefined;
  if (!Array.isArray(frames) || frames.length === 0) {
    invalid('The progress spinner has no frames.', 'Supply at least one frame.');
  }
  const checked = frames.map((frame: unknown, index) => {
    if (typeof frame !== 'string') {
      invalid(
        `The progress spinner frame ${String(index + 1)} is not a string.`,
        'Supply each frame as a string.',
      );
    }
    return frame;
  });
  const interval: unknown = isRecord(spinner) ? spinner.interval : undefined;
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) {
    invalid(
      'The progress spinner interval is not a finite number above 0.',
      'Supply the milliseconds between frames.',
    );
  }
  return { frames: checked, interval };
}

/** A bar's two cells, copied as plain data. */
function checkBar(bar: unknown): { complete: string; incomplete: string } {
  const cells = isRecord(bar) ? bar : {};
  for (const cell of ['complete', 'incomplete'] as const) {
    const text = cells[cell];
    if (typeof text !== 'string' || text === '') {
      invalid(
        `The progress bar's ${cell} cell is not a nonempty string.`,
        'Supply the text of one cell.',
      );
    }
  }
  return { complete: String(cells.complete), incomplete: String(cells.incomplete) };
}

/** The style one application sets, as plain data the root Command carries. */
interface StoredStyle {
  readonly spinner?: Spinner;
  readonly bar?: { readonly complete: string; readonly incomplete: string };
}

/** One application's style settings, checked and copied as plain data. */
function readStyle(settings: unknown): StoredStyle {
  if (settings !== undefined && !isRecord(settings)) {
    invalid(
      'The progress style received settings that are not an object.',
      'Supply an object, such as { spinner }.',
    );
  }
  return {
    ...(settings?.spinner === undefined ? {} : { spinner: checkSpinner(settings.spinner) }),
    ...(settings?.bar === undefined ? {} : { bar: checkBar(settings.bar) }),
  };
}

/** The extension's schema, which reads the style the way `progressStyle()` checked it. */
const storedStyle: StandardSchemaV1<StoredStyle, StoredStyle> = {
  '~standard': {
    validate: (value) => ({ value: readStyle(value) }),
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
 * cli-spinners shape and the bar's cells. Each setting is checked at the call, and each it omits
 * keeps the library's default.
 */
function progressStyle(settings?: ProgressStyleSettings): Plugin {
  const style = readStyle(settings);
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

/** A `done` or `failed` message, which is a string or a function when it is given. */
function checkMessage(label: string, name: 'done' | 'failed', message: unknown): void {
  if (message !== undefined && typeof message !== 'string' && typeof message !== 'function') {
    invalid(
      `The progress line "${label}" received a ${name} message that is neither a string nor a function.`,
      'Supply a string, or a function that returns one.',
    );
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
  const given: unknown = settings;
  const record = isRecord(given) ? given : {};
  const label = checkLabel(record.label);
  const total = checkCount(label, 'total', record.total);
  const own = record.spinner === undefined ? undefined : checkSpinner(record.spinner);
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
    await region.end(state);
  };
  return {
    end: (message) => finish('ended', message === undefined ? undefined : checkLabel(message)),
    fail: (message) => finish('failed', message === undefined ? undefined : checkLabel(message)),
    async track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value> {
      checkMessage(line.label, 'done', messages?.done);
      checkMessage(line.label, 'failed', messages?.failed);
      const outcome = await settle(work);
      if ('error' in outcome) {
        if (line.state === 'running') {
          const failed = trackedMessage(messages?.failed, outcome.error);
          await finish('failed', failed === undefined ? undefined : checkLabel(failed));
        }
        throw outcome.error;
      }
      if (line.state === 'running') {
        const done = trackedMessage(messages?.done, outcome.value);
        await finish('ended', done === undefined ? undefined : checkLabel(done));
      }
      return outcome.value;
    },
    update(update) {
      const changes: unknown = update;
      if (!isRecord(changes)) {
        invalid(
          `The progress line "${line.label}" received an update that is not an object.`,
          'Supply an object, such as { completed: 3 }.',
        );
      }
      const completed = checkCount(line.label, 'completed', changes.completed);
      const nextTotal = checkCount(line.label, 'total', changes.total);
      const nextLabel = changes.label === undefined ? undefined : checkLabel(changes.label);
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
