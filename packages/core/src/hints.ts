import type { Writable } from 'node:stream';

import { developerPlainText, developerText } from './developer.js';
import type { DeveloperScene } from './developer.js';
import { genericDefectText, InternalError, isAuthorFault, reasonOf } from './errors.js';
import type { InvokedBy, LoomError } from './errors.js';
import { nodeAt } from './inspect.js';
import type { CommandGraph, CommandNode } from './inspect.js';
import { reportPlainly } from './output.js';
import type { Output } from './output.js';
import { pluginSentence } from './plugin.js';
import type { BuiltPlugin } from './plugin.js';
import {
  brokenDestination,
  brokenFailureHook,
  brokenFailureView,
  viewCorrection,
} from './rules.js';
import type { ContextualStyle } from './style.js';
import { ignoreRejection, isThenable } from './thenable.js';
import { describeFailure } from './view.js';
import type { FailureReport, FailureViewContext, ViewRegistry } from './view.js';

/**
 * What one `onFailure` hook reads beside the failure. `application`, `path`, and `invokedBy` are the
 * values the failure view reads, so a hook that points at a command line returns no hint for an
 * invocation by name, and `style` is the contextual style for stderr, so a hook escapes text the
 * operator typed. `graph` is the frozen graph `inspect()` returns for the run, and `command` is the
 * node at `path` inside it; reading either builds the run's graph once.
 */
interface FailureHookContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly invokedBy: InvokedBy;
  readonly style: ContextualStyle;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
}

/**
 * A plugin's `onFailure` hook: a synchronous function that returns one hint, a list of hints, or
 * nothing for a failure `run()` renders after graph build. It receives the failure typed read-only,
 * as a failure view does. Core does not freeze the failure, and it reads the exit code before any
 * hook runs, so a working hook cannot change the code.
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
 * Where one failure happened, filled where `run()` or `invoke()` catches it. `built` is absent for
 * a failure raised at or before graph build, which no hook runs for, because no valid graph exists.
 * `invokedBy` says how the run received its inputs.
 */
interface FailureScene {
  application: string;
  path: readonly string[];
  invokedBy: InvokedBy;
  built: BuiltRun | undefined;
}

/**
 * What one run's build decides about its reports. A development build shows the author a
 * Developer Diagnostic for every fault only the author can fix, each after the first report of the
 * run opening with one blank line; a distributed build shows the generic defect message at most
 * once per run.
 */
interface BuildReports {
  readonly development: boolean;
  /** Whether this run has written the generic defect message already. */
  generic: boolean;
  /** Whether this run has written a failure report already. */
  reported: boolean;
}

/** The generic defect message the first time a run writes it, and nothing after that. */
function genericOnce(build: BuildReports, application: string): string {
  if (build.generic) {
    return '';
  }
  build.generic = true;
  return genericDefectText(application);
}

/** Where one failure report is written, the registry its view resolves through, and the build. */
interface FailureSink {
  output: Output;
  registry: ViewRegistry;
  stderr: Writable;
  build: BuildReports;
}

/** What one hook answered: its hints, or why it broke and what it threw. */
type HookAnswer =
  | { kind: 'hints'; hints: readonly string[] }
  | { kind: 'broken'; reason: string; cause: unknown };

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
    return {
      cause: undefined,
      kind: 'broken',
      reason: 'The hook returned a promise instead of hints.',
    };
  }
  const hints = listedHints(returned);
  return hints === undefined
    ? {
        cause: undefined,
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
    return { cause: error, kind: 'broken', reason: reasonOf(error) };
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
  const { application, built, invokedBy, path } = scene;
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
    invokedBy,
    path,
    style,
  });
}

/** One hook that broke: the plugin that installed it, why, and what it threw. */
interface BrokenHook {
  identity: string;
  reason: string;
  cause: unknown;
}

/**
 * Every installed plugin's hints for one failure, in installation order, and each hook that broke.
 * Each hook receives the failure and its context alone, so hints accumulate and no hook sees
 * another's.
 */
function collectHints(
  scene: FailureScene,
  failure: LoomError,
  style: ContextualStyle,
): { broken: readonly BrokenHook[]; hints: readonly string[] } {
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
    answer.kind === 'broken' ? [{ cause: answer.cause, identity, reason: answer.reason }] : [],
  );
  return { broken, hints: Object.freeze(hints) };
}

/** The defect one broken hook reports in a development build. */
function hookDefect({ cause, identity, reason }: BrokenHook): InternalError {
  return new InternalError(brokenFailureHook, {
    cause,
    correction: 'Return a string, an array of strings, or undefined from onFailure, synchronously.',
    sentence: `${pluginSentence(identity)} failed in onFailure: ${reason}`,
  });
}

/** The defect a broken failure view reports in a development build. */
function viewDefect(report: FailureReport & { kind: 'unrendered' }): InternalError {
  return new InternalError(brokenFailureView, {
    cause: report.cause,
    correction: viewCorrection,
    sentence: `Rendering the failure failed: ${report.reason}`,
  });
}

/**
 * What one broken contract reports on the plain fallback path. A development build writes its
 * Developer Diagnostic after a blank line; a distributed build writes the generic defect message
 * at most once per run.
 */
