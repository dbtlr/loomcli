import type { RegisteredGlobals } from './environment.js';
import {
  commandSentence,
  commandSubject,
  DeclarationError,
  NonCallableCommandError,
  UnexpectedArgumentError,
  UnknownCommandError,
} from './errors.js';
import { buildCommandExtensions, buildExtensions } from './extension.js';
import type { DescriptorRegistry, ExtensionRecords, ExtensionValue } from './extension.js';
import {
  checkDeprecated,
  checkDescription,
  checkHidden,
  checkNoListingFacts,
  isPlainObject,
} from './facts.js';
import type { BuiltGlobals, GlobalsState, OptionOwner } from './globals.js';
import { buildGlobals, keyCollision, spellingCollision } from './globals.js';
import { compileOptions, extractGlobals, mergeValues, parseInputs } from './options.js';
import type { OptionValues } from './options.js';
import type { BuiltPlugin, PluginBuild } from './plugin.js';
import type { ContextualStyle } from './style.js';
import type {
  Action,
  ActionContext,
  ArgumentConfig,
  ArgumentValue,
  declaredTypes,
  DeclaredTypes,
  DefaultConstraint,
  GlobalNameConstraint,
  Host,
  MultipleConstraint,
  NameConstraint,
  OpenResult,
  OptionConfig,
  OptionValue,
  Out,
  ResultView,
  ResultViews,
  ResultViewsOf,
  RowView,
  RowViews,
  ValidateOmittedConstraint,
  View,
} from './types.js';
import { captureConfig, validateValues } from './validation.js';
import type {
  ArgumentInput,
  DefaultValues,
  InputDeclaration,
  OptionInput,
  ValidatedInputs,
} from './validation.js';

/** One positional slot: the declaration it fills and whether it takes the remaining tokens. */
export interface ArgumentSlot {
  input: InputDeclaration;
  required: boolean;
  variadic: boolean;
}

export interface DispatchInput {
  style: ContextualStyle;
  host: Host;
  /** The action's channel, whose `results` accepts whatever the routed declaration named. */
  out: Out<OpenResult>;
  passthrough: string[];
  signal: AbortSignal;
  values: ValidatedInputs;
}

/**
 * One child a bare token reaches, under its canonical name or one of its aliases.
 * `name` repeats the key `children` holds, because `BuiltCommand.name` is `string | null` for the
 * root and the routed path a child extends holds strings alone.
 */
export interface RoutedChild {
  command: BuiltCommand;
  name: string;
}

/**
 * One built result declaration: the unit the action emits, the presentations it names in record
 * order, and the key core renders when nothing selects another.
 */
export interface BuiltResult {
  default: string;
  kind: 'value' | 'rows';
  views: ReadonlyMap<string, ResultView>;
}

/**
 * A group registers no action, so its `dispatch` is `undefined` and selection rejects it.
 * `children` is keyed by canonical name, so every candidate list and every walk of the graph reads
 * it, and `routes` adds the aliases, so routing alone resolves them.
 */
export interface BuiltCommand {
  aliases: readonly string[];
  arguments: readonly ArgumentSlot[];
  children: ReadonlyMap<string, BuiltCommand>;
  deprecated: string | undefined;
  description: string | undefined;
  dispatch: ((input: DispatchInput) => unknown) | undefined;
  extensions: Readonly<Record<string, unknown>>;
  hidden: boolean;
  inputs: readonly InputDeclaration[];
  name: string | null;
  options: ReturnType<typeof compileOptions>;
  /** The result the Command declares, or nothing where it declares none. */
  result: BuiltResult | undefined;
  routes: ReadonlyMap<string, RoutedChild>;
}

/** Phantom key. It marks a Command value, so only a Command can be attached as a child. */
export declare const commandValue: unique symbol;

/**
 * The input, alias, child, and action calls a Command can publish. Its type state is a subset,
 * and each call removes the names it invalidates. A Command attaches children at any depth, so
 * `command()` belongs to every Command and to the unnamed root alike.
 */
export type CommandMethod =
  | 'action'
  | 'alias'
  | 'argument'
  | 'command'
  | 'option'
  | 'result'
  | 'rows';

/** One Command declares arguments or attaches children, so the first call removes the other. */
export type AfterArgument<State> = Exclude<State, 'command'>;

/** The same rule read from the other side. */
export type AfterCommand<State> = Exclude<State, 'argument'>;

/** One Command declares one result, so either call removes both. */
export type AfterResult<State> = Exclude<State, 'result' | 'rows'>;

/** Registering the action closes input, alias, child, and further action declarations. */
export type AfterAction = never;

/** A declaration made after its authoring phase closed; build reports the first in call order. */
type LateDeclaration =
  | { alias: string; kind: 'alias' }
  | { name: string; kind: 'global' }
  | { child: object; kind: 'child' }
  | { kind: 'result' }
  | { input: InputDeclaration; kind: 'input' };

/**
 * The names one `alias()` call declares. Each call keeps its own group, so a call that names none,
 * which the types reject and a JavaScript author can still write, reports as the call it is.
 */
type AliasDeclaration = readonly string[];

/** The attachable shape of a Command, without its inferred declaration types. */
interface AttachedCommand {
  readonly name: string | null;
  build(context: BuildContext): BuiltCommand;
}

