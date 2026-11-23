import type { Writable } from 'node:stream';

import type { BuiltGraph } from '../commands/build.js';
import type { InvokedBy } from '../failures/errors.js';
import { askTerminal } from '../host/background-query.js';
import { settleBackground } from '../host/background.js';
import type { Background } from '../host/background.js';
import { captureHost, statedBackground } from '../host/host.js';
import type { HandleFacts, HostCapture, ReportHost } from '../host/host.js';
import { laneOf, processHandle } from '../host/process-handle.js';
import type { Host } from '../host/types.js';
import type { Invocation, StartingView } from '../invocation/chain.js';
import { invocationHost } from '../invocation/invoke.js';
import type { InvokeCall } from '../invocation/invoke.js';
import { lowerInvocation } from '../invocation/lower.js';
import { parseInvocation } from '../invocation/parse.js';
import { argvVerbosity, namedVerbosity } from '../marks/verbosity.js';
import type { DestinationFacts, LogOutlet } from '../output/log.js';
import { Output } from '../output/output.js';
import type { ProgressEvent } from '../output/types.js';
import type { PersistentValues } from '../plugins/providers.js';
import type { OnShutdown, SharedLane } from '../signals/signal-lane.js';
import { bracketRun } from '../signals/signals.js';
import type { LaneEntry, ParentRun, SignalBracket } from '../signals/signals.js';
import { capabilities, plainPolicy, renderingPolicy } from '../style/rendering.js';
import type { RenderingPolicy } from '../style/rendering.js';
import type { ExitCode, RunOptions, BoundGraph } from './types.js';

/**
 * What a call an action makes reads from its run: the graph, its host facts, the signal, and
 * the outlet its log events reach.
 */
export interface ActionCall {
  bound: BoundGraph;
  /** Where the run's log events go, which its nested runs send theirs to as well. */
  outlet: LogOutlet;
  fields: HandleFacts;
  /** The lane of the run's signal source, which the call takes its own place in. */
  lane: SharedLane;
  /** Whether the run keeps its lane listening, which the call then does too. */
  listens: boolean;
  parent: ParentRun;
  /**
   * The persistent values of the outermost run, which every run nested in it shares. The outermost
   * run opens them at its dispatch boundary, before its action can call.
   */
  persistent: () => PersistentValues | undefined;
}

/** What one run reads at its entry, before the graph is built. */
interface RunEntry {
  /** Where an argv run copies its environment additions out: its handle's `publishEnv`, if any. */
  publishEnvironment: ((name: string, value: string) => void) | undefined;
  /**
   * The run's host, captured around the stderr the run writes to, or the failure a working
   * directory that cannot be read raised beside the facts its report writes through.
   */
  host: (stderr: Writable) => HostCapture;
  /** Reads the run's inputs against the built graph. */
  read: (host: Host) => Invocation['read'];
  /** The run's verbosity, settled against the built graph from what the run reads its inputs from. */
  verbosity: (graph: BuiltGraph, host: Host) => number;
  /** The run's background, settled once before graph build from what the run reads. */
  background: (read: BackgroundRead) => Promise<Background | undefined>;
  /** The view the run starts from, which an invocation by name's caller may select. */
  start: StartingView | undefined;
}

/**
 * What a run settles its background from: the operator's choice, whether anything reads the
 * background, the host, the policy the color choice left, and the run's signal, which ends a
 * query's wait.
 */
interface BackgroundRead {
  /** Cancels the run, as the action's `cancel()` does, for an interrupt key nothing raised. */
  cancel: () => void;
  /** Registers a handler on the run's place, which restores the terminal if a signal ends the wait. */
  onShutdown: OnShutdown;
  choice: Background | undefined;
  detects: boolean;
  host: Host;
  policy: RenderingPolicy;
  signal: AbortSignal;
}

/**
 * What differs between `run()` and an invocation by name, so one run body serves both. A run reads
 * argv and makes its process handle's effects: it captures the handle's streams, keeps its signal
 * source's lane listening while it is live, and writes its `exitCode`. An invocation by name reads
 * named values, writes to capture sinks, resolves its output plain, and makes no effect.
 */
export interface RunDoor {
  readonly invokedBy: InvokedBy;
  /** An explicit per-call zone requires checking the reused declared values' validation zone. */
  readonly timeZone: string | undefined;
  /** The lane of the run's signal source. */
  readonly lane: SharedLane;
  /** Whether the run keeps its lane listening: `run()`, or an action's call under it. */
  readonly listens: boolean;
  /**
   * Subscribes the run's controller to whatever cancels it and takes the run's place in its lane,
   * at the run's entry, before its first await.
   */
  bracket: (controller: AbortController, entry: Omit<LaneEntry, 'listens'>) => SignalBracket;
  /** Whether a failure the run reports passes through the failure-encoding stage: `run()` alone. */
  readonly encodes: boolean;
  /** The stream a report reaches until the run's host names its own. */
  readonly stderr: Writable;
  /** Reads what the caller passed, at run entry. */
  enter: () => RunEntry;
  /** The host a report reads when the run failed before its own was captured. */
  fallback: (stderr: Writable) => ReportHost;
  /**
   * The run's output, before the build hands it the declared policy. `early` is the policy the
   * output follows until then: the operator's color choice, or color off in a marked Application
   * whose host capture failed before the choice could be read. `plain` is the run's plain switch.
   */
  output: (
    host: ReportHost,
    signal: AbortSignal,
    settled: { early: RenderingPolicy; plain: boolean },
  ) => Output;
  /** The destination facts of an outermost run, which its host names. */
  destination: (host: ReportHost) => DestinationFacts;
  /**
   * The outlet of the run an action's call is nested in, which the call's events go through, or
   * none for an outermost run, which builds its own.
   */
  readonly outlet: LogOutlet | undefined;
  /** The policy the run resolves its output by, from the Application's declared one. */
  rendering: (declared: RenderingPolicy) => RenderingPolicy;
  /** The graph an action's run built, which this run reuses, or none for a run that builds. */
  bound: BoundGraph | undefined;
  /**
   * The persistent values of the outermost run when this run is nested in an action's run, or none
   * for the outermost run, which holds its own.
   */
  persistent: PersistentValues | undefined;
  /** The process effect the run ends with, once its code is final. */
  settle: (code: ExitCode) => void;
}

