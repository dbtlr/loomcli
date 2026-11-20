import type { Finding } from '../diagnostics/diagnostic-text.js';
import type { InputSite } from '../diagnostics/facts.js';
import { siteFinding, declarerNote, callSite } from '../diagnostics/facts.js';
import { DeclarationError } from '../failures/errors.js';
import { commandSentence, commandSubject, quoted } from '../failures/wording.js';
import { claimsStdin, stdinClaimedTwice } from '../inputs/content-rules.js';
import type { Content } from '../inputs/content.js';
import type { InputDeclaration, OptionInput, ArgumentInput } from '../inputs/declarations.js';
import { declaringSite, inputPlace, configUnread, markApplied } from '../inputs/declarations.js';
import type { ValidatedInputs } from '../inputs/ledger.js';
import { membersOf, declareGroup } from '../inputs/option-groups.js';
import type { OptionGroup } from '../inputs/option-groups.js';
import type { CompileScope, CompiledOptions, OptionSpelling } from '../inputs/options.js';
import {
  compileAll,
  isDeclaredName,
  declaredNameCorrection,
  compileNext,
} from '../inputs/options.js';
import type {
  StdinConfig,
  ArgumentConfig,
  ArgumentValue,
  OptionConfig,
  OptionValue,
} from '../inputs/types.js';
import type { ExtensionSubject } from '../plugins/extension.js';
import { foreignValue, foreignValueCorrection } from '../plugins/rules.js';
import type { GlobalTable } from './globals.js';
import {
  checkLocalOptions,
  inputExtensions,
  copyLocalOption,
  admitLocalOption,
} from './globals.js';
import type { OptionSet, OptionSetValues, AppliedSet } from './option-sets.js';
import { setFacts } from './option-sets.js';
import {
  argumentAfterVariadic,
  declaredName,
  argumentDeclaredTwice,
  optionalArgumentLast,
} from './rules.js';
import type { Declared, CommandState } from './state.js';
import { pathOf } from './subjects.js';
import type { ArgumentSlot } from './types.js';
/** Where one input was declared: the call on the Command at `path` that declared it. */
export function inputSite(
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
export function localScope(
  name: string | null,
  path: readonly string[],
): CompileScope<OptionInput> {
  return { siteOf: (input) => inputSite(name, path, input), subject: commandSubject(name) };
}

/** The options one declaration list holds, in declaration order. */
export function optionsOf(inputs: readonly InputDeclaration[]): OptionInput[] {
  return inputs.filter((input): input is OptionInput => input.kind === 'option');
}

/**
 * The options each declaration list compiled to, keyed by the list. A list is never changed, so its
 * compile holds for as long as the list lives: each `option()` call extends the compile of the list
 * before it, and a list no call compiled, such as one a hook extended, compiles on its first read.
 */
const localCompiles = new WeakMap<readonly InputDeclaration[], CompiledOptions<OptionInput>>();

/**
 * One declaration list's own options compiled, once per list. A compile names no scope, so a fault a
 * later compile finds names its declarations by that compile's own `scope`.
 */
function localCompile(
  inputs: readonly InputDeclaration[],
  scope: CompileScope<OptionInput>,
): CompiledOptions<OptionInput> {
  const known = localCompiles.get(inputs);
  if (known !== undefined) {
    return known;
  }
  const compiled = compileAll(optionsOf(inputs), scope);
  localCompiles.set(inputs, compiled);
  return compiled;
}

/** One declaration list's own options against a globals table, reading the list's one compile. */
export function checkCompiledOptions(
  inputs: readonly InputDeclaration[],
  table: GlobalTable,
  scope: CompileScope<OptionInput>,
): ReadonlyMap<string, OptionSpelling> {
  const compile = () => localCompile(inputs, scope).table;
  return checkLocalOptions({ compile, declarations: optionsOf(inputs) }, table, scope);
}

/** The arguments an author wrote to a `passthrough()` call: none for a bare call. */
export function passthroughArguments(config: { description: string | undefined }): [] | [object] {
  return config.description === undefined ? [] : [{ description: config.description }];
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
export function checkStdinClaims(
  inputs: readonly InputDeclaration[],
  place: { path: readonly string[]; stdin: StdinConfig | undefined },
  declarers: ReadonlyMap<InputDeclaration, string> = new Map(),
): void {
  const claimed = inputs.filter((input) => claimsStdin(input));
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
export function slotOf(input: ArgumentInput): ArgumentSlot {
  return {
    input,
    required: input.config.required === true,
    variadic: input.config.variadic === true,
  };
}

/** Why an argument cannot reserve exactly one word after a variadic. */
function invalidTrailingArgument(config: InputDeclaration['config']): string | undefined {
  if ('variadic' in config && config.variadic) {
    return 'is variadic';
  }
  if (config.type === 'content') {
    return 'is a content argument';
  }
  if (config.required === 'non-interactive') {
    return 'is required only when input is not interactive';
  }
  return config.required === true ? undefined : 'is optional';
}

/**
 * Orders the slots up to and including a variadic one in three tiers: required, then required only
 * when input is not interactive, then optional. A slot never follows one of a later tier, so a
 * required slot never follows a conditional or optional one, and a conditional slot never follows
 * an optional one. Slots of one tier may follow each other, and bare words fill them left to right.
 * Only required scalar arguments that are not content arguments may follow a variadic slot, and
 * they take their words from the end of the line, so this order does not apply to them.
 */
export function checkSlotOrder(
  slot: ArgumentSlot,
  next: ArgumentSlot,
  command: { path: readonly string[]; subject: string },
) {
  const { path, subject } = command;
  const after = inputFinding(path, next.input, 'the argument after it');
  if (slot.variadic) {
    const reason = invalidTrailingArgument(next.input.config);
    if (reason) {
      throw new DeclarationError(argumentAfterVariadic, {
        correction: 'Declare only required scalar arguments after a variadic argument.',
        findings: [inputFinding(path, slot.input, 'the variadic argument'), after],
        sentence: `Argument "${next.input.name}" ${reason} and follows variadic argument "${slot.input.name}" on ${subject}.`,
      });
    }
    return;
  }
  if (slot.input.config.required === 'non-interactive' && needsValue(next)) {
    throw new DeclarationError(optionalArgumentLast, {
      correction:
        'Declare arguments required only when input is not interactive after required ones.',
      findings: [inputFinding(path, slot.input, 'the conditionally required argument'), after],
      sentence: `Argument "${slot.input.name}" is required only when input is not interactive and precedes required argument "${next.input.name}" on ${subject}.`,
    });
  }
  if (
    !slot.required &&
    slot.input.config.required !== 'non-interactive' &&
    (needsValue(next) || next.input.config.required === 'non-interactive')
  ) {
    throw new DeclarationError(optionalArgumentLast, {
      correction: 'Declare optional arguments after required ones.',
      findings: [inputFinding(path, slot.input, 'the optional argument'), after],
      sentence: `Argument "${slot.input.name}" is optional and precedes required argument "${next.input.name}" on ${subject}.`,
    });
  }
}

/**
 * Whether a slot must receive a value at a terminal: a required argument, or a content argument
 * whose minimum asks for at least one source.
 */
function needsValue(slot: ArgumentSlot): boolean {
  const { config } = slot.input;
  return slot.required || (config.type === 'content' && (config.min ?? 0) > 0);
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
  const { descriptors, record } = inputExtensions(input, {
    descriptors: state.descriptors,
    siteOf: () => inputSite(name, pathOf(name), input),
    subject: inputSubject(name, input),
  });
  return { descriptors, records: new Map([...state.records, [input, record]]) };
}

/** How an extension fault names one input of the Command `name`. */
function inputSubject(name: string | null, input: InputDeclaration): ExtensionSubject {
  return {
    phrase: `on ${commandSubject(name)} ${input.kind} "${input.name}"`,
    sentence: `${commandSentence(name)} ${input.kind} "${input.name}"`,
  };
}

/** Every rule one argument answers at its own call: its name, a repeated name, and its place after the arguments before it. */
function checkArgument(state: Declared, input: ArgumentInput): void {
  const { name } = state;
  const path = pathOf(name);
  const command = { name, path, subject: commandSubject(name) };
  const declared = state.inputs.filter((entry) => entry.kind === 'argument');
  checkArgumentName(command, declared, input);
  const previous = declared.find((entry) => entry.config.variadic === true) ?? declared.at(-1);
  if (previous) {
    checkSlotOrder(slotOf(previous), slotOf(input), command);
  }
}

/** One argument's name answers the declared-name rule and names no argument declared before it. */
export function checkArgumentName(
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
  const inputs = [...state.inputs, input];
  // The list before this input already answered the rule, so only a claiming input can break it.
  if (claimsStdin(input)) {
    checkStdinClaims(inputs, { path: pathOf(state.name), stdin: state.stdin });
  }
  const recorded = recordInput(state, input);
  // An argument adds no option, so the options compiled for the list before it still hold.
  const compiled = localCompiles.get(state.inputs);
  if (compiled !== undefined) {
    localCompiles.set(inputs, compiled);
  }
  const previous = state.bind;
  return {
    ...state,
    ...recorded,
    bind: (values) => {
      const bound = previous(values);
      return { ...bound, args: { ...bound.args, ...values.argument(input) } };
    },
    inputs,
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
  const input = copyLocalOption(declared, () =>
    configUnread(localScope(state.name, pathOf(state.name)).siteOf(declared)),
  );
  return { ...state, ...admitOption(state, input, table), bind: bindOption(state.bind, input) };
}

/**
 * One local option joining a declaration, with every rule `option()` judges: what the option
 * proves on its own through `admitLocalOption`, then the stdin claim. Its name was judged before
 * the config was read, by `copyLocalOption`. It answers the parts of the declaration the
 * option changes.
 */
function admitOption(
  state: Declared,
  input: OptionInput,
  table: GlobalTable,
): Pick<Declared, 'descriptors' | 'inputs' | 'records'> {
  const { name } = state;
  const path = pathOf(name);
  const scope = localScope(name, path);
  const inputs = [...state.inputs, input];
  // The options before this one compiled at their own calls, so only this one compiles here.
  const compile = () => {
    const compiled = compileNext(localCompile(state.inputs, scope), input, scope);
    localCompiles.set(inputs, compiled);
    return compiled.table;
  };
  const { descriptors, record } = admitLocalOption(
    input,
    {
      compile,
      declarations: [...optionsOf(state.inputs), input],
      descriptors: state.descriptors,
      extensions: inputSubject(name, input),
      scope,
    },
    table,
  );
  // The list before this input already answered the rule, so only a claiming input can break it.
  if (claimsStdin(input)) {
    checkStdinClaims(inputs, { path, stdin: state.stdin });
  }
  return { descriptors, inputs, records: new Map([...state.records, [input, record]]) };
}

/**
 * Each option of a set joins the declaration as a local option, in the set's order, then each of
 * the set's groups, as one `option()` call per option and one group call per group would. A fault
 * about one of the set's options rebuilds the `options()` call that applied it. The set's values
 * join `options` under the set's own types.
 */
export function declareOptionSet<
  Args,
  Options,
  Globals,
  Configs extends Readonly<Record<string, OptionConfig>>,
>(
  state: CommandState<Args, Options, Globals>,
  set: OptionSet<Configs>,
  table: GlobalTable = noGlobals,
): CommandState<Args, Options & OptionSetValues<Configs>, Globals> {
  const held = setFacts(set);
  if (held === undefined) {
    throw new DeclarationError(foreignValue, {
      correction: foreignValueCorrection,
      findings: [{ arguments: [set], call: 'options', mark: '0', path: pathOf(state.name) }],
      sentence: `${commandSentence(state.name)} applies an option set another installed copy of @loomcli/core built.`,
    });
  }
  // A working copy of the receiver's state takes each option in turn; the receiver stays unchanged.
  const declared: CommandState<Args, Options, Globals> = { ...state };
  const inputs: OptionInput[] = [];
  for (const entry of held.entries) {
    const input = copyLocalOption(entry, () =>
      configUnread(localScope(state.name, pathOf(state.name)).siteOf(entry)),
    );
    markApplied(input);
    Object.assign(declared, admitOption(declared, input, table));
    inputs.push(input);
  }
  for (const group of held.groups) {
    Object.assign(declared, declareOptionGroup(declared, group.kind, membersOf(group)));
  }
  return { ...declared, bind: bindOptionSet(state.bind, { inputs, set }) };
}

/**
 * The bind one `options(set)` call answers: the earlier bind's values, then the set's own. It is
 * built outside the call for the reason `bindOption` states.
 */
function bindOptionSet<Args, Options, Configs extends Readonly<Record<string, OptionConfig>>>(
  previous: (values: ValidatedInputs) => { args: Args; options: Options },
  applied: AppliedSet<Configs>,
): (values: ValidatedInputs) => {
  args: Args;
  options: Options & OptionSetValues<Configs>;
} {
  return (values) => {
    const bound = previous(values);
    return { ...bound, options: { ...bound.options, ...values.optionSet(applied) } };
  };
}

/**
 * The bind one `option()` call answers: the earlier bind's values, then the option's own. It is
 * built outside the call, because a closure built inside it would share the call's scope and keep
 * the receiver's state alive, and with it every earlier state of the Command.
 */
function bindOption<Args, Options, Name extends string, Config extends OptionConfig>(
  previous: (values: ValidatedInputs) => { args: Args; options: Options },
  input: OptionInput<Name, Config>,
): (values: ValidatedInputs) => {
  args: Args;
  options: Options & Record<Name, OptionValue<Config>>;
} {
  return (values) => {
    const bound = previous(values);
    return { ...bound, options: { ...bound.options, ...values.option(input) } };
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

/** A required source reaches this accessor only after preparation accepted its presence. */
export function requiredStdin(source: Content | undefined): Content {
  if (source === undefined) {
    throw new Error('Required stdin was not prepared.');
  }
  return source;
}

/** The `stdin` member of the context: the source as prepared, which a required one always has. */
export function stdinMember(
  state: { readonly stdin?: StdinConfig | undefined },
  source: Content | undefined,
): { readonly stdin: Content | undefined } {
  return { stdin: state.stdin?.required === true ? requiredStdin(source) : source };
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
