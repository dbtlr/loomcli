import { attachToRoot, childNode, checkDeclaredOptions } from '../commands/attach.js';
import type { ChildOwner } from '../commands/attach.js';
import { buildGraph } from '../commands/build.js';
import type {
  AfterAction,
  ResultMethod,
  AttachmentConstraint,
  AfterArgument,
  AfterCommand,
  AfterResult,
  Command,
} from '../commands/command.js';
import {
  commandPlacement,
  declareAction,
  declareExtensions,
  declareResult,
  declareResultViews,
  isPortableName,
  portableNameCorrection,
} from '../commands/declaration.js';
import {
  declareGlobalOption,
  emptyGlobals,
  globalSite,
  globalTable,
  markedSpellings,
} from '../commands/globals.js';
import type { GlobalsState, GlobalTable } from '../commands/globals.js';
import {
  declareStdin,
  stdinMember,
  declareArgument,
  declareOption,
  declareOptionGroup,
  declareOptionSet,
} from '../commands/inputs.js';
import type { OptionSet, OptionSetNameConstraint } from '../commands/option-sets.js';
import { portableName } from '../commands/rules.js';
import { freshState, layerOf } from '../commands/state.js';
import type { CommandState } from '../commands/state.js';
import type { CommandNodeHandle, GlobalNameConstraint, NameConstraint } from '../commands/types.js';
import { DeclarationError } from '../failures/errors.js';
import type { LoomError } from '../failures/errors.js';
import { quoted } from '../failures/messages.js';
import { readTranslations } from '../failures/translators.js';
import type { ProcessHandle } from '../host/types.js';
import type { Content } from '../inputs/content.js';
import type { ArgumentInput, OptionInput } from '../inputs/declarations.js';
import type { OptionSpelling } from '../inputs/options.js';
import { collectInputs, inputPlaces } from '../inputs/places.js';
import { installedSource } from '../inputs/sources.js';
import type {
  StdinConfig,
  ArgumentConfig,
  ArgumentValue,
  DefaultConstraint,
  ImpliedConstraint,
  GlobalOmissionConstraint,
  PerValueConstraint,
  OptionConfig,
  OptionValue,
  ValidateOmittedConstraint,
  ArgumentKeyConstraint,
  Unmarked,
} from '../inputs/types.js';
import { inspectGraph } from '../inspection/inspect.js';
import type { CommandGraph } from '../inspection/inspect.js';
import type {
  StdinContext,
  Action,
  declaredTypes,
  DeclaredTypes,
  InvocationOutcome,
  InvocationValues,
  InvokeOptions,
} from '../invocation/types.js';
import { background } from '../marks/background-mark.js';
import { color } from '../marks/color.js';
import { plain } from '../marks/plain.js';
import { coreViews } from '../output/lanes.js';
import { redactionOf } from '../output/redaction.js';
import type { ResultViews, ResultViewsOf, RowViews } from '../output/types.js';
import { buildViews, viewIdentities } from '../output/view.js';
import { storeCommandLayers } from '../plugins/extension.js';
import type { ExtensionValue } from '../plugins/extension.js';
import { judgeGraph, judgesGraph } from '../plugins/graph-hooks.js';
import { installPlugins, pluginViews } from '../plugins/plugin.js';
import type { InstalledOptionValues, Plugin } from '../plugins/plugin.js';
import { providedBinder, readUses } from '../plugins/providers.js';
import type {
  AnyProvider,
  BuiltValues,
  ProvidedValues,
  ProviderGlobals,
} from '../plugins/providers.js';
import { bakedFacts, isDevelopment } from '../shipping/release.js';
import { shutdownTimeout } from '../signals/shutdown.js';
import { renderingPolicy } from '../style/rendering.js';
import type { ApplicationEnvironment, applicationEnvironment } from './environment.js';
import {
  applicationFacts,
  carriedBinding,
  checkMarkBindings,
  checkPluginMarkBindings,
  optionSite,
} from './facts.js';
import { run, invoke } from './run.js';
import type { RunContext } from './run.js';
import type {
  ExitCode,
  RunOptions,
  ApplicationConstructor,
  ApplicationMethod,
  ApplicationOptions,
  ApplicationConfig,
  PrepareStage,
  BuildChecks,
  BuiltApplication,
  GraphInputs,
  KeptGraph,
} from './types.js';