function brokenContract(defect: InternalError, build: BuildReports, scene: DeveloperScene): string {
  return build.development
    ? `\n${developerPlainText(defect, scene)}`
    : genericOnce(build, scene.application);
}

/**
 * What the plain fallback path writes after one failure's diagnostic: core's default text when the
 * view broke, then what each broken contract reports, the view first and each hook in installation
 * order. Nothing here resolves markup or runs a plugin's code.
 */
function plainLines(
  report: FailureReport,
  broken: readonly BrokenHook[],
  reporting: { build: BuildReports; failure: LoomError; scene: DeveloperScene },
): string {
  const { build, failure, scene } = reporting;
  if (report.kind === 'rendered') {
    return broken.map((hook) => brokenContract(hookDefect(hook), build, scene)).join('');
  }
  // `report.text` is core's default text, which already ends in `\n`; for a defect it is generic.
  const own = isAuthorFault(failure) ? genericOnce(build, scene.application) : report.text;
  return [viewDefect(report), ...broken.map(hookDefect)].reduce(
    (text, defect) => `${text}${brokenContract(defect, build, scene)}`,
    own,
  );
}

/**
 * Renders one failure as the run's build decides. A development build renders a fault only the
 * author can fix as its Developer Diagnostic, ahead of every override, with the hints under it,
 * and after an earlier report of the run it opens with one blank line. Every other failure, and
 * every failure in a distributed build, resolves through the view registry. Core's default text
 * for a defect is the generic message, which the run writes at most once, so a later defect that
 * core's own view renders writes nothing.
 */
async function renderFailure(
  sink: FailureSink,
  failure: LoomError,
  scene: FailureContextScene,
): Promise<FailureReport> {
  const { build } = sink;
  if (build.development && isAuthorFault(failure)) {
    const { style } = sink.output.context('stderr');
    const text = developerText(failure, { ...scene.developer, hints: scene.hints, style });
    await sink.output.report(build.reported ? `\n${text}` : text);
    return { core: false, kind: 'rendered', text: '' };
  }
  const report = describeFailure(sink.registry, failure, failureContext(sink.output, scene));
  if (report.kind === 'rendered' && !repeatsGeneric(build, report, failure)) {
    // The view owns the trailing newline; output resolves its marked text.
    await sink.output.report(report.text);
  }
  return report;
}

/**
 * Whether a rendered report is the generic defect message a run wrote already, which it writes
 * nothing for. Core's own view writes the generic message for a fault only the author can fix, and
 * the first such report counts it.
 */
function repeatsGeneric(build: BuildReports, report: FailureReport, failure: LoomError): boolean {
  if (report.kind !== 'rendered' || !report.core || !isAuthorFault(failure)) {
    return false;
  }
  const repeated = build.generic;
  build.generic = true;
  return repeated;
}

/** Where one failure is rendered from: the run's scene and the hints its hooks returned. */
interface FailureContextScene {
  developer: DeveloperScene;
  hints: readonly string[];
  invokedBy: InvokedBy;
  path: readonly string[];
}

/** The context a failure view reads: the stderr view context, where the run was, and the hints. */
function failureContext(output: Output, scene: FailureContextScene): FailureViewContext {
  return Object.freeze({
    ...output.context('stderr'),
    application: scene.developer.application,
    hints: scene.hints,
    invokedBy: scene.invokedBy,
    path: scene.path,
  });
}

/**
 * Reports one failure. The hooks run first, so the diagnostic or the view receives their hints. A
 * view that breaks leaves core's default text without hints on the plain fallback path, and each
 * broken contract's report follows that whole diagnostic. It answers whether a view or a hook
 * broke, which forces the run's code to 1 outside a cancelled run.
 */
async function reportFailure(
  sink: FailureSink,
  failure: LoomError,
  scene: FailureScene & { host: DeveloperScene['host'] },
): Promise<boolean> {
  const { broken, hints } = collectHints(scene, failure, sink.output.context('stderr').style);
  const developer: DeveloperScene = { application: scene.application, host: scene.host };
  const report = await renderFailure(sink, failure, {
    developer,
    hints,
    invokedBy: scene.invokedBy,
    path: scene.path,
  });
  const plain = plainLines(report, broken, { build: sink.build, failure, scene: developer });
  if (plain !== '') {
    await reportPlainly(sink.stderr, plain);
  }
  sink.build.reported = true;
  return report.kind !== 'rendered' || broken.length > 0;
}

/**
 * What a run writes on the plain fallback path when a destination failed a write or reporting
 * itself failed: the Developer Diagnostic of the broken destination in a development build, and
 * the generic defect message, at most once per run, in a distributed one.
 */
function destinationReport(build: BuildReports, cause: unknown, scene: DeveloperScene): string {
  if (!build.development) {
    return genericOnce(build, scene.application);
  }
  return `${build.reported ? '\n' : ''}${developerPlainText(destinationDefect(cause), scene)}`;
}

/** The defect a destination that failed a write the run owed it is. */
function destinationDefect(cause: unknown): InternalError {
  return new InternalError(brokenDestination, {
    cause,
    correction: 'Give run() host streams that accept every write until the run resolves.',
    sentence: 'Could not write invocation output.',
  });
}

export type { BuildReports, BuiltRun, FailureHook, FailureHookContext, FailureScene };
export { destinationDefect, destinationReport, reportFailure };
