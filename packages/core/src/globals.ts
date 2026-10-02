import { checkEnvBinding, claimVariables } from './bindings.js';
import type { BoundOption } from './bindings.js';
import { DeclarationError, quoted } from './errors.js';
import { buildExtensions } from './extension.js';
import type { DescriptorRegistry } from './extension.js';
import {
  callSite,
  checkDeprecated,
  checkDescription,
  checkHidden,
  factFault,
  pluginOptionSite,
  siteFinding,
} from './facts.js';
import type { InputSite } from './facts.js';
import { globalPresenceRule, optionDeclaredTwice, spellingTaken } from './input-rules.js';
import { checkOptionName, compileOptions, spellingMark } from './options.js';
import type { CompileScope, SpellingRole } from './options.js';
import type { BuiltPlugin } from './plugin.js';
import type { OptionConfig, OptionValue } from './types.js';
import { captureInputConfig, configUnread } from './validation.js';
import type { InputDeclaration, OptionInput, ValidatedInputs } from './validation.js';

const globalSubject = 'the global options';

/**
 * The presence keys a global option may not declare, in the order its diagnostic names them. A
 * global's validation runs on every Command, plugin Commands included, so a rule that a value must
 * exist belongs to the Commands that read it.
 */
const omissionRules = ['required', 'validateOmitted'] as const;

/**
 * Who declared one option that shares the globals table, or the Command that declares a local
 * option colliding with it. Every collision sentence is derived from a pair of these, so the
 * existing global-versus-local wording and the plugin wording read from one place.
 */
type OptionOwner =
  | { kind: 'application' }
  | { kind: 'local'; subject: string }
  | { kind: 'plugin'; identity: string; order: number };

/** One option the globals table holds: the scope that declared it, and where it was declared. */
interface TableEntry {
  owner: OptionOwner;
  site: InputSite;
}

/** One side of a key collision: the option's declared name, its scope, and where it was declared. */
interface OptionSite extends TableEntry {
  name: string;
}

/** One side of a spelling collision, which also says which of the option's forms the spelling is. */
interface SpellingSite extends OptionSite {
  role: SpellingRole;
}

/** A collision sentence names a plugin first, then the application's globals, then a local. */
const ranks: Readonly<Record<OptionOwner['kind'], number>> = {
  application: 1,
  local: 2,
  plugin: 0,
};

function ordered<Side extends OptionSite>(first: Side, second: Side): [Side, Side] {
  const difference = ranks[first.owner.kind] - ranks[second.owner.kind];
  if (difference !== 0) {
    return difference < 0 ? [first, second] : [second, first];
  }
  if (first.owner.kind === 'plugin' && second.owner.kind === 'plugin') {
    return first.owner.order <= second.owner.order ? [first, second] : [second, first];
  }
  return [first, second];
}

/** How one owner reads in a key collision. A repeated preposition is dropped after the first. */
function declaredBy(owner: OptionOwner, leading: boolean): string {
  if (owner.kind === 'plugin') {
    return `${leading ? 'by ' : ''}plugin ${quoted(owner.identity)}`;
  }
  return owner.kind === 'application'
    ? 'as a global option'
    : `as a local option on ${owner.subject}`;
}

/** How one owner reads in a spelling collision, where each side names its own option. */
function usedBy({ name, owner }: OptionSite): string {
  if (owner.kind === 'plugin') {
    return `plugin ${quoted(owner.identity)} option ${quoted(name)}`;
  }
  return owner.kind === 'application'
    ? `the global option ${quoted(name)}`
    : `the local option ${quoted(name)} on ${owner.subject}`;
}

/** The correction each pair earns: a local is renamed, and two plugins are chosen between. */
function correction(first: OptionOwner, second: OptionOwner): string {
  if (first.kind === 'local' || second.kind === 'local') {
    return 'Rename the local option.';
  }
  return first.kind === 'plugin' && second.kind === 'plugin'
    ? 'Install one of them or rename the option.'
    : 'Rename one declaration.';
}

/** The note beside one side's finding, which says which scope declared it. */
const sideNotes: Readonly<Record<OptionOwner['kind'], string>> = {
  application: 'the global option',
  local: 'the local option',
  plugin: 'the plugin option',
};

/** One key claimed twice, whichever two scopes claimed it. */
function keyCollision(first: OptionSite, second: OptionSite): DeclarationError {
  const pair = ordered(first, second);
  const [leading, trailing] = pair;
  return new DeclarationError(optionDeclaredTwice, {
    correction: correction(leading.owner, trailing.owner),
    findings: pair.map(({ owner, site }) => siteFinding(site, site.named, sideNotes[owner.kind])),
    sentence: `Option ${quoted(leading.name)} is declared ${declaredBy(leading.owner, true)} and ${declaredBy(trailing.owner, false)}.`,
  });
}