/**
 * The door `run()` enters by: argv and its process handle's facts, signals, and exit status. The
 * run binds the handle once, and the real process's when it was given none.
 */
export function argvDoor(application: string, options: RunOptions | undefined): RunDoor {
  const handle = options?.process ?? processHandle();
  const lane = laneOf(handle.signals);
  return {
    bound: undefined,
    bracket: (controller, entry) =>
      bracketRun(controller, { caller: options?.signal, entry: { ...entry, listens: true }, lane }),
    destination: ({ env, home, platform, stderr }) =>
      Object.freeze({ env, home, platform, stderr }),
    encodes: true,
    enter: () => {
      const { publishEnv } = handle;
      return {
        background: ({ cancel, choice, detects, host, onShutdown, policy, signal }) =>
          settleBackground(
            {
              choice,
              colored: (['stdout', 'stderr'] as const).some(
                (destination) => capabilities(host, destination, policy).color,
              ),
              detects,
              env: host.env,
              policy: policy.background,
              stated: statedBackground(host.terminal),
              terminals: (['stdin', 'stdout', 'stderr'] as const).every(
                (stream) => host.terminal[stream].isTTY,
              ),
            },
            () => askTerminal(host, { cancel, onShutdown, signal }),
          ),
        host: (reached) => captureHost(application, handle, reached),
        publishEnvironment: publishEnv,
        read: (host) => (graph, walked) => parseInvocation(graph, host.argv, walked),
        start: undefined,
        verbosity: (graph, host) => argvVerbosity(graph, host.argv),
      };
    },
    fallback: (reached) => captureHost(application, handle, reached).report,
    invokedBy: 'argv',
    lane,
    listens: true,
    outlet: undefined,
    output: (host, signal, { early, plain: on }) => {
      const output = new Output(host, signal, on);
      output.configure(early, new Map());
      return output;
    },
    persistent: undefined,
    rendering: (declared) => {
      const rendering = options?.rendering;
      return { ...declared, ...renderingPolicy(rendering) };
    },
    settle: (code) => {
      handle.exitCode = code;
    },
    stderr: handle.stderr,
    timeZone: undefined,
  };
}

/**
 * The door an invocation by name enters by: the call read where it entered, a host of capture
 * sinks around its host facts, a signal derived from the call's own and an action's run, and no
 * process effect.
 */
export function nameDoor<Mapped>(
  call: InvokeCall<Mapped>,
  setup: {
    action: ActionCall | undefined;
    declared: RenderingPolicy;
    fields: () => HandleFacts;
    /** The lane of the call's signal source: its handle's, or its action's run's. */
    lane: SharedLane;
    /** The caller's progress observer, which the run's output hands each event to. */
    observe: ((event: ProgressEvent) => void) | undefined;
    streams: { stderr: Writable; stdout: Writable };
  },
): RunDoor {
  const { action, declared, lane, streams } = setup;
  const host = () => invocationHost(setup.fields(), streams, call.timeZone);
  const listens = action?.listens ?? false;
  return {
    bound: action?.bound,
    bracket: (controller, entry) =>
      bracketRun(controller, {
        caller: call.signal,
        entry: { ...entry, listens },
        lane,
        parent: action?.parent,
      }),
    // An invocation by name writes to no process stream, so a call of the application has no stderr.
    destination: ({ env, home, platform }) => Object.freeze({ env, home, platform, stderr: null }),
    encodes: false,
    enter: () => ({
      // An invocation by name settles no background and writes no query.
      background: async () => undefined,
      host,
      publishEnvironment: undefined,
      read: () => (graph, walked) => lowerInvocation(graph, call.named, walked),
      start: call.view,
      // A call settles its own verbosity from the values it lowers, and inherits none.
      verbosity: (graph) => namedVerbosity(graph, call.named),
    }),
    fallback: () => host().report,
    invokedBy: 'name',
    lane,
    listens,
    // A call's host.argv is empty, so it reads no choice, and its plain policy holds color off.
    outlet: action?.outlet,
    output: (captured, signal) => {
      const output = new Output(captured, signal);
      // A fault raised before the build must already render plain, so the policy applies at entry.
      output.configure(plainPolicy(declared), new Map());
      if (setup.observe !== undefined) {
        output.observeProgress(setup.observe);
      }
      return output;
    },
    persistent: action?.persistent(),
    rendering: plainPolicy,
    settle: () => undefined,
    stderr: streams.stderr,
    timeZone: call.timeZone,
  };
}
