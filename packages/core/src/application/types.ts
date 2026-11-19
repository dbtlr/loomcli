import type { ChildOwner } from '../commands/attach.js';
import type { BuiltGraph } from '../commands/build.js';
import type { CommandMethod } from '../commands/command.js';
import type { CommandNodeHandle } from '../commands/types.js';
import type { DeclarationError } from '../failures/errors.js';
import type { FailureExitCode } from '../failures/exit-codes.js';
import type { Translation, TranslatorRegistry } from '../failures/translators.js';
import type { ProcessHandle } from '../host/types.js';
import type { DeclaredValues, InputPlaces } from '../inputs/declarations.js';
import type { collectInputs } from '../inputs/places.js';
import type { CommandGraph } from '../inspection/inspect.js';
import type { CommandPaths } from '../invocation/paths.js';
import type { StdinContext } from '../invocation/types.js';
import type { Redaction } from '../output/redaction.js';
import type { ViewContributions, ViewOverride, ViewRegistry } from '../output/view.js';
import type { ExtensionValue } from '../plugins/extension.js';
import type { BuiltPlugin, InstalledOptionValues, Plugin } from '../plugins/plugin.js';
import type { AnyProvider, OptIn, ProvidedValues, ProviderGlobals } from '../plugins/providers.js';
import type { RenderingPolicy } from '../style/rendering.js';
import type { Application } from './application.js';
import type { ApplicationFacts } from './facts.js';

/**
 * An Application starts with the option values its installed plugins contribute as its globals,
 * computed once from the constructor's `plugins`, so every action reads them typed and each
 * `globalOption()` call adds its own to them.
 */
interface ApplicationConstructor {
  /** Creates an Application with the given name, which every authoring call then declares onto. */
  new (
    name: string,
  ): Application<
    {},
    {},
    {},
    ApplicationMethod,
    readonly [],
    unknown,
    StdinContext,
    {},
    {},
    CommandPaths
  >;
  /**
   * Creates an Application with the given name and options: its plugins, views, translators,
   * shutdown budget, and core facts.
   */
  new <
    const Plugins extends readonly Plugin[] = readonly [],
    const Uses extends readonly AnyProvider[] = [],
  >(
    name: string,
    options: ApplicationOptions<Plugins, Uses>,
  ): Application<
    {},
    {},
    InstalledOptionValues<Plugins>,
    ApplicationMethod,
    Plugins,
    unknown,
    StdinContext,
    ProvidedValues<Uses>,
    ProviderGlobals<Uses>,
    CommandPaths
  >;
  /**
   * Holds for an Application in every authoring state, and narrows to the default `Application`,
   * which publishes `check()`, `inspect()`, `run()`, `invoke()`, `extend()`, and `name` and no
   * authoring call, since a recognized value may be past any of them.
   */
  [Symbol.hasInstance](value: unknown): value is Application;
}

/**
 * The status `run()` resolves: success, a failure class's code, or a cancellation code.
 *
 * @public
 * @sealed
 */
export type ExitCode = 0 | FailureExitCode | 129 | 130 | 131 | 141 | 143;

/**
 * What a caller states for one `run()`: a rendering policy, the process handle, and a cancellation
 * signal.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/application.md
 * @public
 */
export interface RunOptions {
  /**
   * The rendering settings for this run, each overriding the Application's same field.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/styles.md#rendering-policies
   */
  rendering?: RenderingPolicy;
  /** The process the run reads its facts from and makes its effects on: `processHandle()` when omitted. */
  process?: ProcessHandle;
  /**
   * A caller-owned signal that cancels the run. Core subscribes to it at run entry and honors an
   * abort at every phase boundary; a shutdown aborts the run as well, and the first cause decides.
   */
  signal?: AbortSignal;
}

/**
 * Every authoring call an Application can publish, beside `inspect()`, `check()`, `run()`,
 * `invoke()`, and `name`, which always remain.
 * An Application's type state is a subset of these, and each call removes the names it invalidates.
 * The unnamed root declares what a named Command declares, except for `alias()` and
 * `visibleAlias()`: the root answers to no bare token, so it has no name to alias.
 *
 * @public
 * @sealed
 */
export type ApplicationMethod = Exclude<CommandMethod, 'alias' | 'visibleAlias'> | 'globalOption';

/**
 * What one preparation hands back as each stage of the build passes, in the order it passes them.
 * `inspect()` ignores every stage; `run()` uses them to configure the invocation's output before
 * the graph builds, so a build fault reports through the application's own overrides.
 */
export interface PrepareStage {
  /** Each registry as it is published: the application's alone, then the merged one. */
  views: (registry: ViewRegistry) => void;
  /** The declared rendering policy the constructor validated. */
  rendering: (policy: RenderingPolicy) => void;
  /** The built plugins, which carry the theme the view context resolves styles through. */
  plugins: (plugins: readonly BuiltPlugin[]) => void;
}

