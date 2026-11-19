import type { RegistrationVisible, RegisteredGlobals } from '../application/environment.js';
import type { Content } from '../inputs/content.js';
import type { ArgumentInput, OptionInput } from '../inputs/declarations.js';
import type {
  StdinConfig,
  ArgumentConfig,
  DefaultConstraint,
  ArgumentKeyConstraint,
  PerValueConstraint,
  ValidateOmittedConstraint,
  ArgumentValue,
  OptionConfig,
  Unmarked,
  ImpliedConstraint,
  OptionValue,
} from '../inputs/types.js';
import type { StdinContext, declaredTypes, DeclaredTypes, Action } from '../invocation/types.js';
import type { ResultViews, RowViews, ResultViewsOf } from '../output/types.js';
import type { ExtensionValue } from '../plugins/extension.js';
import type {
  BuiltValues,
  AnyProvider,
  OptIn,
  ProviderGlobals,
  WithProviderGlobals,
  ProvidedValues,
} from '../plugins/providers.js';
import { providedBinder } from '../plugins/providers.js';
import { attachChild } from './attach.js';
import {
  declareAlias,
  declareResult,
  declareResultViews,
  declareAction,
  declareExtensions,
} from './declaration.js';
import {
  declareStdin,
  stdinMember,
  declareArgument,
  declareOption,
  declareOptionSet,
  declareOptionGroup,
} from './inputs.js';
import type { OptionSet, OptionSetNameConstraint } from './option-sets.js';
import type { CommandState } from './state.js';
import { namedState, nodes, nodeHandle } from './state.js';
import type { NameConstraint, GlobalNameConstraint } from './types.js';
/** Phantom key. It marks a Command value, so only a Command can be attached as a child. */
export declare const commandValue: unique symbol;

/**
 * The input, alias, child, and action calls a Command can publish. Its type state is a subset,
 * and each call removes the names it invalidates. `command()` belongs to every Command and to the
 * unnamed root alike, at any depth.
 *
 * @public
 * @sealed
 */
export type CommandMethod =
  | 'action'
  | 'alias'
  | 'visibleAlias'
  | 'argument'
  | 'command'
  | 'option'
  | 'options'
  | 'exclusive'
  | 'oneRequired'
  | 'requiredTogether'
  | 'requires'
  | 'result'
  | 'rows'
  | 'needsTerminal'
  | 'passthrough'
  | 'stdin';

/** A Command with an action may declare arguments and hold children, so `argument()` removes nothing. */
export type AfterArgument<State> = State;

/** The same rule read from the other side: `command()` removes nothing. */
export type AfterCommand<State> = State;

/** One Command declares one result, so either call removes both. */
export type AfterResult<State> = Exclude<State, 'result' | 'rows'>;

/** Registering the action closes input, alias, child, and further action declarations. */
export type AfterAction = never;

