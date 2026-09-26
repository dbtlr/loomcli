import { checkEnvBinding, checkNoArgumentBinding } from './bindings.js';
import type { RegisteredGlobals } from './environment.js';
import {
  commandSentence,
  commandSubject,
  DeclarationError,
  InternalError,
  NonCallableCommandError,
  ResultError,
  UnexpectedArgumentError,
  UnknownCommandError,
} from './errors.js';
import {
  buildExtensions,
  extendStore,
  publishStore,
  registerDescriptor,
  storeCommandLayers,
  validateLayer,
} from './extension.js';
import type {
  AnyExtension,
  DescriptorRegistry,
  ExtensionRecords,
  ExtensionStore,
  ExtensionSubject,
  ExtensionValue,
} from './extension.js';
import {
  checkDeprecated,
  checkDescription,
  checkHidden,
  checkNoListingFacts,
  isPlainObject,
} from './facts.js';
import type { BuiltGlobals, GlobalsState, GlobalTable, InputRecords } from './globals.js';
import { buildGlobals, checkLocalOptions } from './globals.js';
import { nodeAt, resultNode, snapshot } from './inspect.js';
import type { CommandGraph, OptionNode, ResultNode } from './inspect.js';
import {
  compileOptions,
  copyValues,
  emptyValues,
  extractGlobals,
  mergeValues,
  parseInputs,
} from './options.js';
import type { OptionValues } from './options.js';
import type { BuiltPlugin } from './plugin.js';
import { fillInputs } from './sources.js';
import type { SourceOutcome } from './sources.js';
import type { ContextualStyle } from './style.js';
import type {
  Action,
  ActionChannel,
  ActionContext,
  ArgumentConfig,
  ArgumentValue,
  AttachedCommand,
  attachedCommand,
  CommandAttachHook,
  declaredTypes,
  DeclaredResult,
  DeclaredTypes,
  DefaultConstraint,
  GlobalNameConstraint,
  Host,
  PerValueConstraint,
  NameConstraint,
  OpenResult,
  OptionConfig,
  OptionValue,
  Out,
  Request,
  ResultBinding,
  ResultView,
  ResultViews,
  ResultViewsOf,
  RowView,
  RowViews,
  ValidateOmittedConstraint,
  View,
} from './types.js';
import { captureConfig, checkDeclarations, validateValues } from './validation.js';
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
  /** The built declaration is the shape the write site reads, so the channel carries it. */
  result: DeclaredResult | undefined;
  routes: ReadonlyMap<string, RoutedChild>;
}

/** Phantom key. It marks a Command value, so only a Command can be attached as a child. */
export declare const commandValue: unique symbol;

/**
 * The input, alias, child, and action calls a Command can publish. Its type state is a subset,
 * and each call removes the names it invalidates. `command()` belongs to every Command and to the
 * unnamed root alike, and attach bounds how deep the children it adds may nest.
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

/**
 * The deepest level below the root a Command may sit at, and the word its diagnostic spells it with.
 * A child of the root sits at level 1. Raising the cap relaxes a rule and breaks no application.
 */
const nestingCap = { depth: 2, words: 'two' };

/**
 * The shallowest level a parent can sit at: the root is level 0, and a named Command is attached
 * somewhere below it, so it sits at level 1 or deeper.
 */
function parentLevel(name: string | null): number {
  return name === null ? 0 : 1;
}

/**
 * The private handle one graph node is reached through, without its inferred declaration types:
 * what attach and the Application's walk read, and the build that compiles the node.
 */
export interface CommandNodeHandle {
  readonly declared: Declared;
  readonly hasAction: boolean;
  readonly name: string;
  build(context: BuildContext): BuiltCommand;
}

/** One attached child, under the canonical name its parent's namespace holds it by. */
export interface AttachedChild {
  readonly name: string;
  readonly node: CommandNodeHandle;
}

/**
 * One graph build's shared state. `globals` compiles once and every Command reads it. The build is
 * a depth-first walk in attachment order.
 */
interface BuildContext {
  descriptors: DescriptorRegistry;
  extensions: ExtensionRecords;
  globals: BuiltGlobals;
  /** The route from the root to the Command being built, which a lifecycle hook reads. */
  path: readonly string[];
  /** The installed plugins in installation order, whose hooks run over every Command. */
  plugins: readonly BuiltPlugin[];
}

/**
 * Each authored value registers its handle here, so the public value holds no state to reach or
 * replace.
 */
const nodes = new WeakMap<object, CommandNodeHandle>();

/**
 * The handle one Command value registers, closed over its state. The value itself carries no
 * member that reaches the state, so an attached Command stays final.
 */
function nodeHandle<Args, Options, Globals>(
  name: string,
  state: CommandState<Args, Options, Globals>,
): CommandNodeHandle {
  return Object.freeze({
    build: (context: BuildContext) => buildCommand(state, context),
    declared: state,
    hasAction: state.action !== undefined,
    name,
  });
}

/** The handle behind a value an author built as a Command, or nothing for any other value. */
export function commandNode(value: unknown): CommandNodeHandle | undefined {
  return typeof value === 'object' && value !== null ? nodes.get(value) : undefined;
}

