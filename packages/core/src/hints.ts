import type { Writable } from 'node:stream';

import type { FailureSelection } from './chain.js';
import { developerPlainText, developerText } from './developer.js';
import type { DeveloperScene } from './developer.js';
import { callEncoder, encoderDefect } from './encoders.js';
import type { EncoderAnswer, EncoderRegistry, InstalledEncoder } from './encoders.js';
import {
  defaultText,
  genericDefectText,
  InternalError,
  isAuthorFault,
  reasonOf,
} from './errors.js';
import type { DeclarationError, InvokedBy, LoomError } from './errors.js';
import { failureForm } from './form.js';
import type { FailureForm } from './form.js';
import { nodeAt } from './inspect.js';
import type { CommandGraph, CommandNode } from './inspect.js';
import { brokenLogHookDefect } from './log.js';
import type { BrokenLogHook, Log, RunLog } from './log.js';
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
 * What one `onFailure` hook reads beside the failure. `application`, `path`, `invokedBy`, `view`,
 * and `mediaType` are the values the failure view reads, so a hook that points at a command line returns no hint for an
 * invocation by name, and `style` is the contextual style for stderr, so a hook escapes text the
 * operator typed. `graph` is the frozen graph `inspect()` returns for the run, and `command` is the
 * node at `path` inside it; reading either builds the run's graph once. `log` records a log event
 * under the identity of the plugin whose hook is running.
 */
interface FailureHookContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly invokedBy: InvokedBy;
  /** The view the result would render through when the run failed, as the failure view reads it. */
  readonly view: string | undefined;
  /** The media type that view declares. */
  readonly mediaType: string | undefined;
  readonly style: ContextualStyle;
  readonly log: Log;
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
 * `invokedBy` says how the run received its inputs, and `selection` is the run's selection when it
 * failed.
 */
interface FailureScene {
  application: string;
  path: readonly string[];
  invokedBy: InvokedBy;
  built: BuiltRun | undefined;
  selection: FailureSelection;
}

/**
 * What one run's build decides about its reports. A development build shows the author a
 * Developer Diagnostic for every fault only the author can fix, each after the first report of the
 * run opening with one blank line; a distributed build shows the generic defect message at most
 * once per run.
 */