/**
 * One graph build's shared state. `globals` compiles once and every Command reads it. `owners`
 * records the name of the parent that claimed each node, so a second parent holding the same value
 * is building a graph with more than one path to that node, not a tree. The build is a depth-first
 * walk in attachment order, and a parent claims each child as the walk reaches it, so the first
 * owner is the parent whose attachment the walk meets first.
 */
interface BuildContext {
  descriptors: DescriptorRegistry;
  extensions: ExtensionRecords;
  globals: BuiltGlobals;
  owners: Map<AttachedCommand, string | null>;
}

/** Authored values register here, so the public type publishes no state to reach or replace. */
const nodes = new WeakMap<object, AttachedCommand>();

/** Reads the declarations behind an attached value; anything else is a declaration error. */
function nodeOf(parent: string | null, child: object): AttachedCommand {
  const node = nodes.get(child);
  if (!node) {
    throw new DeclarationError(
      `${commandSentence(parent)} attaches a value that is not a Command. Attach the value returned by new Command(name).`,
    );
  }
  return node;
}

/** Reject retired globals wiring at graph build, before any invocation reads the options. */
function checkCommandOptions(name: string | null, options: unknown): void {
  if (options !== undefined && !isPlainObject(options)) {
    throw new DeclarationError(
      `${commandSentence(name)} options must be an object. Supply a Command options object.`,
    );
  }
  if (isPlainObject(options) && 'globals' in options) {
    throw new DeclarationError(
      `${commandSentence(name)} declares globals. Declare globals on the Application and register its environment.`,
    );
  }
}

/** One name rule for every declared name in the graph, so a child and an argument read alike. */
function isDeclaredName(name: unknown): name is string {
  return typeof name === 'string' && Boolean(name) && !name.startsWith('-') && !/[\s=]/u.test(name);
}

function checkChildName(parent: string | null, name: unknown): asserts name is string {
  if (!isDeclaredName(name)) {
    throw new DeclarationError(
      `${commandSentence(parent)} attaches a child named "${String(name)}". Use a nonempty name without a leading hyphen, whitespace, or "=".`,
    );
  }
}

/** An alias is a bare token the way a child name is, so it answers to the same name rule. */
function checkAliasName(command: string | null, alias: unknown): void {
  if (!isDeclaredName(alias)) {
    throw new DeclarationError(
      `${commandSentence(command)} declares an alias named "${String(alias)}". Use a nonempty name without a leading hyphen, whitespace, or "=".`,
    );
  }
}

/**
 * Everything one Command declaration holds. The transitions below copy it with fields replaced, and
 * the Command and Application builders share them, so one declaration call has one implementation.
 */
/**
 * One call of the results lane, in the order it was made. A `result()` or `rows()` call declares
 * the unit, and a `views()` call reshapes the presentation of whichever declaration it follows.
 * Each record arrives unexamined, because build owns every rule the lane carries.
 */
export type ResultCall =
  | { kind: 'value' | 'rows'; views: unknown }
  | { default: unknown; kind: 'views'; views: unknown };

export interface CommandState<Args, Options, Globals> {
  /**
   * The registered actions, with the declared result erased. An action is stored under the widest
   * result, so a handler typed from its own declaration stores here and the channel that carries
   * the result is built for it at dispatch.
   */
  actions: readonly Action<Args, Globals & Options, OpenResult>[];
  aliases: readonly AliasDeclaration[];
  bind: (values: ValidatedInputs) => { args: Args; options: Options };
  children: readonly object[];
  // The migration message the constructor read out of the options slot, unexamined until build.
  deprecated: unknown;
  // The description the constructor read out of the options slot, unexamined until build.
  // The Application checks its own slot, so the root carries none here.
  description: unknown;
  // The extension values the same slot carried, read at build against the `command` target.
  extensions: readonly unknown[];
  // Whether every listing omits this Command, read at build like the other core facts.
  // The Application checks its own slot, so the root carries none here either.
  hidden: unknown;
  inputs: readonly InputDeclaration[];
  late: readonly LateDeclaration[];
  name: string | null;
  // The constructor's raw options argument, kept for the slot's own shape rules.
  // Those rules answer at the same point every other authoring fault does.
  options: unknown;
  // Every results-lane call in call order, which build reads as one declaration.
  results: readonly ResultCall[];
}

/**
 * The state every declaration starts from. The unnamed root and each named Command share it.
 * The declaration values arrive captured, because a later change to the options object the author
 * passed changes nothing the declaration holds.
 */
export function freshState<Globals>(declaration: {
  deprecated: unknown;
  description: unknown;
  extensions: unknown;
  hidden: unknown;
  name: string | null;
  options: unknown;
}): CommandState<{}, {}, Globals> {
  return {
    actions: [],
    aliases: [],
    bind: () => ({ args: {}, options: {} }),
    children: [],
    deprecated: declaration.deprecated,
    description: declaration.description,
    extensions: [declaration.extensions],
    hidden: declaration.hidden,
    inputs: [],
    late: [],
    name: declaration.name,
    options: declaration.options,
    results: [],
  };
}

/** A declaration after the action is an order fault; build reports the first one recorded. */
function recordLate<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  declarations: readonly LateDeclaration[],
): readonly LateDeclaration[] {
  return state.actions.length > 0 ? [...state.late, ...declarations] : state.late;
}

