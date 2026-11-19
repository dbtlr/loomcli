import { encoderRegistry } from '../failures/encoders.js';
import type { EncoderRegistry } from '../failures/encoders.js';
import { exitCodeOf, foreignFailure, toFailure } from '../failures/errors.js';
import type { LoomError } from '../failures/errors.js';
import type { FailureExitCode } from '../failures/exit-codes.js';
import { failureForm } from '../failures/form.js';
import type { FailureForm } from '../failures/form.js';
import { translateThrow } from '../failures/translators.js';
import { handleFacts, settleTerminal } from '../host/host.js';
import type { ReportHost } from '../host/host.js';
import { laneOf, processHandle } from '../host/process-handle.js';
import type { ProcessHandle } from '../host/types.js';
import { prepareDeclaredValues } from '../inputs/declared-values.js';
import type { OptionSpelling } from '../inputs/options.js';
import { noSelection, runInvocation } from '../invocation/chain.js';
import type { FailureSelection } from '../invocation/chain.js';
import {
  captureSink,
  fieldsOf,
  guardedObserver,
  mappedFailure,
  readCall,
} from '../invocation/invoke.js';
import type { InvocationOutcome, InvocationValues, InvokeOptions } from '../invocation/types.js';
import { backgroundChoice } from '../marks/background-mark.js';
import { chosenPolicy, colorChoice, uncapturedPolicy } from '../marks/color.js';
import { plainSwitch } from '../marks/plain.js';
import { RunLog } from '../output/log.js';
import type { DestinationFacts, LogScreen } from '../output/log.js';
import { reportPlainly } from '../output/output.js';
import type { WriteState, Output } from '../output/output.js';
import type { MessageArguments } from '../output/types.js';
import type { ViewRegistry } from '../output/view.js';
import { destinationDefect, destinationReport, reportFailure } from '../plugins/hints.js';
import type { BuildReports, BuiltRun, FailureScene } from '../plugins/hints.js';
import { prepareEnvironment } from '../plugins/prepare-environment.js';
import { PersistentValues, RunValues } from '../plugins/providers.js';
import { isDevelopment } from '../shipping/release.js';
import type { LaneHandlers } from '../signals/signal-lane.js';
import {
  cancellationCode,
  echoesCancellation,
  isCancellationEcho,
  placeHandlers,
} from '../signals/signals.js';
import type { CancellationCode, SignalBracket } from '../signals/signals.js';
import type { RenderingPolicy } from '../style/rendering.js';
import { themeAdapts, themePalette } from '../style/theme.js';
import type { BuiltTheme } from '../style/theme.js';
import { argvDoor, nameDoor } from './doors.js';
import type { ActionCall, RunDoor } from './doors.js';
import type {
  ExitCode,
  RunOptions,
  ApplicationConfig,
  BuiltApplication,
  KeptGraph,
  PrepareStage,
} from './types.js';

/** The registry a failure is reported through when the application's own could not be built. */
const noViews: ViewRegistry = [];

/** Drops what a handler of core's own threw, which nothing an operator does could change. */
const dropped = (): void => undefined;

/**
 * Whether one failure is the cancellation the run already reports, which core does not report a
 * second time. Any other failure after cancellation is rendered as usual.
 */
function silenced(
  thrown: unknown,
  signal: AbortSignal,
  cancelled: CancellationCode | undefined,
): boolean {
  return cancelled !== undefined && isCancellationEcho(thrown, signal.reason);
}

/** The selection of a run whose chain never ran, which reaches no Command's result. */
function unselected(): FailureSelection {
  return noSelection;
}

/**
 * The write state a run reports by. A destination whose write failure the action let propagate,
 * and a translator answered, is reported as that translated failure, so its failure is no longer
 * the destination fault that forces 1.
 */
function answeredWrite(writes: WriteState, answered: unknown): WriteState {
  return writes.kind === 'failed' && answered !== undefined && writes.error === answered
    ? { kind: 'ok' }
    : writes;
}