/** One spelling claimed twice, whichever two scopes claimed it. */
function spellingCollision(
  spelling: string,
  first: SpellingSite,
  second: SpellingSite,
): DeclarationError {
  const pair = ordered(first, second);
  const [leading, trailing] = pair;
  return new DeclarationError(spellingTaken, {
    correction: 'Change one declaration.',
    findings: pair.map(({ owner, role, site }) =>
      siteFinding(site, spellingMark(site, role), sideNotes[owner.kind]),
    ),
    sentence: `Option spelling ${quoted(spelling)} is used by ${usedBy(leading)} and ${usedBy(trailing)}.`,
  });
}

/**
 * The globals table the pre-scan reads, with every rule that pairs two of its options settled: one
 * spelling map, the scope that owns each key and where it was declared, and the variable each
 * option binds. It holds the application's global options and every installed plugin's options,
 * because the pre-scan reads one table.
 */
interface GlobalTable {
  names: ReadonlyMap<string, TableEntry>;
  options: ReturnType<typeof compileOptions>;
  /** The variable each option in the table binds, with the option that binds it. */
  variables: ReadonlyMap<string, BoundOption>;
}

/**
 * The compiled table one graph build shares. `inputs` holds the application's declarations alone,
 * because a plugin option is never validated and never reaches an action.
 */
interface BuiltGlobals extends GlobalTable {
  bind: (values: ValidatedInputs) => unknown;
  inputs: readonly OptionInput[];
  plugins: readonly BuiltPlugin[];
}

/** The validated extension record of each declaration, keyed by the declaration itself. */
type InputRecords = ReadonlyMap<InputDeclaration, Readonly<Record<string, unknown>>>;

/**
 * The Application's private global declarations, their schema-derived value binder, and the
 * extension record each declaration's own call validated.
 */
interface GlobalsState<Globals = unknown> {
  bind: (values: ValidatedInputs) => Globals;
  inputs: readonly OptionInput[];
  records: InputRecords;
}

function emptyGlobals(): GlobalsState<{}> {
  return { bind: () => ({}), inputs: [], records: new Map() };
}

/** Where one global option was declared: its `globalOption()` call on the Application. */
function globalSite(input: OptionInput): InputSite {
  // A global option belongs to the application, not to one Command, so its facts read that way.
  return callSite(`Global option ${quoted(input.name)}`, {
    arguments: [input.name, input.config],
    call: 'globalOption',
    path: [],
  });
}

/**
 * Where each of one plugin's options was declared: its entry in the `options` record of the
 * plugin's `plugin()` call, which is rebuilt from every option the plugin holds.
 */
function pluginSites(
  identity: string,
  inputs: readonly OptionInput[],
): (input: OptionInput) => InputSite {
  const options = Object.fromEntries(inputs.map(({ config, name }) => [name, config]));
  return (input) =>
    pluginOptionSite(
      { identity, options },
      input.name,
      `Plugin ${quoted(identity)} option ${quoted(input.name)}`,
    );
}

/**
 * One global option's own facts, binding, and extension values, checked at its `globalOption()`
 * call against the Application's descriptors. The rules that pair it with another option belong to
 * the table, which the caller rebuilds with it.
 */
function declareGlobalOption<Globals, Name extends string, Config extends OptionConfig>(
  state: GlobalsState<Globals>,
  declared: OptionInput<Name, Config>,
  descriptors: DescriptorRegistry,
): {
  readonly input: OptionInput<Name, Config>;
  readonly state: GlobalsState<Globals & Record<Name, OptionValue<Config>>>;
} {
  // The name is judged before the config, as every other declaration judges its own name first.
  checkOptionName(declared.name, configUnread(globalSite(declared)));
  const input = {
    ...declared,
    config: captureInputConfig(declared, { call: 'globalOption', path: [] }),
  };
  const site = globalSite(input);
  const sentence = site.subject;
  const rejected = omissionRules.find((key) => key in input.config);
  if (rejected !== undefined) {
    throw factFault(globalPresenceRule, site, {
      correction: `Remove ${rejected}, and check for the value in each Command that needs it.`,
      fact: rejected,
      sentence: `${sentence} declares ${rejected}.`,
    });
  }
  checkDescription(site, input.config.description);
  checkHidden(site, input.config.hidden);
  checkDeprecated(site, input.config.deprecated);
  checkEnvBinding(site, input.config);
  const record = buildExtensions({
    declared: input.config.extensions,
    descriptors,
    site: { ...site, at: '1.extensions' },
    subject: { phrase: `on the global option ${quoted(input.name)}`, sentence },
    target: 'option',
  });
  // The caller validates the captured input this state stores, so both read one capture.
  return {
    input,
    state: {
      bind: (values) => ({ ...state.bind(values), ...values.option(input) }),
      inputs: [...state.inputs, input],
      records: new Map([...state.records, [input, record]]),
    },
  };
}

/**
 * The one table the pre-scan reads: the application's global options in authoring order, then each
 * installed plugin's options in installation order. Every collision between the two scopes, by key
 * or by spelling, is reported here, so the pre-scan meets a table with one owner per name.
 */