/** The declared value joins `args` under its literal name, typed by its own config. */
export function declareArgument<
  Args,
  Options,
  Globals,
  Name extends string,
  Config extends ArgumentConfig,
>(
  state: CommandState<Args, Options, Globals>,
  input: ArgumentInput<Name, Config>,
): CommandState<Args & Record<Name, ArgumentValue<Config>>, Options, Globals> {
  const previous = state.bind;
  return {
    ...state,
    bind: (values) => {
      const bound = previous(values);
      return { ...bound, args: { ...bound.args, ...values.argument(input) } };
    },
    inputs: [...state.inputs, input],
    late: recordLate(state, [{ input, kind: 'input' }]),
  };
}

/** The declared value joins `options` under its literal name, typed by its own config. */
export function declareOption<
  Args,
  Options,
  Globals,
  Name extends string,
  Config extends OptionConfig,
>(
  state: CommandState<Args, Options, Globals>,
  input: OptionInput<Name, Config>,
): CommandState<Args, Options & Record<Name, OptionValue<Config>>, Globals> {
  const previous = state.bind;
  return {
    ...state,
    bind: (values) => {
      const bound = previous(values);
      return { ...bound, options: { ...bound.options, ...values.option(input) } };
    },
    inputs: [...state.inputs, input],
    late: recordLate(state, [{ input, kind: 'input' }]),
  };
}

/** Globals close when composition starts; retain late calls for the shared build-order check. */
export function recordGlobalOption<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  name: string,
): CommandState<Args, Options, Globals> {
  return {
    ...state,
    late:
      state.actions.length > 0 || state.children.length > 0
        ? [...state.late, { kind: 'global', name }]
        : state.late,
  };
}

/** One call's names stay one group, so the empty call the types reject still reports as one. */
export function declareAlias<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  names: AliasDeclaration,
): CommandState<Args, Options, Globals> {
  return {
    ...state,
    aliases: [...state.aliases, names],
    late: recordLate(
      state,
      names.map((alias): LateDeclaration => ({ alias, kind: 'alias' })),
    ),
  };
}

/** Extension layers remain open after inputs and the action have been fixed. */
export function declareExtensions<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  values: readonly ExtensionValue<'command'>[],
): CommandState<Args, Options, Globals> {
  return { ...state, extensions: [...state.extensions, values] };
}

/**
 * The same channel, read as the result the handler's own declaration names. The value one call
 * emits is checked where the action was authored, and the channel core hands an action accepts
 * whatever the routed declaration named, so this reading adds no promise the run does not keep.
 */
function declaredChannel<Result>(out: Out<OpenResult>): Out<Result> {
  return { ...out, results: (value) => out.results(value) };
}

/**
 * The handler is typed against the result its own declaration carries, and the state holds one
 * list for every declaration, so the context each handler receives is read back at the call.
 */
export function declareAction<Args, Options, Globals, Result>(
  state: CommandState<Args, Options, Globals>,
  handler: Action<Args, Globals & Options, Result>,
): CommandState<Args, Options, Globals> {
  const stored = (context: ActionContext<Args, Globals & Options, OpenResult>): unknown =>
    handler({ ...context, out: declaredChannel(context.out) });
  return { ...state, actions: [...state.actions, stored] };
}

/** The result declaration, which closes both result calls and reports lateness like the rest. */
export function declareResult<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  kind: 'value' | 'rows',
  declaration: unknown,
): CommandState<Args, Options, Globals> {
  return {
    ...state,
    late: recordLate(state, [{ kind: 'result' }]),
    results: [...state.results, { kind, views: recordOf(declaration, 'views') }],
  };
}

/** A `views()` call reshapes presentation and closes nothing, so it is never a late declaration. */
export function declareResultViews<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  replacements: unknown,
  options: unknown,
): CommandState<Args, Options, Globals> {
  return {
    ...state,
    results: [
      ...state.results,
      { default: recordOf(options, 'default'), kind: 'views', views: replacements },
    ],
  };
}

/** One property of an authoring argument, read defensively: build reports whatever it holds. */
function recordOf(declaration: unknown, key: 'default' | 'views'): unknown {
  return isPlainObject(declaration) ? declaration[key] : undefined;
}

/** Attaching is a declaration call too, so the receiver keeps the children it already had. */
export function attachChild<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  child: object,
): CommandState<Args, Options, Globals> {
  return {
    ...state,
    children: [...state.children, child],
    late: recordLate(state, [{ child, kind: 'child' }]),
  };
}

/** The untyped part of a declaration, which every build check reads regardless of its generics. */
type Declared = Pick<
  CommandState<unknown, unknown, unknown>,
  'aliases' | 'children' | 'inputs' | 'late' | 'name' | 'results'
>;

