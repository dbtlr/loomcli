import {
  argumentDeclaredTwice,
  argumentsBesideChildren,
  commandAttachedTwice,
  commandWithoutAction,
  declaredName,
  optionalArgumentLast,
  portableName,
  siblingNameTaken,
  variadicArgumentLast,
} from './command-rules.js';
import { stdinClaimedTwice } from './content-rules.js';
import type { Content } from './content.js';
import { elided, quoteString, spelled } from './diagnostic-text.js';
import type { DiagnosticRule, Finding } from './diagnostic-text.js';
import type { RegisteredGlobals } from './environment.js';
import {
  commandSentence,
  commandSubject,
  DeclarationError,
  NonCallableCommandError,
  quoted,
  ResultError,
  toFailure,
} from './errors.js';
import type { InvokedBy, LoomError } from './errors.js';
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
import { declarerNote, siteFinding, callSite } from './facts.js';
import type { FactSite, InputSite } from './facts.js';
import type {
  BuiltGlobals,
  GlobalsState,
  GlobalTable,
  InputRecords,
  TableEntry,
} from './globals.js';
import { buildGlobals, checkLocalOptions, frozenValues } from './globals.js';
import { nameSharedAcrossKinds, optionDeclaredTwice, spellingTaken } from './input-rules.js';
import { graphMismatch, nodeAt, resultNode } from './inspect.js';
import type { CommandGraph, CommandNode, OptionNode, ResultNode } from './inspect.js';
import { interaction } from './interaction.js';
import type { Log, LogBinder } from './log.js';
import { isMarked } from './marks.js';
import { rememberInputNames } from './missing-input.js';
import { declareGroup } from './option-groups.js';
import type { OptionGroup } from './option-groups.js';
import {
  booleanValue,
  checkOptionName,
  compileOptions,
  copyValues,
  declaredNameCorrection,
  emptyValues,
  isDeclaredName,
  isSupplied,
  mergeValues,
  spellingMark,
  tableEntries,
} from './options.js';
import type { CompileScope, OptionValues, SpellingOrigin, SpellingTable } from './options.js';
import { candidatesOf } from './parse.js';
import type { ParsedInvocation } from './parse.js';
import { snapshot } from './plain.js';
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
  ImpliedConstraint,
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
  RowViews,
  ValidateOmittedConstraint,
  StdinConfig,
  StdinContext,
  Unmarked,
} from './types.js';
import {
  suppliedInputs,
  configUnread,
  declaringSite,
  inputPlace,
  rejectsGlobal,
  validateValues,
  ValidationLedger,
} from './validation.js';
import type {
  ArgumentInput,
  InputPlaces,
  InputDeclaration,
  OptionInput,
  DeclaredValues,
  Provenance,
  ValidatedInputs,
  Validation,
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
  cancel: () => void;
  interactive: boolean;
  supplied: ActionContext<unknown>['supplied'];
  stdin: Content | undefined;
  command: () => CommandNode;
  graph: () => CommandGraph;
  style: ContextualStyle;
  host: Host;
  /** Runs another Command of this run's graph by name, which the action receives as `invoke`. */
  invoke: ActionContext<unknown>['invoke'];
  /** The action's `log`, bound to no plugin. */
  log: Log;
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
  optionGroups: readonly OptionGroup[];
  stdin: (StdinConfig & { readonly position: number }) | undefined;
  aliases: readonly string[];
  arguments: readonly ArgumentSlot[];
  /**
   * The identity of the plugin whose `onCommandAttach` hook declared each of this Command's inputs
   * a hook declared, which that plugin's middleware reads under `ownOptions`.
   */
  attachedBy: ReadonlyMap<InputDeclaration, string>;
  children: ReadonlyMap<string, BuiltCommand>;
  /** The plugin whose lifecycle hook declared each input a hook declared, by its identity. */
  declarers: ReadonlyMap<InputDeclaration, string>;
  deprecated: string | undefined;
  description: string | undefined;
  dispatch: ((input: DispatchInput) => unknown) | undefined;
  extensions: Readonly<Record<string, unknown>>;
  hidden: boolean;
  inputs: readonly InputDeclaration[];
  name: string | null;
  /**
   * The call that attached this Command, opening with the whole path to its parent, or nothing for
   * the root, which no call attaches.
   */
  placement: Finding | undefined;
  /**
   * The one table the parser reads this Command's words against, built after every lifecycle hook
   * ran: its own options, hook-declared ones included, and every global option. Each entry names
   * one declaration, so a group's table holds the global options alone.
   */
  table: SpellingTable;
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
 * unnamed root alike, at any depth.
 */
export type CommandMethod =
  | 'action'
  | 'alias'
  | 'argument'
  | 'command'
  | 'option'
  | 'exclusive'
  | 'oneRequired'
  | 'requiredTogether'
  | 'result'
  | 'rows'
  | 'stdin';

/** One Command declares arguments or attaches children, so the first call removes the other. */
export type AfterArgument<State> = Exclude<State, 'command'>;

/** The same rule read from the other side. */
export type AfterCommand<State> = Exclude<State, 'argument'>;

/** One Command declares one result, so either call removes both. */
export type AfterResult<State> = Exclude<State, 'result' | 'rows'>;

/** Registering the action closes input, alias, child, and further action declarations. */
export type AfterAction = never;

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
  /** The call that attached the Command being built, or nothing for the root. */
  placement: Finding | undefined;
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
function callArguments(...values: readonly unknown[]): readonly unknown[] {
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
 * The portable name rule, for every name an operator types as a command at a shell prompt: the
 * application name, every Command name, and every alias. The characters are the POSIX portable
 * filename set, and a name starts with neither `-`, which reads as an option, nor `.`, which a
 * shell hides.
 */
export function isPortableName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u.test(name);
}

/** The one correction every portable name diagnostic ends with. */
export const portableNameCorrection =
  'Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".';

/** An alias is typed at the prompt the way a Command name is, so it answers to the portable rule. */
function checkAliasNames(command: string | null, names: readonly string[]): void {
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
 * One call of the results lane, in the order it was made. A `result()` or `rows()` call declares
 * the unit, and a `views()` call reshapes the views of whichever declaration it follows.
 */
export type ResultCall = { entries: readonly ViewEntry[] } & (
  | { kind: 'value' | 'rows' }
  | { default: string | undefined; kind: 'views' }
);

/**
 * One entry of a call's `views` record as the call read it, once: the view name, the view, and the
 * media type the view declared, so a later write to the view object changes no fact.
 */
interface ViewEntry {
  key: string;
  view: ResultView;
  mediaType: string | null;
}

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
  optionGroups: readonly OptionGroup[];
  stdin?: StdinConfig & { readonly position: number };
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
  | 'aliases'
  | 'children'
  | 'descriptors'
  | 'inputs'
  | 'name'
  | 'records'
  | 'results'
  | 'stdin'
  | 'optionGroups'
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
    optionGroups: [],
    records: new Map(),
    results: [],
  };
}

