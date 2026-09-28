import type { Writable } from 'node:stream';

import { reasonOf } from './errors.js';
import type { LoomError } from './errors.js';
import { nodeAt } from './inspect.js';
import type { CommandGraph, CommandNode } from './inspect.js';
import { reportPlainly } from './output.js';
import type { Output } from './output.js';
import { pluginSentence } from './plugin.js';
import type { BuiltPlugin } from './plugin.js';
import type { ContextualStyle } from './style.js';
import { ignoreRejection, isThenable } from './thenable.js';
import { describeFailure } from './view.js';
import type { FailureReport, FailureViewContext, ViewRegistry } from './view.js';

/**
 * What one `onFailure` hook reads beside the failure. `application` and `path` are the values the
 * failure view reads, and `style` is the contextual style for stderr, so a hook escapes text the
 * operator typed. `graph` is the frozen graph `inspect()` returns for the run, and `command` is the
 * node at `path` inside it; reading either builds the run's graph once.
 */
interface FailureHookContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly style: ContextualStyle;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
}

/**
 * A plugin's `onFailure` hook: a synchronous function that returns one hint, a list of hints, or
 * nothing for a failure `run()` renders after graph build. It cannot change the failure.
 */
type FailureHook = (
  failure: Readonly<LoomError>,
  context: FailureHookContext,
) => string | readonly string[] | undefined;

/** What the hooks can read once the graph has built: the installed plugins and the run's graph. */
interface BuiltRun {
  plugins: readonly BuiltPlugin[];
  inspected: () => CommandGraph;
}

/**
 * Where one failure happened, filled where `run()` catches it. `built` is absent for a failure
 * raised at or before graph build, which no hook runs for, because no valid graph exists.
 */
interface FailureScene {
  application: string;
  path: readonly string[];
  built: BuiltRun | undefined;
}

/** Where one failure report is written, and the registry its view resolves through. */
interface FailureSink {
  output: Output;
  registry: ViewRegistry;
  stderr: Writable;
}

/** What one hook answered: its hints, or why it broke. */
type HookAnswer = { kind: 'hints'; hints: readonly string[] } | { kind: 'broken'; reason: string };

/** The string one index of a returned list holds, read once, or `undefined` for a hole or a non-string. */
function heldString(listed: readonly unknown[], index: number): string | undefined {
  if (!Object.hasOwn(listed, index)) {
    return undefined;
  }
  const held = listed[index];
  return typeof held === 'string' ? held : undefined;
}

/** The first `length` strings a list holds, copied into a frozen array, or `undefined` at a gap. */
function copiedHints(listed: readonly unknown[], length: number): readonly string[] | undefined {
  const hints: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const hint = heldString(listed, index);
    if (hint === undefined) {
      return undefined;
    }
    hints.push(hint);
  }
  return Object.freeze(hints);
}

/**
 * Every hint a returned list holds, copied by index into a fresh frozen array, or `undefined` for a
 * value that is not a list of strings alone. The copy calls no method on the returned value, so an
 * array subclass or a proxy cannot answer a list other than the one it holds. A hole is not a hint.
 * The length is read once, so a getter cannot grow the list while it is copied.
 */
function listedHints(returned: unknown): readonly string[] | undefined {
  if (!Array.isArray(returned)) {
    return undefined;
  }
  const listed: readonly unknown[] = returned;
  // A proxy answers its own length, so a length no array can hold is not a list.
  const { length } = listed;
  if (!Number.isSafeInteger(length) || length < 0) {
    return undefined;
  }
  return copiedHints(listed, length);
}

/**
 * The hints one returned value holds. A hook is synchronous, so a returned promise is a broken
 * answer: it receives a rejection handler and is otherwise ignored, as a failure view's is.
 */