/** The types remove a late call for TypeScript authors; JavaScript authors read it here. */
function checkDeclarationOrder(state: Declared): void {
  const { name } = state;
  const late = state.late[0];
  if (!late) {
    return;
  }
  if (late.kind === 'global') {
    throw new DeclarationError(
      `The Application declares global option "${late.name}" after command() or action(). Declare global options before attaching Commands or registering an action.`,
    );
  }
  if (late.kind === 'input') {
    throw new DeclarationError(
      `${commandSentence(name)} declares ${late.input.kind} "${late.input.name}" after its action. Declare arguments and options before action().`,
    );
  }
  if (late.kind === 'alias') {
    throw new DeclarationError(
      `${commandSentence(name)} declares alias "${late.alias}" after its action. Declare aliases before action().`,
    );
  }
  if (late.kind === 'result') {
    throw new DeclarationError(
      `${commandSentence(name)} declares its result after its action. Declare result() or rows() before action().`,
    );
  }
  // Child identity and names are settled before this call, so the node and its name are valid.
  throw new DeclarationError(
    `${commandSentence(name)} attaches child "${String(nodeOf(name, late.child).name)}" after its action. Attach children before action().`,
  );
}

/** Child names are checked before any child builds, so parent diagnostics come first. */
function collectChildren(state: Declared): [string, AttachedCommand][] {
  const attached: [string, AttachedCommand][] = [];
  const seen = new Set<string>();
  for (const child of state.children) {
    const node = nodeOf(state.name, child);
    const name = node.name;
    checkChildName(state.name, name);
    if (seen.has(name)) {
      throw new DeclarationError(
        `${commandSentence(state.name)} attaches two children named "${name}". Rename or remove one.`,
      );
    }
    seen.add(name);
    attached.push([name, node]);
  }
  return attached;
}

/**
 * A Command's own alias rules, and the flat list in declaration order that routing and inspection
 * read. Each call keeps its own group, so a call that names none reports as the call it is.
 */
function collectAliases(state: Declared): string[] {
  const { name } = state;
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const declaration of state.aliases) {
    if (declaration.length === 0) {
      throw new DeclarationError(
        `${commandSentence(name)} declares an alias with no names. Supply at least one name.`,
      );
    }
    for (const alias of declaration) {
      checkAliasName(name, alias);
      if (alias === name) {
        throw new DeclarationError(
          `${commandSentence(name)} declares alias "${alias}", which is its own name. Remove the alias.`,
        );
      }
      if (seen.has(alias)) {
        throw new DeclarationError(
          `${commandSentence(name)} declares alias "${alias}" twice. Remove the repeated alias.`,
        );
      }
      seen.add(alias);
      aliases.push(alias);
    }
  }
  return aliases;
}

/**
 * One parent's namespace, which every canonical name and alias under it shares. Each child settled
 * its own alias rules while it built, so what is left is the collision with a sibling. The names are
 * read before the walk, so the rule reads the same whichever sibling the author declared first.
 */
function aliasNamespace(parent: string | null, names: ReadonlySet<string>) {
  const owners = new Map<string, string>();
  return function claim(child: string, alias: string): void {
    if (names.has(alias)) {
      throw new DeclarationError(
        `${commandSentence(parent)} attaches child "${child}" with alias "${alias}", which is also the name of child "${alias}". Rename or remove one.`,
      );
    }
    const owner = owners.get(alias);
    if (owner !== undefined) {
      throw new DeclarationError(
        `${commandSentence(parent)} attaches child "${child}" with alias "${alias}", which is also an alias of child "${owner}". Rename or remove one.`,
      );
    }
    owners.set(alias, child);
  };
}

/**
 * Claims a child for its parent when the depth-first walk reaches it, then builds its subtree. A
 * claimed node always means a second parent, because the duplicate-name rule rejects one parent
 * attaching a value twice. Parents may share a name, so the claim is by node identity and the name
 * serves the diagnostic alone.
 */
function buildChild(
  parent: string | null,
  [name, node]: [string, AttachedCommand],
  context: BuildContext,
): BuiltCommand {
  const owner = context.owners.get(node);
  if (owner !== undefined) {
    throw new DeclarationError(
      `${commandSentence(parent)} attaches child "${name}", which ${commandSubject(owner)} also attaches. Attach a Command value at one point; create a new Command for each placement.`,
    );
  }
  context.owners.set(node, parent);
  return node.build(context);
}

/** A variadic or optional slot ends the positional list, so nothing may follow either one. */
function checkSlotOrder(slot: ArgumentSlot, next: ArgumentSlot, subject: string) {
  if (slot.variadic) {
    throw new DeclarationError(
      `Argument "${slot.input.name}" is variadic and precedes argument "${next.input.name}" on ${subject}. Declare the variadic argument last.`,
    );
  }
  if (!slot.required) {
    throw new DeclarationError(
      next.required
        ? `Argument "${slot.input.name}" is optional and precedes required argument "${next.input.name}" on ${subject}. Declare optional arguments after required ones.`
        : `Argument "${next.input.name}" follows optional argument "${slot.input.name}" on ${subject}. Declare an optional argument last.`,
    );
  }
}