/** The declaration-owned facts and build access one run reads. */
export interface RunContext {
  name: string;
  config: Pick<
    ApplicationConfig,
    'rendering' | 'facts' | 'plugins' | 'redaction' | 'translators' | 'shutdown'
  >;
  markedSpellings: () => {
    readonly color: ReadonlyMap<string, OptionSpelling> | undefined;
    readonly plain: ReadonlyMap<string, OptionSpelling> | undefined;
    readonly background: ReadonlyMap<string, OptionSpelling> | undefined;
  };
  stage: (stage: PrepareStage) => void;
  keptBuild: (stage: PrepareStage, development: boolean, bound?: KeptGraph) => BuiltApplication;
}

/** Runs the Application through its argv door and resolves its exit code. */
export async function run(context: RunContext, options?: RunOptions): Promise<ExitCode> {
  const end = await execute(context, argvDoor(context.name, options));
  return end.exitCode;
}

/**
 * One invocation by name: the call read where it entered, the run on capture sinks, and the
 * outcome, whose failure the caller's handler maps once the run has ended. An action's call
 * reuses the graph its run built and reads its run's host fields and signal.
 */
export async function invoke<Mapped>(
  context: RunContext,
  call: {
    path: readonly string[];
    values: InvocationValues;
    options: (InvokeOptions<Mapped> & { readonly process?: ProcessHandle }) | undefined;
  },
  action: ActionCall | undefined,
): Promise<InvocationOutcome<Mapped>> {
  const read = readCall(call);
  const sinks = { stderr: captureSink(), stdout: captureSink() };
  const streams = { stderr: sinks.stderr.stream, stdout: sinks.stdout.stream };
  const progress = guardedObserver(read.onProgress);
  // An action's call reads no handle, because its facts and its lane are its run's.
  const handle = call.options?.process ?? processHandle();
  const end = await execute(
    context,
    nameDoor(read, {
      action,
      declared: context.config.rendering,
      fields: () => action?.fields ?? handleFacts(context.name, handle),
      lane: action?.lane ?? laneOf(handle.signals),
      observe: progress.observe,
      streams,
    }),
  );
  // An observer that threw makes the call reject once its run has settled, discarding its text.
  progress.settle();
  if (end.kind === 'cancelled') {
    return { exitCode: end.exitCode, status: 'cancelled' };
  }
  const output = sinks.stdout.text();
  const messages = sinks.stderr.text();
  if (end.kind === 'completed') {
    return { messages, output, status: 'completed' };
  }
  const { exitCode, form, path } = end;
  const failure = mappedFailure(end.failure, read.failure, {
    application: context.name,
    exitCode,
    form,
    path,
  });
  return { exitCode, failure, form, messages, output, status: 'failed' };
}

/**
 * The one run body `run()` and `invoke()` share. The door decides what differs: where the run
 * reads its inputs and host, where it writes, which signals cancel it, whether it reuses an
 * action's run's graph or the one kept for its build, and whether it touches the process.
 */