/** A named Command's options slot holds a plain options object, and never retired globals wiring. */
function checkCommandOptions(name: string, options: unknown): void {
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

/** An alias is a bare token the way a child name is, so it answers to the same name rule. */
function checkAliasName(command: string | null, alias: unknown): void {
  if (!isDeclaredName(alias)) {
    throw new DeclarationError(
      `${commandSentence(command)} declares an alias named "${String(alias)}". Use a nonempty name without a leading hyphen, whitespace, or "=".`,
    );
  }
}

/**
 * One call of the results lane, in the order it was made. A `result()` or `rows()` call declares
 * the unit, and a `views()` call reshapes the views of whichever declaration it follows.
 */
export type ResultCall =
  | { kind: 'value' | 'rows'; views: unknown }
  | { default: unknown; kind: 'views'; views: unknown };

/** The core facts a named Command declares, which its constructor checked. The root carries none. */
export interface CommandFacts {
  deprecated: string | undefined;
  description: string | undefined;
  hidden: boolean;
}

/**
 * Everything one Command declaration holds, each part checked by the call that added it. The
 * transitions below copy it with fields replaced, and the Command and Application builders share
 * them, so one declaration call has one implementation.
 */
export interface CommandState<Args, Options, Globals> {
  /**
   * The registered action, with the declared result erased. An action is stored under the widest
   * result, so a handler typed from its own declaration stores here and the channel that carries
   * the result is built for it at dispatch.
   */
  action: Action<Args, Globals & Options, OpenResult> | undefined;
  aliases: readonly string[];
  bind: (values: ValidatedInputs) => { args: Args; options: Options };
  children: readonly AttachedChild[];
  /**
   * Every descriptor this declaration's extension values name, by identity. The root's holds the
   * whole Application's: its plugins', its global options', and every attached subtree's.
   */
  descriptors: ReadonlyMap<string, AnyExtension>;
  /** The extension values of every layer, validated at the call that carried each one. */
  extensions: ExtensionStore;
  facts: CommandFacts;
  inputs: readonly InputDeclaration[];
  name: string | null;
  /** The extension record each input's own call validated. */
  records: InputRecords;
  // Every results-lane call in call order, which build reads as one declaration.
  results: readonly ResultCall[];
}

/** The untyped part of a declaration, which every attach and build check reads. */
export type Declared = Pick<
  CommandState<unknown, unknown, unknown>,
  'aliases' | 'children' | 'descriptors' | 'inputs' | 'name' | 'records' | 'results'
>;

/** How the extension diagnostics of one Command's own layers name it. */
export function layerOf(name: string | null): ExtensionSubject {
  return { phrase: `on ${commandSubject(name)}`, sentence: commandSentence(name) };
}

/**
 * The state every declaration starts from. The unnamed root and each named Command share it. The
 * declaration values arrive checked, because the constructor that read them threw for any fault.
 */
export function freshState<Globals>(declaration: {
  descriptors: ReadonlyMap<string, AnyExtension>;
  extensions: ExtensionStore;
  facts: CommandFacts;
  name: string | null;
}): CommandState<{}, {}, Globals> {
  return {
    action: undefined,
    aliases: [],
    bind: () => ({ args: {}, options: {} }),
    children: [],
    descriptors: declaration.descriptors,
    extensions: declaration.extensions,
    facts: declaration.facts,
    inputs: [],
    name: declaration.name,
    records: new Map(),
    results: [],
  };
}

/**
 * A named Command's own declaration, checked before the value exists: the name, the options slot,
 * the core facts, and the extension values the slot carries. A later change to the options object
 * the author passed changes nothing the declaration holds.
 */
function namedState<Globals>(
  name: unknown,
  options: unknown,
): { name: string; state: CommandState<{}, {}, Globals> } {
  if (!isDeclaredName(name)) {
    throw new DeclarationError(
      `Command name "${String(name)}" is invalid. Use a nonempty name without a leading hyphen, whitespace, or "=".`,
    );
  }
  checkCommandOptions(name, options);
  const slot = isPlainObject(options) ? options : undefined;
  const sentence = commandSentence(name);
  // The facts are read in the order their diagnostics have always ranked.
  const description = checkDescription(sentence, slot?.description);
  const hidden = checkHidden(sentence, slot?.hidden);
  const deprecated = checkDeprecated(sentence, slot?.deprecated);
  const descriptors: DescriptorRegistry = new Map();
  const extensions = storeCommandLayers({
    descriptors,
    layers: [slot?.extensions],
    subject: layerOf(name),
  });
  return {
    name,
    state: freshState({
      descriptors,
      extensions,
      facts: { deprecated, description, hidden },
      name,
    }),
  };
}

/**
 * A declaration call after `action()` is an order fault the receiver's own earlier call makes
 * certain. The types remove the call for a TypeScript author; a JavaScript author meets it here.
 */
function checkOpen(
  state: { readonly action: unknown; readonly name: string | null },
  clause: string,
  remedy: string,
): void {
  if (state.action !== undefined) {
    throw new DeclarationError(
      `${commandSentence(state.name)} ${clause} after its action. ${remedy}`,
    );
  }
}

/** The remedy a late argument or option earns. */
const inputRemedy = 'Declare arguments and options before action().';

/** One Command declares arguments or attaches children, whichever call came second. */
function placementFault(name: string | null, argument: string, child: string): DeclarationError {
  return new DeclarationError(
    `${commandSentence(name)} declares argument "${argument}" and attaches child "${child}". Move the argument into a child Command or remove the children.`,
  );
}

/** The options one declaration list holds, in declaration order. */
function optionsOf(inputs: readonly InputDeclaration[]): OptionInput[] {
  return inputs.filter((input): input is OptionInput => input.kind === 'option');
}

/** The positional slot one argument fills. */
function slotOf(input: ArgumentInput): ArgumentSlot {
  return {
    input,
    required: input.config.required === true,
    variadic: input.config.variadic === true,
  };
}

/**
 * One input's extension values, validated at the call that declares it, and the descriptors they
 * name joined to the declaration's own.
 */
function recordInput(
  state: Declared,
  input: InputDeclaration,
): Pick<Declared, 'descriptors' | 'records'> {
  const { name } = state;
  const descriptors = new Map(state.descriptors);
  const record = buildExtensions({
    declared: input.config.extensions,
    descriptors,
    subject: {
      phrase: `on ${commandSubject(name)} ${input.kind} "${input.name}"`,
      sentence: `${commandSentence(name)} ${input.kind} "${input.name}"`,
    },
    target: input.kind,
  });
  return { descriptors, records: new Map([...state.records, [input, record]]) };
}

/**
 * Every rule one argument answers at its own call: its name, a repeated name, children beside it,
 * its place after the arguments before it, its own facts, and its declaration rules.
 */
function checkArgument(state: Declared, input: ArgumentInput): void {
  const { name } = state;
  const subject = commandSubject(name);
  if (!isDeclaredName(input.name)) {
    throw new DeclarationError(
      `${commandSentence(name)} declares an argument named "${String(input.name)}". Use a nonempty name without a leading hyphen, whitespace, or "=".`,
    );
  }
  const declared = state.inputs.filter((entry) => entry.kind === 'argument');
  if (declared.some((entry) => entry.name === input.name)) {
    throw new DeclarationError(
      `Argument "${input.name}" is declared more than once on ${subject}. Remove or rename the duplicate.`,
    );
  }
  const child = state.children[0];
  if (child) {
    throw placementFault(name, input.name, child.name);
  }
  const previous = declared.at(-1);
  if (previous) {
    checkSlotOrder(slotOf(previous), slotOf(input), subject);
  }
  const sentence = `${commandSentence(name)} argument "${input.name}"`;
  checkDescription(sentence, input.config.description);
  checkNoListingFacts(sentence, input.config);
  checkNoArgumentBinding(sentence, input.config);
  checkDeclarations([input]);
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
  checkOpen(state, `declares argument "${input.name}"`, inputRemedy);
  checkArgument(state, input);
  const recorded = recordInput(state, input);
  const previous = state.bind;
  return {
    ...state,
    ...recorded,
    bind: (values) => {
      const bound = previous(values);
      return { ...bound, args: { ...bound.args, ...values.argument(input) } };
    },
    inputs: [...state.inputs, input],
  };
}

/** The table a named Command's options meet at its own calls, before any Application holds it. */
const noGlobals: GlobalTable = { names: new Map(), options: new Map(), variables: new Map() };

/**
 * The declared value joins `options` under its literal name, typed by its own config. The root's
 * options also meet the Application's globals table, which a named Command meets when its subtree
 * joins an Application.
 */
export function declareOption<
  Args,
  Options,
  Globals,
  Name extends string,
  Config extends OptionConfig,
>(
  state: CommandState<Args, Options, Globals>,
  input: OptionInput<Name, Config>,
  table: GlobalTable = noGlobals,
): CommandState<Args, Options & Record<Name, OptionValue<Config>>, Globals> {
  checkOpen(state, `declares option "${input.name}"`, inputRemedy);
  const sentence = `${commandSentence(state.name)} option "${input.name}"`;
  checkDescription(sentence, input.config.description);
  checkHidden(sentence, input.config.hidden);
  checkDeprecated(sentence, input.config.deprecated);
  checkEnvBinding(sentence, input.config);
  const recorded = recordInput(state, input);
  checkLocalOptions([...optionsOf(state.inputs), input], table, commandSubject(state.name));
  checkDeclarations([input]);
  const previous = state.bind;
  return {
    ...state,
    ...recorded,
    bind: (values) => {
      const bound = previous(values);
      return { ...bound, options: { ...bound.options, ...values.option(input) } };
    },
    inputs: [...state.inputs, input],
  };
}

/**
 * One call's names join the Command's aliases. A call that names none, which the types reject and
 * a JavaScript author can still write, reports as the call it is.
 */
export function declareAlias<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  names: readonly string[],
): CommandState<Args, Options, Globals> {
  const { name } = state;
  const first = names[0];
  if (first === undefined) {
    throw new DeclarationError(
      `${commandSentence(name)} declares an alias with no names. Supply at least one name.`,
    );
  }
  checkOpen(state, `declares alias "${first}"`, 'Declare aliases before action().');
  const aliases = [...state.aliases];
  for (const alias of names) {
    checkAliasName(name, alias);
    if (alias === name) {
      throw new DeclarationError(
        `${commandSentence(name)} declares alias "${alias}", which is its own name. Remove the alias.`,
      );
    }
    if (aliases.includes(alias)) {
      throw new DeclarationError(
        `${commandSentence(name)} declares alias "${alias}" twice. Remove the repeated alias.`,
      );
    }
    aliases.push(alias);
  }
  return { ...state, aliases };
}