function collectArguments(state: Declared, subject: string): ArgumentSlot[] {
  const slots: ArgumentSlot[] = [];
  const seen = new Set<string>();
  for (const input of state.inputs.filter((entry) => entry.kind === 'argument')) {
    if (!isDeclaredName(input.name)) {
      throw new DeclarationError(
        `${commandSentence(state.name)} declares an argument named "${String(input.name)}". Use a nonempty name without a leading hyphen, whitespace, or "=".`,
      );
    }
    if (seen.has(input.name)) {
      throw new DeclarationError(
        `Argument "${input.name}" is declared more than once on ${subject}. Remove or rename the duplicate.`,
      );
    }
    seen.add(input.name);
    slots.push({
      input,
      required: input.config.required === true,
      variadic: input.config.variadic === true,
    });
  }
  for (let index = 0; index + 1 < slots.length; index += 1) {
    const slot = slots[index];
    const next = slots[index + 1];
    if (slot && next) {
      checkSlotOrder(slot, next, subject);
    }
  }
  return slots;
}

/**
 * One Command's own options against the shared globals table. The table holds the application's
 * globals and every plugin option, so a local collision reads the same sentence whichever scope on
 * the other side claimed the name or the spelling.
 */
function compileLocalOptions(state: Declared, globals: BuiltGlobals, subject: string) {
  const declarations = state.inputs.filter((input) => input.kind === 'option');
  const local: OptionOwner = { kind: 'local', subject };
  const application: OptionOwner = { kind: 'application' };
  for (const declaration of declarations) {
    const claimed = globals.names.get(declaration.name);
    if (claimed) {
      throw keyCollision(declaration.name, claimed, local);
    }
  }
  const options = compileOptions(declarations, subject);
  for (const [spelling, option] of options) {
    const global = globals.options.get(spelling);
    if (global) {
      throw spellingCollision(
        spelling,
        { name: global.name, owner: globals.names.get(global.name) ?? application },
        { name: option.name, owner: local },
      );
    }
  }
  return options;
}

/**
 * A Command without an action is a group, and routing sends an invocation on to one of its
 * children. A group with no children receives an invocation no handler can answer, and a local
 * option on a group reaches no handler either, because locals never inherit.
 */
function checkGroup(state: Declared, children: readonly [string, AttachedCommand][]): void {
  const { name } = state;
  if (children.length === 0) {
    throw new DeclarationError(`${commandSentence(name)} has no action. Register an action.`);
  }
  const option = state.inputs.find((input) => input.kind === 'option');
  if (option) {
    throw new DeclarationError(
      `${commandSentence(name)} declares option "${option.name}" but registers no action to receive it. Register an action or remove the option.`,
    );
  }
}

/**
 * A presentation name is a bare token the way a child name is, and never an array index, because
 * an integer-like key does not keep the position the author gave it.
 */
function isPresentationName(name: string): boolean {
  return isDeclaredName(name) && !/^(?:0|[1-9]\d*)$/u.test(name);
}

/** One entry read back as the whole view its own `render` function names. */
function isWholeView(entry: unknown): entry is View<never> {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'render' in entry &&
    typeof entry.render === 'function'
  );
}

/** The same reading for the row shape, which core feeds one row at a time. */
function isRowView(entry: unknown): entry is RowView<never> {
  return (
    typeof entry === 'object' && entry !== null && 'row' in entry && typeof entry.row === 'function'
  );
}

/**
 * The key one `views()` call selected, spelled the way its own diagnostic names it. A call that
 * names none keeps whichever key an earlier call named.
 */
function selectedKey(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined');
}

/** The entries one authored `views` record holds, in record order; anything else holds none. */
function recordEntries(record: unknown): [string, unknown][] {
  return isPlainObject(record) ? Object.entries(record) : [];
}

/**
 * One `views` entry under the unit its declaration named, read back as the shape its own functions
 * name. The two shapes are exclusive, and a row view answers a rows declaration alone.
 */
function resultView(
  declaration: { kind: 'value' | 'rows'; sentence: string },
  name: string,
  entry: unknown,
): ResultView {
  const { kind, sentence } = declaration;
  const whole = isWholeView(entry);
  const row = isRowView(entry);
  if (whole && row) {
    throw new DeclarationError(
      `${sentence} names view "${name}" with render and row. Supply one of the two.`,
    );
  }
  if (row) {
    if (kind === 'value') {
      throw new DeclarationError(
        `${sentence} names row view "${name}" on a value result. Supply a view with render, or declare the result with rows().`,
      );
    }
    return entry;
  }
  if (whole) {
    return entry;
  }
  throw new DeclarationError(
    `${sentence} names view "${name}" with a value that is not a view. Supply a view with render or a row view with row.`,
  );
}

/**
 * Every rule the results lane carries, applied to one Command's calls in the order it made them.
 * The merged record is what the rules read: a later `views()` call replaces a key in place and
 * appends a new one, so each name keeps the position the call that first named it gave it. A
 * `default` once named persists through later calls that name none, and the first key answers
 * until one is named.
 */