/**
 * A named Command's own declaration, checked before the value exists: the name, then the extension
 * values its options carry.
 */
function namedState<Globals>(
  name: string,
  options: CommandOptions | undefined,
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
  const site: FactSite = {
    at: '1',
    declaration: { arguments: [name, options], call: 'new Command' },
    subject: commandSentence(name),
  };
  const descriptors: DescriptorRegistry = new Map();
  const extensions = storeCommandLayers({
    descriptors,
    layers: [options?.extensions],
    site: { ...site, at: '1.extensions' },
    subject: layerOf(name),
  });
  return {
    name,
    state: freshState({
      descriptors,
      extensions,
      facts: {
        deprecated: options?.deprecated,
        description: options?.description,
        hidden: options?.hidden ?? false,
      },
      name,
    }),
  };
}

/** Where one input was declared: the call on the Command at `path` that declared it. */
function inputSite(
  name: string | null,
  path: readonly string[],
  input: InputDeclaration,
): InputSite {
  return declaringSite(
    input,
    inputPlace(input, path),
    `${commandSentence(name)} ${input.kind} ${quoted(input.name)}`,
  );
}

/** The finding for the `argument()` or `option()` call that declared one input, marking its name. */
export function inputFinding(
  path: readonly string[],
  input: InputDeclaration,
  note?: string,
): Finding {
  const site = declaringSite(input, inputPlace(input, path));
  return siteFinding(site, site.named, note);
}

/**
 * The finding for an input whose name is invalid, marking the name. The config is read after the
 * name is judged, so it prints elided.
 */
function nameFinding(path: readonly string[], input: InputDeclaration): Finding {
  const site = configUnread(declaringSite(input, inputPlace(input, path)));
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

/** A stdin call's finding carries authored settings without internal ordering metadata. */
export function stdinFinding(path: readonly string[], config: StdinConfig): Finding {
  const supplied = {
    ...(Object.hasOwn(config, 'description') ? { description: config.description } : {}),
    ...(Object.hasOwn(config, 'required') ? { required: config.required } : {}),
  };
  return { arguments: [supplied], call: 'stdin', mark: '0', path };
}

/** Claims are checked at each authored call and again after hooks add local inputs. */
function checkStdinClaims(
  inputs: readonly InputDeclaration[],
  place: { path: readonly string[]; stdin: StdinConfig | undefined },
  declarers: ReadonlyMap<InputDeclaration, string> = new Map(),
): void {
  const claimed = inputs.filter(
    (input) => input.config.type === 'content' && input.config.stdin === true,
  );
  if (claimed.length + Number(place.stdin !== undefined) > 1) {
    throw new DeclarationError(stdinClaimedTwice, {
      correction: 'Keep one stdin target on the Command.',
      findings: [
        ...claimed.map((input) =>
          inputFinding(
            place.path,
            input,
            declarers.has(input)
              ? `${declarerNote(declarers.get(input) ?? '')} in onCommandAttach; claims stdin`
              : 'claims stdin',
          ),
        ),
        ...(place.stdin === undefined ? [] : [stdinFinding(place.path, place.stdin)]),
      ],
      sentence: 'A Command declares more than one stdin target.',
    });
  }
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
  });
  return { descriptors, records: new Map([...state.records, [input, record]]) };
}

/**
 * Every rule one argument answers at its own call: its name, a repeated name, children beside it,
 * and its place after the arguments before it. The types keep a named Command's own `argument()`
 * and `command()` apart, so a child beside an argument reaches this call at the root, where a
 * plugin's Commands attached before the author declared the argument.
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
      correction: declaredNameCorrection,
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
  const { name } = state;
  checkArgumentName({ name, path: pathOf(name), subject: commandSubject(name) }, [], declared);
  const input = { ...declared, config: { ...declared.config } };
  checkArgument(state, input);
  checkStdinClaims([...state.inputs, input], { path: pathOf(state.name), stdin: state.stdin });
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
  const path = pathOf(state.name);
  checkOptionName(declared.name, configUnread(inputSite(state.name, path, declared)));
  const input = { ...declared, config: { ...declared.config } };
  const recorded = recordInput(state, input);
  checkLocalOptions(
    [...optionsOf(state.inputs), input],
    table,
    localScope(state.name, pathOf(state.name)),
  );
  checkStdinClaims([...state.inputs, input], { path: pathOf(state.name), stdin: state.stdin });
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

/** Group calls share the same immutable state transition on a Command and the root. */
export function declareOptionGroup<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  kind: OptionGroup['kind'],
  names: readonly string[],
): CommandState<Args, Options, Globals> {
  const group = declareGroup({
    groups: state.optionGroups,
    inputs: state.inputs,
    kind,
    name: state.name,
    names,
  });
  return { ...state, optionGroups: [...state.optionGroups, group] };
}

/**
 * One call's names join the Command's aliases. An alias that repeats the Command's own name or an
 * alias it already holds adds no name, so it is skipped.
 */