interface BuildReports {
  /**
   * Whether the run is a development build, read from the release facts of the run's recorded
   * report host each time, and `true` until one is recorded.
   */
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

/**
 * Where one failure report is written, the registry its view resolves through, the build, and the
 * failure encoders a `run()` writes through, which an invocation by name never has.
 */
interface FailureSink {
  logging: RunLog;
  output: Output;
  registry: ViewRegistry;
  stderr: Writable;
  build: BuildReports;
  encoders: EncoderRegistry | undefined;
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
  shared: { log: Log; style: ContextualStyle },
): FailureHookContext {
  const { application, built, invokedBy, path, selection } = scene;
  const { log, style } = shared;
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
    log,
    mediaType: selection.mediaType,
    path,
    style,
    view: selection.view,
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
  shared: { logging: RunLog; style: ContextualStyle },
): { broken: readonly BrokenHook[]; hints: readonly string[] } {
  const { built } = scene;
  if (built === undefined) {
    return { broken: [], hints: Object.freeze([]) };
  }
  const { logging, style } = shared;
  // Every hook runs here, in installation order, before any answer is read.
  const answers = built.plugins.flatMap(({ identity, onFailure }) => {
    if (onFailure === undefined) {
      return [];
    }
    const context = hookContext({ ...scene, built }, { log: logging.bind(identity), style });
    return [{ answer: callHook(onFailure, failure, context), identity }];
  });
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
 * What the plain fallback path writes for the `onLog` hooks that broke in a run: each one's
 * Developer Diagnostic in a development build, opening with one blank line after an earlier
 * report, and the generic defect message, at most once per run, in a distributed one.
 */
function brokenLogReport(
  broken: readonly BrokenLogHook[],
  build: BuildReports,
  scene: DeveloperScene,
): string {
  return broken
    .map((entry) => plainDefectReport(build, brokenLogHookDefect(entry), scene))
    .join('');
}

/**
 * What the plain fallback path writes after one failure's diagnostic when its view broke: core's
 * default text, then the broken view's own report. Nothing here resolves markup or runs a plugin's
 * code.
 */
function brokenViewLines(
  report: FailureReport & { kind: 'unrendered' },
  reporting: { build: BuildReports; failure: LoomError; scene: DeveloperScene },
): string {
  const { build, failure, scene } = reporting;
  // `report.text` is core's default text, which already ends in `\n`; for a defect it is generic.
  const own = isAuthorFault(failure) ? genericOnce(build, scene.application) : report.text;
  return `${own}${brokenContract(viewDefect(report), build, scene)}`;
}

/**
 * Writes a fault only the author can fix as its Developer Diagnostic, with the hints under it, ahead
 * of every override and every encoder. After an earlier report of the run it opens with one blank
 * line.
 */
async function writeDiagnostic(
  sink: FailureSink,
  failure: DeclarationError | InternalError,
  scene: { developer: DeveloperScene; hints: readonly string[] },
): Promise<void> {
  const { style } = sink.output.context('stderr');
  const text = developerText(failure, { ...scene.developer, hints: scene.hints, style });
  await sink.output.report(sink.build.reported ? `\n${text}` : text);
}

/**
 * What one failure's own report left the plain fallback path, and whether the view or the encoder
 * that answered it broke.
 */
interface OwnReport {
  broken: boolean;
  plain: string;
}

/**
 * Renders one failure as the run's build decides. A development build renders a fault only the
 * author can fix as its Developer Diagnostic. Every other failure, and every failure in a
 * distributed build, resolves through the view registry. Core's default text for a defect is the
 * generic message, which the run writes at most once, so a later defect that core's own view
 * renders writes nothing. A view that breaks leaves core's default text without hints, and its own
 * report, to the plain fallback path.
 */
async function renderFailure(
  sink: FailureSink,
  failure: LoomError,
  scene: FailureContextScene,
): Promise<OwnReport> {
  const { build } = sink;
  if (build.development && isAuthorFault(failure)) {
    await writeDiagnostic(sink, failure, scene);
    return { broken: false, plain: '' };
  }
  const report = describeFailure(sink.registry, failure, failureContext(sink.output, scene));
  if (report.kind === 'unrendered') {
    return {
      broken: true,
      plain: brokenViewLines(report, { build, failure, scene: scene.developer }),
    };
  }
  if (!repeatsGeneric(build, report, failure)) {
    // The view owns the trailing newline; output resolves its marked text.
    await sink.output.report(report.text);
  }
  return { broken: false, plain: '' };
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
  selection: FailureSelection;
}

/** The context a failure view reads: the stderr view context, where the run was, and the hints. */
function failureContext(output: Output, scene: FailureContextScene): FailureViewContext {
  return Object.freeze({
    ...output.context('stderr'),
    application: scene.developer.application,
    hints: scene.hints,
    invokedBy: scene.invokedBy,
    mediaType: scene.selection.mediaType,
    path: scene.path,
    view: scene.selection.view,
  });
}

/**
 * What the plain fallback path writes for a broken encoder: core's default text for the failure,
 * without hints, unless a diagnosed fault already wrote its diagnostic, then the broken encoder's
 * own report.
 */
function brokenEncoderLines(
  failure: LoomError,
  broken: {
    answer: EncoderAnswer & { kind: 'broken' };
    diagnosed: boolean;
    installed: InstalledEncoder;
  },
  reporting: { build: BuildReports; scene: DeveloperScene },
): string {
  const { answer, diagnosed, installed } = broken;
  const { build, scene } = reporting;
  let own = '';
  if (!diagnosed) {
    own = isAuthorFault(failure)
      ? genericOnce(build, scene.application)
      : defaultText(failure, scene.application);
  }
  return `${own}${brokenContract(encoderDefect(installed, answer), build, scene)}`;
}

/**
 * The failure-encoding stage, which takes the place of the failure view for a failure whose
 * selection declares a media type an installed plugin encodes. The encoder's text is the only
 * failure text the report writes, as it is. A development build writes a fault only the author
 * can fix as its Developer Diagnostic with the hints under it first, and the encoded line after one
 * blank line. A broken encoder leaves core's default text for the failure, without hints, and the
 * broken encoder's own report, to the plain fallback path. The run's held incomplete-result lines
 * are dropped when the encoder writes the failure, and written ahead of everything when it breaks.
 */
async function encodeFailureReport(
  sink: FailureSink,
  failure: LoomError,
  encoding: FailureContextScene & { form: FailureForm; installed: InstalledEncoder },
): Promise<OwnReport> {
  const { developer, form, installed } = encoding;
  const diagnosed = sink.build.development && isAuthorFault(failure);
  // The encoder answers first, because whether it wrote the failure decides the held lines.
  const answer = callEncoder(installed, form);
  await settleIncomplete(sink.output, answer);
  if (diagnosed) {
    await writeDiagnostic(sink, failure, encoding);
  }
  if (answer.kind === 'encoded') {
    await sink.output.encoded(diagnosed ? `\n${answer.text}` : answer.text);
    return { broken: false, plain: '' };
  }
  return {
    broken: true,
    plain: brokenEncoderLines(
      failure,
      { answer, diagnosed, installed },
      { build: sink.build, scene: developer },
    ),
  };
}

/**
 * The run's held incomplete-result lines once an encoder answered: dropped when it wrote the
 * failure, whose line is then the only failure text, and written when it broke.
 */
async function settleIncomplete(output: Output, answer: EncoderAnswer): Promise<void> {
  if (answer.kind === 'encoded') {
    output.dropIncomplete();
    return;
  }
  await output.writeIncomplete();
}

/**
 * The form of one failure, built after the hooks, which is also the failure the run logs. No hook
 * runs for a failure raised before the graph built, and no event is logged for it either.
 */
function loggedForm(
  sink: FailureSink,
  failure: LoomError,
  answered: { built: BuiltRun | undefined; hints: readonly string[] },
): FailureForm {
  const form = failureForm(failure, {
    development: sink.build.development,
    hints: answered.hints,
    plain: (text) => sink.output.plain(text),
  });
  if (answered.built !== undefined) {
    sink.logging.failure(failure, form);
  }
  return form;
}

/**
 * Reports one failure. The hooks run first, so the diagnostic, the view, or the encoder receives
 * their hints and their form. A failure whose selection an installed plugin encodes passes through
 * the encoding stage in place of its view. What a broken view or encoder leaves the plain fallback
 * path comes first there, and each broken hook's report follows that whole diagnostic. It answers
 * whether a view, an encoder, or a hook broke, which forces the run's code to 1 outside a cancelled
 * run, and the failure's form.
 */
async function reportFailure(
  sink: FailureSink,
  failure: LoomError,
  scene: FailureScene & { host: DeveloperScene['host'] },
): Promise<FailureReported> {
  const { broken, hints } = collectHints(scene, failure, {
    logging: sink.logging,
    style: sink.output.context('stderr').style,
  });
  const form = loggedForm(sink, failure, { built: scene.built, hints });
  const developer: DeveloperScene = { application: scene.application, host: scene.host };
  const own = await reportOwn(sink, failure, { ...scene, developer, form, hints });
  const hooks = broken.map((hook) => brokenContract(hookDefect(hook), sink.build, developer));
  const plain = `${own.plain}${hooks.join('')}`;
  if (plain !== '') {
    await reportPlainly(sink.stderr, plain);
  }
  sink.build.reported = true;
  return { broken: own.broken || broken.length > 0, form };
}

/**
 * One failure's own report: the encoding stage when an installed plugin encodes the media type the
 * run selected, and the failure's view otherwise, after the run's held incomplete-result lines.
 */
async function reportOwn(
  sink: FailureSink,
  failure: LoomError,
  scene: FailureContextScene & { form: FailureForm },
): Promise<OwnReport> {
  const { mediaType } = scene.selection;
  const installed = mediaType === undefined ? undefined : sink.encoders?.get(mediaType);
  if (installed) {
    return encodeFailureReport(sink, failure, { ...scene, installed });
  }
  await sink.output.writeIncomplete();
  return renderFailure(sink, failure, scene);
}

/**
 * What reporting one failure answered: whether a view, an encoder, or a hook broke, which forces
 * the run's code to 1 outside a cancelled run, and the failure's form, which holds the hints its
 * hooks returned.
 */
interface FailureReported {
  broken: boolean;
  form: FailureForm;
}

/**
 * What the plain fallback path writes for one defect: its Developer Diagnostic in a development
 * build, opening with a blank line after an earlier report, and the generic defect message, at
 * most once per run, in a distributed one.
 */
function plainDefectReport(
  build: BuildReports,
  defect: InternalError,
  scene: DeveloperScene,
): string {
  if (!build.development) {
    return genericOnce(build, scene.application);
  }
  const text = developerPlainText(defect, scene);
  const written = build.reported ? `\n${text}` : text;
  build.reported = true;
  return written;
}

/**
 * What a run writes on the plain fallback path when a destination failed a write or reporting
 * itself failed: the Developer Diagnostic of the broken destination in a development build, and
 * the generic defect message, at most once per run, in a distributed one.
 */
function destinationReport(
  build: BuildReports,
  defect: InternalError,
  scene: DeveloperScene,
): string {
  return plainDefectReport(build, defect, scene);
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
export { brokenLogReport, destinationDefect, destinationReport, reportFailure };