function buildResult(state: Declared, hasAction: boolean): BuiltResult | undefined {
  const sentence = commandSentence(state.name);
  const declarations = state.results.filter((call) => call.kind !== 'views');
  if (declarations.length > 1) {
    throw new DeclarationError(
      `${sentence} declares two results. Declare one result() or rows() call.`,
    );
  }
  const declaration = declarations[0];
  // A `views()` call on a declaration that carries no result reshapes nothing, and the types
  // Publish the call where a result is carried alone.
  if (!declaration) {
    return undefined;
  }
  if (!hasAction) {
    throw new DeclarationError(
      `${sentence} declares a result and no action. Register an action or remove the result.`,
    );
  }
  const views = new Map<string, ResultView>();
  let selected: string | undefined = undefined;
  for (const call of state.results) {
    for (const [name, entry] of recordEntries(call.views)) {
      const view = resultView({ kind: declaration.kind, sentence }, name, entry);
      if (!isPresentationName(name)) {
        throw new DeclarationError(
          `${sentence} names view "${name}". Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.`,
        );
      }
      views.set(name, view);
    }
    if (call.kind === 'views') {
      selected = selectedKey(call.default) ?? selected;
    }
  }
  const first = views.keys().next();
  if (first.done === true) {
    throw new DeclarationError(
      `${sentence} declares a result with no views. Name at least one view.`,
    );
  }
  if (selected !== undefined && !views.has(selected)) {
    throw new DeclarationError(
      `${sentence} selects default view "${selected}", which it does not name. Name the view or select a named one.`,
    );
  }
  return { default: selected ?? first.value, kind: declaration.kind, views };
}

/** Binds one Command's declarations to its action, so an action reads only validated values. */
function bindDispatch<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  action: Action<Args, Globals & Options>,
  globals: BuiltGlobals,
) {
  return ({ host, out, passthrough, signal, style, values }: DispatchInput) => {
    const bound = state.bind(values);
    // Last resort: no typed path exists. The graph erases the binder's generic relationship.
    // It holds because attachment checks the global output requirement and graph build rejects
    // Global/local collisions. This binder returns the Application's validated globals alone.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const globalOptions = globals.bind(values) as Globals;
    return action({
      args: bound.args,
      host,
      options: { ...globalOptions, ...bound.options },
      out,
      passthrough,
      signal,
      style,
    });
  };
}

/** Validates one declaration against the shared globals table and compiles it for dispatch. */
export function buildCommand<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  context: BuildContext,
): BuiltCommand {
  const { actions, name } = state;
  const { globals } = context;
  const subject = commandSubject(name);
  checkCommandOptions(name, state.options);
  const description = checkDescription(commandSentence(name), state.description);
  const hidden = checkHidden(commandSentence(name), state.hidden);
  const deprecated = checkDeprecated(commandSentence(name), state.deprecated);
  const extensions = buildCommandExtensions({
    descriptors: context.descriptors,
    layers: state.extensions,
    subject: { phrase: `on ${subject}`, sentence: commandSentence(name) },
  });
  // Each declaration's own facts, in authoring order, before the rules that pair declarations.
  for (const input of state.inputs) {
    const sentence = `${commandSentence(name)} ${input.kind} "${input.name}"`;
    checkDescription(sentence, input.config.description);
    if (input.kind === 'argument') {
      checkNoListingFacts(sentence, input.config);
    } else {
      checkHidden(sentence, input.config.hidden);
      checkDeprecated(sentence, input.config.deprecated);
    }
    context.extensions.set(
      input,
      buildExtensions({
        declared: input.config.extensions,
        descriptors: context.descriptors,
        subject: { phrase: `on ${subject} ${input.kind} "${input.name}"`, sentence },
        target: input.kind,
      }),
    );
  }
  const attached = collectChildren(state);
  checkDeclarationOrder(state);
  const aliases = collectAliases(state);
  const slots = collectArguments(state, subject);
  const first = slots[0];
  const child = attached[0];
  if (first && child) {
    throw new DeclarationError(
      `${commandSentence(name)} declares argument "${first.input.name}" and attaches child "${child[0]}". Move the argument into a child Command or remove the children.`,
    );
  }
  if (actions.length > 1) {
    throw new DeclarationError(
      `${commandSentence(name)} has multiple actions. Register one action.`,
    );
  }
  const action = actions[0];
  const result = buildResult(state, action !== undefined);
  if (!action) {
    checkGroup(state, attached);
  }
  const options = compileLocalOptions(state, globals, subject);
  const children = new Map<string, BuiltCommand>();
  const routes = new Map<string, RoutedChild>();
  const claim = aliasNamespace(name, new Set(attached.map((entry) => entry[0])));
  for (const entry of attached) {
    // The subtree builds before its aliases are claimed, so the tree rule keeps its precedence.
    const routed: RoutedChild = { command: buildChild(name, entry, context), name: entry[0] };
    children.set(routed.name, routed.command);
    routes.set(routed.name, routed);
    for (const alias of routed.command.aliases) {
      claim(routed.name, alias);
      routes.set(alias, routed);
    }
  }
  return {
    aliases,
    arguments: slots,
    children,
    deprecated,
    description,
    dispatch: action ? bindDispatch(state, action, globals) : undefined,
    extensions,
    hidden,
    inputs: state.inputs,
    name,
    options,
    result,
    routes,
  };
}

/** One built graph: the shared globals table, the root Command, and the facts each node carries. */
export interface BuiltGraph {
  extensions: ExtensionRecords;
  globals: BuiltGlobals;
  root: BuiltCommand;
}

/** The globals table and the owners record each compile once per invocation and the whole graph shares them. */
export function buildGraph<Args, Options, Globals>(
  root: CommandState<Args, Options, Globals>,
  globals: GlobalsState<Globals>,
  install: PluginBuild & { plugins: readonly BuiltPlugin[] },
): BuiltGraph {
  const context: BuildContext = {
    descriptors: install.descriptors,
    extensions: install.extensions,
    globals: buildGlobals(globals, install.plugins, install),
    owners: new Map(),
  };
  return {
    extensions: context.extensions,
    globals: context.globals,
    root: buildCommand(root, context),
  };
}