/** The stages `inspect()` and `check()` ignore, because they configure no output. */
const unstaged: PrepareStage = {
  plugins: () => undefined,
  rendering: () => undefined,
  views: () => undefined,
};

/** The fault handler of a run and of `inspect()`: the first fault ends the build. */
function raise(fault: DeclarationError): never {
  throw fault;
}

/**
 * Nothing when the Application's globals hold what its root's opt-ins read, and otherwise a member
 * no handler carries, so the `action()` call is rejected.
 */
type RootRequirement<Globals, Requires> = [Globals] extends [Requires]
  ? unknown
  : { readonly 'The Application declares no global option its root providers read': Requires };

/**
 * The Application holds the unnamed root's declaration state and applies the same transitions a
 * Command does, so each declaration call has one typed implementation and no builder to recover.
 */
class ApplicationBuilder<
  Args,
  Options,
  Globals,
  State extends ApplicationMethod = ApplicationMethod,
  Plugins extends readonly Plugin[] = readonly [],
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
  Requires = {},
> {
  /**
   * A type-only marker that carries the Application's global option types and plugins, which
   * `EnvironmentOf` reads. It holds no runtime value.
   */
  declare readonly [applicationEnvironment]: ApplicationEnvironment<Globals, Plugins>;
  /**
   * A type-only marker that carries the declared argument, option, result, stdin, and provided
   * types, which `ActionHandler` reads. It holds no runtime value.
   */
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals, Result, Stdin, Provided>;

  /** Composes the declared stdin and passthrough fragments of the action context. */
  readonly #stdinBind: (source: Content | undefined, passthrough: string[]) => Stdin;
  /** Reads the values core built for the root's opt-ins as the type the Application's `uses` names. */
  readonly #providedBind: (values: BuiltValues) => Provided;
  readonly #name: string;
  readonly #root: CommandState<Args, Options, Globals>;
  readonly #globals: GlobalsState;
  readonly #config: ApplicationConfig;
  /**
   * The spellings of the options that carry the marks a run reads from argv before graph build,
   * the color mark, the plain mark, and the background mark, read from the declarations the first
   * time a run needs them. The holder keeps an Application with none of them from reading them
   * again.
   */
  #markedSpellings:
    | {
        readonly color: ReadonlyMap<string, OptionSpelling> | undefined;
        readonly plain: ReadonlyMap<string, OptionSpelling> | undefined;
        readonly background: ReadonlyMap<string, OptionSpelling> | undefined;
      }
    | undefined = undefined;
  /**
   * The graph the first successful graph build of each build produced, development or distributed,
   * which a later `run()`, `invoke()`, or `inspect()` in that build reuses, so no build hook runs
   * again (ADR-0191). The declarations it was built from never change on this value, because every
   * authoring call returns a new Application, and a kept graph holds nothing of one run.
   */
  readonly #kept: { development?: KeptGraph; distributed?: KeptGraph } = {};

  constructor(
    name: string,
    declared: {
      config: ApplicationConfig;
      globals: GlobalsState;
      root: CommandState<Args, Options, Globals>;
    },
    binds: {
      stdin: (source: Content | undefined, passthrough: string[]) => Stdin;
      provided: (values: BuiltValues) => Provided;
    },
  ) {
    this.#stdinBind = binds.stdin;
    this.#providedBind = binds.provided;
    this.#name = name;
    this.#config = declared.config;
    this.#globals = declared.globals;
    this.#root = declared.root;
  }

  /** The Application's name. */
  get name(): string {
    return this.#name;
  }

  /**
   * Declares that the root's action needs a terminal: a run whose stdin or stderr is not a
   * terminal, or that is under CI, fails before the action, and no invocation by name or MCP tool
   * runs it.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#a-command-that-needs-a-terminal
   */
  needsTerminal(): Application<
    Args,
    Options,
    Globals,
    Exclude<State, 'needsTerminal'>,
    Plugins,
    Result,
    Stdin,
    Provided,
    Requires
  > {
    return new ApplicationBuilder(
      this.#name,
      {
        config: this.#config,
        globals: this.#globals,
        root: { ...this.#root, needsTerminal: true },
      },
      { provided: this.#providedBind, stdin: this.#stdinBind },
    );
  }

  /**
   * Declares the root Command's untouched tail after the first bare delimiter.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#passthrough
   */
  passthrough(
    config: { description?: string } = {},
  ): Application<
    Args,
    Options,
    Globals,
    Exclude<State, 'passthrough'>,
    Plugins,
    Result,
    Stdin & { passthrough: string[] },
    Provided,
    Requires
  > {
    return new ApplicationBuilder(
      this.#name,
      {
        config: this.#config,
        globals: this.#globals,
        root: { ...this.#root, passthrough: { description: config.description } },
      },
      {
        provided: this.#providedBind,
        stdin: (source, passthrough) => ({ ...this.#stdinBind(source, passthrough), passthrough }),
      },
    );
  }

  /**
   * Declares the root's stdin as required, so the action reads it as a `Content` that is always
   * present.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/validation.md#content-inputs
   */
  stdin(
    config: StdinConfig & { required: true },
  ): Application<
    Args,
    Options,
    Globals,
    State,
    Plugins,
    Result,
    Omit<Stdin, 'stdin'> & { readonly stdin: Content },
    Provided,
    Requires
  >;
  /**
   * Declares the root's stdin as optional, so the action's `stdin` is absent when the operator
   * supplies none.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/validation.md#content-inputs
   */
  stdin(
    config: StdinConfig,
  ): Application<
    Args,
    Options,
    Globals,
    State,
    Plugins,
    Result,
    Omit<Stdin, 'stdin'> & StdinContext,
    Provided,
    Requires
  >;
  stdin(
    config: StdinConfig,
  ): Application<
    Args,
    Options,
    Globals,
    State,
    Plugins,
    Result,
    Omit<Stdin, 'stdin'> & StdinContext,
    Provided,
    Requires
  > {
    const root = declareStdin(this.#root, config);
    return new ApplicationBuilder<
      Args,
      Options,
      Globals,
      State,
      Plugins,
      Result,
      Omit<Stdin, 'stdin'> & StdinContext,
      Provided,
      Requires
    >(
      this.#name,
      { config: this.#config, globals: this.#globals, root },
      {
        provided: this.#providedBind,
        stdin: (source, passthrough) => ({
          ...this.#stdinBind(source, passthrough),
          ...stdinMember(root, source),
        }),
      },
    );
  }

  /**
   * Declares a positional argument of the root. The name is the key the action reads under `args`.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#declaring-a-command
   */
  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<ArgumentKeyConstraint<Config>> &
      NoInfer<PerValueConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Application<
    Args & Record<Name, ArgumentValue<Config>>,
    Options,
    Globals,
    AfterArgument<State>,
    Plugins,
    Result,
    Stdin,
    Provided,
    Requires
  > {
    const input: ArgumentInput<Name, Config> = {
      config,
      kind: 'argument',
      name,
    };
    return this.derive(declareArgument(this.#root, input));
  }

  /**
   * Declares a local option of the root. The name is the key the action reads under `options`.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md
   */
  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      Unmarked &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<ImpliedConstraint<Config>> &
      NoInfer<PerValueConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Application<
    Args,
    Options & Record<Name, OptionValue<Config>>,
    Globals,
    State,
    Plugins,
    Result,
    Stdin,
    Provided,
    Requires
  > {
    const input: OptionInput<Name, Config> = {
      config,
      kind: 'option',
      name,
    };
    return this.derive(declareOption(this.#root, input, this.table()));
  }

  /**
   * Declares each option of a set as a local option of the root, in the set's order, then each of
   * the set's option groups, as one `option()` call per option and one group call per group would.
   * The action reads each option under `options`. Nothing inherits: a child that shares the options
   * applies the set itself.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#sharing-options
   */
  options<Configs extends Readonly<Record<string, OptionConfig>>>(
    set: OptionSet<Configs> & NoInfer<OptionSetNameConstraint<Configs, Options, Globals>>,
  ): Application<
    Args,
    Options & { [Name in Extract<keyof Configs, string>]: OptionValue<Configs[Name]> },
    Globals,
    State,
    Plugins,
    Result,
    Stdin,
    Provided,
    Requires
  > {
    return this.derive(declareOptionSet(this.#root, set, this.table()));
  }

  /**
   * Declares that at most one of the named local options of the root may be supplied.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  exclusive(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Application<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires> {
    return this.derive(declareOptionGroup(this.#root, 'exclusive', names));
  }

  /**
   * Declares that at least one of the named local options of the root must be supplied.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  oneRequired(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Application<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires> {
    return this.derive(declareOptionGroup(this.#root, 'oneRequired', names));
  }

  /**
   * Declares that the named local options of the root are supplied all together or not at all.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  requiredTogether(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Application<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires> {
    return this.derive(declareOptionGroup(this.#root, 'requiredTogether', names));
  }

  /**
   * Declares that supplying the first named local option of the root requires each further one,
   * while a further option alone is accepted: `.requires('password', 'user')` accepts `--user`
   * alone and refuses `--password` without `--user`.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  requires(
    option: Extract<keyof Options, string>,
    ...needed: [Extract<keyof Options, string>, ...Extract<keyof Options, string>[]]
  ): Application<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires> {
    return this.derive(declareOptionGroup(this.#root, 'requires', [option, ...needed]));
  }

  /**
   * Declares a global option, which every Command of the Application reads under `options`. It
   * closes once the Application's own `command()` or `action()` has run.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#global-options
   */
  globalOption<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      (Name extends keyof Options
        ? { 'This option name is already declared as a local option': Name }
        : unknown) &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<ImpliedConstraint<Config>> &
      NoInfer<PerValueConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>> &
      NoInfer<GlobalOmissionConstraint<Config>>,
  ): Application<
    Args,
    Options,
    Globals & Record<Name, OptionValue<Config>>,
    State,
    Plugins,
    Result,
    Stdin,
    Provided,
    Requires
  > {
    const input: OptionInput<Name, Config> = {
      config,
      kind: 'option',
      name,
    };
    const descriptors = new Map(this.#root.descriptors);
    const { input: captured, state: globals } = declareGlobalOption(
      this.#globals,
      input,
      descriptors,
    );
    const root = { ...this.#root, descriptors };
    checkDeclaredOptions(root, globalTable(globals.inputs, this.#config.plugins));
    checkMarkBindings(
      captured.config,
      globalSite(captured),
      carriedBinding(globals.records.get(captured), this.#config.plugins),
    );
    return new ApplicationBuilder<
      Args,
      Options,
      Globals & Record<Name, OptionValue<Config>>,
      State,
      Plugins,
      Result,
      Stdin,
      Provided,
      Requires
    >(
      this.#name,
      { config: this.#config, globals, root },
      {
        provided: this.#providedBind,
        stdin: this.#stdinBind,
      },
    );
  }

  /**
   * Registering the action closes input authoring; extension configuration remains available. The
   * globals the root's own opt-ins read are checked here, once `globalOption()` has closed.
   */
  action(
    handler: Action<Args, Globals & Options, Result, Stdin, Provided> &
      RootRequirement<Globals, Requires>,
  ): Application<Args, Options, Globals, AfterAction, Plugins, Result, Stdin, Provided, Requires> {
    return this.derive(
      declareAction(this.#root, handler, { provided: this.#providedBind, stdin: this.#stdinBind }),
      { composed: true },
    );
  }

  /** A child arrives in any type state, because its own action is the call that finished it. */
  command<const Child extends Command<unknown, unknown, Globals>>(
    child: Child & NoInfer<AttachmentConstraint<Globals, Child>>,
  ): Application<
    Args,
    Options,
    Globals,
    AfterCommand<Exclude<State, 'globalOption'>>,
    Plugins,
    Result,
    Stdin,
    Provided,
    Requires
  > {
    const scope = {
      descriptors: new Map(this.#root.descriptors),
      owners: new Map(this.#config.owners),
      table: this.table(),
    };
    const node = childNode(child);
    const root = attachToRoot(
      this.#root,
      { node, placement: commandPlacement([], node.name) },
      scope,
    );
    return this.derive(root, { composed: true, owners: scope.owners });
  }

  /**
   * The value the root action produces for its consumer. The type argument is stated by the
   * author, as it is on a Command.
   */
  result<Value>(declaration: {
    views: ResultViews<NoInfer<Value>>;
  }): Application<
    Args,
    Options,
    Globals,
    AfterResult<State>,
    Plugins,
    { kind: 'value'; value: Value },
    Stdin,
    Provided,
    Requires
  > {
    return this.derive<Args, Options, AfterResult<State>, { kind: 'value'; value: Value }>(
      declareResult(this.#root, 'value', declaration),
    );
  }

  /** The same declaration over a sequence, whose type argument is one row. */
  rows<Row>(declaration: {
    views: RowViews<NoInfer<Row>>;
  }): Application<
    Args,
    Options,
    Globals,
    AfterResult<State>,
    Plugins,
    { kind: 'rows'; row: Row },
    Stdin,
    Provided,
    Requires
  > {
    return this.derive<Args, Options, AfterResult<State>, { kind: 'rows'; row: Row }>(
      declareResult(this.#root, 'rows', declaration),
    );
  }

  /** Views after the fact, merged by key, as it is on a Command. */
  views<const Replacements extends ResultViewsOf<Result>>(
    replacements: Replacements,
    options?: { default?: keyof Replacements & string },
  ): Application<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires> {
    return this.derive(declareResultViews(this.#root, replacements, options));
  }

  /**
   * Adds extension values to the root Command.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/extensions.md
   */
  extend(
    ...values: readonly ExtensionValue<'command'>[]
  ): Application<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires> {
    return this.derive(declareExtensions(this.#root, values));
  }

  /** The globals table the root's options and every joining subtree meet. */
  private table(): GlobalTable {
    return globalTable(this.#globals.inputs, this.#config.plugins);
  }

  /**
   * Root declaration calls preserve the Application configuration, with the parts a call changed.
   * The next state travels through this call: each method names its transition in its return type,
   * and the wrapper publishes the same runtime value in exactly that state.
   */
  private derive<DerivedArgs, DerivedOptions, Next extends ApplicationMethod, Declared = Result>(
    root: CommandState<DerivedArgs, DerivedOptions, Globals>,
    changed: Partial<Pick<ApplicationConfig, 'composed' | 'owners'>> = {},
  ): Application<
    DerivedArgs,
    DerivedOptions,
    Globals,
    Next,
    Plugins,
    Declared,
    Stdin,
    Provided,
    Requires
  > {
    return new ApplicationBuilder<
      DerivedArgs,
      DerivedOptions,
      Globals,
      Next,
      Plugins,
      Declared,
      Stdin,
      Provided,
      Requires
    >(
      this.#name,
      { config: { ...this.#config, ...changed }, globals: this.#globals, root },
      { provided: this.#providedBind, stdin: this.#stdinBind },
    );
  }

  /**
   * The graph build, which applies the rules no earlier moment could know: the root's
   * finished-Command rules, every lifecycle hook's contribution, the checks `checks` names, and
   * every `onGraphBuilt` judgment of the frozen graph. The application's own overrides are
   * published first, so a build fault reports through them. The merged registry is published once
   * the build has succeeded, so a build fault never resolves through a plugin's overrides.
   * `inspected` is the frozen graph `inspect()` returns, built at most once, whoever reads it
   * first. It always builds anew, as `check()` does, and reuses no kept graph.
   */
  private prepare(stage: PrepareStage, checks: BuildChecks): BuiltApplication {
    this.stage(stage);
    return this.build(stage, checks);
  }

  /**
   * The stages that pass before the graph builds: the application's own overrides, the declared
   * rendering policy, and the built plugins, each published to `stage`.
   */
  private stage(stage: PrepareStage): void {
    const { plugins, rendering, views } = this.#config;
    stage.views([views]);
    stage.rendering(rendering);
    stage.plugins(plugins);
  }

  /**
   * The graph of a run, an invocation by name, or `inspect()` in one build. An action's call reuses
   * its run's graph, and any other call reuses the graph kept for its build, or builds and keeps one.
   * A build that faults throws before it is kept, so the next call builds again and meets the fault.
   */
  private keptBuild(
    stage: PrepareStage,
    development: boolean,
    bound?: KeptGraph,
  ): BuiltApplication {
    if (bound) {
      return this.build(stage, { development, fault: raise }, bound);
    }
    const slot = development ? 'development' : 'distributed';
    const built = this.build(stage, { development, fault: raise }, this.#kept[slot]);
    this.#kept[slot] ??= { graph: built.graph, inputs: built.inputs, inspected: built.inspected };
    return built;
  }

  /** The graph build after the stages `stage()` published, as `prepare()` states it. */
  private build(stage: PrepareStage, checks: BuildChecks, reuse?: KeptGraph): BuiltApplication {
    const { contributors, facts, plugins, views } = this.#config;
    // A graph already built and judged is reused, so no lifecycle hook runs again.
    if (reuse) {
      stage.views([views, ...contributors]);
      return {
        facts,
        graph: reuse.graph,
        inputs: reuse.inputs,
        inspected: reuse.inspected,
        plugins,
      };
    }
    const graph = buildGraph(this.#root, this.#globals, plugins);
    let derived: GraphInputs | undefined = undefined;
    const inputs = () =>
      (derived ??= { locals: collectInputs(graph.root), places: inputPlaces(graph) });
    let frozen: CommandGraph | undefined = undefined;
    const converterFault = checks.development ? checks.fault : undefined;
    const inspected = () =>
      (frozen ??= inspectGraph(this.#name, graph, {
        ...facts,
        converterFault,
        source: installedSource(plugins)?.source,
      }));
    if (checks.development) {
      // A build that checks converters asks every one at build, so its check runs on every build.
      inspected();
    }
    if (judgesGraph(plugins)) {
      judgeGraph(inspected(), plugins, checks.fault);
    }
    stage.views([views, ...contributors]);
    return { facts, graph, inputs, inspected, plugins };
  }

  /**
   * The built graph as plain, frozen data. It builds the graph as `run()` does and throws
   * `DeclarationError` for the same build faults. Validating a declared default through its schema
   * can be asynchronous, so that one rule stays in `run()`. It takes no host, so it learns its build
   * from the release facts the build baked in, and malformed ones throw their `InternalError`. The
   * Application keeps the graph of each build, so a later call in the same build, or a call after a
   * run in it, returns the same object and runs no lifecycle hook again.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/graph-inspection.md#reusing-the-built-graph
   */
  inspect(): CommandGraph {
    const development = isDevelopment(bakedFacts());
    this.stage(unstaged);
    return this.keptBuild(unstaged, development).inspected();
  }

  /**
   * Every declaration fault a development run reports before routing, except a declared default or
   * implied value its validator rejects, as values in the order a run meets them. It builds the
   * graph as `inspect()` does and runs the development checks whatever the release facts read,
   * reading no host and no baked facts. A build rule's fault ends the build, so it is the one fault;
   * past a built graph, each failing converter and each rejecting `onGraphBuilt` hook is kept and
   * the build goes on. Any other throw leaves it as it is. It builds anew on every call, whatever
   * graph the Application keeps, and keeps nothing.
   */
  check(): readonly DeclarationError[] {
    const faults: DeclarationError[] = [];
    try {
      this.prepare(unstaged, {
        development: true,
        fault: (fault) => {
          faults.push(fault);
        },
      });
    } catch (error) {
      // A thrown fault is a build rule's, which ends the build, so it is returned alone.
      if (error instanceof DeclarationError) {
        return [error];
      }
      throw error;
    }
    return faults;
  }

  /**
   * Runs the Application as the process: reads argv, routes it to a Command, writes the run's
   * output, and resolves the exit code. A failure of the run is reported through its view and
   * resolves its code, so `run()` does not reject for it.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/application.md
   */
  async run(options?: RunOptions): Promise<ExitCode> {
    return run(this.#runContext(), options);
  }

  /**
   * Runs one Command by its path, with named values in place of argv, captures what the run writes,
   * and resolves a structured outcome. It builds the graph as `run()` does, reusing the graph the
   * Application keeps for the build its release facts name. It touches no process.
   */
  invoke<Mapped = LoomError>(
    path: readonly string[],
    values: InvocationValues,
    options?: InvokeOptions<Mapped> & {
      /** The process the call reads its facts from: `processHandle()` when omitted. */
      readonly process?: ProcessHandle;
    },
  ): Promise<InvocationOutcome<Mapped>> {
    return invoke(this.#runContext(), { options, path, values }, undefined);
  }

  /** The runner's access to declaration-owned facts and the kept graph. */
  #runContext(): RunContext {
    return {
      config: this.#config,
      keptBuild: (stage, development, bound) => this.keptBuild(stage, development, bound),
      markedSpellings: () => {
        const globalInputs = this.#globals.inputs;
        const { plugins: installed } = this.#config;
        return (this.#markedSpellings ??= {
          background: markedSpellings(globalInputs, installed, background),
          color: markedSpellings(globalInputs, installed, color),
          plain: markedSpellings(globalInputs, installed, plain),
        });
      },
      name: this.#name,
      stage: (stage) => this.stage(stage),
    };
  }
}

/**
 * The authoring surface of an Application in one type state: the root Command's calls, `command()`,
 * `inspect()`, `check()`, `run()`, `invoke()`, and `name`. Every authoring call returns a new
 * declaration value, leaves its receiver unchanged, and publishes only the calls that are still
 * valid after it. `inspect()`, `check()`, `run()`, `invoke()`, and `name` survive every call. `State` lists the authoring calls a value still offers.
 * It defaults to the state after `action()`, which publishes the fewest calls, so
 * `Application<A, O, G>` accepts an application in any state, a finished one included.
 *
 * @public
 * @sealed
 */
export type Application<
  Args = {},
  Options = {},
  Globals = {},
  State extends ApplicationMethod = AfterAction,
  Plugins extends readonly Plugin[] = readonly Plugin[],
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
  Requires = {},
> = Pick<
  ApplicationBuilder<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires>,
  | typeof applicationEnvironment
  | typeof declaredTypes
  | 'check'
  | 'extend'
  | 'inspect'
  | 'invoke'
  | 'name'
  | 'run'
  | State
  | ResultMethod<Result>
>;

/**
 * Every rule `new Application(name, options)` applies, in the order it reads the slot: the
 * application's own view overrides, its translations, the installed list and every rule between
 * two plugins, the root's extension values,
 * and then each plugin's Commands, which attach to the root first, in installation order and list
 * order. The root's globals are the option values the declared `plugins` tuple contributes.
 */
function declareApplication<Plugins extends readonly Plugin[]>(
  name: string,
  declared:
    | (Omit<ApplicationOptions<Plugins>, 'uses'> & { uses?: readonly AnyProvider[] })
    | undefined,
): {
  config: ApplicationConfig;
  globals: GlobalsState;
  root: CommandState<{}, {}, InstalledOptionValues<Plugins>>;
} {
  const slot = declared;
  const identities = viewIdentities(coreViews);
  const views = buildViews(
    {
      owner: { call: 'new Application', named: name },
      sentence: 'The Application',
    },
    slot?.views,
    identities,
  );
  const translations = readTranslations(
    optionSite(name, 'translators', slot?.translators),
    slot?.translators,
  );
  const rendering = renderingPolicy(slot?.rendering);
  const shutdown = shutdownTimeout(name, slot?.shutdown);
  const redaction = redactionOf(name, slot?.log);
  const facts = applicationFacts(slot);
  const installed = installPlugins(name, slot?.plugins ?? []);
  const { plugins } = installed;
  const contributors = plugins.map((entry) =>
    buildViews(pluginViews(entry.identity), entry.views, identities),
  );
  const table = globalTable([], plugins);
  checkPluginMarkBindings(plugins);
  const descriptors = installed.descriptors;
  const extensions = storeCommandLayers({
    descriptors,
    layers: [slot?.extensions],
    site: optionSite(name, 'extensions', slot?.extensions),
    subject: layerOf(null),
  });
  // The Application checks its own facts, so the root carries none.
  // Its diagnostics name the Application rather than the root Command.
  let root = freshState<InstalledOptionValues<Plugins>>({
    descriptors,
    extensions,
    facts: { deprecated: undefined, description: undefined, hidden: false },
    name: null,
    uses: readUses(optionSite(name, 'uses', slot?.uses), slot?.uses),
  });
  const owners = new Map<CommandNodeHandle, ChildOwner>();
  for (const command of plugins.flatMap((entry) => entry.commands)) {
    root = attachToRoot(root, command, {
      descriptors: new Map(root.descriptors),
      owners,
      table,
    });
  }
  return {
    config: {
      composed: false,
      contributors,
      facts,
      owners,
      plugins,
      redaction,
      rendering,
      shutdown,
      translators: [translations, ...plugins.map((entry) => entry.translators)],
      views,
    },
    globals: emptyGlobals(),
    root,
  };
}

/** The application name is typed as a command at the prompt, so it answers to the portable rule. */
function checkApplicationName(name: string): string {
  if (!isPortableName(name)) {
    throw new DeclarationError(portableName, {
      correction: portableNameCorrection,
      findings: [{ arguments: [name], call: 'new Application', mark: '0' }],
      sentence: `Application name ${quoted(name)} is invalid.`,
    });
  }
  return name;
}

/**
 * Constructor inference preserves the installed plugin tuple, and the globals start as the option
 * values the installed plugins contribute.
 */
class ApplicationDeclaration<
  const Plugins extends readonly Plugin[] = readonly [],
  const Uses extends readonly AnyProvider[] = [],
> extends ApplicationBuilder<
  {},
  {},
  InstalledOptionValues<Plugins>,
  ApplicationMethod,
  Plugins,
  unknown,
  StdinContext,
  ProvidedValues<Uses>,
  ProviderGlobals<Uses>
> {
  /**
   * Each declaring call returns a new builder rather than an instance of this class, so
   * `instanceof Application` reads the builder's prototype chain, and holds for an Application in
   * every authoring state. It narrows to the default `Application`, which publishes only what every
   * state keeps. An author's subclass inherits this method, and `instanceof` that subclass reads
   * the subclass's own prototype chain, as `instanceof` reads any class.
   */
  static [Symbol.hasInstance](value: unknown): value is Application {
    if (this !== ApplicationDeclaration) {
      return Function.prototype[Symbol.hasInstance].call(this, value);
    }
    return value instanceof ApplicationBuilder;
  }

  constructor(name: string, options?: ApplicationOptions<Plugins, Uses>) {
    // The arguments evaluate in order, so the name is checked before any option is read.
    const checked = checkApplicationName(name);
    super(checked, declareApplication(checked, options), {
      provided: providedBinder<Uses>(options?.uses),
      stdin: (source) => ({ stdin: source }),
    });
  }
}

/**
 * The Application: the root of one command application, which holds an unnamed root Command and the
 * global options, plugins, and views every Command shares. Every authoring call returns a new
 * value, and `run()` runs it as the process.
 *
 * @example
 * ```ts
 * import { Application, Command } from '@loomcli/core';
 *
 * const greet = new Command('greet', { description: 'Print a greeting.' })
 *   .argument('name', { description: 'Who to greet.', required: true })
 *   .action(({ args, out }) => out.print(`Hello, ${args.name}`));
 *
 * const app = new Application('hello', { description: 'A greeting tool.', version: '1.0.0' }).command(greet);
 *
 * await app.run();
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/application.md
 * @public
 */
export const Application: ApplicationConstructor = ApplicationDeclaration;