/**
 * Extension layers remain open after inputs and the action have been fixed. Each layer is validated
 * at its own call, against every descriptor the declaration already names.
 */
export function declareExtensions<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  values: readonly unknown[],
): CommandState<Args, Options, Globals> {
  const descriptors = new Map(state.descriptors);
  const layer = validateLayer({
    declared: values,
    descriptors,
    subject: layerOf(state.name),
    target: 'command',
  });
  return { ...state, descriptors, extensions: extendStore(state.extensions, layer) };
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
 * action for every declaration, so the context the handler receives is read back at the call.
 */
export function declareAction<Args, Options, Globals, Result>(
  state: CommandState<Args, Options, Globals>,
  handler: Action<Args, Globals & Options, Result>,
): CommandState<Args, Options, Globals> {
  if (state.action !== undefined) {
    throw new DeclarationError(
      `${commandSentence(state.name)} has multiple actions. Register one action.`,
    );
  }
  const stored = (context: ActionContext<Args, Globals & Options, OpenResult>): unknown =>
    handler({ ...context, out: declaredChannel(context.out) });
  return { ...state, action: stored };
}

/**
 * The result declaration, which closes both result calls. Every rule its own call can judge throws
 * here; the empty record and the default wait for attach, because `views()` can still add keys.
 */
export function declareResult<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  kind: 'value' | 'rows',
  declaration: unknown,
): CommandState<Args, Options, Globals> {
  checkOpen(state, 'declares its result', 'Declare result() or rows() before action().');
  const results = [...state.results, { kind, views: recordOf(declaration, 'views') }];
  mergeResult(state.name, results);
  return { ...state, results };
}

/** A `views()` call reshapes views and closes nothing, so it is never a late declaration. */
export function declareResultViews<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  replacements: unknown,
  options: unknown,
): CommandState<Args, Options, Globals> {
  const results: readonly ResultCall[] = [
    ...state.results,
    { default: recordOf(options, 'default'), kind: 'views', views: replacements },
  ];
  mergeResult(state.name, results);
  return { ...state, results };
}

/** One property of an authoring argument, read defensively: the rules report whatever it holds. */
function recordOf(declaration: unknown, key: 'default' | 'views'): unknown {
  return isPlainObject(declaration) ? declaration[key] : undefined;
}

/** The parent one attach reads: its name, the children it holds, and the calls that close it. */
interface AttachParent {
  /** The first argument the parent declares, which no child may sit beside. */
  argument: string | undefined;
  children: readonly AttachedChild[];
  hasAction: boolean;
  name: string | null;
}

/** The parent a declaration is, as attach reads it. */
function parentOf(state: Declared & { readonly action: unknown }): AttachParent {
  return {
    argument: state.inputs.find((input) => input.kind === 'argument')?.name,
    children: state.children,
    hasAction: state.action !== undefined,
    name: state.name,
  };
}

/**
 * One parent's namespace, which every canonical name and alias under it shares. The rule reads the
 * same whichever sibling the author attached first.
 */
function checkSiblings(parent: AttachParent, child: AttachedChild): void {
  const sentence = commandSentence(parent.name);
  const { children } = parent;
  if (children.some((entry) => entry.name === child.name)) {
    throw new DeclarationError(
      `${sentence} attaches two children named "${child.name}". Rename or remove one.`,
    );
  }
  for (const alias of child.node.declared.aliases) {
    if (children.some((entry) => entry.name === alias)) {
      throw new DeclarationError(
        `${sentence} attaches child "${child.name}" with alias "${alias}", which is also the name of child "${alias}". Rename or remove one.`,
      );
    }
    const owner = children.find((entry) => entry.node.declared.aliases.includes(alias));
    if (owner) {
      throw new DeclarationError(
        `${sentence} attaches child "${child.name}" with alias "${alias}", which is also an alias of child "${owner.name}". Rename or remove one.`,
      );
    }
  }
  const aliased = children.find((entry) => entry.node.declared.aliases.includes(child.name));
  if (aliased) {
    throw new DeclarationError(
      `${sentence} attaches child "${aliased.name}" with alias "${child.name}", which is also the name of child "${child.name}". Rename or remove one.`,
    );
  }
}

/**
 * A child at the cap holds no children. Attach reads the child at the shallowest level its parent
 * can sit at, and the Application's join reads every node at its level below the root.
 */
function checkNesting(parent: string | null, child: AttachedChild, level: number): void {
  if (level >= nestingCap.depth && child.node.declared.children.length > 0) {
    throw new DeclarationError(
      `${commandSentence(parent)} attaches child "${child.name}", which has children of its own. Nest Commands at most ${nestingCap.words} levels below the root.`,
    );
  }
}

/**
 * A Command without an action is a group, and routing sends an invocation on to one of its
 * children. A group with no children receives an invocation no handler can answer, and a local
 * option on a group reaches no handler either, because locals never inherit.
 */