export class CommandBuilder<
  Args,
  Options,
  Globals,
  State extends CommandMethod = CommandMethod,
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
> {
  /**
   * A type-only marker that tells a Command declaration from any other value. It holds no runtime
   * value.
   */
  declare readonly [commandValue]: true;
  /**
   * A type-only marker that carries the declared argument, option, result, stdin, and provided
   * types, which `ActionHandler` reads. It holds no runtime value.
   */
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals, Result, Stdin, Provided>;

  readonly #name: string;
  readonly #state: CommandState<Args, Options, Globals>;
  /** Composes the declared stdin and passthrough fragments of the action context. */
  readonly #stdinBind: (source: Content | undefined, passthrough: string[]) => Stdin;
  /** Reads the values core built for the Command's opt-ins as the type its `uses` names. */
  readonly #providedBind: (values: BuiltValues) => Provided;

  constructor(
    name: string,
    state: CommandState<Args, Options, Globals>,
    binds: {
      stdin: (source: Content | undefined, passthrough: string[]) => Stdin;
      provided: (values: BuiltValues) => Provided;
    },
  ) {
    this.#stdinBind = binds.stdin;
    this.#providedBind = binds.provided;
    this.#name = name;
    this.#state = state;
    nodes.set(this, nodeHandle(name, state));
  }

  /**
   * Declares that the action needs a terminal: a run whose stdin or stderr is not a terminal, or
   * that is under CI, fails before the action, and no invocation by name or MCP tool runs it.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#a-command-that-needs-a-terminal
   */
  needsTerminal(): Command<
    Args,
    Options,
    Globals,
    Exclude<State, 'needsTerminal'>,
    Result,
    Stdin,
    Provided
  > {
    return new CommandBuilder(
      this.#name,
      { ...this.#state, needsTerminal: true },
      { provided: this.#providedBind, stdin: this.#stdinBind },
    );
  }

  /**
   * Declares the untouched tail after the first bare delimiter.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#passthrough
   */
  passthrough(
    config: { description?: string } = {},
  ): Command<
    Args,
    Options,
    Globals,
    Exclude<State, 'passthrough'>,
    Result,
    Stdin & { passthrough: string[] },
    Provided
  > {
    return new CommandBuilder(
      this.#name,
      { ...this.#state, passthrough: { description: config.description } },
      {
        provided: this.#providedBind,
        stdin: (source, passthrough) => ({ ...this.#stdinBind(source, passthrough), passthrough }),
      },
    );
  }

  /**
   * Declares the Command's stdin as required, so the action reads it as a `Content` that is always
   * present.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/validation.md#content-inputs
   */
  stdin(
    config: StdinConfig & { required: true },
  ): Command<
    Args,
    Options,
    Globals,
    State,
    Result,
    Omit<Stdin, 'stdin'> & { readonly stdin: Content },
    Provided
  >;
  /**
   * Declares the Command's stdin as optional, so the action's `stdin` is absent when the operator
   * supplies none.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/validation.md#content-inputs
   */
  stdin(
    config: StdinConfig,
  ): Command<Args, Options, Globals, State, Result, Omit<Stdin, 'stdin'> & StdinContext, Provided>;
  stdin(
    config: StdinConfig,
  ): Command<Args, Options, Globals, State, Result, Omit<Stdin, 'stdin'> & StdinContext, Provided> {
    const state = declareStdin(this.#state, config);
    return new CommandBuilder<
      Args,
      Options,
      Globals,
      State,
      Result,
      Omit<Stdin, 'stdin'> & StdinContext,
      Provided
    >(this.#name, state, {
      provided: this.#providedBind,
      stdin: (source, passthrough) => ({
        ...this.#stdinBind(source, passthrough),
        ...stdinMember(state, source),
      }),
    });
  }

  /**
   * Declares a positional argument. The name is the key the action reads under `args`.
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
  ): Command<
    Args & Record<Name, ArgumentValue<Config>>,
    Options,
    Globals,
    AfterArgument<State>,
    Result,
    Stdin,
    Provided
  > {
    const input: ArgumentInput<Name, Config> = {
      config,
      kind: 'argument',
      name,
    };
    return this.#derive(declareArgument(this.#state, input));
  }

  /**
   * Declares a local option. The name is the key the action reads under `options`.
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
  ): Command<
    Args,
    Options & Record<Name, OptionValue<Config>>,
    Globals,
    State,
    Result,
    Stdin,
    Provided
  > {
    const input: OptionInput<Name, Config> = {
      config,
      kind: 'option',
      name,
    };
    return this.#derive(declareOption(this.#state, input));
  }

  /**
   * Declares each option of a set as a local option, in the set's order, then each of the set's
   * option groups, as one `option()` call per option and one group call per group would. The
   * action reads each option under `options`. Nothing inherits: a child that shares the options
   * applies the set itself.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#sharing-options
   */
  options<Configs extends Readonly<Record<string, OptionConfig>>>(
    set: OptionSet<Configs> & NoInfer<OptionSetNameConstraint<Configs, Options, Globals>>,
  ): Command<
    Args,
    Options & { [Name in Extract<keyof Configs, string>]: OptionValue<Configs[Name]> },
    Globals,
    State,
    Result,
    Stdin,
    Provided
  > {
    return this.#derive(declareOptionSet(this.#state, set));
  }

  /**
   * Declares that at most one of the named local options may be supplied.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  exclusive(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareOptionGroup(this.#state, 'exclusive', names));
  }

  /**
   * Declares that at least one of the named local options must be supplied.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  oneRequired(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareOptionGroup(this.#state, 'oneRequired', names));
  }

  /**
   * Declares that the named local options are supplied all together or not at all.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  requiredTogether(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareOptionGroup(this.#state, 'requiredTogether', names));
  }

  /**
   * Declares that supplying the first named local option requires each further one, while a
   * further option alone is accepted: `.requires('password', 'user')` accepts `--user` alone and
   * refuses `--password` without `--user`.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  requires(
    option: Extract<keyof Options, string>,
    ...needed: [Extract<keyof Options, string>, ...Extract<keyof Options, string>[]]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareOptionGroup(this.#state, 'requires', [option, ...needed]));
  }

  /**
   * Aliases are other portable names that route to this Command. They invalidate no call, and the
   * tuple rest parameter rejects a call that names none.
   */
  alias(
    ...names: [string, ...string[]]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareAlias(this.#state, names, 'alias'));
  }

  /**
   * Visible aliases are other portable names that route to this Command, as `alias()` declares,
   * and that help, the man page, completion, and the manifest show beside its canonical name:
   * `.visibleAlias('ls')` on `list` prints `(alias: ls)` on its row. They invalidate no call, and
   * the tuple rest parameter rejects a call that names none.
   *
   * @example
   * ```ts
   * import { Command } from '@loomcli/core';
   *
   * export const list = new Command('list', { description: 'List the cache.' })
   *   .visibleAlias('ls')
   *   .action(({ out }) => out.print('cache.db'));
   * ```
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#visible-aliases
   */
  visibleAlias(
    ...names: [string, ...string[]]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareAlias(this.#state, names, 'visibleAlias'));
  }

  /**
   * A child arrives in any type state, because its own action is the call that finished it. Its
   * global requirements join this Command's, so they meet the Application wherever the child sits.
   */
  command<const Child extends Command<unknown, unknown, never>>(
    child: Child & NoInfer<AttachmentConstraint<Globals, Child>>,
  ): Command<
    Args,
    Options,
    PassedUp<Globals, Child>,
    AfterCommand<State>,
    Result,
    Stdin,
    Provided
  > {
    return this.#derive<Args, Options, AfterCommand<State>, Result, PassedUp<Globals, Child>>(
      attachChild(this.#state, child),
    );
  }

  /**
   * The value this Command produces for its consumer. The type argument is stated by the author,
   * so the views record states no type of its own and an omitted argument names none either.
   */
  result<Value>(declaration: {
    views: ResultViews<NoInfer<Value>>;
  }): Command<
    Args,
    Options,
    Globals,
    AfterResult<State>,
    { kind: 'value'; value: Value },
    Stdin,
    Provided
  > {
    return this.#derive<Args, Options, AfterResult<State>, { kind: 'value'; value: Value }>(
      declareResult(this.#state, 'value', declaration),
    );
  }

  /** The same declaration over a sequence, whose type argument is one row. */
  rows<Row>(declaration: {
    views: RowViews<NoInfer<Row>>;
  }): Command<
    Args,
    Options,
    Globals,
    AfterResult<State>,
    { kind: 'rows'; row: Row },
    Stdin,
    Provided
  > {
    return this.#derive<Args, Options, AfterResult<State>, { kind: 'rows'; row: Row }>(
      declareResult(this.#state, 'rows', declaration),
    );
  }

  /**
   * Views after the fact. It merges by key, so an existing name is replaced in place and a new one
   * is appended, and `default` names the key core renders when nothing selects another, one of the
   * keys this call supplies.
   */
  views<const Replacements extends ResultViewsOf<Result>>(
    replacements: Replacements,
    options?: { default?: keyof Replacements & string },
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareResultViews(this.#state, replacements, options));
  }

  /** The action closes input authoring; `extend()` remains outside this state transition. */
  action(
    handler: Action<Args, Globals & Options, Result, Stdin, Provided>,
  ): Command<Args, Options, Globals, AfterAction, Result, Stdin, Provided> {
    return this.#derive(
      declareAction(this.#state, handler, { provided: this.#providedBind, stdin: this.#stdinBind }),
    );
  }

  /**
   * Adds extension values to the Command.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/extensions.md
   */
  extend(
    ...values: readonly ExtensionValue<'command'>[]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided> {
    return this.#derive(declareExtensions(this.#state, values));
  }

  /**
   * The same runtime value in the state the calling method's return type names. Each call states
   * its own transition, and the declared result travels with it unless the call replaces it.
   */
  #derive<
    DerivedArgs,
    DerivedOptions,
    Next extends CommandMethod,
    DerivedResult = Result,
    DerivedGlobals = Globals,
  >(
    state: CommandState<DerivedArgs, DerivedOptions, DerivedGlobals>,
  ): Command<DerivedArgs, DerivedOptions, DerivedGlobals, Next, DerivedResult, Stdin, Provided> {
    return new CommandBuilder<
      DerivedArgs,
      DerivedOptions,
      DerivedGlobals,
      Next,
      DerivedResult,
      Stdin,
      Provided
    >(this.#name, state, { provided: this.#providedBind, stdin: this.#stdinBind });
  }
}

/**
 * The authoring surface of a Command in one type state. Every call returns a new declaration value,
 * leaves its receiver unchanged, and publishes only the calls that are still valid after it. The
 * declarations themselves stay private, so no consumer can reach them. `State` lists the authoring
 * calls a value still offers. It defaults to the state after `action()`, which publishes the fewest
 * calls, so `Command<A, O, G>` accepts a Command in any state, a finished one included.
 *
 * @public
 * @sealed
 */
export type Command<
  Args = {},
  Options = {},
  Globals = {},
  State extends CommandMethod = AfterAction,
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
> = Pick<
  CommandBuilder<Args, Options, Globals, State, Result, Stdin, Provided>,
  typeof commandValue | typeof declaredTypes | 'extend' | State | ResultMethod<Result>
>;

/**
 * `views()` is published in every state on a declaration that carries a result, and on none that
 * carries none. It is a key of the picked surface rather than a member of the state union, because
 * the state union answers the calls a declaration closes and this one closes nothing.
 */
export type ResultMethod<Result> = unknown extends Result ? never : 'views';

/**
 * The core facts and initial extension values a named Command carries.
 *
 * @public
 */
export interface CommandOptions<Uses extends readonly AnyProvider[] = []> {
  /** The one-line summary of the Command, which help and every projection read. */
  description?: string;
  /** Keeps the Command off every listing. An omitted one reads `false`. */
  hidden?: boolean;
  /** The one-line migration message a listing shows beside the Command. */
  deprecated?: string;
  /**
   * The extension values the Command carries.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/extensions.md
   */
  extensions?: readonly ExtensionValue<'command'>[];
  /** The providers whose values the action reads under `provided`. */
  uses?: MetByRegistration<Uses, OptIn<Uses>>;
}

/**
 * The opt-in list as it stands outside a registered compilation, where the requirement passes up
 * to the Application. Where an Application's registration is visible, the Command's globals are
 * that Application's, so a list whose providers read an option it does not declare is rejected at
 * the Command.
 */
type MetByRegistration<Uses extends readonly AnyProvider[], List> = RegistrationVisible extends true
  ? [RegisteredGlobals] extends [ProviderGlobals<Uses>]
    ? List
    : List & {
        readonly 'The registered Application declares no global option these providers read': ProviderGlobals<Uses>;
      }
  : List;

/** Collect every union member's known local keys before testing for a global collision. */
type LocalKeys<Child> = Child extends {
  readonly [declaredTypes]: { options: infer Options };
}
  ? keyof Options
  : never;

export type AttachmentConstraint<Globals, Child> =
  Extract<keyof Globals, LocalKeys<Child>> extends never ? unknown : never;

/**
 * The global options a Command requires of the Application it attaches to. A child typed by the
 * widest annotation, whose requirement reads `never`, states none this parent can carry.
 */
type RequirementOf<Child> = Child extends {
  readonly [declaredTypes]: { globals: (value: infer Globals) => void };
}
  ? [Globals] extends [never]
    ? {}
    : Globals
  : never;

/** A parent's requirements once a child's join them, unchanged when the parent's already hold them. */
export type PassedUp<Globals, Child> = [Globals] extends [RequirementOf<Child>]
  ? Globals
  : Globals & RequirementOf<Child>;

type CommandConstructor = new <const Uses extends readonly AnyProvider[] = []>(
  name: string,
  options?: CommandOptions<Uses>,
) => Command<
  {},
  {},
  WithProviderGlobals<RegisteredGlobals, Uses>,
  CommandMethod,
  unknown,
  StdinContext,
  ProvidedValues<Uses>
>;

/**
 * The constructor uses the Application registration; public type defaults stay library-neutral.
 * Every rule on the name and the options slot throws before the value exists.
 */
class CommandDeclaration<const Uses extends readonly AnyProvider[] = []> extends CommandBuilder<
  {},
  {},
  WithProviderGlobals<RegisteredGlobals, Uses>,
  CommandMethod,
  unknown,
  StdinContext,
  ProvidedValues<Uses>
> {
  constructor(name: string, options?: CommandOptions<Uses>) {
    const declared = namedState<WithProviderGlobals<RegisteredGlobals, Uses>>(name, options);
    super(declared.name, declared.state, {
      provided: providedBinder<Uses>(options?.uses),
      stdin: (source) => ({ stdin: source }),
    });
  }
}

/**
 * The public constructor takes a name and one options object, as the Application does.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 *
 * export const greet = new Command('greet', { description: 'Print a greeting.' })
 *   .argument('name', { description: 'Who to greet.', required: true })
 *   .option('shout', { type: 'boolean', description: 'Print in capitals.' })
 *   .action(({ args, options, out }) => {
 *     const text = `Hello, ${args.name}`;
 *     out.print(options.shout ? text.toUpperCase() : text);
 *   });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#declaring-a-command
 * @public
 */
export const Command: CommandConstructor = CommandDeclaration;