function globalTable(inputs: readonly OptionInput[], plugins: readonly BuiltPlugin[]): GlobalTable {
  const names = new Map<string, TableEntry>();
  const application: OptionOwner = { kind: 'application' };
  for (const input of inputs) {
    names.set(input.name, { owner: application, site: globalSite(input) });
  }
  const options = compileOptions(inputs, { siteOf: globalSite, subject: globalSubject });
  plugins.forEach((installed, order) => {
    join({ identity: installed.identity, kind: 'plugin', order }, installed.inputs, {
      names,
      options,
    });
  });
  const variables = claimVariables([
    ...boundOptions(inputs, (input) => ({
      phrase: `global option ${quoted(input.name)}`,
      site: globalSite(input),
    })),
    ...plugins.flatMap((installed) => {
      const siteOf = pluginSites(installed.identity, installed.inputs);
      return boundOptions(installed.inputs, (input) => ({
        phrase: `plugin ${quoted(installed.identity)} option ${quoted(input.name)}`,
        site: siteOf(input),
      }));
    }),
  ]);
  return { names, options, variables };
}

/** The table one graph build shares, which every earlier call already proved free of collisions. */
function buildGlobals(node: GlobalsState, plugins: readonly BuiltPlugin[]): BuiltGlobals {
  return { ...globalTable(node.inputs, plugins), bind: node.bind, inputs: node.inputs, plugins };
}

/**
 * One Command's own options against the globals table, compiled for dispatch. The table holds the
 * application's globals and every plugin option, so a local collision reads the same sentence
 * whichever scope on the other side claimed the name, the spelling, or the variable. One
 * invocation's scope is this Command's own options and the table, so a variable binds one option
 * there, while a sibling Command may bind it again. `scope` names the Command and places each of
 * its options.
 */
function checkLocalOptions(
  declarations: readonly OptionInput[],
  table: GlobalTable,
  scope: CompileScope<OptionInput>,
): ReturnType<typeof compileOptions> {
  const { siteOf, subject } = scope;
  const local: OptionOwner = { kind: 'local', subject };
  for (const declaration of declarations) {
    const claimed = table.names.get(declaration.name);
    if (claimed) {
      throw keyCollision(
        { ...claimed, name: declaration.name },
        { name: declaration.name, owner: local, site: siteOf(declaration) },
      );
    }
  }
  const options = compileOptions(declarations, scope);
  for (const [spelling, option] of options) {
    const global = table.options.get(spelling);
    const claimed = global && table.names.get(global.name);
    const declaration = declarations.find((input) => input.name === option.name);
    if (global && claimed && declaration) {
      throw spellingCollision(
        spelling,
        { ...claimed, name: global.name, role: global.role },
        { name: option.name, owner: local, role: option.role, site: siteOf(declaration) },
      );
    }
  }
  claimVariables(
    boundOptions(declarations, (input) => ({
      phrase: `${subject} option ${quoted(input.name)}`,
      site: siteOf(input),
    })),
    table.variables,
  );
  return options;
}

/** The options in one list that bind a variable, each named and placed by its scope. */
function boundOptions(
  inputs: readonly OptionInput[],
  describe: (input: OptionInput) => Omit<BoundOption, 'variable'>,
): BoundOption[] {
  return inputs.flatMap((input) =>
    input.config.env === undefined ? [] : [{ ...describe(input), variable: input.config.env }],
  );
}

/** One plugin's options joining the table the application's globals already hold. */
function join(
  owner: OptionOwner & { kind: 'plugin' },
  inputs: readonly OptionInput[],
  table: { names: Map<string, TableEntry>; options: ReturnType<typeof compileOptions> },
): void {
  const { names, options } = table;
  const siteOf = pluginSites(owner.identity, inputs);
  for (const input of inputs) {
    const claimed = names.get(input.name);
    if (claimed) {
      throw keyCollision(
        { name: input.name, owner, site: siteOf(input) },
        { ...claimed, name: input.name },
      );
    }
    names.set(input.name, { owner, site: siteOf(input) });
  }
  for (const [spelling, option] of compileOptions(inputs, {
    siteOf,
    subject: `plugin ${quoted(owner.identity)}`,
  })) {
    const existing = options.get(spelling);
    const claimed = existing && names.get(existing.name);
    const own = names.get(option.name);
    if (existing && claimed && own) {
      throw spellingCollision(
        spelling,
        { ...own, name: option.name, role: option.role },
        { ...claimed, name: existing.name, role: existing.role },
      );
    }
    options.set(spelling, option);
  }
}

export type { BuiltGlobals, GlobalsState, GlobalTable, InputRecords, OptionOwner, TableEntry };
export {
  boundOptions,
  buildGlobals,
  checkLocalOptions,
  declareGlobalOption,
  emptyGlobals,
  globalSite,
  globalTable,
  pluginSites,
};