function checkGroup(state: Declared): void {
  const { name } = state;
  if (state.children.length === 0) {
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
 * The rules a finished Command answers, which attach applies to a child and build to the root: a
 * result needs an action, its merged views record names at least one view and its default, and a
 * Command without an action is a group. It answers with the resolved result.
 */
function checkFinished(declared: Declared, hasAction: boolean): DeclaredResult | undefined {
  const result = buildResult(declared, hasAction);
  if (!hasAction) {
    checkGroup(declared);
  }
  return result;
}

/**
 * The one attach operation `Command.command()`, `Application.command()`, and a plugin's
 * `commands` list share. A Command is an immutable value, so the child is final here: it is checked
 * as a finished Command, against the parent's current children, and against the nesting cap from
 * the shallowest level the parent can sit at.
 */
export function attach(parent: AttachParent, node: CommandNodeHandle): AttachedChild {
  const { name } = node;
  if (parent.hasAction) {
    throw new DeclarationError(
      `${commandSentence(parent.name)} attaches child "${name}" after its action. Attach children before action().`,
    );
  }
  if (parent.argument !== undefined) {
    throw placementFault(parent.name, parent.argument, name);
  }
  checkFinished(node.declared, node.hasAction);
  const child: AttachedChild = { name, node };
  checkSiblings(parent, child);
  checkNesting(parent.name, child, parentLevel(parent.name) + 1);
  return child;
}

/** The handle behind the value one `command()` call received; anything else is a declaration error. */
export function childNode(parent: string | null, child: unknown): CommandNodeHandle {
  const node = commandNode(child);
  if (!node) {
    throw new DeclarationError(
      `${commandSentence(parent)} attaches a value that is not a Command. Attach the value returned by new Command(name).`,
    );
  }
  return node;
}

/** Attaching is a declaration call too, so the receiver keeps the children it already had. */
function attachChild<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  child: unknown,
): CommandState<Args, Options, Globals> {
  const attached = attach(parentOf(state), childNode(state.name, child));
  return { ...state, children: [...state.children, attached] };
}

/** What an Application holds while a subtree joins it, each register a copy the caller commits. */
interface JoinScope {
  descriptors: DescriptorRegistry;
  /** The parent that claimed each node the Application holds, by the name a diagnostic reads. */
  owners: Map<CommandNodeHandle, string | null>;
  table: GlobalTable;
}

/**
 * Walks one subtree joining an Application, once, for the rules only the Application can judge: one
 * Command value reached through two paths, two distinct descriptors under one identity, a local
 * option that meets a global or plugin option's key, spelling, or variable, and the nesting cap
 * measured from the root. A claim is by node identity, and the name serves the diagnostic alone.
 * At a cap of two a named parent's `command()` already rejects every deeper tree, so the depth check
 * here fires only once the cap rises: attach reads one level, and only this walk knows each level.
 */
function joinSubtree(
  scope: JoinScope,
  child: AttachedChild,
  { level, parent }: { level: number; parent: string | null },
): void {
  const { name, node } = child;
  checkNesting(parent, child, level);
  if (scope.owners.has(node)) {
    throw new DeclarationError(
      `${commandSentence(parent)} attaches child "${name}", which ${commandSubject(scope.owners.get(node) ?? null)} also attaches. Attach a Command value at one point; create a new Command for each placement.`,
    );
  }
  scope.owners.set(node, parent);
  for (const descriptor of node.declared.descriptors.values()) {
    registerDescriptor(scope.descriptors, descriptor);
  }
  checkLocalOptions(optionsOf(node.declared.inputs), scope.table, commandSubject(name));
  for (const entry of node.declared.children) {
    joinSubtree(scope, entry, { level: level + 1, parent: name });
  }
}

/**
 * Attaches one child to an Application's root and walks the subtree it brings, once. The scope's
 * registers are copies: the caller commits the owners, and the returned root holds the descriptors.
 */
export function attachToRoot<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  node: CommandNodeHandle,
  scope: JoinScope,
): CommandState<Args, Options, Globals> {
  const attached = attach(parentOf(state), node);
  joinSubtree(scope, attached, { level: parentLevel(state.name) + 1, parent: state.name });
  return { ...state, children: [...state.children, attached], descriptors: scope.descriptors };
}

/** Every attached Command's local options against a globals table that has just grown. */
function checkAttachedOptions(table: GlobalTable, children: readonly AttachedChild[]): void {
  for (const { name, node } of children) {
    checkLocalOptions(optionsOf(node.declared.inputs), table, commandSubject(name));
    checkAttachedOptions(table, node.declared.children);
  }
}

/**
 * A declaration's own options and every attached Command's, against a globals table that has just
 * grown. The table's new option reads as the other side of any collision.
 */