async function execute(context: RunContext, door: RunDoor): Promise<RunEnd> {
  // The marked options' spellings, known from the declarations before any graph builds.
  const marked = context.markedSpellings();
  const spellings = marked.color;
  const plainSpellings = marked.plain;
  const backgroundSpellings = marked.background;
  const { stderr } = door;
  let output: Output | undefined = undefined;
  let code: 0 | FailureExitCode = 0;
  let reportingFailed = false;
  // A registry that could not be built reports through core's defaults, not through itself.
  let registry: ViewRegistry | undefined = undefined;
  // The thrown value this run reports as its primary outcome, whose translation decides its writes.
  let primary: { value: unknown } | undefined = undefined;
  // The failure that set this run's failure code, which an invocation by name hands its caller.
  let decisive: LoomError | undefined = undefined;
  // The form of each failure this run reported, which holds the hints its hooks returned.
  const forms = new Map<LoomError, FailureForm>();
  // Each failure a translator answered, keyed to the foreign throw it replaced.
  const translatedFrom = new Map<unknown, unknown>();
  // Where a failure happened: the path routing walked, and what the hooks read once the graph built.
  let walked: readonly string[] = Object.freeze([]);
  let reached: BuiltRun | undefined = undefined;
  // The run's selection when it failed, published once the chain is about to run.
  let selected: () => FailureSelection = unselected;
  // The failure encoders a `run()` writes through, once the plugins are installed for the build.
  let encoders: EncoderRegistry | undefined = undefined;
  /**
   * The host a failure's report reads: what the run's capture read, even when its working
   * directory could not be read, or the door's fallback when the run failed before capturing.
   * Nothing captures the host a second time.
   */
  let reportHost: ReportHost | undefined = undefined;
  /**
   * What this run's build decides about its reports, shared by every report the run writes. Its
   * build reads the release facts of the recorded report host each time, so no reader sees a
   * value from before the capture. Until a host is recorded, or when its facts were malformed,
   * the build is unknown, so the run is a development build and the author reads their defect.
   */
  const build: BuildReports = {
    get development() {
      return isDevelopment(reportHost?.release);
    },
    generic: false,
    reported: false,
  };
  const useReportHost = (host: ReportHost): ReportHost => {
    reportHost = host;
    return host;
  };
  const reportingHost = (): ReportHost => reportHost ?? useReportHost(door.fallback(stderr));
  /**
   * This run's log events, created when the first context asks. The destination is the
   * outermost run's, which the door decides, and the path is the one routing published.
   */
  const logged: { current: RunLog | undefined } = { current: undefined };
  /**
   * Where this run shows a log event as a log line, read at each call, so a line follows the
   * verbosity the run settled. Core logs no event before then.
   */
  const screen: LogScreen = {
    out: { warn: (...call: MessageArguments) => output?.out.warn(...call) ?? Promise.resolve() },
    show: (event) => {
      output?.showLog(event);
    },
    shows: (level) => output?.showsLog(level) ?? false,
  };
  // A hook's stderr follows the run's stderr order once the run's output exists.
  const destinationFacts = (): DestinationFacts => {
    const facts = door.destination(reportingHost());
    return output?.logDestination(facts) ?? facts;
  };
  const logs = (): RunLog => {
    logged.current ??= new RunLog({
      application: Object.freeze({
        name: context.name,
        version: context.config.facts.version,
      }),
      outlet: door.outlet ?? {
        facts: destinationFacts(),
        hooks: context.config.plugins.flatMap(({ identity, onLog }) =>
          onLog === undefined ? [] : [{ hook: onLog, plugin: identity }],
        ),
        screen,
      },
      path: () => walked,
      redaction: context.config.redaction,
    });
    return logged.current;
  };
  const scene = (): FailureScene & { host: ReportHost } => ({
    application: context.name,
    built: reached,
    host: reportingHost(),
    invokedBy: door.invokedBy,
    path: walked,
    selection: selected(),
  });
  // What broke the run's reporting: a destination's write error, or a throw while reporting.
  let reportingCause: unknown = undefined;
  // One private controller per run, subscribed to the caller's signal at run entry.
  const controller = new AbortController();
  // The bracket this run holds, once the run has entered and subscribed to the caller's signal.
  let signals: SignalBracket | undefined = undefined;
  // A cancelled run resolves its cancellation code whenever it ends after graph build.
  // A declaration or internal failure raised before that ends the run with its own code instead.
  let graphBuilt = false;
  const cancellation = (): CancellationCode | undefined => {
    const reason = graphBuilt ? signals?.reason() : undefined;
    return reason ? cancellationCode(reason) : undefined;
  };
  /**
   * Offers one throw from the application's work to the translators, a view's included, because
   * a throw from a library a view calls is the author's to translate like any other. A
   * cancellation echo is never offered, because it already names what it is.
   */
  const offer = (thrown: unknown): LoomError | undefined => {
    if (echoesCancellation(thrown, controller.signal)) {
      return undefined;
    }
    const failure = translateThrow(context.config.translators, thrown);
    if (failure !== undefined) {
      translatedFrom.set(failure, thrown);
    }
    return failure;
  };
  /**
   * Every exit path of the run leaves through the removal below, the one place it is written,
   * so no listener this run installed outlives it however the run ends.
   */
  try {
    try {
      // The run takes its place in its lane before its first await, so a signal from now reaches it.
      const bracket = door.bracket(controller, {
        flush: () => {
          output?.flushQueue();
        },
        timeout: context.config.shutdown,
      });
      signals = bracket;
      const entered = door.enter();
      const capture = entered.host(stderr);
      useReportHost(capture.report);
      if ('failure' in capture) {
        throw capture.failure;
      }
      const { host } = capture;
      // The operator's color choice, read from argv before anything else prints.
      const choice = spellings && colorChoice(host.argv, spellings);
      // The plain switch, read beside it, so every byte written after capture follows it.
      const invocationOutput = door.output(host, controller.signal, {
        early: chosenPolicy({}, choice),
        plain: plainSwitch(host.argv, host.env, plainSpellings),
      });
      output = invocationOutput;
      invocationOutput.useLiveRegionsHooks(
        context.config.plugins.flatMap(({ onLiveRegions }) =>
          onLiveRegions === undefined ? [] : [onLiveRegions],
        ),
      );
      // A closed reader on stdout ends the run as a cancellation does, with its own reason.
      invocationOutput.useClosedPipe((cause) => signals?.closePipe(cause));
      // Core's own handlers on the run's place: the live regions and the background query.
      const ownHandlers = placeHandlers(bracket.place, {
        resume: dropped,
        shutdown: dropped,
        suspend: dropped,
      });
      invocationOutput.useSuspension(ownHandlers);
      // The constructor validated the declared policy, which the build hands over after the overrides.
      let policy: RenderingPolicy = {};
      // The installed theme, which the run's background resolves to a palette once it settles.
      let theme: BuiltTheme = new Map();
      const { bound } = door;
      const stage: PrepareStage = {
        plugins: (plugins) => {
          theme = plugins.find((entry) => entry.theme !== undefined)?.theme ?? new Map();
          invocationOutput.configure(policy, themePalette(theme, undefined));
        },
        rendering: (declared) => {
          policy = chosenPolicy(door.rendering(declared), choice);
          invocationOutput.configure(policy, new Map());
        },
        views: (value) => {
          registry = value;
          invocationOutput.useViews(value);
        },
      };
      context.stage(stage);
      // The run's background settles once, before graph build, so the first themed byte knows it.
      const settled = await entered.background({
        cancel: bracket.cancel,
        choice: backgroundSpellings && backgroundChoice(host.argv, backgroundSpellings),
        detects: backgroundSpellings !== undefined || themeAdapts(theme),
        host,
        onShutdown: ownHandlers.onShutdown,
        policy,
        signal: controller.signal,
      });
      settleTerminal(host.terminal, settled);
      invocationOutput.configure(policy, themePalette(theme, settled));
      const built = context.keptBuild(stage, build.development, bound);
      const { graph, inspected } = built;
      // Nothing has written a lane yet: graph build's hooks receive no out.
      invocationOutput.useVerbosity(entered.verbosity(graph, host));
      reached = { inspected, plugins: built.plugins };
      if (door.encodes) {
        encoders = encoderRegistry(built.plugins);
      }
      if (bound === undefined) {
        await prepareEnvironment({
          host,
          log: (identity) => logs().bind(identity),
          out: {
            warn: (...call: MessageArguments) => invocationOutput.out.warn(...call),
          },
          plugins: built.plugins,
          publish: entered.publishEnvironment,
          signal: controller.signal,
        });
      }
      const { locals, places } = built.inputs();
      // A nested run reuses its outer run's declared values, so only an outermost run collects inputs.
      const declaredValues =
        bound?.declaredValues ??
        (await prepareDeclaredValues({ globals: graph.globals.inputs, locals }, host, places));
      graphBuilt = true;
      if (!controller.signal.aborted) {
        /**
         * The persistent values every run nested in this one shares: its outermost run's, or, on
         * the outermost run, the ones its own dispatch boundary opens with its opener scope.
         */
        let persistent = door.persistent;
        // An action's own call reuses this run's graph, host fields, signal, and lane.
        const action: ActionCall = {
          bound: { declaredValues, graph, inputs: built.inputs, inspected },
          fields: fieldsOf(host),
          lane: door.lane,
          listens: door.listens,
          outlet: logs().outlet,
          parent: { reason: () => bracket.reason(), signal: controller.signal },
          persistent: () => persistent,
        };
        /**
         * A context's `onShutdown`, `onSuspend`, and `onResume` register through the run's place,
         * and a handler's throw is an `error` log event naming the plugin whose middleware
         * registered it, or none.
         */
        const laneHandlers = (plugin: string | null): LaneHandlers => {
          const failed = (sentence: string) => (thrown: unknown) => {
            logs().bind(plugin).error(sentence, { error: thrown });
          };
          return placeHandlers(bracket.place, {
            resume: failed('A resume handler failed.'),
            shutdown: failed('A shutdown handler failed.'),
            suspend: failed('A suspend handler failed.'),
          });
        };
        await runInvocation({
          cancel: bracket.cancel,
          channel: (binding) => invocationOutput.channel(binding),
          declaredValues,
          graph,
          handFailure: (fault) => invocationOutput.handFailure(fault),
          host,
          inspected,
          invoke: (path, values, options) => invoke(context, { options, path, values }, action),
          invokedBy: door.invokedBy,
          laneHandlers,
          logFor: (plugin) => logs().bind(plugin),
          offer,
          out: output.out,
          places,
          plugins: built.plugins,
          providers: (scope) => {
            persistent ??= new PersistentValues(scope);
            return new RunValues(scope, persistent, door.persistent === undefined);
          },
          read: entered.read(host),
          route: (path) => {
            walked = path;
            invocationOutput.useRoute(path);
          },
          select: (read) => {
            selected = read;
          },
          signal: controller.signal,
          start: entered.start,
          style: output.style,
        });
        // The chain has unwound, so every region a middleware or a source left open closes.
        invocationOutput.closeRegions('completion');
      }
    } catch (error) {
      primary = { value: error };
      // Each open region writes its last frame before the failure report, which comes last.
      output?.closeRegions('failure');
      try {
        const failure = toFailure(error);
        code = exitCodeOf(failure);
        decisive = failure;
        // Output is unbuilt only when host capture failed, before the choice could be read.
        // Argv was never read, so the switch follows ACCESSIBLE alone.
        const reporting = reportingHost();
        output ??= door.output(reporting, controller.signal, {
          early: uncapturedPolicy(spellings !== undefined),
          plain: plainSwitch([], reporting.env, undefined),
        });
        const writes = answeredWrite(await output.settle(), translatedFrom.get(failure));
        if (writes.kind === 'ok' && !silenced(error, controller.signal, cancellation())) {
          // A broken failure view or a throwing onFailure hook forces 1 over the failure's code.
          const sink = {
            build,
            encoders,
            logging: logs(),
            output,
            registry: registry ?? noViews,
            stderr,
          };
          const reported = await reportFailure(sink, failure, scene());
          forms.set(failure, reported.form);
          if (reported.broken) {
            code = 1;
          }
        }
      } catch (reportError) {
        code = 1;
        reportingFailed = true;
        reportingCause = reportError;
      }
    }
    /**
     * A failure a handed call raised that no code observed has no catcher: a render whose view
     * threw, a row source that threw, or a `next()` misuse, in a call the code that made it never
     * awaited. Each is
     * reported after the chain settles through the ordinary failure path, offered to the
     * translators as a foreign throw is, and a failure that code observed is that code's own.
     */
    await output?.settle();
    const faults = (output?.uncaught() ?? []).map((cause) => offer(cause) ?? toFailure(cause));
    // A fault is reported after the primary outcome, which keeps its code.
    // After a primary outcome that succeeded, the first fault's own code decides the run.
    // It is reported the way the primary failure is, so an override answers its class.
    const reportFault = async (fault: LoomError): Promise<void> => {
      if (!silenced(fault, controller.signal, cancellation())) {
        output?.closeRegions('failure');
        decisive = code === 0 ? fault : decisive;
        code = code === 0 ? exitCodeOf(fault) : code;
        try {
          const sink = output && {
            build,
            encoders,
            logging: logs(),
            output,
            registry: registry ?? noViews,
            stderr,
          };
          const reported = sink && (await reportFailure(sink, fault, scene()));
          if (reported) {
            forms.set(fault, reported.form);
          }
          if (reported?.broken === true) {
            code = 1;
          }
        } catch (reportError) {
          reportingFailed = true;
          reportingCause ??= reportError;
        }
      }
    };
    for (const fault of faults) {
      await reportFault(fault);
    }
    /**
     * A report writes the held incomplete-result lines ahead of its failure, or drops them when an
     * encoder wrote the failure. A run no report reached, such as a cancelled one or one whose
     * stdout failed, writes them now, and a line whose view broke is then the run's view fault.
     */
    const lineFault = await output?.writeIncomplete();
    if (lineFault !== undefined && decisive === undefined) {
      await reportFault(toFailure(lineFault.cause));
    }
    /**
     * The first throw of an `onLog` hook is reported once, after every other report, through the
     * ordinary failure path, and the run returns 1 whatever code it would have returned. Its later
     * throws, such as one on the event that report logs, are not reported.
     */
    const hookThrow = logged.current?.thrown;
    if (hookThrow !== undefined) {
      await reportFault(foreignFailure(hookThrow.value));
      code = 1;
    }
    // The first throw of an `onLiveRegions` hook is reported the same way, after the `onLog` one.
    const regionsThrow = output?.liveRegionsThrow;
    if (regionsThrow !== undefined) {
      await reportFault(foreignFailure(regionsThrow.value));
      code = 1;
    }
    if (output) {
      // A region nothing closed yet, such as one a run whose stdout broke left open, closes here.
      output.closeRegions(code === 0 ? 'completion' : 'failure');
      const writes = answeredWrite(
        await output.settle(),
        primary && translatedFrom.get(primary.value),
      );
      if (writes.kind === 'failed') {
        code = 1;
        reportingFailed = true;
        reportingCause ??= writes.error;
      }
      output.dispose();
    }
    /**
     * A failure no report reached, such as one whose stderr had failed, ran no hook, so its form
     * holds no hint.
     */
    const unhintedForm = (failure: LoomError): FailureForm =>
      failureForm(failure, {
        development: build.development,
        hints: [],
        plain: (text) => output?.plain(text) ?? text,
      });
    /**
     * A destination that failed a write, or a report that threw, is a defect the run reports on
     * the plain fallback path, so it logs like any reported failure once the graph has built.
     */
    const destinationFault = reportingFailed ? destinationDefect(reportingCause) : undefined;
    if (destinationFault) {
      const { application, host } = scene();
      const text = destinationReport(build, destinationFault, { application, host });
      if (text !== '') {
        await reportPlainly(stderr, text);
      }
      const form = unhintedForm(destinationFault);
      forms.set(destinationFault, form);
      if (reached !== undefined) {
        logs().failure(destinationFault, form);
      }
    }
    /**
     * One rule orders every code: a cancelled run resolves its signal's code, and a broken
     * failure view, onFailure hook, onLog hook, or destination in that run is reported without
     * changing it. The signal decides the code whatever the action did afterward, so this
     * reading comes last.
     */
    const cancelled = cancellation();
    const exitCode: ExitCode = cancelled ?? code;
    // The run's reasons for core to listen end before its status is set.
    signals?.finish();
    door.settle(exitCode);
    if (cancelled !== undefined) {
      return { exitCode: cancelled, kind: 'cancelled' };
    }
    if (code === 0) {
      return { exitCode: code, kind: 'completed' };
    }
    // A run whose destination alone failed reports that defect, which is its failure.
    const failure = decisive ?? destinationFault ?? destinationDefect(reportingCause);
    const form = forms.get(failure) ?? unhintedForm(failure);
    return { exitCode: code, failure, form, kind: 'failed', path: walked };
  } finally {
    signals?.finish();
  }
}
/** How one run ended, which `run()` reads the code of and `invoke()` builds its outcome from. */
type RunEnd =
  | { kind: 'cancelled'; exitCode: CancellationCode }
  | { kind: 'completed'; exitCode: 0 }
  | {
      kind: 'failed';
      exitCode: FailureExitCode;
      failure: LoomError;
      form: FailureForm;
      path: readonly string[];
    };