function readHints(returned: unknown): HookAnswer {
  if (returned === undefined) {
    return { hints: [], kind: 'hints' };
  }
  if (typeof returned === 'string') {
    return { hints: [returned], kind: 'hints' };
  }
  if (isThenable(returned)) {
    ignoreRejection(returned);
    return { kind: 'broken', reason: 'The hook returned a promise instead of hints.' };
  }
  const hints = listedHints(returned);
  return hints === undefined
    ? {
        kind: 'broken',
        reason: 'The hook returned a value that is not a string or an array of strings.',
      }
    : { hints, kind: 'hints' };
}

/** One hook's call, with a throw read as a broken answer. */
function callHook(hook: FailureHook, failure: LoomError, context: FailureHookContext): HookAnswer {
  try {
    return readHints(hook(failure, context));
  } catch (error) {
    return { kind: 'broken', reason: reasonOf(error) };
  }
}

/**
 * The context every hook for one failure shares. `graph` and `command` stay getters, so a run
 * whose hooks read neither builds no graph for them.
 */
function hookContext(
  scene: FailureScene & { built: BuiltRun },
  style: ContextualStyle,
): FailureHookContext {
  const { application, built, path } = scene;
  let command: CommandNode | undefined = undefined;
  return Object.freeze({
    application,
    get command() {
      command ??= nodeAt(built.inspected(), path);
      return command;
    },
    get graph() {
      return built.inspected();
    },
    path,
    style,
  });
}

/**
 * Every installed plugin's hints for one failure, in installation order, and one internal-error
 * line for each hook that broke. Each hook receives the failure and its context alone, so hints
 * accumulate and no hook sees another's.
 */
function collectHints(
  scene: FailureScene,
  failure: LoomError,
  style: ContextualStyle,
): { broken: readonly string[]; hints: readonly string[] } {
  const { built } = scene;
  if (built === undefined) {
    return { broken: [], hints: Object.freeze([]) };
  }
  const context = hookContext({ ...scene, built }, style);
  // Every hook runs here, in installation order, before any answer is read.
  const answers = built.plugins.flatMap(({ identity, onFailure }) =>
    onFailure === undefined ? [] : [{ answer: callHook(onFailure, failure, context), identity }],
  );
  const hints = answers.flatMap(({ answer }) => (answer.kind === 'hints' ? answer.hints : []));
  const broken = answers.flatMap(({ answer, identity }) =>
    answer.kind === 'broken'
      ? [`Internal error: ${pluginSentence(identity)} failed in onFailure: ${answer.reason}\n`]
      : [],
  );
  return { broken, hints: Object.freeze(hints) };
}

/**
 * What the plain fallback path writes after one failure's diagnostic: core's default text and the
 * view's own line when the view broke, then each broken hook's line.
 */
function plainLines(report: FailureReport, broken: readonly string[]): string {
  // `report.text` is core's default text, which already ends in `\n`.
  const fallback =
    report.kind === 'rendered'
      ? ''
      : `${report.text}Internal error: Rendering the failure failed: ${report.reason}\n`;
  return `${fallback}${broken.join('')}`;
}

/**
 * Reports one failure. The hooks run first, so the view receives their hints under the failure
 * view context. A view that breaks leaves core's default text without hints and its own line on the
 * plain fallback path, and each broken hook's line follows that whole diagnostic. It answers
 * whether a view or a hook broke, which forces the run's code to 1 outside a cancelled run.
 */
async function reportFailure(
  sink: FailureSink,
  failure: LoomError,
  scene: FailureScene,
): Promise<boolean> {
  const stderrContext = sink.output.context('stderr');
  const { broken, hints } = collectHints(scene, failure, stderrContext.style);
  const context: FailureViewContext = Object.freeze({
    ...stderrContext,
    application: scene.application,
    hints,
    path: scene.path,
  });
  const report = describeFailure(sink.registry, failure, context);
  if (report.kind === 'rendered') {
    // The view owns the trailing newline; output resolves its marked text.
    await sink.output.report(report.text);
  }
  const plain = plainLines(report, broken);
  if (plain !== '') {
    await reportPlainly(sink.stderr, plain);
  }
  return report.kind !== 'rendered' || broken.length > 0;
}

export type { BuiltRun, FailureHook, FailureHookContext, FailureScene };
export { reportFailure };