export function checkDeclaredOptions(state: Declared, table: GlobalTable): void {
  checkLocalOptions(optionsOf(state.inputs), table, commandSubject(state.name));
  checkAttachedOptions(table, state.children);
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

/**
 * The positional slots one declaration holds. Every authored argument answered these rules at its
 * own call, so they throw here only for an argument a lifecycle hook declared.
 */
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
    slots.push(slotOf(input));
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
 * A view name is a bare token the way a child name is, and never an array index, because an
 * integer-like key does not keep the position the author gave it.
 */
function isViewName(name: string): boolean {
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

/** The results lane's calls read as one declaration: its unit, its views, and its selected key. */
interface MergedResult {
  kind: 'value' | 'rows';
  selected: string | undefined;
  views: Map<string, ResultView>;
}

/**
 * Every rule a results-lane call can judge on its own, applied to one Command's calls in the order
 * it made them. The merged record is what the rules read: a later `views()` call replaces a key in
 * place and appends a new one, so each name keeps the position the call that first named it gave
 * it. A `default` once named persists through later calls that name none.
 */
function mergeResult(
  name: string | null,
  results: readonly ResultCall[],
): MergedResult | undefined {
  const sentence = commandSentence(name);
  const declarations = results.filter((call) => call.kind !== 'views');
  if (declarations.length > 1) {
    throw new DeclarationError(
      `${sentence} declares two results. Declare one result() or rows() call.`,
    );
  }
  const declaration = declarations[0];
  // A `views()` call reshapes a result's views, so one with no result reshapes nothing.
  // The types publish the call where a result is carried, so this reaches a JavaScript author.
  if (!declaration) {
    if (results.length > 0) {
      throw new DeclarationError(
        `${sentence} reshapes its views and declares no result. Declare result() or rows() before action().`,
      );
    }
    return undefined;
  }
  const views = new Map<string, ResultView>();
  let selected: string | undefined = undefined;
  for (const call of results) {
    for (const [key, entry] of recordEntries(call.views)) {
      const view = resultView({ kind: declaration.kind, sentence }, key, entry);
      if (!isViewName(key)) {
        throw new DeclarationError(
          `${sentence} names view "${key}". Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.`,
        );
      }
      views.set(key, view);
    }
    if (call.kind === 'views') {
      selected = selectedKey(call.default) ?? selected;
    }
  }
  return { kind: declaration.kind, selected, views };
}

/**
 * The finished result: the merged record, which needs an action, at least one view, and a default
 * that names one of them. The first key answers until one is named.
 */
function buildResult(
  declared: Pick<Declared, 'name' | 'results'>,
  hasAction: boolean,
): DeclaredResult | undefined {
  const merged = mergeResult(declared.name, declared.results);
  if (!merged) {
    return undefined;
  }
  const sentence = commandSentence(declared.name);
  if (!hasAction) {
    throw new DeclarationError(
      `${sentence} declares a result and no action. Register an action or remove the result.`,
    );
  }
  const { selected, views } = merged;
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
  return { default: selected ?? first.value, kind: merged.kind, views };
}

/** One call a hook made, in the order it made it, which the declaration reads back afterwards. */
type AttachCall =
  | { identity: string; input: InputDeclaration; kind: 'input' }
  | { call: ResultCall; kind: 'views' };

/** The erased declaration one hook reads, with the calls it and every hook before it has made. */
interface AttachState {
  calls: readonly AttachCall[];
  declared: Declared;
  /** Every extension value validated so far: the author's layers, then each hook's `extend()`. */
  extensions: ExtensionStore;
  /**
   * The descriptors this value's extensions registered, over the build's registry. Build commits
   * the registry of the value the last hook returned, so a descriptor a hook added only to a value
   * it discarded, or in a call that threw, never reaches the build.
   */
  registry: ReadonlyMap<string, AnyExtension>;
  hasAction: boolean;
  identity: string;
  /** The token one Command's own build mints, which every value derived within it carries. */
  lineage: object;
  path: readonly string[];
  /** The Command a diagnostic about one of its extension values names. */
  subject: ExtensionSubject;
}

/** What the hooks of one Command have produced so far, which the next hook reads. */
type AttachProgress = Pick<AttachState, 'calls' | 'declared' | 'extensions' | 'registry'>;

/** The values one build made, so a value a hook returns is one of them and never a forged shape. */
const attachments = new WeakMap<object, AttachState>();

/**
 * The declared names of one kind, in declaration order, as a hook reads them. The list is frozen,
 * because the surface publishes it read-only and a hook reshapes a Command through its calls alone.
 */
function declaredNames(declared: Declared, kind: 'argument' | 'option'): readonly string[] {
  return Object.freeze(
    declared.inputs.filter((input) => input.kind === kind).map((input) => input.name),
  );
}

/**
 * One Command unlocked for a hook. Every call returns a new value and leaves its receiver
 * unchanged, and records what it added twice over: on the erased declaration the next value reads
 * its facts from, and on the call list the declaration reads back once every hook has returned.
 * The result is resolved for each value, so a `views()` call reports its own fault where it is made
 * and a later call reads the record that call left behind.
 */
class AttachedCommandValue implements AttachedCommand {
  declare readonly [attachedCommand]: true;

  readonly #state: AttachState;
  readonly #result: ResultNode | null;

  constructor(state: AttachState) {
    this.#state = state;
    this.#result = resultNode(buildResult(state.declared, state.hasAction));
    attachments.set(this, state);
    Object.freeze(this);
  }

  get name(): string | null {
    return this.#state.declared.name;
  }

  get path(): readonly string[] {
    return this.#state.path;
  }

  get hasAction(): boolean {
    return this.#state.hasAction;
  }

  get arguments(): readonly string[] {
    return declaredNames(this.#state.declared, 'argument');
  }

  get options(): readonly string[] {
    return declaredNames(this.#state.declared, 'option');
  }

  get result(): ResultNode | null {
    return this.#result;
  }

  /** Published on first read and shared by every value whose store is unchanged. */
  get extensions(): Readonly<Record<string, unknown>> {
    return publishStore(this.#state.extensions);
  }

  argument(name: string, config: ArgumentConfig): AttachedCommand {
    return this.#declare({ config: captureConfig(config), kind: 'argument', name });
  }

  option(name: string, config: OptionConfig): AttachedCommand {
    return this.#declare({ config: captureConfig(config), kind: 'option', name });
  }

  views(
    replacements: Readonly<Record<string, ResultView>>,
    options?: { default?: string },
  ): AttachedCommand {
    const call: ResultCall = {
      default: recordOf(options, 'default'),
      kind: 'views',
      views: replacements,
    };
    const { declared } = this.#state;
    return this.#derive(
      { call, kind: 'views' },
      { ...declared, results: [...declared.results, call] },
    );
  }

  /**
   * The values are validated here, at the call, so the next read of `extensions` holds them and
   * build never validates them again. A rejected value throws from the call and adds nothing.
   */
  extend(...values: readonly ExtensionValue<'command'>[]): AttachedCommand {
    const state = this.#state;
    const registry = new Map(state.registry);
    const layer = validateLayer({
      declared: values,
      descriptors: registry,
      subject: state.subject,
      target: 'command',
    });
    return new AttachedCommandValue({
      ...state,
      extensions: extendStore(state.extensions, layer),
      registry,
    });
  }

  /** One input the running hook declared, which the Command's own names now hold. */
  #declare(input: InputDeclaration): AttachedCommand {
    const { declared, identity } = this.#state;
    return this.#derive(
      { identity, input, kind: 'input' },
      { ...declared, inputs: [...declared.inputs, input] },
    );
  }

  #derive(call: AttachCall, declared: Declared): AttachedCommand {
    const state = this.#state;
    return new AttachedCommandValue({ ...state, calls: [...state.calls, call], declared });
  }
}

/** The reason one failed hook reports, which is the thrown value's own message. */
function attachReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One hook's own call, whose failure is the plugin's, and whose own report is its own. */
function callHook(
  value: AttachedCommand,
  hook: CommandAttachHook,
  named: { identity: string; subject: string },
): AttachedCommand {
  try {
    return hook(value);
  } catch (error) {
    // A hook that reports a declaration fault of its own reports as itself.
    if (error instanceof DeclarationError) {
      throw error;
    }
    throw new DeclarationError(
      `Plugin "${named.identity}" failed in onCommandAttach for ${named.subject}: ${attachReason(error)}.`,
    );
  }
}

/**
 * One plugin's hook over one Command, which answers with the declaration the hook returned. The
 * returned value has to carry the lineage token of the value the hook received, so the surface of
 * another Command, or of one an earlier build made, never replays its calls onto this Command.
 */
function attachOnce(
  value: AttachedCommand,
  hook: CommandAttachHook,
  named: { identity: string; lineage: object; subject: string },
): AttachState {
  const state = attachments.get(callHook(value, hook, named));
  if (!state || state.lineage !== named.lineage) {
    throw new DeclarationError(
      `Plugin "${named.identity}" returned a value that is not the attached Command from onCommandAttach for ${named.subject}. Return the value it received or a value derived from it.`,
    );
  }
  return state;
}

/**
 * Every installed plugin's hook over one Command, in installation order, each receiving what the
 * previous returned. The calls they made travel back to the declaration the remaining rules read.
 */
function runAttachHooks(
  start: Pick<AttachState, 'declared' | 'extensions' | 'registry'> & { layer: ExtensionSubject },
  facts: { hasAction: boolean; lineage: object; path: readonly string[] },
  plugins: readonly BuiltPlugin[],
): AttachProgress {
  const { declared, extensions, layer, registry } = start;
  const subject = commandSubject(declared.name);
  const { lineage } = facts;
  let progress: AttachProgress = { calls: [], declared, extensions, registry };
  for (const installed of plugins) {
    const hook = installed.onCommandAttach;
    if (hook) {
      const identity = installed.identity;
      const value = new AttachedCommandValue({ ...progress, ...facts, identity, subject: layer });
      const state = attachOnce(value, hook, { identity, lineage, subject });
      progress = {
        calls: state.calls,
        declared: state.declared,
        extensions: state.extensions,
        registry: state.registry,
      };
    }
  }
  return progress;
}

/**
 * One input a hook declared. It joins the values an action reads at run time and the declaration's
 * types not at all, and it skips the order checks an authoring call makes, because a hook's calls
 * are exempt from the closures `action()` applies.
 */
function declareHookInput<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  input: InputDeclaration,
): CommandState<Args, Options, Globals> {
  const previous = state.bind;
  return {
    ...state,
    bind: (values) => {
      const bound = previous(values);
      return input.kind === 'argument'
        ? { ...bound, args: { ...bound.args, ...values.argument(input) } }
        : { ...bound, options: { ...bound.options, ...values.option(input) } };
    },
    inputs: [...state.inputs, input],
  };
}

/** The declaration the hooks left behind, which every remaining build rule reads. */
function applyAttachCalls<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  calls: readonly AttachCall[],
): CommandState<Args, Options, Globals> {
  let next = state;
  for (const call of calls) {
    next =
      call.kind === 'input'
        ? declareHookInput(next, call.input)
        : { ...next, results: [...next.results, call.call] };
  }
  return next;
}

/** One input a hook declared, with the plugin whose hook declared it. */
interface AttachedInput {
  identity: string;
  input: InputDeclaration;
}

/** The names one Command already holds, by the scope that holds each of them. */
interface HeldNames {
  arguments: ReadonlySet<string>;
  globals: BuiltGlobals;
  hookArguments: Map<string, string>;
  hooks: Map<string, string>;
  locals: ReadonlySet<string>;
}

/** What one collision reports: the scope that holds the name, and the remedy that pair earns. */
interface Collision {
  clause: string;
  remedy: string;
}