export class CommandBuilder<
  Args,
  Options,
  Globals,
  State extends CommandMethod = CommandMethod,
  Result = unknown,
> {
  declare readonly [commandValue]: true;
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals, Result>;

  readonly #state: CommandState<Args, Options, Globals>;

  constructor(state: CommandState<Args, Options, Globals>) {
    this.#state = state;
    nodes.set(this, this);
  }

  get name(): string | null {
    return this.#state.name;
  }

  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Command<
    Args & Record<Name, ArgumentValue<Config>>,
    Options,
    Globals,
    AfterArgument<State>,
    Result
  > {
    const input: ArgumentInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'argument',
      name,
    };
    return this.derive(declareArgument(this.#state, input));
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<MultipleConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Command<Args, Options & Record<Name, OptionValue<Config>>, Globals, State, Result> {
    const input: OptionInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'option',
      name,
    };
    return this.derive(declareOption(this.#state, input));
  }

  /**
   * Aliases are other bare tokens that route to this Command. They invalidate no call, and the
   * tuple rest parameter rejects a call that names none.
   */
  alias(...names: [string, ...string[]]): Command<Args, Options, Globals, State, Result> {
    return this.derive(declareAlias(this.#state, names));
  }

  /** A child arrives in any type state, because its own action is the call that finished it. */
  command<const Child extends Command<unknown, unknown, Globals>>(
    child: Child & NoInfer<AttachmentConstraint<Globals, Child>>,
  ): Command<Args, Options, Globals, AfterCommand<State>, Result> {
    return this.derive(attachChild(this.#state, child));
  }

  /**
   * The value this Command produces for its consumer. The type argument is stated by the author,
   * so the views record states no type of its own and an omitted argument names none either.
   */
  result<Value>(declaration: {
    views: ResultViews<NoInfer<Value>>;
  }): Command<Args, Options, Globals, AfterResult<State>, { kind: 'value'; value: Value }> {
    return this.derive<Args, Options, AfterResult<State>, { kind: 'value'; value: Value }>(
      declareResult(this.#state, 'value', declaration),
    );
  }

  /** The same declaration over a sequence, whose type argument is one row. */
  rows<Row>(declaration: {
    views: RowViews<NoInfer<Row>>;
  }): Command<Args, Options, Globals, AfterResult<State>, { kind: 'rows'; row: Row }> {
    return this.derive<Args, Options, AfterResult<State>, { kind: 'rows'; row: Row }>(
      declareResult(this.#state, 'rows', declaration),
    );
  }

  /**
   * Presentation after the fact. It merges by key, so an existing name is replaced in place and a
   * new one is appended, and `default` names the key core renders when nothing selects another.
   */
  views(
    replacements: ResultViewsOf<Result>,
    options?: { default?: string },
  ): Command<Args, Options, Globals, State, Result> {
    return this.derive(declareResultViews(this.#state, replacements, options));
  }

  /** The action closes input authoring; `extend()` remains outside this state transition. */
  action(
    handler: Action<Args, Globals & Options, Result>,
  ): Command<Args, Options, Globals, AfterAction, Result> {
    return this.derive(declareAction(this.#state, handler));
  }

  extend(
    ...values: readonly ExtensionValue<'command'>[]
  ): Command<Args, Options, Globals, State, Result> {
    return this.derive(declareExtensions(this.#state, values));
  }

  build(context: BuildContext): BuiltCommand {
    return buildCommand(this.#state, context);
  }

  /**
   * The same runtime value in the state the calling method's return type names. Each call states
   * its own transition, and the declared result travels with it unless the call replaces it.
   */
  private derive<DerivedArgs, DerivedOptions, Next extends CommandMethod, DerivedResult = Result>(
    state: CommandState<DerivedArgs, DerivedOptions, Globals>,
  ): Command<DerivedArgs, DerivedOptions, Globals, Next, DerivedResult> {
    return new CommandBuilder<DerivedArgs, DerivedOptions, Globals, Next, DerivedResult>(state);
  }
}

/**
 * The authoring surface of a Command in one type state. Every call returns a new declaration value,
 * leaves its receiver unchanged, and publishes only the calls that are still valid after it. The
 * declarations themselves stay private, so no consumer can reach them. `State` lists the authoring
 * calls a value still offers. It defaults to the state after `action()`, which publishes the fewest
 * calls, so `Command<A, O, G>` accepts a Command in any state, a finished one included.
 */
export type Command<
  Args = {},
  Options = {},
  Globals = {},
  State extends CommandMethod = AfterAction,
  Result = unknown,
> = Pick<
  CommandBuilder<Args, Options, Globals, State, Result>,
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
 */
export interface CommandOptions {
  description?: string;
  hidden?: boolean;
  deprecated?: string;
  extensions?: readonly ExtensionValue<'command'>[];
}

/** Collect every union member's known local keys before testing for a global collision. */
type LocalKeys<Child> = Child extends {
  readonly [declaredTypes]: { options: infer Options };
}
  ? keyof Options
  : never;

export type AttachmentConstraint<Globals, Child> =
  Extract<keyof Globals, LocalKeys<Child>> extends never ? unknown : never;

type CommandConstructor = new (
  name: string,
  options?: CommandOptions,
) => Command<{}, {}, RegisteredGlobals, CommandMethod>;

/** The constructor uses the Application registration; public type defaults stay library-neutral. */
class CommandDeclaration extends CommandBuilder<{}, {}, RegisteredGlobals> {
  constructor(name: string, options?: CommandOptions) {
    super(
      freshState({
        deprecated: options?.deprecated,
        description: options?.description,
        extensions: options?.extensions,
        hidden: options?.hidden,
        name,
        options,
      }),
    );
  }
}

/** The public constructor takes a name and one options object, as the Application does. */
export const Command: CommandConstructor = CommandDeclaration;

/** Every declaration in the graph, so defaults are validated before any token is read. */
export function collectInputs(command: BuiltCommand): InputDeclaration[] {
  return [
    ...command.inputs,
    ...[...command.children.values()].flatMap((child) => collectInputs(child)),
  ];
}

/**
 * The names a routing failure offers: the canonical names of the visible children, in authoring
 * order. A candidate list is a listing, so a hidden child is absent from it, and a parent whose
 * children are all hidden offers none.
 */
function candidatesOf(command: BuiltCommand): string[] {
  return [...command.children].filter(([, child]) => !child.hidden).map(([name]) => name);
}

/** Bare tokens, names or aliases, select children until a Command has none; a hyphen commits. */
export function route(root: BuiltCommand, tokens: readonly string[]) {
  let command = root;
  const path: string[] = [];
  let index = 0;
  while (command.children.size > 0) {
    const token = tokens[index];
    if (token === undefined || token === '--' || token.startsWith('-')) {
      break;
    }
    const child = command.routes.get(token);
    if (!child) {
      throw new UnknownCommandError(token, candidatesOf(command));
    }
    // An alias routes like the canonical name, and the path it walks reports that name alone.
    command = child.command;
    path.push(child.name);
    index += 1;
  }
  return { command, path, tokens: tokens.slice(index) };
}

/**
 * The tokens each positional slot received. An omitted required argument binds nothing here and
 * reports as a missing input in the validation phase, so omission has one class whether the input
 * is an argument or an option. Extra tokens are a token fault, so this phase still reports them.
 */
function bindArguments(
  command: BuiltCommand,
  path: readonly string[],
  positionals: readonly string[],
) {
  const values = new Map<InputDeclaration, string | string[]>();
  let index = 0;
  for (const slot of command.arguments) {
    if (slot.variadic) {
      const rest = positionals.slice(index);
      // An empty tail binds nothing, so validation reads it as `[]` or reports the omission.
      if (rest.length > 0) {
        values.set(slot.input, rest);
      }
      index = positionals.length;
    } else {
      const value = positionals[index];
      if (value !== undefined) {
        values.set(slot.input, value);
        index += 1;
      }
    }
  }
  if (index < positionals.length) {
    throw new UnexpectedArgumentError(path, command.arguments.length, positionals.slice(index));
  }
  return values;
}

/** One invocation after the pre-scan and routing, which the middleware chain runs on top of. */
export interface RoutedInvocation {
  command: BuiltCommand;
  path: readonly string[];
  scan: OptionValues;
  tokens: readonly string[];
}

/** Consumes the globals table, then routes the remaining bare tokens to a Command. */
export function routeInvocation(graph: BuiltGraph, argv: readonly string[]): RoutedInvocation {
  const scan = extractGlobals(graph.globals.options, [...argv]);
  const routed = route(graph.root, scan.rest);
  return {
    command: routed.command,
    path: routed.path,
    scan: scan.values,
    tokens: routed.tokens,
  };
}

/**
 * The phases the middleware chain terminates in: the callable check, local parsing, validation, and
 * the action. It answers with the call that dispatches, so the caller records that the action was
 * invoked at the moment it invokes it and no earlier failure reads as a dispatch.
 */
export async function prepareDispatch(
  graph: BuiltGraph,
  routed: RoutedInvocation,
  invocation: {
    defaults: DefaultValues;
    host: Host;
    /** The channel the action receives, which the results lane builds from the routed node. */
    out: Out<OpenResult>;
    signal: AbortSignal;
    style: ContextualStyle;
  },
): Promise<() => unknown> {
  const { command, path, scan } = routed;
  const { dispatch } = command;
  // A group answers no invocation of its own, so it fails with the routing errors above it.
  if (!dispatch) {
    throw new NonCallableCommandError(path, candidatesOf(command));
  }
  const parsed = parseInputs(command.options, routed.tokens);
  const args = bindArguments(command, path, parsed.positionals);
  const values = await validateValues({
    command: path,
    defaults: invocation.defaults,
    host: invocation.host,
    inputs: { globals: graph.globals.inputs, locals: command.inputs },
    passthrough: parsed.passthrough,
    supplied: { args, options: mergeValues(scan, parsed.options) },
  });
  return () =>
    dispatch({
      host: invocation.host,
      out: invocation.out,
      passthrough: parsed.passthrough,
      signal: invocation.signal,
      style: invocation.style,
      values,
    });
}
