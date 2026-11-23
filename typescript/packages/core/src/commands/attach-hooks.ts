import type { Finding, DiagnosticRule } from '../diagnostics/diagnostic-text.js';
import { declarerNote, siteFinding } from '../diagnostics/facts.js';
import type { InputSite } from '../diagnostics/facts.js';
import { DeclarationError, asSentence, reasonOf } from '../failures/errors.js';
import { commandSubject, quoted } from '../failures/wording.js';
import type { InputDeclaration, OptionInput } from '../inputs/declarations.js';
import { configUnread } from '../inputs/declarations.js';
import type { OptionGroup } from '../inputs/option-groups.js';
import { declareGroup } from '../inputs/option-groups.js';
import { checkOptionName, spellingMark, compileOptions } from '../inputs/options.js';
import type { SpellingOrigin, OptionSpelling, CompileScope } from '../inputs/options.js';
import { nameSharedAcrossKinds, optionDeclaredTwice, spellingTaken } from '../inputs/rules.js';
import type { ArgumentConfig, OptionConfig } from '../inputs/types.js';
import type { ResultNode } from '../inspection/inspect.js';
import { resultNode } from '../inspection/inspect.js';
import type { ResultView } from '../output/types.js';
import type {
  ExtensionStore,
  AdmittedDescriptor,
  ExtensionSubject,
  ExtensionValue,
} from '../plugins/extension.js';
import { publishStore, validateLayer, extendStore } from '../plugins/extension.js';
import type { BuiltPlugin } from '../plugins/plugin.js';
import { brokenAttachHook } from '../plugins/rules.js';
import type { AttachedCommand, attachedCommand, CommandAttachHook } from '../plugins/types.js';
import { viewsCall } from './declaration.js';
import type { BuiltGlobals, TableEntry } from './globals.js';
import { checkArgumentName, inputSite, inputFinding, localScope } from './inputs.js';
import { buildResult } from './results.js';
import { argumentDeclaredTwice } from './rules.js';
import type { ResultCall, Declared, CommandState } from './state.js';
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

  requires(option: string, ...needed: [string, ...string[]]): AttachedCommand {
    return this.#group('requires', [option, ...needed]);
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
      checkOptionName(raw.name, () => configUnread(inputSite(declared.name, path, raw)));
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
 * One plugin's hook over one Command, which answers with the declaration the hook returned. A
 * returned value core never built has no declaration to read, which the hook's type already
 * rejects, so it meets the same `TypeError` a missing property would.
 */
function attachOnce(
  value: AttachedCommand,
  hook: CommandAttachHook,
  named: { identity: string; subject: string },
): AttachState {
  const state = attachments.get(callHook(value, hook, named));
  if (state === undefined) {
    throw new TypeError('onCommandAttach returned a value that is not an attached Command.');
  }
  return state;
}

/**
 * Every installed plugin's hook over one Command, in installation order, each receiving what the
 * previous returned. The calls they made travel back to the declaration the remaining rules read.
 */
export function runAttachHooks(
  start: Pick<AttachState, 'declared' | 'extensions' | 'registry'> & { layer: ExtensionSubject },
  facts: { hasAction: boolean; path: readonly string[] },
  plugins: readonly BuiltPlugin[],
): AttachProgress {
  const { declared, extensions, layer, registry } = start;
  const subject = commandSubject(declared.name);
  let progress: AttachProgress = { calls: [], declared, extensions, registry };
  for (const installed of plugins) {
    const hook = installed.onCommandAttach;
    if (hook) {
      const identity = installed.identity;
      const value = new AttachedCommandValue({ ...progress, ...facts, identity, subject: layer });
      const state = attachOnce(value, hook, { identity, subject });
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
export function applyAttachCalls<Args, Options, Globals>(
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
  /** Built only when a collision reports it, because nothing else reads it. */
  finding: () => Finding | undefined;
}

/** Where the option one table names declared one of its spellings, by its name and the origin. */
type SpellingPlace = (name: string, origin: SpellingOrigin) => Finding | undefined;

/** The spellings one compiled table holds, each with its form and the place that declared it. */
function readSpellings(
  table: ReadonlyMap<string, OptionSpelling>,
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
      claimed.set(spelling, { finding: () => placeOf(option.name, option), form });
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
          ...[used.finding()].filter((finding) => finding !== undefined),
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
export function checkAttachedInputs(
  declared: Declared,
  attached: readonly AttachedInput[],
  place: { globals: BuiltGlobals; path: readonly string[] },
): void {
  // With no hook-declared input there is nothing to judge, and the claims below are never read.
  if (attached.length === 0) {
    return;
  }
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