/** The clause and the remedy an input another plugin's hook already declared earns. */
function hookClause(kind: 'argument' | 'option', identity: string): Collision {
  return {
    clause: `an ${kind} plugin "${identity}" declared through onCommandAttach`,
    remedy: 'Install one of them.',
  };
}

/**
 * The remedy a collision against the Command's own declarations, the globals table, or another
 * plugin's option earns. The remedy follows the target alone, whichever kind the hook declared:
 * the author renames their own local option or argument, the author renames the colliding global
 * option, or, when the target is another plugin's option, the two plugins install one of them.
 */
function attachedRemedy(target: 'argument' | 'global' | 'local' | 'plugin'): string {
  if (target === 'local') {
    return "Rename the Command's option or omit the plugin.";
  }
  if (target === 'argument') {
    return "Rename the Command's argument or omit the plugin.";
  }
  if (target === 'global') {
    return 'Rename the global option or omit the plugin.';
  }
  return 'Install one of them.';
}

/**
 * What one name a hook-declared input of either kind collides with, in the order the scopes are
 * reported: an earlier hook's option, an earlier hook's argument, a local option, a global or
 * plugin-owned option, or an argument the Command declares. The remedy follows the target alone,
 * not which kind the hook declared.
 */
function attachedCollision(input: InputDeclaration, held: HeldNames): Collision | undefined {
  const { name } = input;
  const hook = held.hooks.get(name);
  if (hook !== undefined) {
    return hookClause('option', hook);
  }
  const hooked = held.hookArguments.get(name);
  if (hooked !== undefined) {
    return hookClause('argument', hooked);
  }
  if (held.locals.has(name)) {
    return { clause: 'a local option', remedy: attachedRemedy('local') };
  }
  const claimed = held.globals.names.get(name);
  if (claimed) {
    const target = claimed.kind === 'plugin' ? 'plugin' : 'global';
    const clause =
      claimed.kind === 'plugin' ? `an option of plugin "${claimed.identity}"` : 'a global option';
    return { clause, remedy: attachedRemedy(target) };
  }
  return held.arguments.has(name)
    ? { clause: 'an argument', remedy: attachedRemedy('argument') }
    : undefined;
}

/**
 * The spellings one compiled table holds, each under the form its own option is named by, which is
 * its long form where it declares one and the colliding spelling itself where it declares none.
 */
function readSpellings(table: ReturnType<typeof compileOptions>, claimed: Map<string, string>) {
  const longs = new Map<string, string>();
  for (const [spelling, option] of table) {
    if (option.role === 'long') {
      longs.set(option.name, spelling);
    }
  }
  for (const [spelling, option] of table) {
    if (!claimed.has(spelling)) {
      claimed.set(spelling, longs.get(option.name) ?? spelling);
    }
  }
}

/** One hook-declared option's spellings, against every spelling the table already claims. */
function checkAttachedSpelling(
  declared: { identity: string; input: OptionInput },
  named: { claimed: Map<string, string>; subject: string },
): void {
  const { claimed, subject } = named;
  const table = compileOptions([declared.input], subject);
  for (const [spelling] of table) {
    const used = claimed.get(spelling);
    if (used !== undefined) {
      throw new DeclarationError(
        `Plugin "${declared.identity}" declares option "${declared.input.name}" with spelling "${spelling}" on ${subject}, which "${used}" already uses.`,
      );
    }
  }
  readSpellings(table, claimed);
}

/**
 * Every input a hook declared, against the names and spellings the Command, the globals table, and
 * an earlier hook already hold. It runs before the Command's own inputs compile, so a hook-declared
 * input reports as the plugin's fault and never as the author's.
 */
function checkAttachedInputs(
  declared: Declared,
  attached: readonly AttachedInput[],
  globals: BuiltGlobals,
): void {
  const subject = commandSubject(declared.name);
  const hooked = new Set(attached.map((entry) => entry.input));
  const authored = declared.inputs.filter((input) => !hooked.has(input));
  const options = authored.filter((input) => input.kind === 'option');
  const held: HeldNames = {
    arguments: new Set(
      authored.filter((input) => input.kind === 'argument').map((input) => input.name),
    ),
    globals,
    hookArguments: new Map(),
    hooks: new Map(),
    locals: new Set(options.map((input) => input.name)),
  };
  const claimed = new Map<string, string>();
  readSpellings(globals.options, claimed);
  readSpellings(compileOptions(options, subject), claimed);
  for (const { identity, input } of attached) {
    const collision = attachedCollision(input, held);
    if (collision) {
      throw new DeclarationError(
        `Plugin "${identity}" declares ${input.kind} "${input.name}" on ${subject}, which is already declared as ${collision.clause}. ${collision.remedy}`,
      );
    }
    if (input.kind === 'option') {
      checkAttachedSpelling({ identity, input }, { claimed, subject });
      held.hooks.set(input.name, identity);
    } else {
      held.hookArguments.set(input.name, identity);
    }
  }
}