export function declareAlias<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  names: readonly string[],
): CommandState<Args, Options, Globals> {
  const { name } = state;
  checkAliasNames(name, names);
  const aliases = [...state.aliases];
  for (const alias of names) {
    if (alias !== name && !aliases.includes(alias)) {
      aliases.push(alias);
    }
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
export function declareAction<Args, Options, Globals, Result, Stdin extends StdinContext>(
  state: CommandState<Args, Options, Globals>,
  handler: Action<Args, Globals & Options, Result, Stdin>,
  stdinBind: (source: Content | undefined) => Stdin,
): CommandState<Args, Options, Globals> {
  // The graph and the routed node stay getters, because a spread would build the graph on every run.
  const stored = (context: ActionContext<Args, Globals & Options, OpenResult>): unknown =>
    handler({
      args: context.args,
      cancel: context.cancel,
      get command() {
        return context.command;
      },
      get graph() {
        return context.graph;
      },
      host: context.host,
      interactive: context.interactive,
      invoke: context.invoke,
      log: context.log,
      options: context.options,
      out: declaredChannel(context.out),
      passthrough: context.passthrough,
      signal: context.signal,
      ...stdinBind(context.stdin),
      style: context.style,
      supplied: context.supplied,
    });
  return { ...state, action: stored };
}

/** The result declaration, which closes both result calls. */
export function declareResult<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  kind: 'value' | 'rows',
  declaration: { readonly views: Readonly<Record<string, ResultView>> },
): CommandState<Args, Options, Globals> {
  const call: ResultCall = { entries: viewEntries(declaration.views), kind };
  return { ...state, results: [...state.results, call] };
}

/** A `views()` call reshapes views and closes nothing. */
export function declareResultViews<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  replacements: Readonly<Record<string, ResultView>>,
  options: { readonly default?: string | undefined } | undefined,
): CommandState<Args, Options, Globals> {
  return { ...state, results: [...state.results, viewsCall(replacements, options)] };
}

/** One `views()` call as the results lane records it. */
function viewsCall(
  replacements: Readonly<Record<string, ResultView>>,
  options: { readonly default?: string | undefined } | undefined,
): ResultCall {
  return { default: options?.default, entries: viewEntries(replacements), kind: 'views' };
}

/** One Command a rule judges: the name its sentence reads, and the path its findings open with. */
interface CommandPlace {
  name: string | null;
  path: readonly string[];
}

/** The parent one attach reads: its place and the children it holds. */
interface AttachParent extends CommandPlace {
  children: readonly AttachedChild[];
}

/** The parent a declaration is, as attach reads it. */
function parentOf(state: Declared): AttachParent {
  return { children: state.children, name: state.name, path: pathOf(state.name) };
}

/** The path one child sits at under its parent. */
function childPath(parent: CommandPlace, child: string): readonly string[] {
  return [...parent.path, child];
}

/**
 * The call that attached one child, opening with the whole path to its parent. The root's attach
 * knew that whole path, so a root child keeps its call, a plugin's `commands` entry included. A
 * named parent's `command()` call knew its own name alone, so the walk rebuilds it under the root.
 */