/**
 * Which checks one build runs past the built graph, and what each fault they find does. A run and
 * `inspect()` throw the first, which ends the build; `check()` keeps each and goes on.
 */
export interface BuildChecks {
  /** Whether the build runs a development build's checks: it asks every validated input's converter. */
  readonly development: boolean;
  readonly fault: (fault: DeclarationError) => void;
}

/**
 * What a run reads of every input in one graph: where each was declared, and the local ones, which
 * the declared defaults and implied values are collected from. Both follow from the graph alone.
 */
export interface GraphInputs {
  locals: ReturnType<typeof collectInputs>;
  places: InputPlaces;
}

/**
 * What one graph build hands back: the facts, the graph, its frozen graph, what a run reads of its
 * inputs, and the built plugins. The frozen graph and the inputs are each derived at most once.
 */
export interface BuiltApplication {
  facts: ApplicationFacts;
  graph: BuiltGraph;
  inputs: () => GraphInputs;
  inspected: () => CommandGraph;
  plugins: readonly BuiltPlugin[];
}

/**
 * What `new Application(name, options)` takes beside the name: its rendering policy, its view
 * overrides, its translators, its plugins, its core facts, and its shutdown budget.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/application.md
 * @public
 */
export interface ApplicationOptions<
  Plugins extends readonly Plugin[] = readonly Plugin[],
  Uses extends readonly AnyProvider[] = [],
> {
  /**
   * The rendering policy of every run; a run's own `rendering` overrides the fields it supplies.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/styles.md#rendering-policies
   */
  rendering?: RenderingPolicy;
  /** How a signal ends the process: `timeout` is the shutdown budget, 500 milliseconds by default. */
  shutdown?: { readonly timeout?: number };
  /**
   * What core does with every log event: `redact` lists the dotted field paths whose values read
   * `"[Redacted]"` wherever the event goes, every `onLog` hook and log line included.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/logging.md#redaction
   */
  log?: { readonly redact?: readonly string[] };
  /**
   * The Application's view overrides, each pairing a declared view or a failure class with a
   * replacement, which resolve ahead of every plugin's.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/views.md
   */
  views?: readonly ViewOverride[];
  /**
   * The Application's failure translations, which resolve ahead of each plugin's.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#translators
   */
  translators?: readonly Translation[];
  /** The plugins the Application installs. Their global options join the Application's own. */
  plugins?: Plugins;
  /**
   * The extension values the Application's root Command carries.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/extensions.md
   */
  extensions?: readonly ExtensionValue<'command'>[];
  /** The one-line summary of the Application, which `inspect()` reports. */
  description?: string;
  /** The version of the Application, which `inspect()` reports. */
  version?: string;
  /** The providers whose values the root's own action reads under `provided`. */
  uses?: OptIn<Uses>;
}

/**
 * Everything an Application holds beside its root declaration and its globals, each part checked by
 * the constructor or the call that set it.
 */
export interface ApplicationConfig {
  /** Whether the application's own `command()` or `action()` has run, which closes `globalOption()`. */
  composed: boolean;
  /** Each installed plugin's view contributions, in installation order. */
  contributors: readonly ViewContributions[];
  facts: ApplicationFacts;
  /** The parent that claimed each node the graph holds, so one value attaches at one point. */
  owners: ReadonlyMap<CommandNodeHandle, ChildOwner>;
  plugins: readonly BuiltPlugin[];
  /** The field paths every log event's copy redacts, which the constructor checked, or none. */
  redaction: Redaction | undefined;
  rendering: RenderingPolicy;
  /** The milliseconds a run gets to unwind after an ending signal, which the constructor checked. */
  shutdown: number;
  /** The application's translations, then each installed plugin's, in resolution order. */
  translators: TranslatorRegistry;
  /** The application's own view overrides. */
  views: ViewContributions;
}

/**
 * A built and judged graph that a later call reuses, so no lifecycle hook runs again: the graph,
 * what a run reads of its inputs, and its frozen graph, each derived at most once, whoever reads it
 * first. None holds anything of one run, so runs that overlap share it.
 */
export type KeptGraph = Pick<BoundGraph, 'graph' | 'inputs' | 'inspected'>;

/**
 * The graph an action's run built and validated, which a call the action makes reuses: no lifecycle
 * hook runs again. Declared values are reused only in the zone they were validated under.
 */
export interface BoundGraph {
  declaredValues: DeclaredValues;
  /** The validation host's zone, read only when an explicit per-call zone needs comparison. */
  declaredTimeZone: () => string;
  graph: BuiltGraph;
  inputs: () => GraphInputs;
  inspected: () => CommandGraph;
}

export type { ApplicationConstructor };