/** Binds one Command's declarations to its action, so an action reads only validated values. */
function bindDispatch<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  action: Action<Args, Globals & Options>,
  globals: BuiltGlobals,
) {
  return ({ host, out, passthrough, signal, style, values }: DispatchInput) => {
    const bound = state.bind(values);
    // Last resort: no typed path exists.
    // The graph erases the binder's generic relationship.
    // It holds because attachment checks the global output requirement.
    // The call or the attach that met both options rejected a collision between a global and a local.
    // This binder returns the Application's validated globals alone.
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

/**
 * The own facts and extension values of each input a lifecycle hook declared, which the calls that
 * declared the author's inputs already checked.
 */
function checkInputFacts(
  inputs: readonly InputDeclaration[],
  command: { name: string | null; subject: string },
  context: BuildContext,
): void {
  const { name, subject } = command;
  for (const input of inputs) {
    const sentence = `${commandSentence(name)} ${input.kind} "${input.name}"`;
    checkDescription(sentence, input.config.description);
    if (input.kind === 'argument') {
      checkNoListingFacts(sentence, input.config);
      checkNoArgumentBinding(sentence, input.config);
    } else {
      checkHidden(sentence, input.config.hidden);
      checkDeprecated(sentence, input.config.deprecated);
      checkEnvBinding(sentence, input.config);
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
}

/** One Command declares arguments or attaches children, whichever declaration made each of them. */
function checkArgumentPlacement(
  name: string | null,
  slot: ArgumentSlot | undefined,
  child: AttachedChild | undefined,
): void {
  if (slot && child) {
    throw placementFault(name, slot.input.name, child.name);
  }
}

/**
 * Compiles one declaration for dispatch against the shared globals table. Every authored rule threw
 * at the call or the attach that first held its data, so what can still fail here is the root's
 * finished-Command rules, the root never being attached, and whatever the lifecycle hooks
 * contributed.
 */
export function buildCommand<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  context: BuildContext,
): BuiltCommand {
  const { action, facts, name } = state;
  const { globals } = context;
  const subject = commandSubject(name);
  const layer = layerOf(name);
  for (const [input, record] of state.records) {
    context.extensions.set(input, record);
  }
  const declaredSlots = collectArguments(state, subject);
  const hasAction = action !== undefined;
  /**
   * The hooks run once the author's declaration is complete, and each value a hook receives resolves
   * its result, so a hook reads an exact record. Every rule below reads what the hooks returned.
   */
  // One token per Command per build, which binds a hook's return to the value it received.
  const lineage = {};
  const progress = runAttachHooks(
    { declared: state, extensions: state.extensions, layer, registry: context.descriptors },
    { hasAction, lineage, path: context.path },
    context.plugins,
  );
  const { calls } = progress;
  // The descriptors the returned value's extensions registered join the build's registry.
  for (const [identity, descriptor] of progress.registry) {
    context.descriptors.set(identity, descriptor);
  }
  const hooked = applyAttachCalls(state, calls);
  const hookInputs = calls.filter((call) => call.kind === 'input');
  checkInputFacts(
    hookInputs.map((call) => call.input),
    { name, subject },
    context,
  );
  // The hook-declared names are checked first, so a collision reports in the plugin's voice.
  // A rule the author's own declaration voices never speaks for a name a hook declared.
  checkAttachedInputs(hooked, hookInputs, globals);
  // Every value was validated once, the author's at each call and each hook's at its `extend()`.
  const extensions = publishStore(progress.extensions);
  const slots = hookInputs.length > 0 ? collectArguments(hooked, subject) : declaredSlots;
  checkArgumentPlacement(name, slots[0], state.children[0]);
  const result = checkFinished(hooked, hasAction);
  const options = checkLocalOptions(optionsOf(hooked.inputs), globals, subject);
  // A hook's erased calls answer the declaration rules an authored call answers at the call.
  checkDeclarations(hookInputs.map((call) => call.input));
  const children = new Map<string, BuiltCommand>();
  const routes = new Map<string, RoutedChild>();
  for (const child of state.children) {
    const routed: RoutedChild = {
      command: child.node.build({ ...context, path: [...context.path, child.name] }),
      name: child.name,
    };
    children.set(routed.name, routed.command);
    routes.set(routed.name, routed);
    for (const alias of routed.command.aliases) {
      routes.set(alias, routed);
    }
  }
  return {
    aliases: state.aliases,
    arguments: slots,
    children,
    deprecated: facts.deprecated,
    description: facts.description,
    dispatch: action ? bindDispatch(hooked, action, globals) : undefined,
    extensions,
    hidden: facts.hidden,
    inputs: hooked.inputs,
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

/**
 * The globals table compiles once per build and the whole graph shares it. The root's registry
 * holds every descriptor the Application names, so a hook's `extend()` call meets all of them.
 */
export function buildGraph<Args, Options, Globals>(
  root: CommandState<Args, Options, Globals>,
  globals: GlobalsState<Globals>,
  plugins: readonly BuiltPlugin[],
): BuiltGraph {
  const extensions: ExtensionRecords = new Map([
    ...globals.records,
    ...plugins.flatMap((installed) => [...installed.records]),
  ]);
  const context: BuildContext = {
    descriptors: new Map(root.descriptors),
    extensions,
    globals: buildGlobals(globals, plugins),
    path: [],
    plugins,
  };
  return { extensions, globals: context.globals, root: buildCommand(root, context) };
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

  readonly #name: string;
  readonly #state: CommandState<Args, Options, Globals>;

  constructor(name: string, state: CommandState<Args, Options, Globals>) {
    this.#name = name;
    this.#state = state;
    nodes.set(this, nodeHandle(name, state));
  }

  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<PerValueConstraint<Config>> &
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
    return this.#derive(declareArgument(this.#state, input));
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<PerValueConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Command<Args, Options & Record<Name, OptionValue<Config>>, Globals, State, Result> {
    const input: OptionInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'option',
      name,
    };
    return this.#derive(declareOption(this.#state, input));
  }

  /**
   * Aliases are other bare tokens that route to this Command. They invalidate no call, and the
   * tuple rest parameter rejects a call that names none.
   */
  alias(...names: [string, ...string[]]): Command<Args, Options, Globals, State, Result> {
    return this.#derive(declareAlias(this.#state, names));
  }

  /** A child arrives in any type state, because its own action is the call that finished it. */
  command<const Child extends Command<unknown, unknown, Globals>>(
    child: Child & NoInfer<AttachmentConstraint<Globals, Child>>,
  ): Command<Args, Options, Globals, AfterCommand<State>, Result> {
    return this.#derive(attachChild(this.#state, child));
  }

  /**
   * The value this Command produces for its consumer. The type argument is stated by the author,
   * so the views record states no type of its own and an omitted argument names none either.
   */
  result<Value>(declaration: {
    views: ResultViews<NoInfer<Value>>;
  }): Command<Args, Options, Globals, AfterResult<State>, { kind: 'value'; value: Value }> {
    return this.#derive<Args, Options, AfterResult<State>, { kind: 'value'; value: Value }>(
      declareResult(this.#state, 'value', declaration),
    );
  }

  /** The same declaration over a sequence, whose type argument is one row. */
  rows<Row>(declaration: {
    views: RowViews<NoInfer<Row>>;
  }): Command<Args, Options, Globals, AfterResult<State>, { kind: 'rows'; row: Row }> {
    return this.#derive<Args, Options, AfterResult<State>, { kind: 'rows'; row: Row }>(
      declareResult(this.#state, 'rows', declaration),
    );
  }

  /**
   * Views after the fact. It merges by key, so an existing name is replaced in place and a new one
   * is appended, and `default` names the key core renders when nothing selects another.
   */
  views(
    replacements: ResultViewsOf<Result>,
    options?: { default?: string },
  ): Command<Args, Options, Globals, State, Result> {
    return this.#derive(declareResultViews(this.#state, replacements, options));
  }

  /** The action closes input authoring; `extend()` remains outside this state transition. */
  action(
    handler: Action<Args, Globals & Options, Result>,
  ): Command<Args, Options, Globals, AfterAction, Result> {
    return this.#derive(declareAction(this.#state, handler));
  }

  extend(
    ...values: readonly ExtensionValue<'command'>[]
  ): Command<Args, Options, Globals, State, Result> {
    return this.#derive(declareExtensions(this.#state, values));
  }

  /**
   * The same runtime value in the state the calling method's return type names. Each call states
   * its own transition, and the declared result travels with it unless the call replaces it.
   */
  #derive<DerivedArgs, DerivedOptions, Next extends CommandMethod, DerivedResult = Result>(
    state: CommandState<DerivedArgs, DerivedOptions, Globals>,
  ): Command<DerivedArgs, DerivedOptions, Globals, Next, DerivedResult> {
    return new CommandBuilder<DerivedArgs, DerivedOptions, Globals, Next, DerivedResult>(
      this.#name,
      state,
    );
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

/**
 * The constructor uses the Application registration; public type defaults stay library-neutral.
 * Every rule on the name and the options slot throws before the value exists.
 */
class CommandDeclaration extends CommandBuilder<{}, {}, RegisteredGlobals> {
  constructor(name: string, options?: CommandOptions) {
    const declared = namedState<RegisteredGlobals>(name, options);
    super(declared.name, declared.state);
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

/** What one invocation reaches the middleware chain with. */
export interface DispatchInvocation {
  /** The channel the action receives, which the results lane builds from the routed node. */
  channel: (binding: ResultBinding) => ActionChannel;
  defaults: DefaultValues;
  host: Host;
  /** The graph `inspect()` returns for the run, built on its first read, which a source reads. */
  inspected: () => CommandGraph;
  signal: AbortSignal;
  style: ContextualStyle;
}

/**
 * One invocation prepared ahead of the middleware chain. `'ready'` carries the request a middleware
 * reads and the call that dispatches; `'held'` carries the fault this phase found, which core
 * raises at the dispatch boundary and never before, so a takeover swallows it. `result` is what the
 * routed Command declared, whose views a middleware selects among, on either shape. `globals` holds
 * the globals table's values after the input-source stage, which activation and every plugin's own
 * options read on either shape.
 */
export type Prepared = {
  globals: OptionValues;
  result: DeclaredResult | undefined;
} & (
  | { dispatch: (view: string | null) => Promise<void>; kind: 'ready'; request: Request }
  | { fault: unknown; kind: 'held'; request: null }
);

/**
 * The frozen records one middleware reads: the routed Command's own inputs, and the tail. Every
 * value is a plain-data copy frozen to every depth, so a middleware that reaches into a list or a
 * schema's output object reaches its own copy and contributes nothing to what the action receives.
 * A value that is neither an array nor a plain object, a class instance or a `Date` a schema
 * produced, is shared by reference, because core cannot copy it meaningfully.
 */
function requestOf(
  command: BuiltCommand,
  values: ValidatedInputs,
  passthrough: readonly string[],
): Request {
  const args: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  for (const input of command.inputs) {
    const target = input.kind === 'argument' ? args : options;
    target[input.name] = snapshot(values.read(input));
  }
  return Object.freeze({
    args: Object.freeze(args),
    options: Object.freeze(options),
    passthrough: Object.freeze([...passthrough]),
  });
}

/** The routed Command's own tokens after local parsing, or the fault that phase holds. */
type LocalPhase =
  | {
      args: ReadonlyMap<InputDeclaration, string | string[]>;
      dispatch: (input: DispatchInput) => unknown;
      kind: 'parsed';
      options: OptionValues;
      passthrough: string[];
    }
  | { fault: unknown; kind: 'held' };

/**
 * The callable check and local parsing. A group answers no invocation of its own, so it holds the
 * missing-subcommand error with the rank the routing errors have and parses no token; a token
 * fault holds the same way.
 */
function parseLocal(routed: RoutedInvocation): LocalPhase {
  const { command, path } = routed;
  const { dispatch } = command;
  try {
    if (!dispatch) {
      throw new NonCallableCommandError(path, candidatesOf(command));
    }
    const parsed = parseInputs(command.options, routed.tokens);
    const args = bindArguments(command, path, parsed.positionals);
    return {
      args,
      dispatch,
      kind: 'parsed',
      options: parsed.options,
      passthrough: parsed.passthrough,
    };
  } catch (error) {
    return { fault: error, kind: 'held' };
  }
}

/**
 * The node of one option a configuration source is asked about: in the graph's globals, or among
 * the routed Command's own options. Build published every declaration, so a missing node means the
 * two readings of one graph disagree.
 */
function requestNode(
  graph: CommandGraph,
  path: readonly string[],
  place: { global: boolean; name: string },
): OptionNode {
  const options = place.global ? graph.globals : nodeAt(graph, path).options;
  const node = options.find((option) => option.name === place.name);
  if (!node) {
    throw new InternalError(`Option "${place.name}" is not in the inspected graph.`, undefined);
  }
  return node;
}

/** The one invocation every phase ahead of the chain reads: the graph, the route, and the run. */
interface Preparation {
  graph: BuiltGraph;
  invocation: DispatchInvocation;
  routed: RoutedInvocation;
}

/**
 * The input-source stage over this run's own copies of the parsed values. The global and plugin
 * options fill whatever local parsing held; the routed Command's own options fill only when local
 * parsing held no fault, because the request is `null` otherwise.
 */
async function fillScope(
  { graph, invocation, routed }: Preparation,
  local: LocalPhase,
): Promise<{ globals: OptionValues; locals: OptionValues; sources: SourceOutcome }> {
  const globals = copyValues(routed.scan);
  const locals = copyValues(local.kind === 'parsed' ? local.options : emptyValues());
  const sources = await fillInputs({
    extensions: graph.extensions,
    globals: {
      global: true,
      inputs: [...graph.globals.inputs, ...graph.globals.plugins.flatMap((entry) => entry.inputs)],
      values: globals,
    },
    host: invocation.host,
    locals:
      local.kind === 'parsed'
        ? { global: false, inputs: optionsOf(routed.command.inputs), values: locals }
        : undefined,
    plugins: graph.globals.plugins,
    request: (input, global) =>
      requestNode(invocation.inspected(), routed.path, { global, name: input.name }),
    signal: invocation.signal,
  });
  return { globals, locals, sources };
}

/**
 * Validation and the dispatch it prepares, over the values the input-source stage left. It answers
 * with the call that dispatches, so the caller records that the action was invoked at the moment
 * it invokes it and no earlier failure reads as a dispatch.
 */
async function readyDispatch(
  { graph, invocation, routed }: Preparation,
  filled: {
    local: LocalPhase & { kind: 'parsed' };
    sources: SourceOutcome;
    values: OptionValues;
  },
): Promise<{ dispatch: (view: string | null) => Promise<void>; request: Request }> {
  const { command, path } = routed;
  const { local } = filled;
  const values = await validateValues({
    command: path,
    defaults: invocation.defaults,
    host: invocation.host,
    inputs: { globals: graph.globals.inputs, locals: command.inputs },
    passthrough: local.passthrough,
    plugins: graph.globals.plugins.flatMap((entry) => entry.inputs),
    signal: invocation.signal,
    sources: filled.sources,
    supplied: { args: local.args, options: filled.values },
  });
  return {
    dispatch: async (view) => {
      // The channel is built at the boundary, because the view a middleware selected is read there.
      const channel = invocation.channel({ path, result: command.result, view });
      try {
        await local.dispatch({
          host: invocation.host,
          out: channel.out,
          passthrough: local.passthrough,
          signal: invocation.signal,
          style: invocation.style,
          values,
        });
        /**
         * A declared result is a promise the Command makes, so an action that returned normally
         * without emitting one broke it. A failure raised before the call is that failure, and a
         * cancelled run raises none, because an action that reads its signal and returns is the
         * sanctioned path.
         */
        if (command.result && !channel.emitted() && !invocation.signal.aborted) {
          throw new ResultError('missing', path);
        }
      } catch (error) {
        // The action's failure is the invocation's outcome.
        // A sequence it left pending is stopped where it stands rather than drained to its end.
        channel.stop();
        throw error;
      }
    },
    request: requestOf(command, values, local.passthrough),
  };
}

/**
 * Prepares one dispatch ahead of the middleware chain and holds whatever fault it found, so a
 * middleware reads the request before the action runs and a takeover never observes the fault.
 * The phases run in order: local parsing, the input-source stage, and validation. A local fault
 * outranks a configuration source's fault, and after either one core runs no validation.
 */
export async function prepareDispatch(
  graph: BuiltGraph,
  routed: RoutedInvocation,
  invocation: DispatchInvocation,
): Promise<Prepared> {
  const result = routed.command.result;
  const local = parseLocal(routed);
  const preparation = { graph, invocation, routed };
  const { globals, locals, sources } = await fillScope(preparation, local);
  const held = (fault: unknown): Prepared => ({
    fault,
    globals,
    kind: 'held',
    request: null,
    result,
  });
  if (local.kind === 'held') {
    return held(local.fault);
  }
  if (sources.fault) {
    return held(sources.fault);
  }
  try {
    const ready = await readyDispatch(preparation, {
      local,
      sources,
      values: mergeValues(globals, locals),
    });
    return { ...ready, globals, kind: 'ready', result };
  } catch (error) {
    return held(error);
  }
}
