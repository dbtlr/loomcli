import { checkEnvBinding, checkNoArgumentBinding } from './bindings.js';
import { captureDeclaration, unreadableArgument } from './capture.js';
import {
  aliasWithoutNames,
  argumentDeclaredTwice,
  argumentsBesideChildren,
  commandAttachedTwice,
  commandGlobals,
  commandWithoutAction,
  declaredAfterAction,
  declaredName,
  groupOption,
  multipleActions,
  multipleResults,
  nestingDepth,
  notACommand,
  optionalArgumentLast,
  portableName,
  repeatedAlias,
  resultWithoutAction,
  resultWithoutViews,
  rowViewOnValue,
  siblingNameTaken,
  unknownDefaultView,
  variadicArgumentLast,
  viewName,
  viewShape,
  viewsWithoutResult,
} from './command-rules.js';
import { elided, quoteString, spelled } from './diagnostic-text.js';
import type { DiagnosticRule, Finding } from './diagnostic-text.js';
import type { RegisteredGlobals } from './environment.js';
import {
  asSentence,
  commandSentence,
  commandSubject,
  DeclarationError,
  NonCallableCommandError,
  quoted,
  ResultError,
  toFailure,
  UnexpectedArgumentError,
  UnknownCommandError,
  reasonOf,
} from './errors.js';
import type { LoomError } from './errors.js';
import {
  buildExtensions,
  extendStore,
  publishStore,
  registerDescriptor,
  storeCommandLayers,
  validateLayer,
} from './extension.js';
import type {
  AdmittedDescriptor,
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
  declarerNote,
  siteFinding,
} from './facts.js';
import type { FactSite, InputSite } from './facts.js';
import type {
  BuiltGlobals,
  GlobalsState,
  GlobalTable,
  InputRecords,
  TableEntry,
} from './globals.js';
import { buildGlobals, checkLocalOptions } from './globals.js';
import { nameSharedAcrossKinds, optionDeclaredTwice, spellingTaken } from './input-rules.js';
import { graphMismatch, nodeAt, resultNode } from './inspect.js';
import type { CommandGraph, CommandNode, OptionNode, ResultNode } from './inspect.js';
import {
  checkOptionName,
  compileOptions,
  copyValues,
  emptyValues,
  extractGlobals,
  isOptionToken,
  mergeValues,
  parseInputs,
  spellingMark,
} from './options.js';
import type { CompileScope, OptionValues, SpellingRole } from './options.js';
import { declaring, isPlainObject, shallowList, snapshot } from './plain.js';
import { brokenAttachHook, notAnObject } from './plugin-rules.js';
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
import {
  captureInputConfig,
  configUnread,
  checkDeclarations,
  declaringSite,
  inputPlace,
  validateValues,
} from './validation.js';
import type {
  ArgumentInput,
  DefaultValues,
  InputPlace,
  InputPlaces,
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

/**
 * What one dispatch hands its action. `graph` and `command` are the run's inspected graph and the
 * routed node inside it, the values its middleware read. Each builds on its first read, so a run
 * whose action reads neither, whose chain is empty, and which asks no configuration source renders
 * no graph and calls no converter.
 */
export interface DispatchInput {
  command: () => CommandNode;
  graph: () => CommandGraph;
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

/**
 * One attached child, under the canonical name its parent's namespace holds it by, with the call
 * that attached it, which a diagnostic about the child as a whole marks.
 */
export interface AttachedChild {
  readonly name: string;
  readonly node: CommandNodeHandle;
  readonly placement: Finding;
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

/**
 * The path a finding opens with for a declaration call on one Command. The root's is empty. A named
 * Command's call cannot know the parent it will join, so its path is its own name.
 */
function pathOf(name: string | null): readonly string[] {
  return name === null ? [] : [name];
}

/** A call's arguments as its author wrote them: the trailing ones left undefined are dropped. */
export function callArguments(...values: readonly unknown[]): readonly unknown[] {
  let length = values.length;
  while (length > 0 && values[length - 1] === undefined) {
    length -= 1;
  }
  return values.slice(0, length);
}

/** A Command value as a finding prints it, which it would otherwise print as an ellipsis. */
export function commandCode(name: string): object {
  return spelled(`new Command(${quoteString(name)})`);
}

/** The finding for one `command()` call that attached a child under the Command at `path`. */
export function commandPlacement(path: readonly string[], child: string): Finding {
  return { arguments: [commandCode(child)], call: 'command', mark: '0', path };
}

/** The finding for one `new Command()` call, which carries the name and the options slot. */
function constructorFinding(name: unknown, options: unknown, mark: string): Finding {
  return { arguments: callArguments(name, options), call: 'new Command', mark };
}

/**
 * The one copy of the options that `new Command(name, options)` reads, taken once the name is
 * judged: the options object and its `extensions` list, whose entries are what their factory built
 * and are not copied. A read that throws is the unreadable fault of the options, a value that is not
 * a plain object is the not-an-object fault, and a Command declared without options has none.
 */
function captureCommandOptions(
  name: string,
  options: unknown,
): Record<string, unknown> | undefined {
  if (options === undefined) {
    return undefined;
  }
  return captureDeclaration(
    options,
    (copy, read) => {
      read.nested(copy, 'extensions', shallowList);
    },
    {
      notAnObject: () =>
        new DeclarationError(notAnObject, {
          correction: 'Supply a Command options object.',
          findings: [constructorFinding(name, options, '1')],
          sentence: `${commandSentence(name)} declares options that are not an object.`,
        }),
      unreadable: unreadableArgument(
        { call: 'new Command', named: name, subject: commandSentence(name) },
        'options',
      ),
    },
  );
}

/** A named Command's options never carry the retired globals wiring. */
function checkCommandOptions(name: string, options: Readonly<Record<string, unknown>>): void {
  if ('globals' in options) {
    throw new DeclarationError(commandGlobals, {
      correction: 'Declare globals on the Application and register its environment.',
      findings: [constructorFinding(name, options, '1.globals')],
      sentence: `${commandSentence(name)} declares globals.`,
    });
  }
}

/** One name rule for an argument, option, or view name: a bare token the parser can read. */
function isDeclaredName(name: unknown): name is string {
  return typeof name === 'string' && Boolean(name) && !name.startsWith('-') && !/[\s=]/u.test(name);
}

/**
 * The portable name rule, for every name an operator types as a command at a shell prompt: the
 * application name, every Command name, and every alias. The characters are the POSIX portable
 * filename set, and a name starts with neither `-`, which reads as an option, nor `.`, which a
 * shell hides.
 */
export function isPortableName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u.test(name);
}

/** The one correction every portable name diagnostic ends with. */
export const portableNameCorrection =
  'Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".';

/** An alias is typed at the prompt the way a Command name is, so it answers to the portable rule. */
function checkAliasNames(command: string | null, names: readonly unknown[]): void {
  for (const [index, alias] of names.entries()) {
    if (!isPortableName(alias)) {
      throw new DeclarationError(portableName, {
        correction: portableNameCorrection,
        findings: [{ arguments: names, call: 'alias', mark: String(index), path: pathOf(command) }],
        sentence: `${commandSentence(command)} declares an alias named ${quoted(alias)}.`,
      });
    }
  }
}

/**
 * The finding for the `alias()` call that declared one alias on the Command at `path`, rebuilt from
 * every alias the Command holds.
 */
function aliasFinding(
  command: { path: readonly string[]; aliases: readonly string[] },
  alias: string,
  note: string,
): Finding {
  const { aliases, path } = command;
  return { arguments: aliases, call: 'alias', mark: String(aliases.indexOf(alias)), note, path };
}

/**
 * One call of the results lane, in the order it was made, with the arguments a finding rebuilds it
 * from. A `result()` or `rows()` call declares the unit, and a `views()` call reshapes the views of
 * whichever declaration it follows.
 */
export type ResultCall = { arguments: readonly unknown[] } & (
  | { kind: 'value' | 'rows'; views: unknown }
  | { default: unknown; kind: 'views'; views: unknown }
);

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
  descriptors: ReadonlyMap<string, AdmittedDescriptor>;
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
  descriptors: ReadonlyMap<string, AdmittedDescriptor>;
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
 * A named Command's own declaration, checked before the value exists: the name, then the one copy
 * of the options slot, its core facts, and the extension values it carries. A later change to the
 * options object the author passed changes nothing the declaration holds.
 */
function namedState<Globals>(
  name: unknown,
  options: unknown,
): { name: string; state: CommandState<{}, {}, Globals> } {
  if (!isPortableName(name)) {
    // The options are read after the name is judged, so the name's finding prints them elided.
    throw new DeclarationError(portableName, {
      correction: portableNameCorrection,
      findings: [
        constructorFinding(name, options === undefined ? undefined : spelled(elided), '0'),
      ],
      sentence: `Command name ${quoted(name)} is invalid.`,
    });
  }
  const slot = captureCommandOptions(name, options);
  if (slot !== undefined) {
    checkCommandOptions(name, slot);
  }
  const site: FactSite = {
    at: '1',
    declaration: { arguments: [name, slot], call: 'new Command' },
    subject: commandSentence(name),
  };
  // The facts are read in the order their diagnostics have always ranked.
  const description = checkDescription(site, slot?.description);
  const hidden = checkHidden(site, slot?.hidden);
  const deprecated = checkDeprecated(site, slot?.deprecated);
  const descriptors: DescriptorRegistry = new Map();
  const extensions = storeCommandLayers({
    descriptors,
    layers: [slot?.extensions],
    site: { ...site, at: '1.extensions' },
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
  late: { clause: string; remedy: string; call: string; arguments: readonly unknown[] },
): void {
  if (state.action !== undefined) {
    throw new DeclarationError(declaredAfterAction, {
      correction: late.remedy,
      findings: [
        {
          arguments: late.arguments,
          call: late.call,
          mark: '0',
          note: 'after action()',
          path: pathOf(state.name),
        },
      ],
      sentence: `${commandSentence(state.name)} ${late.clause} after its action.`,
    });
  }
}

/** The remedy a late argument or option earns. */
const inputRemedy = 'Declare arguments and options before action().';

/** Where one input was declared: the call on the Command at `path` that declared it. */
function inputSite(
  name: string | null,
  path: readonly string[],
  input: InputDeclaration,
): InputSite {
  return declaringSite(
    input,
    inputPlace(input, { global: false, path }),
    `${commandSentence(name)} ${input.kind} ${quoted(input.name)}`,
  );
}

/** The finding for the `argument()` or `option()` call that declared one input, marking its name. */
function inputFinding(path: readonly string[], input: InputDeclaration, note?: string): Finding {
  const site = declaringSite(input, inputPlace(input, { global: false, path }));
  return siteFinding(site, site.named, note);
}

/**
 * The finding for an input whose name is invalid, marking the name. The config is read after the
 * name is judged, so it prints elided.
 */
function nameFinding(path: readonly string[], input: InputDeclaration): Finding {
  const site = configUnread(declaringSite(input, inputPlace(input, { global: false, path })));
  return siteFinding(site, site.named);
}

/** The scope one Command's own options compile under: its subject, and each option's call. */
function localScope(name: string | null, path: readonly string[]): CompileScope<OptionInput> {
  return { siteOf: (input) => inputSite(name, path, input), subject: commandSubject(name) };
}

/** One Command declares arguments or attaches children, whichever call came second. */
function placementFault(
  parent: { name: string | null; path: readonly string[] },
  argument: InputDeclaration,
  child: AttachedChild,
): DeclarationError {
  return new DeclarationError(argumentsBesideChildren, {
    correction: 'Move the argument into a child Command or remove the children.',
    findings: [
      inputFinding(parent.path, argument, 'the argument'),
      { ...child.placement, note: 'the child' },
    ],
    sentence: `${commandSentence(parent.name)} declares argument "${argument.name}" and attaches child "${child.name}".`,
  });
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
    site: { ...inputSite(name, pathOf(name), input), at: '1.extensions' },
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
  const path = pathOf(name);
  const command = { name, path, subject: commandSubject(name) };
  const declared = state.inputs.filter((entry) => entry.kind === 'argument');
  checkArgumentName(command, declared, input);
  const child = state.children[0];
  if (child) {
    throw placementFault(command, input, child);
  }
  const previous = declared.at(-1);
  if (previous) {
    checkSlotOrder(slotOf(previous), slotOf(input), command);
  }
  const site = inputSite(name, path, input);
  checkDescription(site, input.config.description);
  checkNoListingFacts(site, input.config);
  checkNoArgumentBinding(site, input.config);
  checkDeclarations([{ input, site }]);
}

/** One argument's name answers the declared-name rule and names no argument declared before it. */
function checkArgumentName(
  command: { name: string | null; path: readonly string[]; subject: string },
  declared: readonly InputDeclaration[],
  input: InputDeclaration,
): void {
  const { path } = command;
  if (!isDeclaredName(input.name)) {
    throw new DeclarationError(declaredName, {
      correction: 'Use a nonempty name without a leading hyphen, whitespace, or "=".',
      findings: [nameFinding(path, input)],
      sentence: `${commandSentence(command.name)} declares an argument named ${quoted(input.name)}.`,
    });
  }
  const first = declared.find((entry) => entry.name === input.name);
  if (first) {
    throw new DeclarationError(argumentDeclaredTwice, {
      correction: 'Remove or rename the duplicate.',
      findings: [
        inputFinding(path, first, 'the first declaration'),
        inputFinding(path, input, 'the second declaration'),
      ],
      sentence: `Argument "${input.name}" is declared more than once on ${command.subject}.`,
    });
  }
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
  declared: ArgumentInput<Name, Config>,
): CommandState<Args & Record<Name, ArgumentValue<Config>>, Options, Globals> {
  // The call's own input is judged before the receiver's state, as alias() judges its names.
  // A name of another kind then reports as a declared name instead of failing to print in the order diagnostic.
  // The config is read once right after its name is judged, and every later check reads that copy.
  const { name } = state;
  checkArgumentName({ name, path: pathOf(name), subject: commandSubject(name) }, [], declared);
  const input = {
    ...declared,
    config: captureInputConfig(declared, { call: 'argument', path: pathOf(name) }),
  };
  checkOpen(state, {
    arguments: [input.name, input.config],
    call: 'argument',
    clause: `declares argument ${quoted(input.name)}`,
    remedy: inputRemedy,
  });
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
  declared: OptionInput<Name, Config>,
  table: GlobalTable = noGlobals,
): CommandState<Args, Options & Record<Name, OptionValue<Config>>, Globals> {
  // The call's own input is judged before the receiver's state, as alias() judges its names.
  // The config is read once right after its name is judged, and every later check reads that copy.
  const path = pathOf(state.name);
  checkOptionName(declared.name, configUnread(inputSite(state.name, path, declared)));
  const input = {
    ...declared,
    config: captureInputConfig(declared, { call: 'option', path }),
  };
  const site = inputSite(state.name, path, input);
  checkOpen(state, {
    arguments: [input.name, input.config],
    call: 'option',
    clause: `declares option ${quoted(input.name)}`,
    remedy: inputRemedy,
  });
  checkDescription(site, input.config.description);
  checkHidden(site, input.config.hidden);
  checkDeprecated(site, input.config.deprecated);
  checkEnvBinding(site, input.config);
  const recorded = recordInput(state, input);
  checkLocalOptions(
    [...optionsOf(state.inputs), input],
    table,
    localScope(state.name, pathOf(state.name)),
  );
  checkDeclarations([{ input, site }]);
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
  const path = pathOf(name);
  const first = names[0];
  if (first === undefined) {
    throw new DeclarationError(aliasWithoutNames, {
      correction: 'Supply at least one name.',
      findings: [{ arguments: [], call: 'alias', path }],
      sentence: `${commandSentence(name)} declares an alias with no names.`,
    });
  }
  // The call's own input is judged before the receiver's state.
  // A non-string name then reports as an alias name instead of failing to print in the order diagnostic.
  checkAliasNames(name, names);
  checkOpen(state, {
    arguments: names,
    call: 'alias',
    clause: `declares alias "${first}"`,
    remedy: 'Declare aliases before action().',
  });
  const aliases = [...state.aliases];
  for (const [index, alias] of names.entries()) {
    const repeated = { arguments: names, call: 'alias', mark: String(index), path };
    if (alias === name) {
      throw new DeclarationError(repeatedAlias, {
        correction: 'Remove the alias.',
        findings: [{ ...repeated, note: 'its own name' }],
        sentence: `${commandSentence(name)} declares alias "${alias}", which is its own name.`,
      });
    }
    if (aliases.includes(alias)) {
      throw new DeclarationError(repeatedAlias, {
        correction: 'Remove the repeated alias.',
        findings: [{ ...repeated, note: 'already an alias' }],
        sentence: `${commandSentence(name)} declares alias "${alias}" twice.`,
      });
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
    site: { at: '', declaration: { arguments: values, call: 'extend', path: pathOf(state.name) } },
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
    throw new DeclarationError(multipleActions, {
      correction: 'Register one action.',
      findings: [
        {
          arguments: [handler],
          call: 'action',
          mark: '0',
          note: 'the second action',
          path: pathOf(state.name),
        },
      ],
      sentence: `${commandSentence(state.name)} has multiple actions.`,
    });
  }
  // The graph and the routed node stay getters, because a spread would build the graph on every run.
  const stored = (context: ActionContext<Args, Globals & Options, OpenResult>): unknown =>
    handler({
      args: context.args,
      get command() {
        return context.command;
      },
      get graph() {
        return context.graph;
      },
      host: context.host,
      options: context.options,
      out: declaredChannel(context.out),
      passthrough: context.passthrough,
      signal: context.signal,
      style: context.style,
    });
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
  const call: ResultCall = {
    arguments: callArguments(declaration),
    kind,
    views: recordOf(declaration, 'views'),
  };
  checkOpen(state, {
    arguments: call.arguments,
    call: resultCallName(call),
    clause: 'declares its result',
    remedy: 'Declare result() or rows() before action().',
  });
  const results = [...state.results, call];
  mergeResult({ name: state.name, path: pathOf(state.name) }, results);
  return { ...state, results };
}

/** A `views()` call reshapes views and closes nothing, so it is never a late declaration. */
export function declareResultViews<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  replacements: unknown,
  options: unknown,
): CommandState<Args, Options, Globals> {
  const results: readonly ResultCall[] = [...state.results, viewsCall(replacements, options)];
  mergeResult({ name: state.name, path: pathOf(state.name) }, results);
  return { ...state, results };
}

/** One `views()` call as the results lane records it. */
function viewsCall(replacements: unknown, options: unknown): ResultCall {
  return {
    arguments: callArguments(replacements, options),
    default: recordOf(options, 'default'),
    kind: 'views',
    views: replacements,
  };
}

/** One property of an authoring argument, read defensively: the rules report whatever it holds. */
function recordOf(declaration: unknown, key: 'default' | 'views'): unknown {
  return isPlainObject(declaration) ? declaration[key] : undefined;
}

/** The authoring call one results-lane call was made through. */
function resultCallName(call: ResultCall): string {
  return call.kind === 'value' ? 'result' : call.kind;
}

/** The finding for one results-lane call on the Command at `path`, marking one of its arguments. */
function resultFinding(
  path: readonly string[],
  call: ResultCall,
  mark: { at: string; note?: string },
): Finding {
  const finding = { arguments: call.arguments, call: resultCallName(call), mark: mark.at, path };
  return mark.note === undefined ? finding : { ...finding, note: mark.note };
}

/** Where one views entry sits among its call's arguments: in `views` for a declaration, or first. */
function entryMark(call: ResultCall, key: string): string {
  return call.kind === 'views' ? `0.${key}` : `0.views.${key}`;
}

/** One Command a rule judges: the name its sentence reads, and the path its findings open with. */
interface CommandPlace {
  name: string | null;
  path: readonly string[];
}

/** The parent one attach reads: its place, the children it holds, and the calls that close it. */
interface AttachParent extends CommandPlace {
  /** The first argument the parent declares, which no child may sit beside. */
  argument: InputDeclaration | undefined;
  children: readonly AttachedChild[];
  hasAction: boolean;
}

/** The parent a declaration is, as attach reads it. */
function parentOf(state: Declared & { readonly action: unknown }): AttachParent {
  return {
    argument: state.inputs.find((input) => input.kind === 'argument'),
    children: state.children,
    hasAction: state.action !== undefined,
    name: state.name,
    path: pathOf(state.name),
  };
}

/** The path one child sits at under its parent. */
function childPath(parent: CommandPlace, child: string): readonly string[] {
  return [...parent.path, child];
}

/** The call that attached one child, noted with the child's name. */
function childFinding(entry: AttachedChild): Finding {
  return { ...entry.placement, note: `child "${entry.name}"` };
}

/**
 * One parent's namespace, which every canonical name and alias under it shares. The rule reads the
 * same whichever sibling the author attached first.
 */
function checkSiblings(parent: AttachParent, child: AttachedChild): void {
  const sentence = commandSentence(parent.name);
  const { children } = parent;
  const aliased = (entry: AttachedChild, alias: string): Finding =>
    aliasFinding(
      { aliases: entry.node.declared.aliases, path: childPath(parent, entry.name) },
      alias,
      `alias of child "${entry.name}"`,
    );
  const correction = 'Rename or remove one.';
  const twin = children.find((entry) => entry.name === child.name);
  if (twin) {
    throw new DeclarationError(siblingNameTaken, {
      correction,
      findings: [childFinding(twin), childFinding(child)],
      sentence: `${sentence} attaches two children named "${child.name}".`,
    });
  }
  for (const alias of child.node.declared.aliases) {
    const holder = children.find((entry) => entry.name === alias);
    if (holder) {
      throw new DeclarationError(siblingNameTaken, {
        correction,
        findings: [childFinding(holder), aliased(child, alias)],
        sentence: `${sentence} attaches child "${child.name}" with alias "${alias}", which is also the name of child "${alias}".`,
      });
    }
    const owner = children.find((entry) => entry.node.declared.aliases.includes(alias));
    if (owner) {
      throw new DeclarationError(siblingNameTaken, {
        correction,
        findings: [aliased(owner, alias), aliased(child, alias)],
        sentence: `${sentence} attaches child "${child.name}" with alias "${alias}", which is also an alias of child "${owner.name}".`,
      });
    }
  }
  const owner = children.find((entry) => entry.node.declared.aliases.includes(child.name));
  if (owner) {
    throw new DeclarationError(siblingNameTaken, {
      correction,
      findings: [aliased(owner, child.name), childFinding(child)],
      sentence: `${sentence} attaches child "${owner.name}" with alias "${child.name}", which is also the name of child "${child.name}".`,
    });
  }
}

/**
 * A child at the cap holds no children. Attach reads the child at the shallowest level its parent
 * can sit at, and the Application's join reads every node at its level below the root.
 */
function checkNesting(parent: string | null, child: AttachedChild, level: number): void {
  if (level >= nestingCap.depth && child.node.declared.children.length > 0) {
    throw new DeclarationError(nestingDepth, {
      correction: `Nest Commands at most ${nestingCap.words} levels below the root.`,
      findings: [{ ...child.placement, note: 'has children of its own' }],
      sentence: `${commandSentence(parent)} attaches child "${child.name}", which has children of its own.`,
    });
  }
}

/**
 * Where a finished Command is judged: its path, and the call that attached it, which build has none
 * of for the root.
 */
interface FinishedPlace {
  path: readonly string[];
  placement?: Finding;
}

/**
 * A Command without an action is a group, and routing sends an invocation on to one of its
 * children. A group with no children receives an invocation no handler can answer, and a local
 * option on a group reaches no handler either, because locals never inherit.
 */
function checkGroup(state: Declared, place: FinishedPlace): void {
  const { name } = state;
  if (state.children.length === 0) {
    const { placement } = place;
    throw new DeclarationError(commandWithoutAction, {
      correction: 'Register an action.',
      findings:
        placement === undefined ? [] : [{ ...placement, note: 'no action and no children' }],
      sentence: `${commandSentence(name)} has no action.`,
    });
  }
  const option = state.inputs.find((input) => input.kind === 'option');
  if (option) {
    throw new DeclarationError(groupOption, {
      correction: 'Register an action or remove the option.',
      findings: [inputFinding(place.path, option, 'no action reads it')],
      sentence: `${commandSentence(name)} declares option ${quoted(option.name)} but registers no action to receive it.`,
    });
  }
}

/**
 * The rules a finished Command answers, which attach applies to a child and build to the root: a
 * result needs an action, its merged views record names at least one view and its default, and a
 * Command without an action is a group. It answers with the resolved result.
 */
function checkFinished(
  declared: Declared,
  hasAction: boolean,
  place: FinishedPlace,
): DeclaredResult | undefined {
  const result = buildResult(declared, hasAction, place.path);
  if (!hasAction) {
    checkGroup(declared, place);
  }
  return result;
}

/**
 * The one attach operation `Command.command()`, `Application.command()`, and a plugin's
 * `commands` list share. A Command is an immutable value, so the child is final here: it is checked
 * as a finished Command, against the parent's current children, and against the nesting cap from
 * the shallowest level the parent can sit at. The placement is the call that attached it, which a
 * finding about the child as a whole marks.
 */
export function attach(
  parent: AttachParent,
  node: CommandNodeHandle,
  placement: Finding,
): AttachedChild {
  const { name } = node;
  const child: AttachedChild = { name, node, placement };
  if (parent.hasAction) {
    throw new DeclarationError(declaredAfterAction, {
      correction: 'Attach children before action().',
      findings: [{ ...placement, note: 'after action()' }],
      sentence: `${commandSentence(parent.name)} attaches child "${name}" after its action.`,
    });
  }
  if (parent.argument !== undefined) {
    throw placementFault(parent, parent.argument, child);
  }
  checkFinished(node.declared, node.hasAction, { path: childPath(parent, name), placement });
  checkSiblings(parent, child);
  checkNesting(parent.name, child, parentLevel(parent.name) + 1);
  return child;
}

/** The handle behind the value one `command()` call received; anything else is a declaration error. */
export function childNode(parent: string | null, child: unknown): CommandNodeHandle {
  const node = commandNode(child);
  if (!node) {
    throw new DeclarationError(notACommand, {
      correction: 'Attach the value returned by new Command(name).',
      findings: [{ arguments: [child], call: 'command', mark: '0', path: pathOf(parent) }],
      sentence: `${commandSentence(parent)} attaches a value that is not a Command.`,
    });
  }
  return node;
}

/** Attaching is a declaration call too, so the receiver keeps the children it already had. */
function attachChild<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  child: unknown,
): CommandState<Args, Options, Globals> {
  const node = childNode(state.name, child);
  const attached = attach(parentOf(state), node, commandPlacement(pathOf(state.name), node.name));
  return { ...state, children: [...state.children, attached] };
}

/** The first place an Application holds one Command value: its parent's name and the attach call. */
export interface ChildOwner {
  name: string | null;
  placement: Finding;
}

/** What an Application holds while a subtree joins it, each register a copy the caller commits. */
interface JoinScope {
  descriptors: DescriptorRegistry;
  /** The first place that claimed each node the Application holds. */
  owners: Map<CommandNodeHandle, ChildOwner>;
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
  { level, parent }: { level: number; parent: CommandPlace },
): void {
  const { name, node, placement } = child;
  checkNesting(parent.name, child, level);
  const owner = scope.owners.get(node);
  if (owner) {
    throw new DeclarationError(commandAttachedTwice, {
      correction: 'Attach a Command value at one point; create a new Command for each placement.',
      findings: [
        { ...owner.placement, note: 'the first placement' },
        { ...placement, note: 'the second placement' },
      ],
      sentence: `${commandSentence(parent.name)} attaches child "${name}", which ${commandSubject(owner.name)} also attaches.`,
    });
  }
  scope.owners.set(node, { name: parent.name, placement });
  for (const [key, descriptor] of node.declared.descriptors) {
    registerDescriptor(scope.descriptors, descriptor, { identity: key });
  }
  const path = childPath(parent, name);
  checkLocalOptions(optionsOf(node.declared.inputs), scope.table, localScope(name, path));
  for (const entry of node.declared.children) {
    // A nested child's own placement knew its parent alone, so the walk places it under the root.
    const rooted = { ...entry, placement: commandPlacement(path, entry.name) };
    joinSubtree(scope, rooted, { level: level + 1, parent: { name, path } });
  }
}

/**
 * Attaches one child to an Application's root and walks the subtree it brings, once. The scope's
 * registers are copies: the caller commits the owners, and the returned root holds the descriptors.
 */
export function attachToRoot<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  child: { node: CommandNodeHandle; placement: Finding },
  scope: JoinScope,
): CommandState<Args, Options, Globals> {
  const parent = parentOf(state);
  const attached = attach(parent, child.node, child.placement);
  joinSubtree(scope, attached, { level: parentLevel(state.name) + 1, parent });
  return { ...state, children: [...state.children, attached], descriptors: scope.descriptors };
}

/** Every attached Command's local options against a globals table that has just grown. */
function checkAttachedOptions(
  table: GlobalTable,
  parent: CommandPlace,
  children: readonly AttachedChild[],
): void {
  for (const { name, node } of children) {
    const path = childPath(parent, name);
    checkLocalOptions(optionsOf(node.declared.inputs), table, localScope(name, path));
    checkAttachedOptions(table, { name, path }, node.declared.children);
  }
}

/**
 * A declaration's own options and every attached Command's, against a globals table that has just
 * grown. The table's new option reads as the other side of any collision.
 */
export function checkDeclaredOptions(state: Declared, table: GlobalTable): void {
  const place: CommandPlace = { name: state.name, path: pathOf(state.name) };
  checkLocalOptions(optionsOf(state.inputs), table, localScope(place.name, place.path));
  checkAttachedOptions(table, place, state.children);
}

/** A variadic or optional slot ends the positional list, so nothing may follow either one. */
function checkSlotOrder(
  slot: ArgumentSlot,
  next: ArgumentSlot,
  command: { path: readonly string[]; subject: string },
) {
  const { path, subject } = command;
  const after = inputFinding(path, next.input, 'the argument after it');
  if (slot.variadic) {
    throw new DeclarationError(variadicArgumentLast, {
      correction: 'Declare the variadic argument last.',
      findings: [inputFinding(path, slot.input, 'the variadic argument'), after],
      sentence: `Argument "${slot.input.name}" is variadic and precedes argument "${next.input.name}" on ${subject}.`,
    });
  }
  if (!slot.required) {
    const findings = [inputFinding(path, slot.input, 'the optional argument'), after];
    throw new DeclarationError(
      optionalArgumentLast,
      next.required
        ? {
            correction: 'Declare optional arguments after required ones.',
            findings,
            sentence: `Argument "${slot.input.name}" is optional and precedes required argument "${next.input.name}" on ${subject}.`,
          }
        : {
            correction: 'Declare an optional argument last.',
            findings,
            sentence: `Argument "${next.input.name}" follows optional argument "${slot.input.name}" on ${subject}.`,
          },
    );
  }
}

/**
 * The positional slots one declaration holds. Every authored argument answered these rules at its
 * own call, so they throw here only for an argument a lifecycle hook declared.
 */
function collectArguments(state: Declared, command: CommandPlace): ArgumentSlot[] {
  const slots: ArgumentSlot[] = [];
  const declared: InputDeclaration[] = [];
  const judged = { ...command, subject: commandSubject(command.name) };
  for (const input of state.inputs.filter((entry) => entry.kind === 'argument')) {
    checkArgumentName(judged, declared, input);
    declared.push(input);
    slots.push(slotOf(input));
  }
  for (let index = 0; index + 1 < slots.length; index += 1) {
    const slot = slots[index];
    const next = slots[index + 1];
    if (slot && next) {
      checkSlotOrder(slot, next, judged);
    }
  }
  return slots;
}

/**
 * A view name is a bare token the way an argument or option name is, and never an array index,
 * because an integer-like key does not keep the position the author gave it.
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

/** Where one views entry was declared: the Command's sentence and path, the call, and the key. */
interface EntrySite {
  sentence: string;
  path: readonly string[];
  call: ResultCall;
  key: string;
}

/**
 * One `views` entry under the unit its declaration named, read back as the shape its own functions
 * name. The two shapes are exclusive, and a row view answers a rows declaration alone.
 */
function resultView(kind: 'value' | 'rows', site: EntrySite, entry: unknown): ResultView {
  const { call, key, path, sentence } = site;
  const findings = [resultFinding(path, call, { at: entryMark(call, key) })];
  const whole = isWholeView(entry);
  const row = isRowView(entry);
  if (whole && row) {
    throw new DeclarationError(viewShape, {
      correction: 'Supply one of the two.',
      findings,
      sentence: `${sentence} names view ${quoted(key)} with render and row.`,
    });
  }
  if (row) {
    if (kind === 'value') {
      throw new DeclarationError(rowViewOnValue, {
        correction: 'Supply a view with render, or declare the result with rows().',
        findings,
        sentence: `${sentence} names row view ${quoted(key)} on a value result.`,
      });
    }
    return entry;
  }
  if (whole) {
    return entry;
  }
  throw new DeclarationError(viewShape, {
    correction: 'Supply a view with render or a row view with row.',
    findings,
    sentence: `${sentence} names view ${quoted(key)} with a value that is not a view.`,
  });
}

/**
 * The results lane's calls read as one declaration: its unit, its views, and its selected key, with
 * the call that declared the unit and the one that selected the key, which a finding marks.
 */
interface MergedResult {
  declaration: ResultCall;
  kind: 'value' | 'rows';
  selected: { key: string; call: ResultCall } | undefined;
  views: Map<string, ResultView>;
}

/**
 * Every rule a results-lane call can judge on its own, applied to one Command's calls in the order
 * it made them. The merged record is what the rules read: a later `views()` call replaces a key in
 * place and appends a new one, so each name keeps the position the call that first named it gave
 * it. A `default` once named persists through later calls that name none.
 */
function mergeResult(
  command: CommandPlace,
  results: readonly ResultCall[],
): MergedResult | undefined {
  const { path } = command;
  const sentence = commandSentence(command.name);
  const declarations = results.filter((call) => call.kind !== 'views');
  const [declaration, second] = declarations;
  if (declaration && second) {
    throw new DeclarationError(multipleResults, {
      correction: 'Declare one result() or rows() call.',
      findings: [
        resultFinding(path, declaration, { at: '0', note: 'the first result' }),
        resultFinding(path, second, { at: '0', note: 'the second result' }),
      ],
      sentence: `${sentence} declares two results.`,
    });
  }
  // A `views()` call reshapes a result's views, so one with no result reshapes nothing.
  // The types publish the call where a result is carried, so this reaches a JavaScript author.
  if (!declaration) {
    const [reshape] = results;
    if (reshape) {
      throw new DeclarationError(viewsWithoutResult, {
        correction: 'Declare result() or rows() before action().',
        findings: [resultFinding(path, reshape, { at: '0' })],
        sentence: `${sentence} reshapes its views and declares no result.`,
      });
    }
    return undefined;
  }
  const views = new Map<string, ResultView>();
  let selected: MergedResult['selected'] = undefined;
  for (const call of results) {
    for (const [key, entry] of recordEntries(call.views)) {
      const view = resultView(declaration.kind, { call, key, path, sentence }, entry);
      if (!isViewName(key)) {
        throw new DeclarationError(viewName, {
          correction:
            'Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.',
          findings: [resultFinding(path, call, { at: entryMark(call, key) })],
          sentence: `${sentence} names view ${quoted(key)}.`,
        });
      }
      views.set(key, view);
    }
    const key = call.kind === 'views' ? selectedKey(call.default) : undefined;
    if (key !== undefined) {
      selected = { call, key };
    }
  }
  return { declaration, kind: declaration.kind, selected, views };
}

/**
 * The finished result: the merged record, which needs an action, at least one view, and a default
 * that names one of them. The first key answers until one is named.
 */
function buildResult(
  declared: Pick<Declared, 'name' | 'results'>,
  hasAction: boolean,
  path: readonly string[],
): DeclaredResult | undefined {
  const merged = mergeResult({ name: declared.name, path }, declared.results);
  if (!merged) {
    return undefined;
  }
  const sentence = commandSentence(declared.name);
  const { declaration, selected, views } = merged;
  if (!hasAction) {
    throw new DeclarationError(resultWithoutAction, {
      correction: 'Register an action or remove the result.',
      findings: [resultFinding(path, declaration, { at: '0' })],
      sentence: `${sentence} declares a result and no action.`,
    });
  }
  const first = views.keys().next();
  if (first.done === true) {
    throw new DeclarationError(resultWithoutViews, {
      correction: 'Name at least one view.',
      findings: [resultFinding(path, declaration, { at: '0.views' })],
      sentence: `${sentence} declares a result with no views.`,
    });
  }
  if (selected !== undefined && !views.has(selected.key)) {
    throw new DeclarationError(unknownDefaultView, {
      correction: 'Name the view or select a named one.',
      findings: [resultFinding(path, selected.call, { at: '1.default' })],
      sentence: `${sentence} selects default view ${quoted(selected.key)}, which it does not name.`,
    });
  }
  return { default: selected?.key ?? first.value, kind: merged.kind, views };
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
  registry: ReadonlyMap<string, AdmittedDescriptor>;
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
    this.#result = resultNode(buildResult(state.declared, state.hasAction, state.path));
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
    return this.#declare({ config, kind: 'argument', name });
  }

  option(name: string, config: OptionConfig): AttachedCommand {
    return this.#declare({ config, kind: 'option', name });
  }

  views(
    replacements: Readonly<Record<string, ResultView>>,
    options?: { default?: string },
  ): AttachedCommand {
    const call = viewsCall(replacements, options);
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
      site: { at: '', declaration: { arguments: values, call: 'extend', path: state.path } },
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
  #declare(raw: InputDeclaration): AttachedCommand {
    const { declared, identity } = this.#state;
    const { path } = this.#state;
    // The name is judged before the config, as Command and Application judge it.
    if (raw.kind === 'argument') {
      const { name } = declared;
      checkArgumentName({ name, path, subject: commandSubject(name) }, [], raw);
    } else {
      checkOptionName(raw.name, configUnread(inputSite(declared.name, path, raw)));
    }
    // Each kind captures its own config, so the input keeps the pairing its kind declares.
    const place = { call: raw.kind, path };
    const input: InputDeclaration =
      raw.kind === 'argument'
        ? { ...raw, config: captureInputConfig(raw, place) }
        : { ...raw, config: captureInputConfig(raw, place) };
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

/** The finding for the hook one plugin declared, as `plugin(identity, { onCommandAttach })`. */
function hookFinding(identity: string, hook: CommandAttachHook): Finding {
  return {
    arguments: [identity, { onCommandAttach: hook }],
    call: 'plugin',
    mark: '1.onCommandAttach',
  };
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
      brokenAttachHook,
      {
        correction:
          'Return the value the hook received or a value derived from it, and throw only a DeclarationError from the hook.',
        findings: [hookFinding(named.identity, hook)],
        sentence: `Plugin ${quoted(named.identity)} failed in onCommandAttach for ${named.subject}: ${asSentence(reasonOf(error))}`,
      },
      { cause: error },
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
    throw new DeclarationError(brokenAttachHook, {
      correction: 'Return the value it received or a value derived from it.',
      findings: [hookFinding(named.identity, hook)],
      sentence: `Plugin ${quoted(named.identity)} returned a value that is not the attached Command from onCommandAttach for ${named.subject}.`,
    });
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
  arguments: ReadonlyMap<string, InputDeclaration>;
  globals: BuiltGlobals;
  hookArguments: Map<string, AttachedInput>;
  hooks: Map<string, AttachedInput>;
  locals: ReadonlyMap<string, InputDeclaration>;
  /** The Command the names sit on, which a finding for one of its own inputs opens with. */
  path: readonly string[];
}

/**
 * What one collision reports: the scope that holds the name, the kind of input that holds it, the
 * remedy that pair earns, and the finding for the declaration that already holds the name.
 */
interface Collision {
  clause: string;
  kind: InputDeclaration['kind'];
  remedy: string;
  held: Finding;
}

/**
 * The reason rule one name collision breaks.
 * Two options or two arguments break the rule the application's own collision of the pair breaks.
 * An argument and an option under one name break name-shared-across-kinds, which only a hook reaches.
 */
function nameCollisionRule(
  declared: InputDeclaration['kind'],
  held: InputDeclaration['kind'],
): DiagnosticRule {
  if (declared !== held) {
    return nameSharedAcrossKinds;
  }
  return declared === 'option' ? optionDeclaredTwice : argumentDeclaredTwice;
}

/** The clause and the remedy an input another plugin's hook already declared earns. */
function hookClause(earlier: AttachedInput, path: readonly string[]): Collision {
  const { identity, input } = earlier;
  return {
    clause: `an ${input.kind} plugin ${quoted(identity)} declared through onCommandAttach`,
    held: inputFinding(path, input, declarerNote(identity)),
    kind: input.kind,
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

/** The collision with one option the globals table holds, a global or a plugin's own option. */
function tableCollision(entry: TableEntry): Collision {
  const { owner, site } = entry;
  if (owner.kind === 'plugin') {
    const clause = `an option of plugin ${quoted(owner.identity)}`;
    return {
      clause,
      held: siteFinding(site, site.named, clause),
      kind: 'option',
      remedy: attachedRemedy('plugin'),
    };
  }
  return {
    clause: 'a global option',
    held: siteFinding(site, site.named, 'the global option'),
    kind: 'option',
    remedy: attachedRemedy('global'),
  };
}

/**
 * What one name a hook-declared input of either kind collides with, in the order the scopes are
 * reported: an earlier hook's option, an earlier hook's argument, a local option, a global or
 * plugin-owned option, or an argument the Command declares. The remedy follows the target alone,
 * not which kind the hook declared.
 */
function attachedCollision(input: InputDeclaration, held: HeldNames): Collision | undefined {
  const { name } = input;
  const { path } = held;
  const hook = held.hooks.get(name) ?? held.hookArguments.get(name);
  if (hook !== undefined) {
    return hookClause(hook, path);
  }
  const local = held.locals.get(name);
  if (local !== undefined) {
    return {
      clause: 'a local option',
      held: inputFinding(path, local, 'the local option'),
      kind: 'option',
      remedy: attachedRemedy('local'),
    };
  }
  const entry = held.globals.names.get(name);
  if (entry) {
    return tableCollision(entry);
  }
  const argument = held.arguments.get(name);
  return argument === undefined
    ? undefined
    : {
        clause: 'an argument',
        held: inputFinding(path, argument, 'the argument'),
        kind: 'argument',
        remedy: attachedRemedy('argument'),
      };
}

/**
 * One spelling a table already claims: the form its option is named by, which is its long form
 * where it declares one and the colliding spelling itself where it declares none, and the finding
 * for the declaration that claims it.
 */
interface ClaimedSpelling {
  form: string;
  finding: Finding | undefined;
}

/** Where the option one table names declared one of its spellings, by its name and the role. */
type SpellingPlace = (name: string, role: SpellingRole) => Finding | undefined;

/** The spellings one compiled table holds, each with its form and the place that declared it. */
function readSpellings(
  table: ReturnType<typeof compileOptions>,
  claimed: Map<string, ClaimedSpelling>,
  placeOf: SpellingPlace,
) {
  const longs = new Map<string, string>();
  for (const [spelling, option] of table) {
    if (option.role === 'long') {
      longs.set(option.name, spelling);
    }
  }
  for (const [spelling, option] of table) {
    if (!claimed.has(spelling)) {
      const form = longs.get(option.name) ?? spelling;
      claimed.set(spelling, { finding: placeOf(option.name, option.role), form });
    }
  }
}

/** The place one input's spelling sits: the key of its call that yields the spelling. */
function spellingPlace(site: InputSite, role: SpellingRole, note: string): Finding {
  return siteFinding(site, spellingMark(site, role), note);
}

/** One hook-declared option's spellings, against every spelling the table already claims. */
function checkAttachedSpelling(
  declared: AttachedInput & { input: OptionInput },
  named: { claimed: Map<string, ClaimedSpelling>; scope: CompileScope<OptionInput> },
): void {
  const { claimed, scope } = named;
  const { identity, input } = declared;
  const { subject } = scope;
  const site = scope.siteOf(input);
  const table = compileOptions([input], scope);
  for (const [spelling, option] of table) {
    const used = claimed.get(spelling);
    if (used !== undefined) {
      throw new DeclarationError(spellingTaken, {
        correction: 'Change one of the two spellings or omit the plugin.',
        findings: [
          spellingPlace(site, option.role, declarerNote(identity)),
          ...(used.finding === undefined ? [] : [used.finding]),
        ],
        sentence: `Plugin ${quoted(identity)} declares option ${quoted(input.name)} with spelling ${quoted(spelling)} on ${subject}, which ${quoted(used.form)} already uses.`,
      });
    }
  }
  readSpellings(table, claimed, (_name, role) => spellingPlace(site, role, declarerNote(identity)));
}

/** The declarations of one kind, keyed by name, the first of each name winning. */
function byName(inputs: readonly InputDeclaration[]): Map<string, InputDeclaration> {
  const named = new Map<string, InputDeclaration>();
  for (const input of inputs) {
    if (!named.has(input.name)) {
      named.set(input.name, input);
    }
  }
  return named;
}

/** Where the globals table's options declared their spellings, a global or a plugin's option. */
function tableSpellings(globals: BuiltGlobals): SpellingPlace {
  return (name, role) => {
    const entry = globals.names.get(name);
    if (!entry) {
      return undefined;
    }
    const { owner, site } = entry;
    const note =
      owner.kind === 'plugin'
        ? `an option of plugin ${quoted(owner.identity)}`
        : `the global option ${quoted(name)}`;
    return spellingPlace(site, role, note);
  };
}

/**
 * Every input a hook declared, against the names and spellings the Command, the globals table, and
 * an earlier hook already hold. It runs before the Command's own inputs compile, so a hook-declared
 * input reports as the plugin's fault and never as the author's. A collision carries a finding for
 * the hook's input and one for the declaration that already holds the name or spelling.
 */
function checkAttachedInputs(
  declared: Declared,
  attached: readonly AttachedInput[],
  place: { globals: BuiltGlobals; path: readonly string[] },
): void {
  const { globals, path } = place;
  const scope = localScope(declared.name, path);
  const { subject } = scope;
  const hooked = new Set(attached.map((entry) => entry.input));
  const authored = declared.inputs.filter((input) => !hooked.has(input));
  const options = authored.filter((input) => input.kind === 'option');
  const locals = byName(options);
  const held: HeldNames = {
    arguments: byName(authored.filter((input) => input.kind === 'argument')),
    globals,
    hookArguments: new Map(),
    hooks: new Map(),
    locals,
    path,
  };
  const claimed = new Map<string, ClaimedSpelling>();
  readSpellings(globals.options, claimed, tableSpellings(globals));
  readSpellings(compileOptions(options, scope), claimed, (name, role) => {
    const local = locals.get(name);
    return local === undefined || local.kind !== 'option'
      ? undefined
      : spellingPlace(scope.siteOf(local), role, `the local option ${quoted(name)}`);
  });
  for (const entry of attached) {
    const { identity, input } = entry;
    const collision = attachedCollision(input, held);
    if (collision) {
      throw new DeclarationError(nameCollisionRule(input.kind, collision.kind), {
        correction: collision.remedy,
        findings: [inputFinding(path, input, declarerNote(identity)), collision.held],
        sentence: `Plugin ${quoted(identity)} declares ${input.kind} ${quoted(input.name)} on ${subject}, which is already declared as ${collision.clause}.`,
      });
    }
    if (input.kind === 'option') {
      checkAttachedSpelling({ identity, input }, { claimed, scope });
      held.hooks.set(input.name, entry);
    } else {
      held.hookArguments.set(input.name, entry);
    }
  }
}

/** Binds one Command's declarations to its action, so an action reads only validated values. */
function bindDispatch<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  action: Action<Args, Globals & Options>,
  globals: BuiltGlobals,
) {
  return ({ command, graph, host, out, passthrough, signal, style, values }: DispatchInput) => {
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
      get command() {
        return command();
      },
      get graph() {
        return graph();
      },
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
    const site = inputSite(name, context.path, input);
    const sentence = site.subject;
    checkDescription(site, input.config.description);
    if (input.kind === 'argument') {
      checkNoListingFacts(site, input.config);
      checkNoArgumentBinding(site, input.config);
    } else {
      checkHidden(site, input.config.hidden);
      checkDeprecated(site, input.config.deprecated);
      checkEnvBinding(site, input.config);
    }
    context.extensions.set(
      input,
      buildExtensions({
        declared: input.config.extensions,
        descriptors: context.descriptors,
        site: { ...site, at: '1.extensions' },
        subject: { phrase: `on ${subject} ${input.kind} "${input.name}"`, sentence },
        target: input.kind,
      }),
    );
  }
}

/** One Command declares arguments or attaches children, whichever declaration made each of them. */
function checkArgumentPlacement(
  command: CommandPlace,
  slot: ArgumentSlot | undefined,
  child: AttachedChild | undefined,
): void {
  if (slot && child) {
    throw placementFault(command, slot.input, child);
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
  const place: CommandPlace = { name, path: context.path };
  const declaredSlots = collectArguments(state, place);
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
  checkAttachedInputs(hooked, hookInputs, { globals, path: context.path });
  // Every value was validated once, the author's at each call and each hook's at its `extend()`.
  const extensions = publishStore(progress.extensions);
  const slots = hookInputs.length > 0 ? collectArguments(hooked, place) : declaredSlots;
  checkArgumentPlacement(place, slots[0], state.children[0]);
  const result = checkFinished(hooked, hasAction, { path: context.path });
  const options = checkLocalOptions(
    optionsOf(hooked.inputs),
    globals,
    localScope(name, context.path),
  );
  // A hook's erased calls answer the declaration rules an authored call answers at the call.
  checkDeclarations(
    hookInputs.map(({ input }) => ({ input, site: inputSite(name, context.path, input) })),
  );
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
      config,
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
      config,
      kind: 'option',
      name,
    };
    return this.#derive(declareOption(this.#state, input));
  }

  /**
   * Aliases are other portable names that route to this Command. They invalidate no call, and the
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
    const declared = declaring(() => namedState<RegisteredGlobals>(name, options));
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
 * Where every input of one graph was declared: each global option at its `globalOption()` call,
 * and each Command's own inputs at their calls on the Command, under its path from the root.
 */
export function inputPlaces(graph: BuiltGraph): InputPlaces {
  const places = new Map<InputDeclaration, InputPlace>();
  for (const input of graph.globals.inputs) {
    places.set(input, inputPlace(input, { global: true, path: [] }));
  }
  const walk = (command: BuiltCommand, path: readonly string[]) => {
    for (const input of command.inputs) {
      places.set(input, inputPlace(input, { global: false, path }));
    }
    for (const [name, child] of command.children) {
      walk(child, [...path, name]);
    }
  };
  walk(graph.root, []);
  return places;
}

/**
 * The names a routing failure offers: the canonical names of the visible, current children, in
 * authoring order. A candidate list is a listing, so a hidden or a deprecated child is absent from
 * it, as completion leaves them out, and a parent whose children are all hidden or deprecated
 * offers none. A deprecated child typed in full still routes.
 */
function candidatesOf(command: BuiltCommand): string[] {
  return [...command.children]
    .filter(([, child]) => !child.hidden && child.deprecated === undefined)
    .map(([name]) => name);
}

/**
 * Whether a token names one of the Command's children: the Command has children and the token is
 * no option token. Routing and `locate` read a bare word through this rule.
 */
export function readsAsChild(command: BuiltCommand, token: string): boolean {
  return command.children.size > 0 && !isOptionToken(token);
}

/**
 * Bare tokens, names or aliases, select children until a Command has none; a hyphen commits.
 * `walked` receives the path after each name routes, so an unknown Command leaves its caller
 * holding the partial path walked before it.
 */
export function route(
  root: BuiltCommand,
  tokens: readonly string[],
  walked?: (path: readonly string[]) => void,
) {
  let command = root;
  const path: string[] = [];
  let index = 0;
  for (let token = tokens[index]; token !== undefined; token = tokens[index]) {
    if (!readsAsChild(command, token)) {
      break;
    }
    const child = command.routes.get(token);
    if (!child) {
      throw new UnknownCommandError(token, candidatesOf(command));
    }
    // An alias routes like the canonical name, and the path it walks reports that name alone.
    command = child.command;
    path.push(child.name);
    walked?.(Object.freeze([...path]));
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
  for (const [position, token] of positionals.entries()) {
    const slot = argumentSlot(command.arguments, position);
    if (!slot) {
      throw new UnexpectedArgumentError(
        path,
        command.arguments.length,
        positionals.slice(position),
      );
    }
    // An empty variadic tail binds nothing, so validation reads it as `[]` or reports the omission.
    const bound = values.get(slot.input);
    if (!slot.variadic) {
      values.set(slot.input, token);
    } else if (Array.isArray(bound)) {
      bound.push(token);
    } else {
      values.set(slot.input, [token]);
    }
  }
  return values;
}

/**
 * The slot the positional at one index fills: the slot at that index, else a variadic last slot,
 * which accepts every later positional, else none. Binding and `locate` read positions through it.
 */
export function argumentSlot(
  slots: readonly ArgumentSlot[],
  position: number,
): ArgumentSlot | undefined {
  const last = slots.at(-1);
  return slots[position] ?? (last?.variadic ? last : undefined);
}

/** One invocation after the pre-scan and routing, which the middleware chain runs on top of. */
export interface RoutedInvocation {
  command: BuiltCommand;
  path: readonly string[];
  scan: OptionValues;
  tokens: readonly string[];
}

/**
 * Consumes the globals table, then routes the remaining bare tokens to a Command. `walked`
 * receives the path as routing extends it, the partial path of an unknown Command included.
 */
export function routeInvocation(
  graph: BuiltGraph,
  argv: readonly string[],
  walked: (path: readonly string[]) => void,
): RoutedInvocation {
  const scan = extractGlobals(graph.globals.options, [...argv]);
  const routed = route(graph.root, scan.rest, walked);
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
  /** Offers a configuration source's foreign throw to the translators where its call settles. */
  offer: (thrown: unknown) => LoomError | undefined;
  signal: AbortSignal;
  /** The channel a configuration source writes through, whose results call names the source. */
  sourceOut: Out<OpenResult>;
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
    throw graphMismatch(`Option "${place.name}" is not in the inspected graph.`);
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
    inspected: invocation.inspected,
    locals:
      local.kind === 'parsed'
        ? { global: false, inputs: optionsOf(routed.command.inputs), values: locals }
        : undefined,
    offer: invocation.offer,
    out: invocation.sourceOut,
    plugins: graph.globals.plugins,
    request: (input, global) =>
      requestNode(invocation.inspected(), routed.path, { global, name: input.name }),
    signal: invocation.signal,
    style: invocation.style,
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
          // The run builds its graph once, so every read answers the same node.
          command: () => nodeAt(invocation.inspected(), path),
          graph: invocation.inspected,
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
    // The fault is held as a failure, so a throw from reading a validator's output is never offered.
    return held(toFailure(error));
  }
}
