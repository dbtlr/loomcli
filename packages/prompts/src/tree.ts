/*
 * A progress line and the tasks under it, under ADR-0091, ADR-0170, ADR-0172, and ADR-0173. Every
 * line, a root `progress()` opened or a task `task()` opened, is one `Line`. A root's region draws
 * the whole tree as one frame through the progress view, on the root's frame timer. Each task opens
 * a region of its own through its root's context, for its reports and its end, and never draws in
 * it, so the task takes no rows and core closes a tree's regions together. Where the root's region
 * is not live, each line writes its plain start and end lines when they happen, a task's indented.
 */
import { glyph } from '@loomcli/core';
import type { Region, RegionCloser, View, ViewContext } from '@loomcli/core';

import { controls } from './controls.js';
import { estimate } from './estimate.js';
import type { Estimate } from './estimate.js';
import { placeTree } from './height.js';
import type { Grove, Seat } from './height.js';
import { keptLinesAt, ProgressLog } from './log.js';
import { logLinesDropped } from './messages.js';
import type {
  Progress,
  ProgressContext,
  ProgressSettings,
  Spinner,
  TrackMessages,
} from './progress.js';
import { progressLine } from './views.js';
import type { ProgressLine } from './views.js';

/** The state a line takes when core closes its root's region. */
const closedState: Readonly<Record<RegionCloser, 'ended' | 'failed' | 'cancelled'>> = {
  cancellation: 'cancelled',
  completion: 'ended',
  end: 'ended',
  failure: 'failed',
};

/** The state a line's own end takes, each of which draws its own end line. */
type EndState = Exclude<ProgressLine['state'], 'running' | 'cancelled'>;

/** The state a line ends in: its own end, or one core's close gives it. */
type Finish = Exclude<ProgressLine['state'], 'running'>;

/** The rows a running line shows of its log when its settings name no count. */
const LOG_ROWS = 5;
/** The lines a line keeps of its log to write when it fails when its settings name no count. */
const LOG_LIMIT = 1000;

/** The glyph and style token a plain line's lane marks it with. */
type Mark = 'error' | 'info' | 'success' | 'warning';

/**
 * The message laid out right of a gutter `width` columns wide, as core's lane views lay it out: on a
 * terminal its tabs expand first, and it wraps at the columns right of the gutter, each
 * continuation line indented under the message. Off a terminal it is unchanged.
 */
function underGutter(message: string, context: ViewContext, width: number): string {
  const gutter = ' '.repeat(width);
  const room = context.columns === undefined ? 0 : context.columns - width;
  const laid = context.columns === undefined ? message : context.expandTabs(message);
  const wrapped = room > 0 ? context.wrap(laid, room) : laid;
  return wrapped.replace(/(?<newline>\r?\n)(?!$)/gu, `$<newline>${gutter}`);
}

/**
 * The view a task's plain line draws through: the lane's default look, its glyph in the lane's
 * token, one space, and the text, after two columns for each level of the task's depth, its
 * continuation rows indented with it.
 */