function rootedPlacement(parent: CommandPlace, child: AttachedChild): Finding {
  return parent.name === null ? child.placement : commandPlacement(parent.path, child.name);
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
 * Where a finished Command is judged: its path, and the call that attached it, which build has none
 * of for the root.
 */
interface FinishedPlace {
  path: readonly string[];
  placement?: Finding;
}

/**
 * A Command without an action is a group, and routing sends an invocation on to one of its
 * children. A group with no children receives an invocation no handler can answer, and stdin on a
 * group reaches no handler either.
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
  if (state.stdin !== undefined) {
    throw new DeclarationError(commandWithoutAction, {
      correction: 'Declare stdin on the Command that reads it, or register an action.',
      findings: [stdinFinding(place.path, state.stdin)],
      sentence: `${commandSentence(name)} declares stdin but registers no action to receive it.`,
    });
  }
}

/**
 * The rules a finished Command answers, which attach applies to a child and build to the root: a
 * Command without an action is a group. It answers with the resolved result.
 */
function checkFinished(
  declared: Declared,
  hasAction: boolean,
  place: FinishedPlace,
): DeclaredResult | undefined {
  if (!hasAction) {
    checkGroup(declared, place);
  }
  return buildResult(declared.results);
}

/**
 * The one attach operation `Command.command()`, `Application.command()`, and a plugin's
 * `commands` list share. A Command is an immutable value, so the child is final here: it is checked
 * as a finished Command and against the parent's current children, at any depth. The placement is
 * the call that attached it, which a finding about the child as a whole marks.
 */
export function attach(
  parent: AttachParent,
  node: CommandNodeHandle,
  placement: Finding,
): AttachedChild {
  const { name } = node;
  const child: AttachedChild = { name, node, placement };
  checkFinished(node.declared, node.hasAction, { path: childPath(parent, name), placement });
  checkSiblings(parent, child);
  return child;
}

/** The handle behind a Command value, which the registry of authored Commands holds. */
export function childNode(child: unknown): CommandNodeHandle {
  const node = commandNode(child);
  if (!node) {
    throw new TypeError('Expected a value returned by new Command(name).');
  }
  return node;
}

/** Attaching is a declaration call too, so the receiver keeps the children it already had. */
function attachChild<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  child: unknown,
): CommandState<Args, Options, Globals> {
  const node = childNode(child);
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
 * Command value reached through two paths, two distinct descriptors under one identity, and a local
 * option that meets a global option's key, spelling, or variable. A claim is by node identity, and
 * the name serves the diagnostic alone.
 */
function joinSubtree(scope: JoinScope, child: AttachedChild, parent: CommandPlace): void {
  const { name, node, placement } = child;
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
    const rooted = { ...entry, placement: rootedPlacement({ name, path }, entry) };
    joinSubtree(scope, rooted, { name, path });
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
  joinSubtree(scope, attached, parent);
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

/**
 * A variadic slot ends the positional list, so nothing may follow it, and a required slot never
 * follows an optional one. Optional slots may follow each other, and bare words fill them left to
 * right.
 */
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
  if (!slot.required && next.required) {
    throw new DeclarationError(optionalArgumentLast, {
      correction: 'Declare optional arguments after required ones.',
      findings: [inputFinding(path, slot.input, 'the optional argument'), after],
      sentence: `Argument "${slot.input.name}" is optional and precedes required argument "${next.input.name}" on ${subject}.`,
    });
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

/** The entries one `views` record holds, in record order, each with the media type it declares. */
function viewEntries(record: Readonly<Record<string, ResultView>>): readonly ViewEntry[] {
  return Object.entries(record).map(([key, view]) => ({
    key,
    mediaType: view.mediaType ?? null,
    view,
  }));
}

/**
 * The finished result: the results lane's calls read as one declaration. A later `views()` call
 * replaces a key in place and appends a new one, so each name keeps the position the call that
 * first named it gave it. A `default` once named persists through later calls that name none, and
 * the first key answers until one is named. A default no view answers fails where the result
 * renders, as a views record that names no view does.
 */
function buildResult(results: readonly ResultCall[]): DeclaredResult | undefined {
  const declaration = results.find((call) => call.kind !== 'views');
  if (!declaration) {
    return undefined;
  }
  const views = new Map<string, ResultView>();
  const mediaTypes = new Map<string, string | null>();
  let selected: string | undefined = undefined;
  for (const call of results) {
    for (const { key, mediaType, view } of call.entries) {
      views.set(key, view);
      mediaTypes.set(key, mediaType);
    }
    if (call.kind === 'views' && call.default !== undefined) {
      selected = call.default;
    }
  }
  const first = views.keys().next();
  const fallback = first.done === true ? '' : first.value;
  return { default: selected ?? fallback, kind: declaration.kind, mediaTypes, views };
}

/** One call a hook made, in the order it made it, which the declaration reads back afterwards. */
type AttachCall =
  | { identity: string; input: InputDeclaration; kind: 'input' }
  | { call: ResultCall; kind: 'views' }
  | { group: OptionGroup; kind: 'optionGroup' };

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
    this.#result = resultNode(buildResult(state.declared.results));
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

  exclusive(...names: [string, string, ...string[]]): AttachedCommand {
    return this.#group('exclusive', names);
  }

  oneRequired(...names: [string, string, ...string[]]): AttachedCommand {
    return this.#group('oneRequired', names);
  }

  requiredTogether(...names: [string, string, ...string[]]): AttachedCommand {
    return this.#group('requiredTogether', names);
  }

  #group(kind: OptionGroup['kind'], names: readonly string[]): AttachedCommand {
    const { declared } = this.#state;
    const group = declareGroup({
      groups: declared.optionGroups,
      inputs: declared.inputs,
      kind,
      name: declared.name,
      names,
    });
    return this.#derive(
      { group, kind: 'optionGroup' },
      { ...declared, optionGroups: [...declared.optionGroups, group] },
    );
  }

  views<const Replacements extends Readonly<Record<string, ResultView>>>(
    replacements: Replacements,
    options?: { default?: keyof Replacements & string },
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
    // Each kind copies its own config, so the input keeps the pairing its kind declares.
    const input: InputDeclaration =
      raw.kind === 'argument'
        ? { ...raw, config: { ...raw.config } }
        : { ...raw, config: { ...raw.config } };
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

/**
 * One plugin's hook over one Command, which answers with the declaration the hook returned. A throw
 * is the hook's own and leaves the build: a `DeclarationError` reports as itself, and any other
 * throw is a foreign throw. A returned value core never built has no declaration to read, which
 * the hook's type already rejects, so it meets the same `TypeError` a missing property would.
 */
function attachOnce(value: AttachedCommand, hook: CommandAttachHook): AttachState {
  const state = attachments.get(hook(value));
  if (state === undefined) {
    throw new TypeError('onCommandAttach returned a value that is not an attached Command.');
  }
  return state;
}

/**
 * Every installed plugin's hook over one Command, in installation order, each receiving what the
 * previous returned. The calls they made travel back to the declaration the remaining rules read.
 */
function runAttachHooks(
  start: Pick<AttachState, 'declared' | 'extensions' | 'registry'> & { layer: ExtensionSubject },
  facts: { hasAction: boolean; path: readonly string[] },
  plugins: readonly BuiltPlugin[],
): AttachProgress {
  const { declared, extensions, layer, registry } = start;
  let progress: AttachProgress = { calls: [], declared, extensions, registry };
  for (const installed of plugins) {
    const hook = installed.onCommandAttach;
    if (hook) {
      const identity = installed.identity;
      const value = new AttachedCommandValue({ ...progress, ...facts, identity, subject: layer });
      const state = attachOnce(value, hook);
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
    if (call.kind === 'input') {
      next = declareHookInput(next, call.input);
    } else if (call.kind === 'optionGroup') {
      next = { ...next, optionGroups: [...next.optionGroups, call.group] };
    } else {
      next = { ...next, results: [...next.results, call.call] };
    }
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

/** Where the option one table names declared one of its spellings, by its name and the origin. */
type SpellingPlace = (name: string, origin: SpellingOrigin) => Finding | undefined;

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
      claimed.set(spelling, { finding: placeOf(option.name, option), form });
    }
  }
}

/** The place one input's spelling sits: the key of its call that yields the spelling. */
function spellingPlace(site: InputSite, origin: SpellingOrigin, note: string): Finding {
  return siteFinding(site, spellingMark(site, origin), note);
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
          spellingPlace(site, option, declarerNote(identity)),
          ...(used.finding === undefined ? [] : [used.finding]),
        ],
        sentence: `Plugin ${quoted(identity)} declares option ${quoted(input.name)} with spelling ${quoted(spelling)} on ${subject}, which ${quoted(used.form)} already uses.`,
      });
    }
  }
  readSpellings(table, claimed, (_name, origin) =>
    spellingPlace(site, origin, declarerNote(identity)),
  );
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
  return (name, origin) => {
    const entry = globals.names.get(name);
    if (!entry) {
      return undefined;
    }
    const { owner, site } = entry;
    const note =
      owner.kind === 'plugin'
        ? `an option of plugin ${quoted(owner.identity)}`
        : `the global option ${quoted(name)}`;
    return spellingPlace(site, origin, note);
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
  readSpellings(compileOptions(options, scope), claimed, (name, origin) => {
    const local = locals.get(name);
    return local === undefined || local.kind !== 'option'
      ? undefined
      : spellingPlace(scope.siteOf(local), origin, `the local option ${quoted(name)}`);
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
  return ({
    cancel,
    interactive,
    supplied,
    command,
    graph,
    host,
    invoke,
    log,
    out,
    passthrough,
    signal,
    style,
    stdin,
    values,
  }: DispatchInput) => {
    const bound = state.bind(values);
    // Last resort: no typed path exists.
    // The graph erases the binder's generic relationship.
    // It holds because attachment checks the global output requirement.
    // The call or the attach that met both options rejected a collision between a global and a local.
    // This binder returns the validated value of every global option, the plugins' included.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const globalOptions = globals.bind(values) as Globals;
    return action({
      args: bound.args,
      cancel,
      get command() {
        return command();
      },
      get graph() {
        return graph();
      },
      host,
      interactive,
      invoke,
      log,
      options: { ...globalOptions, ...bound.options },
      out,
      passthrough,
      signal,
      stdin,
      style,
      supplied,
    });
  };
}

/**
 * The extension values of each input a lifecycle hook declared, which the calls that declared the
 * author's inputs already validated.
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
    context.extensions.set(
      input,
      buildExtensions({
        declared: input.config.extensions,
        descriptors: context.descriptors,
        site: { ...site, at: '1.extensions' },
        subject: { phrase: `on ${subject} ${input.kind} "${input.name}"`, sentence },
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
  const progress = runAttachHooks(
    { declared: state, extensions: state.extensions, layer, registry: context.descriptors },
    { hasAction, path: context.path },
    context.plugins,
  );
  const { calls } = progress;
  // The descriptors the returned value's extensions registered join the build's registry.
  for (const [identity, descriptor] of progress.registry) {
    context.descriptors.set(identity, descriptor);
  }
  const hooked = applyAttachCalls(state, calls);
  const hookInputs = calls.filter((call) => call.kind === 'input');
  checkStdinClaims(
    hooked.inputs,
    { path: context.path, stdin: hooked.stdin },
    new Map(hookInputs.map(({ input, identity }) => [input, identity])),
  );
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
  const table: SpellingTable = new Map([...tableEntries(options, false), ...globals.table]);
  const children = new Map<string, BuiltCommand>();
  const routes = new Map<string, RoutedChild>();
  for (const child of state.children) {
    const routed: RoutedChild = {
      command: child.node.build({
        ...context,
        path: [...context.path, child.name],
        placement: rootedPlacement(place, child),
      }),
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
    attachedBy: new Map(hookInputs.map(({ identity, input }) => [input, identity])),
    children,
    declarers: new Map(hookInputs.map(({ identity, input }) => [input, identity])),
    deprecated: facts.deprecated,
    description: facts.description,
    dispatch: action ? bindDispatch(hooked, action, globals) : undefined,
    extensions,
    hidden: facts.hidden,
    inputs: hooked.inputs,
    name,
    optionGroups: hooked.optionGroups,
    placement: context.placement,
    result,
    routes,
    stdin: state.stdin,
    table,
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
  globals: GlobalsState,
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
    placement: undefined,
    plugins,
  };
  return { extensions, globals: context.globals, root: buildCommand(root, context) };
}

/** A required source reaches this accessor only after preparation accepted its presence. */
export function requiredStdinContext(source: Content | undefined): { readonly stdin: Content } {
  if (source === undefined) {
    throw new Error('Required stdin was not prepared.');
  }
  return { stdin: source };
}

export function declareStdin<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  config: StdinConfig,
): CommandState<Args, Options, Globals> {
  const site = callSite('Stdin', {
    arguments: [config],
    call: 'stdin',
    path: pathOf(state.name),
  });
  if (state.stdin !== undefined) {
    throw new DeclarationError(stdinClaimedTwice, {
      correction: 'Keep one stdin declaration.',
      findings: [siteFinding(site, '0')],
      sentence: 'A Command declares stdin twice.',
    });
  }
  checkStdinClaims(state.inputs, { path: pathOf(state.name), stdin: config });
  return { ...state, stdin: Object.freeze({ ...config, position: state.inputs.length }) };
}

export class CommandBuilder<
  Args,
  Options,
  Globals,
  State extends CommandMethod = CommandMethod,
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
> {
  declare readonly [commandValue]: true;
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals, Result, Stdin>;

  readonly #name: string;
  readonly #state: CommandState<Args, Options, Globals>;
  readonly #stdinBind: (source: Content | undefined) => Stdin;

  constructor(
    name: string,
    state: CommandState<Args, Options, Globals>,
    stdinBind: (source: Content | undefined) => Stdin,
  ) {
    this.#stdinBind = stdinBind;
    this.#name = name;
    this.#state = state;
    nodes.set(this, nodeHandle(name, state));
  }

  stdin(
    config: StdinConfig & { required: true },
  ): Command<Args, Options, Globals, State, Result, { readonly stdin: Content }>;
  stdin(config: StdinConfig): Command<Args, Options, Globals, State, Result>;
  stdin(config: StdinConfig): Command<Args, Options, Globals, State, Result> {
    const state = declareStdin(this.#state, config);
    return new CommandBuilder<Args, Options, Globals, State, Result>(
      this.#name,
      state,
      state.stdin?.required ? requiredStdinContext : (source) => ({ stdin: source }),
    );
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
    Result,
    Stdin
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
      Unmarked &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<ImpliedConstraint<Config>> &
      NoInfer<PerValueConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Command<Args, Options & Record<Name, OptionValue<Config>>, Globals, State, Result, Stdin> {
    const input: OptionInput<Name, Config> = {
      config,
      kind: 'option',
      name,
    };
    return this.#derive(declareOption(this.#state, input));
  }

  exclusive(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Command<Args, Options, Globals, State, Result, Stdin> {
    return this.#derive(declareOptionGroup(this.#state, 'exclusive', names));
  }

  oneRequired(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Command<Args, Options, Globals, State, Result, Stdin> {
    return this.#derive(declareOptionGroup(this.#state, 'oneRequired', names));
  }

  requiredTogether(
    ...names: [
      Extract<keyof Options, string>,
      Extract<keyof Options, string>,
      ...Extract<keyof Options, string>[],
    ]
  ): Command<Args, Options, Globals, State, Result, Stdin> {
    return this.#derive(declareOptionGroup(this.#state, 'requiredTogether', names));
  }

  /**
   * Aliases are other portable names that route to this Command. They invalidate no call, and the
   * tuple rest parameter rejects a call that names none.
   */
  alias(...names: [string, ...string[]]): Command<Args, Options, Globals, State, Result, Stdin> {
    return this.#derive(declareAlias(this.#state, names));
  }

  /** A child arrives in any type state, because its own action is the call that finished it. */
  command<const Child extends Command<unknown, unknown, Globals>>(
    child: Child & NoInfer<AttachmentConstraint<Globals, Child>>,
  ): Command<Args, Options, Globals, AfterCommand<State>, Result, Stdin> {
    return this.#derive(attachChild(this.#state, child));
  }

  /**
   * The value this Command produces for its consumer. The type argument is stated by the author,
   * so the views record states no type of its own and an omitted argument names none either.
   */
  result<Value>(declaration: {
    views: ResultViews<NoInfer<Value>>;
  }): Command<Args, Options, Globals, AfterResult<State>, { kind: 'value'; value: Value }, Stdin> {
    return this.#derive<Args, Options, AfterResult<State>, { kind: 'value'; value: Value }>(
      declareResult(this.#state, 'value', declaration),
    );
  }

  /** The same declaration over a sequence, whose type argument is one row. */
  rows<Row>(declaration: {
    views: RowViews<NoInfer<Row>>;
  }): Command<Args, Options, Globals, AfterResult<State>, { kind: 'rows'; row: Row }, Stdin> {
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
  ): Command<Args, Options, Globals, State, Result, Stdin> {
    return this.#derive(declareResultViews(this.#state, replacements, options));
  }

  /** The action closes input authoring; `extend()` remains outside this state transition. */
  action(
    handler: Action<Args, Globals & Options, Result, Stdin>,
  ): Command<Args, Options, Globals, AfterAction, Result, Stdin> {
    return this.#derive(declareAction(this.#state, handler, this.#stdinBind));
  }

  extend(
    ...values: readonly ExtensionValue<'command'>[]
  ): Command<Args, Options, Globals, State, Result, Stdin> {
    return this.#derive(declareExtensions(this.#state, values));
  }

  /**
   * The same runtime value in the state the calling method's return type names. Each call states
   * its own transition, and the declared result travels with it unless the call replaces it.
   */
  #derive<DerivedArgs, DerivedOptions, Next extends CommandMethod, DerivedResult = Result>(
    state: CommandState<DerivedArgs, DerivedOptions, Globals>,
  ): Command<DerivedArgs, DerivedOptions, Globals, Next, DerivedResult, Stdin> {
    return new CommandBuilder<DerivedArgs, DerivedOptions, Globals, Next, DerivedResult, Stdin>(
      this.#name,
      state,
      this.#stdinBind,
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
  Stdin extends StdinContext = StdinContext,
> = Pick<
  CommandBuilder<Args, Options, Globals, State, Result, Stdin>,
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
    super(declared.name, declared.state, (source) => ({ stdin: source }));
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
 * Where every input of one graph was declared: each global option at its `globalOption()` call or
 * in its plugin's `options` record, and each Command's own inputs at their calls on the Command,
 * under its path from the root.
 */
export function inputPlaces(graph: BuiltGraph): InputPlaces {
  const places = new Map<InputDeclaration, InputSite>(graph.globals.sites);
  const walk = (command: BuiltCommand, path: readonly string[]) => {
    for (const input of command.inputs) {
      places.set(input, declaringSite(input, inputPlace(input, path)));
    }
    for (const [name, child] of command.children) {
      walk(child, [...path, name]);
    }
  };
  walk(graph.root, []);
  return places;
}

/** What one invocation reaches the middleware chain with. */
export interface DispatchInvocation {
  cancel: () => void;
  /** The channel the action receives, which the results lane builds from the routed node. */
  channel: (binding: ResultBinding) => ActionChannel;
  host: Host;
  /** Where every input of the graph was declared, which a broken validator's finding rebuilds. */
  places: InputPlaces;
  /** Every declared default and implied value, validated before any token was read. */
  declaredValues: DeclaredValues;
  /** The graph `inspect()` returns for the run, built on its first read, which a source reads. */
  inspected: () => CommandGraph;
  /** How the run received its inputs, which names every input a problem reports. */
  invokedBy: InvokedBy;
  /** Runs another Command of this run's graph by name, which the action receives. */
  invoke: DispatchInput['invoke'];
  /** Gives a context of the run its `log`, bound to the plugin core is calling, or to none. */
  logFor: LogBinder;
  /** Offers a configuration source's foreign throw to the translators where its call settles. */
  offer: (thrown: unknown) => LoomError | undefined;
  signal: AbortSignal;
  /** The channel a configuration source writes through. */
  out: Out<OpenResult>;
  style: ContextualStyle;
}

/**
 * One invocation prepared ahead of the middleware chain. `'ready'` carries the request a middleware
 * reads and the call that dispatches; `'held'` carries the fault this phase found, which core
 * raises at the dispatch boundary and never before, so a takeover swallows it. `result` is what the
 * routed Command declared, whose views a middleware selects among, on either shape. `globals` holds
 * the globals table's values after the input-source stage, which activation and each plugin's
 * spellings read on either shape. `options` is every global option's validated value, which every
 * middleware reads, or `null` when a global option has a structural fault or was rejected, or the
 * values could not be read. `own` answers one plugin's `ownOptions`: each option the plugin
 * declared, its own global options and the local options its hook declared on the routed Command,
 * that validated in this run, whatever fault is held for another input.
 */
export type Prepared = {
  globals: OptionValues;
  options: Readonly<Record<string, unknown>> | null;
  own: (identity: string, inputs: readonly OptionInput[]) => Readonly<Record<string, unknown>>;
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
  { passthrough, stdin }: { passthrough: readonly string[]; stdin: Content | undefined },
): Request {
  const args: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  for (const input of command.inputs) {
    const target = input.kind === 'argument' ? args : options;
    target[input.name] = snapshot(values.read(input));
  }
  return Object.freeze({
    ...(command.stdin !== undefined ? { stdin } : {}),
    args: Object.freeze(args),
    options: Object.freeze(options),
    passthrough: Object.freeze([...passthrough]),
  });
}

/** The routed Command's own values after parsing, or the fault parsing or the callable check holds. */
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
 * The held structural fault, then the callable check. A group answers no invocation of its own, so
 * it holds the missing-subcommand error, which ranks after every structural fault.
 */
function parseLocal(routed: ParsedInvocation): LocalPhase {
  const { command, fault, path } = routed;
  const { dispatch } = command;
  if (fault) {
    return { fault, kind: 'held' };
  }
  if (!dispatch) {
    return { fault: new NonCallableCommandError(path, candidatesOf(command)), kind: 'held' };
  }
  return {
    args: routed.args,
    dispatch,
    kind: 'parsed',
    options: routed.values.locals,
    passthrough: routed.passthrough,
  };
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

/**
 * The one invocation every phase ahead of the chain reads: the graph, the route, the run, and what
 * the run's validation passes settled, which each later pass reads so a validator runs at most once.
 */
interface Preparation {
  interactive: boolean;
  graph: BuiltGraph;
  invocation: DispatchInvocation;
  ledger: ValidationLedger;
  routed: ParsedInvocation;
}

/**
 * The routed Command's own parsed inputs a validation pass reads: its arguments, its local option
 * values, and its passthrough tail. A pass whose locals were held reads none.
 */
interface LocalScope {
  readonly args: ReadonlyMap<InputDeclaration, string | string[]>;
  readonly options: OptionValues;
  readonly passthrough: readonly string[];
}

/**
 * The input-source stage over this run's own copies of the parsed values. The global options fill
 * whatever was held, and a faulted occurrence supplied nothing, so a source may fill its option;
 * the routed Command's own options fill only when nothing is held, because the request is `null`
 * otherwise. A configuration source's own options pass their validators before the source is
 * called, as a pass over those options alone.
 */
async function fillScope(
  preparation: Preparation,
  local: LocalPhase,
): Promise<{ globals: OptionValues; scope: LocalScope | undefined; sources: SourceOutcome }> {
  const { graph, invocation, routed } = preparation;
  const globals = copyValues(routed.values.globals);
  const locals = copyValues(local.kind === 'parsed' ? local.options : emptyValues());
  const scope =
    local.kind === 'parsed'
      ? { args: local.args, options: locals, passthrough: local.passthrough }
      : undefined;
  const sources = await fillInputs({
    extensions: graph.extensions,
    globals: { global: true, inputs: graph.globals.inputs, values: globals },
    host: invocation.host,
    inspected: invocation.inspected,
    invokedBy: invocation.invokedBy,
    locals:
      local.kind === 'parsed'
        ? { global: false, inputs: optionsOf(routed.command.inputs), values: locals }
        : undefined,
    log: invocation.logFor,
    offer: invocation.offer,
    out: invocation.out,
    plugins: graph.globals.plugins,
    request: (input, global) =>
      requestNode(invocation.inspected(), routed.path, { global, name: input.name }),
    signal: invocation.signal,
    style: invocation.style,
    validate: (inputs, provenance) =>
      validateInvocation(preparation, {
        local: scope,
        only: new Set(inputs),
        sources: provenance,
        values: globals,
      }),
  });
  return { globals, scope, sources };
}

/**
 * A validation pass over the values the input-source stage has filled: every global option
 * whatever was held, and the routed Command's own declarations only when the pass reads its local
 * scope, which the run's one pass does when nothing is held and the Command is not a group. `only`
 * narrows the declarations a pass validates, as the pass over a configuration source's own options
 * does ahead of its call and the pass over the plugins' own options under a held fault does,
 * while every validator reads the same context. Each pass reads what an earlier pass of the run
 * settled through the ledger rather than validating it again.
 */
function validateInvocation(
  { graph, invocation, interactive, ledger, routed }: Preparation,
  filled: {
    local: LocalScope | undefined;
    only?: ReadonlySet<InputDeclaration>;
    sources: Provenance;
    values: OptionValues;
  },
): Promise<Validation> {
  const { local, only, sources } = filled;
  return validateValues({
    command: routed.path,
    declaredValues: invocation.declaredValues,
    host: invocation.host,
    inputs: { globals: graph.globals.inputs, locals: local ? routed.command.inputs : [] },
    interactive,
    ledger,
    named: invocation.invokedBy === 'name' ? { unlowered: routed.unlowered } : undefined,
    optionGroups: local && only === undefined ? routed.command.optionGroups : [],
    passthrough: local?.passthrough ?? [],
    places: invocation.places,
    signal: invocation.signal,
    sources,
    stdin: local ? routed.command.stdin : undefined,
    supplied: {
      args: local?.args ?? new Map(),
      options: local ? mergeValues(filled.values, local.options) : filled.values,
    },
    table: routed.command.table,
    ...(only ? { only } : {}),
  });
}

/**
 * The options of the plugins that a held fault left unvalidated and that core still validates for
 * `ownOptions`: each plugin's global options, and each local option a hook declared on the routed
 * Command, whose tokens parsed, none of whose occurrences faulted, and that no earlier pass
 * reached. A group validates no local option. Under a validation problem the run's own pass
 * validated every one of them, so only a structural fault, an input-source fault, or a validator
 * that threw leaves any to add. An option whose validator threw was reached, so it is never
 * validated again.
 */
function ownUnderFault({ graph, ledger, routed }: Preparation): ReadonlySet<InputDeclaration> {
  const { command, faulted, values } = routed;
  const parsed = (input: OptionInput, supplied: OptionValues) =>
    isSupplied(supplied, input.name) && !faulted.has(input.name) && !ledger.reached(input);
  const globals = graph.globals.plugins
    .flatMap(({ inputs }) => inputs)
    .filter((input) => parsed(input, values.globals));
  const attached =
    command.dispatch === undefined
      ? []
      : command.inputs.filter(
          (input) =>
            input.kind === 'option' &&
            command.attachedBy.has(input) &&
            parsed(input, values.locals),
        );
  return new Set([...globals, ...attached]);
}

/**
 * The pass over the plugins' options a held fault left unvalidated, for `ownOptions` alone: the
 * held fault stays the one raised whatever the validators answer, so a rejection, and a validator
 * that throws, leave the option absent and report nothing. The ledger keeps what this pass
 * settled before a throw, so the options validated ahead of it stand.
 */
async function validateOwn(preparation: Preparation, globals: OptionValues): Promise<void> {
  const { routed } = preparation;
  const only = ownUnderFault(preparation);
  if (only.size === 0) {
    return;
  }
  try {
    await validateInvocation(preparation, {
      local:
        routed.command.dispatch === undefined
          ? undefined
          : { args: routed.args, options: copyValues(routed.values.locals), passthrough: [] },
      only,
      sources: { labels: new Map(), rejected: new Map() },
      values: globals,
    });
  } catch {
    // The held fault is the one raised, so a broken validator here reports nothing.
  }
}

/**
 * The record one plugin's middleware reads under `ownOptions`: each of the plugin's own global
 * options, and each local option its hook declared on the routed Command, that a pass of the run
 * validated, keyed by declared name. An option with an occurrence that faulted is absent, and so
 * is one no pass validated. Each value is a copy frozen to every depth, as under `options`.
 */
function ownRecord(routed: ParsedInvocation, validated: ValidatedInputs): Prepared['own'] {
  return (identity, inputs) => {
    const { command, faulted } = routed;
    const attached = command.inputs.filter(
      (input) => input.kind === 'option' && command.attachedBy.get(input) === identity,
    );
    const record: Record<string, unknown> = {};
    for (const input of [...inputs, ...attached]) {
      if (validated.has(input) && !faulted.has(input.name)) {
        record[input.name] = snapshot(validated.read(input));
      }
    }
    return Object.freeze(record);
  };
}

/**
 * The dispatch a clean validation prepares. It answers with the call that dispatches, so the caller
 * records that the action was invoked at the moment it invokes it and no earlier failure reads as a
 * dispatch.
 */
function readyDispatch(
  { invocation, interactive, routed }: Preparation,
  local: LocalPhase & { kind: 'parsed' },
  {
    values,
    stdin,
    supplied,
  }: Pick<Validation, 'values' | 'stdin'> & { supplied: ActionContext<unknown>['supplied'] },
): { dispatch: (view: string | null) => Promise<void>; request: Request } {
  const { command, path } = routed;
  return {
    dispatch: async (view) => {
      // The channel is built at the boundary, because the view a middleware selected is read there.
      const channel = invocation.channel({ path, result: command.result, view });
      try {
        rememberInputNames(invocation.host, invocation.invokedBy);
        await local.dispatch({
          cancel: invocation.cancel,
          // The run builds its graph once, so every read answers the same node.
          command: () => nodeAt(invocation.inspected(), path),
          graph: invocation.inspected,
          host: invocation.host,
          interactive,
          invoke: invocation.invoke,
          log: invocation.logFor(null),
          out: channel.out,
          passthrough: local.passthrough,
          signal: invocation.signal,
          stdin,
          style: invocation.style,
          supplied,
          values,
        });
        // The action returned, so each region it left open closes for its completion.
        channel.complete();
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
    request: requestOf(command, values, { passthrough: local.passthrough, stdin }),
  };
}

/**
 * Prepares one dispatch ahead of the middleware chain and holds whatever fault it found, so a
 * middleware reads the request before the action runs and a takeover never observes the fault.
 * The phases run in order: the structural fault parsing held, a group's missing subcommand, the
 * input-source stage, and validation. Either of the first two outranks a configuration source's
 * fault, and a source's fault takes the place of every validation problem. Validation checks the
 * global options whatever was held, so a middleware reads them after a local fault; a structural
 * fault on a global option, a rejected global option, a source's fault, or a validator's own fault
 * leaves `options` `null`.
 */
export async function prepareDispatch(
  graph: BuiltGraph,
  routed: ParsedInvocation,
  invocation: DispatchInvocation,
): Promise<Prepared> {
  const result = routed.command.result;
  const local = parseLocal(routed);
  const ledger = new ValidationLedger();
  const preparation = { graph, interactive: false, invocation, ledger, routed };
  const { globals, scope, sources } = await fillScope(preparation, local);
  const marked = graph.globals.inputs.find((input) => isMarked(input.config, interaction));
  preparation.interactive =
    invocation.host.terminal.stdin.isTTY &&
    invocation.host.terminal.stderr.isTTY &&
    (marked === undefined || booleanValue(globals, marked.name, marked.config));
  const held = async (fault: unknown, options: Prepared['options']): Promise<Prepared> => {
    await validateOwn(preparation, globals);
    return {
      fault: local.kind === 'held' ? local.fault : fault,
      globals,
      kind: 'held',
      options,
      own: ownRecord(routed, ledger.values),
      request: null,
      result,
    };
  };
  if (sources.fault) {
    return held(sources.fault, null);
  }
  try {
    const validation = await validateInvocation(preparation, {
      local: scope,
      sources,
      values: globals,
    });
    const options =
      routed.globalFault || rejectsGlobal(validation)
        ? null
        : frozenValues(graph.globals.inputs, validation.values);
    if (local.kind === 'held' || validation.failure) {
      return await held(validation.failure, options);
    }
    const ready = readyDispatch(preparation, local, {
      ...validation,
      supplied: suppliedInputs(
        [...graph.globals.inputs, ...routed.command.inputs],
        {
          args: scope?.args ?? new Map(),
          options: scope ? mergeValues(globals, scope.options) : globals,
        },
        true,
      ),
    });
    return {
      ...ready,
      globals,
      kind: 'ready',
      options,
      own: ownRecord(routed, ledger.values),
      result,
    };
  } catch (error) {
    // The fault is held as a failure, so a throw from reading a validator's output is never offered.
    return await held(toFailure(error), null);
  }
}