function plainLane(mark: Mark, depth: number): View<string> {
  const indent = '  '.repeat(depth);
  return {
    render: (message, context) => {
      const glyphText = glyph[mark];
      const body = underGutter(message, context, indent.length + context.width(glyphText) + 1);
      return `${indent}${context.style[mark](glyphText)} ${body}`;
    },
  };
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

/**
 * Reads `text` into a log: a string joins at once, and an iterable is read to its end. Its text is
 * discarded once the log has closed, and the log never stops an iterable, so a child writing into it
 * never blocks.
 */
async function readInto(book: ProgressLog, text: string | AsyncIterable<string>): Promise<void> {
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
}

/** How a tree looks and draws, which every line of it reads from its root. */
interface Look {
  /** The spinner a line draws: its own, or else the application's style, or else the default. */
  readonly spinner: (own: Spinner | undefined) => Spinner;
  /** The cells every bar of the tree draws. */
  readonly bar: { readonly complete: string; readonly incomplete: string };
}

/** What every line of one tree shares: its root's context and look, and how the tree draws. */
interface Tree {
  readonly context: ProgressContext;
  readonly look: Look;
  /** Whether the tree draws: its root's region is live. */
  live: boolean;
  /** The tree's place among the trees that share the terminal's height, while it draws. */
  grove: Grove | undefined;
  /** The root's frame timer, while the tree draws. */
  timer: ReturnType<typeof setInterval> | undefined;
  /** How many of the tree's lines have finished, which orders its finished rows. */
  finishes: number;
}

/** One progress line: a tree's root, or a task under a line of it. */
class Line {
  readonly tree: Tree;
  readonly parent: Line | undefined;
  readonly depth: number;
  readonly region: Region;
  readonly settings: ProgressSettings;
  readonly spinner: Spinner;
  /** The line's log, which a line that ends as a success or a skip lets go at its end. */
  book: ProgressLog;
  // The rate and time left read the reports and the clock the elapsed time reads, and no timer.
  readonly pace: Estimate = estimate();
  readonly started = Date.now();
  state: ProgressLine['state'] = 'running';
  label: string;
  completed: number | undefined;
  total: number | undefined;
  tick = 0;
  /** The tasks under the line that its tree still shows, in the order they opened. */
  tasks: Line[] = [];
  /** The line's own data, frozen at its end, so its end line reads the same at every later frame. */
  ended: ProgressLine | undefined = undefined;
  /** Where the line finished among its tree's lines, so the first to finish gives way first. */
  finished = 0;
  /** The line's place among the open lines that share the terminal's height, while it runs live. */
  place: Seat | undefined = undefined;
  /** The log rows the line draws at the frame its tree builds. */
  rows: readonly string[] = [];

  constructor(tree: Tree, parent: Line | undefined, settings: ProgressSettings) {
    this.tree = tree;
    this.parent = parent;
    this.depth = parent === undefined ? 0 : parent.depth + 1;
    this.settings = settings;
    this.spinner = tree.look.spinner(settings.spinner);
    this.book = new ProgressLog(settings.logRows ?? LOG_ROWS, settings.logLimit ?? LOG_LIMIT);
    this.label = settings.label;
    this.total = settings.total;
    this.completed = settings.total === undefined ? undefined : 0;
    this.region = tree.context.out.region();
    this.region.report(
      settings.total === undefined
        ? { label: settings.label }
        : { completed: 0, label: settings.label, total: settings.total },
    );
  }

  /** The line's own data at `now`, without its depth and tasks: its frozen data once it has ended. */
  own(now: number): ProgressLine {
    if (this.ended !== undefined) {
      return this.ended;
    }
    return {
      bar: this.tree.look.bar,
      completed: this.completed,
      elapsed: now - this.started,
      estimate: this.settings.estimate ?? false,
      frame: this.spinner.frames[this.tick % this.spinner.frames.length] ?? '',
      label: this.label,
      log: this.state === 'running' ? this.rows : [],
      rate: this.pace.rate(),
      remaining: this.pace.remaining(this.total, now),
      state: this.state,
      total: this.total,
      unit: this.settings.unit,
    };
  }

  /** The line's end data with no tasks, as its end line draws on its own. */
  alone(): ProgressLine {
    return { ...this.own(Date.now()), depth: this.depth, tasks: [] };
  }

  /**
   * Ends the line in `state`: it leaves the lines that share, its log closes, and its data freezes,
   * its end line's elapsed time, rate, and time left with it.
   */
  freeze(state: Finish): void {
    this.state = state;
    this.place?.leave();
    this.place = undefined;
    this.book.close();
    if (state === 'ended' || state === 'skipped') {
      // A success or a skip writes no kept line, so the finished line holds none while it shows.
      this.book = new ProgressLog(0, 0);
      this.book.close();
    }
    this.tree.finishes += 1;
    this.finished = this.tree.finishes;
    this.ended = this.own(Date.now());
  }

  /** A group that ends as a success or a skip lets its tasks go, unless its `keepTasks` keeps them. */
  settle(): void {
    if ((this.state === 'ended' || this.state === 'skipped') && this.settings.keepTasks !== true) {
      this.tasks = [];
    }
  }

  /** The line's kept log lines as one message above its end line, through the lane of its level. */
  writeKept(state: 'failed' | 'warned' | 'cancelled'): Promise<void> {
    const { dropped, lines } = this.book.kept();
    if (lines.length === 0) {
      return Promise.resolve();
    }
    const message = [...(dropped > 0 ? [logLinesDropped(dropped)] : []), ...lines].join('\n');
    const view = keptLinesAt(this.depth);
    const { out } = this.tree.context;
    return state === 'failed' ? out.error(message, view) : out.warn(message, view);
  }

  /** One plain line through the lane of `mark`, a root's through the lane view and a task's indented. */
  writePlain(mark: Mark, text: string): Promise<void> {
    const { out } = this.tree.context;
    const view = this.depth === 0 ? undefined : plainLane(mark, this.depth);
    const lanes: Readonly<Record<Mark, () => Promise<void>>> = {
      error: () => out.error(text, view),
      info: () => out.info(text, view),
      success: () => out.success(text, view),
      warning: () => out.warn(text, view),
    };
    return lanes[mark]();
  }

  /**
   * Where the line does not draw, the lines its end writes: its kept lines when it failed, warned,
   * or was cancelled, then its end line through the lane of its level, except for a cancelled line.
   */
  writeEnd(): Promise<void>[] {
    const { label, state } = this;
    const writes: Readonly<Record<ProgressLine['state'], () => Promise<void>[]>> = {
      cancelled: () => [this.writeKept('cancelled')],
      ended: () => [this.writePlain('success', label)],
      failed: () => [this.writeKept('failed'), this.writePlain('error', label)],
      running: () => [],
      skipped: () => [this.writePlain('info', label)],
      warned: () => [this.writeKept('warned'), this.writePlain('warning', label)],
    };
    return writes[state]();
  }
}

/** Every line of a tree, the root first and each line followed by its tasks in opening order. */
function preorder(line: Line): Line[] {
  return [line, ...line.tasks.flatMap((task) => preorder(task))];
}

/** The finished tasks a tree shows under `line`: every ended task it still holds, at any depth. */
function finishedUnder(line: Line): Line[] {
  return line.tasks.flatMap((task) => [
    ...(task.state === 'running' ? [] : [task]),
    ...finishedUnder(task),
  ]);
}

/** A line's data with the tasks under it that show, `shown` naming the finished ones that do. */
function shownData(line: Line, shown: ReadonlySet<Line>, now: number): ProgressLine {
  return {
    ...line.own(now),
    depth: line.depth,
    tasks: line.tasks
      .filter((task) => task.state === 'running' || shown.has(task))
      .map((task) => shownData(task, shown, now)),
  };
}

/**
 * The tree's frame while its root runs: each running line's log rows fitted to its share of the
 * terminal's height, in opening order, then the newest finished rows the tree's share leaves.
 */
function treeFrame(root: Line): ProgressLine {
  for (const line of preorder(root)) {
    if (line.state === 'running') {
      const rows = line.book.rows();
      const count = line.place === undefined ? rows.length : line.place.fit(rows.length);
      line.rows = count === 0 ? [] : rows.slice(-count);
    }
  }
  const finished = finishedUnder(root);
  const allowed = root.tree.grove?.fit(finished.length) ?? finished.length;
  const newest = [...finished];
  newest.sort((left, right) => right.finished - left.finished);
  return shownData(root, new Set(newest.slice(0, allowed)), Date.now());
}

/** The root of a line's tree. */
function rootOf(line: Line): Line {
  return line.parent === undefined ? line : rootOf(line.parent);
}

/** Draws the tree's next frame through its root's region, while its root runs live. */
function drawTree(line: Line): Promise<void> {
  const root = rootOf(line);
  if (!root.tree.live || root.state !== 'running') {
    return Promise.resolve();
  }
  return root.region.draw(treeFrame(root), progressLine);
}

/**
 * Ends every open task under `line` in `state`, each task's own open tasks before it and siblings
 * in opening order, so every task's end event comes before its parent's. Each takes its own label.
 * A task keeps its kept lines while its tree draws, and writes its plain lines where it does not.
 * Under core's close, `own` is false: core closes each task's region after the root's and builds
 * each end event.
 */
function endTasks(line: Line, state: Finish, own: boolean): Promise<unknown>[] {
  const pending: Promise<unknown>[] = [];
  for (const task of line.tasks) {
    if (task.state !== 'running') {
      continue;
    }
    pending.push(...endTasks(task, state, own));
    task.freeze(state);
    task.settle();
    if (!task.tree.live) {
      pending.push(...task.writeEnd());
    }
    if (own && state !== 'cancelled') {
      pending.push(task.region.end(state));
    }
  }
  return pending;
}

/** Clears every open task under `line`, each task's own open tasks before it. */
function clearTasks(line: Line): Promise<unknown>[] {
  const pending: Promise<unknown>[] = [];
  for (const task of line.tasks) {
    if (task.state === 'running') {
      pending.push(...clearTasks(task));
      task.freeze('ended');
      pending.push(task.region.end('ended'));
    }
    task.tasks = [];
  }
  return pending;
}

/**
 * The end of a root whose tasks stay: an empty last frame, then the tree written above the stack,
 * one line at a time from the root down, each line's kept lines above its end line, which draws
 * through `out.draw` and the progress view, followed by one line break.
 */
function writeTree(root: Line): Promise<unknown>[] {
  const { out } = root.tree.context;
  const writes: Promise<unknown>[] = [root.region.draw('', controls)];
  for (const line of preorder(root)) {
    if (line.state === 'failed' || line.state === 'warned' || line.state === 'cancelled') {
      writes.push(line.writeKept(line.state));
    }
    writes.push(out.draw(line.alone(), progressLine), out.draw('\n', controls));
  }
  return writes;
}

/**
 * The last of a root that draws: the tree written when tasks stay under it, and otherwise its kept
 * lines above its end line, its last frame.
 */
function endRoot(root: Line): Promise<unknown>[] {
  const { tree } = root;
  clearInterval(tree.timer);
  tree.grove?.leave();
  tree.grove = undefined;
  if (root.tasks.length > 0) {
    return writeTree(root);
  }
  const kept =
    root.state === 'failed' || root.state === 'warned' || root.state === 'cancelled'
      ? [root.writeKept(root.state)]
      : [];
  return [...kept, root.region.draw(root.alone(), progressLine)];
}

/** Ends `line` by its own `end`, `fail`, `skip`, `warn`, or `track`, its open tasks taking the end. */
async function finish(line: Line, state: EndState, message: string | undefined): Promise<void> {
  if (line.state !== 'running') {
    return;
  }
  // The tasks' ends, the kept lines, the end line, and the close are issued in one tick, in order.
  // Core's queue keeps the order, so nothing another writer writes lands between them.
  const pending = endTasks(line, state, true);
  line.label = message ?? line.label;
  line.freeze(state);
  line.settle();
  if (!line.tree.live) {
    pending.push(...line.writeEnd());
  } else if (line.parent === undefined) {
    pending.push(...endRoot(line));
  } else {
    pending.push(drawTree(line));
  }
  pending.push(line.region.end(state, message));
  await Promise.all(pending);
}

/** Ends `line` and removes it with its tasks, which take the clear. */
async function clear(line: Line): Promise<void> {
  if (line.state !== 'running') {
    return;
  }
  const pending = clearTasks(line);
  line.freeze('ended');
  line.tasks = [];
  const { parent, tree } = line;
  if (parent === undefined) {
    clearInterval(tree.timer);
    tree.grove?.leave();
    tree.grove = undefined;
    if (tree.live) {
      // A cleared root's last frame is the library's empty one, never the view's.
      pending.push(line.region.draw('', controls));
    }
  } else {
    parent.tasks = parent.tasks.filter((task) => task !== line);
    pending.push(drawTree(line));
  }
  pending.push(line.region.end('ended'));
  await Promise.all(pending);
}

/**
 * Core closes the root's region for its opener's completion, a failure, or cancellation. The tree
 * ends there, as if its root ended that way, and draws and writes its end inside the abort, so that
 * is the region's last frame and comes before core's failure report. Core closes each task's region
 * after it and builds each end event.
 */
function closeRoot(root: Line): void {
  clearInterval(root.tree.timer);
  if (root.state !== 'running') {
    return;
  }
  const state = closedState[root.region.closedBy ?? 'completion'];
  const pending = endTasks(root, state, false);
  root.freeze(state);
  root.settle();
  if (root.tree.live) {
    pending.push(...endRoot(root));
  } else {
    pending.push(...root.writeEnd());
  }
  void Promise.all(pending);
}

/** The handle of a task opened on a line that had ended: it has ended too, and does nothing. */
function endedHandle(): Progress {
  const book = new ProgressLog(0, 0);
  book.close();
  return {
    clear: () => Promise.resolve(),
    end: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    log: (text) => readInto(book, text),
    skip: () => Promise.resolve(),
    task: () => endedHandle(),
    async track<Value>(work: PromiseLike<Value>): Promise<Value> {
      const outcome = await settle(work);
      if ('error' in outcome) {
        throw outcome.error;
      }
      return outcome.value;
    },
    update: () => undefined,
    warn: () => Promise.resolve(),
  };
}

/** The handle of one line, which its author holds. */
function handleOf(line: Line): Progress {
  return {
    clear: () => clear(line),
    end: (message) => finish(line, 'ended', message),
    fail: (message) => finish(line, 'failed', message),
    log: (text) => readInto(line.book, text),
    skip: (message) => finish(line, 'skipped', message),
    task: (settings) => (line.state === 'running' ? openTask(line, settings) : endedHandle()),
    async track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value> {
      const outcome = await settle(work);
      if ('error' in outcome) {
        await finish(line, 'failed', trackedMessage(messages?.failed, outcome.error));
        throw outcome.error;
      }
      await finish(line, 'ended', trackedMessage(messages?.done, outcome.value));
      return outcome.value;
    },
    update({ completed, label, total }) {
      if (line.state !== 'running') {
        return;
      }
      line.completed = completed ?? line.completed;
      if (completed !== undefined) {
        line.pace.report(Date.now(), completed);
      }
      line.total = total ?? line.total;
      line.label = label ?? line.label;
      line.region.report({
        ...(completed === undefined ? {} : { completed }),
        ...(label === undefined ? {} : { label }),
        ...(total === undefined ? {} : { total }),
      });
      void drawTree(line);
    },
    warn: (message) => finish(line, 'warned', message),
  };
}

/** Opens a task under a running line, which draws in its tree or writes its plain start line. */
function openTask(parent: Line, settings: ProgressSettings): Progress {
  const { tree } = parent;
  const task = new Line(tree, parent, settings);
  if (task.region.closedBy !== undefined) {
    // A region opened after the run's cancellation closed as it opened, so the task starts closed.
    task.freeze(closedState[task.region.closedBy]);
    return handleOf(task);
  }
  // A task joins its parent's tasks whether or not the tree draws, so it takes its parent's end.
  parent.tasks.push(task);
  if (tree.live) {
    task.place = tree.grove?.seat(() => task.book.rows().length);
    void drawTree(task);
  } else {
    void task.writePlain('info', task.label);
  }
  return handleOf(task);
}

/**
 * Opens a root line in its own live region: it draws the tree on its unref'd frame timer, which it
 * clears when the region's signal aborts, and draws or writes its end there when core closes it. A
 * root whose region closed as it opened draws nothing, writes nothing, and runs no timer. Off a
 * terminal it writes its plain start line.
 */
function openRoot(context: ProgressContext, look: Look, settings: ProgressSettings): Progress {
  const tree: Tree = {
    context,
    finishes: 0,
    grove: undefined,
    live: false,
    look,
    timer: undefined,
  };
  const root = new Line(tree, undefined, settings);
  const { region } = root;
  if (region.closedBy !== undefined) {
    // A region opened after the run's cancellation closed as it opened, so the line starts closed.
    root.freeze(closedState[region.closedBy]);
    return handleOf(root);
  }
  if (region.live) {
    tree.live = true;
    const stderr = context.host?.terminal.stderr;
    if (stderr !== undefined) {
      tree.grove = placeTree(stderr, {
        need: () => finishedUnder(root).length,
        redraw: () => {
          void drawTree(root);
        },
      });
      root.place = tree.grove.seat(() => root.book.rows().length);
    }
    void drawTree(root);
    tree.timer = setInterval(() => {
      for (const line of preorder(root)) {
        if (line.state === 'running') {
          line.tick += 1;
        }
      }
      void drawTree(root);
    }, root.spinner.interval);
    tree.timer.unref();
  } else {
    void root.writePlain('info', root.label);
  }
  region.signal.addEventListener(
    'abort',
    () => {
      closeRoot(root);
    },
    { once: true },
  );
  return handleOf(root);
}

export { openRoot };
export type { Look };
