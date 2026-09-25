import { checkEnvBinding, claimVariables } from './bindings.js';
import type { BoundOption } from './bindings.js';
import { DeclarationError } from './errors.js';
import { buildExtensions } from './extension.js';
import type { DescriptorRegistry } from './extension.js';
import { checkDeprecated, checkDescription, checkHidden } from './facts.js';
import { compileOptions } from './options.js';
import type { BuiltPlugin } from './plugin.js';
import type { OptionConfig, OptionValue } from './types.js';
import type { InputDeclaration, OptionInput, ValidatedInputs } from './validation.js';

const globalSubject = 'the global options';

/**
 * Who declared one option that shares the globals table, or the Command that declares a local
 * option colliding with it. Every collision sentence is derived from a pair of these, so the
 * existing global-versus-local wording and the plugin wording read from one place.
 */
type OptionOwner =
  | { kind: 'application' }
  | { kind: 'local'; subject: string }
  | { kind: 'plugin'; identity: string; order: number };

/** One side of a collision: the option's declared name under the scope that declared it. */
interface OptionSite {
  name: string;
  owner: OptionOwner;
}

/** A collision sentence names a plugin first, then the application's globals, then a local. */
const ranks: Readonly<Record<OptionOwner['kind'], number>> = {
  application: 1,
  local: 2,
  plugin: 0,
};

function ordered(first: OptionSite, second: OptionSite): [OptionSite, OptionSite] {
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
    return `${leading ? 'by ' : ''}plugin "${owner.identity}"`;
  }
  return owner.kind === 'application'
    ? 'as a global option'
    : `as a local option on ${owner.subject}`;
}

/** How one owner reads in a spelling collision, where each side names its own option. */
function usedBy({ name, owner }: OptionSite): string {
  if (owner.kind === 'plugin') {
    return `plugin "${owner.identity}" option "${name}"`;
  }
  return owner.kind === 'application'
    ? `the global option "${name}"`
    : `the local option "${name}" on ${owner.subject}`;
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

/** One key claimed twice, whichever two scopes claimed it. */
function keyCollision(name: string, first: OptionOwner, second: OptionOwner): DeclarationError {
  const [leading, trailing] = ordered({ name, owner: first }, { name, owner: second });
  return new DeclarationError(
    `Option "${name}" is declared ${declaredBy(leading.owner, true)} and ${declaredBy(trailing.owner, false)}. ${correction(leading.owner, trailing.owner)}`,
  );
}

/** One spelling claimed twice, whichever two scopes claimed it. */
function spellingCollision(
  spelling: string,
  first: OptionSite,
  second: OptionSite,
): DeclarationError {
  const [leading, trailing] = ordered(first, second);
  return new DeclarationError(
    `Option spelling "${spelling}" is used by ${usedBy(leading)} and ${usedBy(trailing)}. Change one declaration.`,
  );
}

/**
 * The globals table the pre-scan reads, with every rule that pairs two of its options settled: one
 * spelling map, the scope that owns each key, and the variable each option binds. It holds the
 * application's global options and every installed plugin's options, because the pre-scan reads one
 * table.
 */
interface GlobalTable {
  names: ReadonlyMap<string, OptionOwner>;
  options: ReturnType<typeof compileOptions>;
  /** The variable each option in the table binds, under the phrase a duplicate names it by. */
  variables: ReadonlyMap<string, string>;
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

/**
 * One global option's own facts, binding, and extension values, checked at its `globalOption()`
 * call against the Application's descriptors. The rules that pair it with another option belong to
 * the table, which the caller rebuilds with it.
 */
function declareGlobalOption<Globals, Name extends string, Config extends OptionConfig>(
  state: GlobalsState<Globals>,
  input: OptionInput<Name, Config>,
  descriptors: DescriptorRegistry,
): GlobalsState<Globals & Record<Name, OptionValue<Config>>> {
  // A global option belongs to the application, not to one Command, so its facts read that way.
  const sentence = `Global option "${input.name}"`;
  checkDescription(sentence, input.config.description);
  checkHidden(sentence, input.config.hidden);
  checkDeprecated(sentence, input.config.deprecated);
  checkEnvBinding(sentence, input.config);
  const record = buildExtensions({
    declared: input.config.extensions,
    descriptors,
    subject: { phrase: `on the global option "${input.name}"`, sentence },
    target: 'option',
  });
  return {
    bind: (values) => ({ ...state.bind(values), ...values.option(input) }),
    inputs: [...state.inputs, input],
    records: new Map([...state.records, [input, record]]),
  };
}

/**
 * The one table the pre-scan reads: the application's global options in authoring order, then each
 * installed plugin's options in installation order. Every collision between the two scopes, by key
 * or by spelling, is reported here, so the pre-scan meets a table with one owner per name.
 */
function globalTable(inputs: readonly OptionInput[], plugins: readonly BuiltPlugin[]): GlobalTable {
  const names = new Map<string, OptionOwner>();
  const application: OptionOwner = { kind: 'application' };
  for (const input of inputs) {
    names.set(input.name, application);
  }
  const options = compileOptions(inputs, globalSubject);
  plugins.forEach((installed, order) => {
    join({ identity: installed.identity, kind: 'plugin', order }, installed.inputs, {
      names,
      options,
    });
  });
  const variables = claimVariables([
    ...boundOptions(inputs, (name) => `global option "${name}"`),
    ...plugins.flatMap((installed) =>
      boundOptions(installed.inputs, (name) => `plugin "${installed.identity}" option "${name}"`),
    ),
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
 * there, while a sibling Command may bind it again.
 */
function checkLocalOptions(
  declarations: readonly OptionInput[],
  table: GlobalTable,
  subject: string,
): ReturnType<typeof compileOptions> {
  const local: OptionOwner = { kind: 'local', subject };
  const application: OptionOwner = { kind: 'application' };
  for (const declaration of declarations) {
    const claimed = table.names.get(declaration.name);
    if (claimed) {
      throw keyCollision(declaration.name, claimed, local);
    }
  }
  const options = compileOptions(declarations, subject);
  for (const [spelling, option] of options) {
    const global = table.options.get(spelling);
    if (global) {
      throw spellingCollision(
        spelling,
        { name: global.name, owner: table.names.get(global.name) ?? application },
        { name: option.name, owner: local },
      );
    }
  }
  claimVariables(
    boundOptions(declarations, (option) => `${subject} option "${option}"`),
    table.variables,
  );
  return options;
}

/** The options in one list that bind a variable, each named by the phrase its scope gives it. */
function boundOptions(
  inputs: readonly OptionInput[],
  site: (name: string) => string,
): BoundOption[] {
  return inputs.flatMap(({ config, name }) =>
    config.env === undefined ? [] : [{ site: site(name), variable: config.env }],
  );
}

/** One plugin's options joining the table the application's globals already hold. */
function join(
  owner: OptionOwner & { kind: 'plugin' },
  inputs: readonly OptionInput[],
  table: { names: Map<string, OptionOwner>; options: ReturnType<typeof compileOptions> },
): void {
  const { names, options } = table;
  for (const input of inputs) {
    const claimed = names.get(input.name);
    if (claimed) {
      throw keyCollision(input.name, owner, claimed);
    }
    names.set(input.name, owner);
  }
  for (const [spelling, option] of compileOptions(inputs, `plugin "${owner.identity}"`)) {
    const claimed = options.get(spelling);
    if (claimed) {
      throw spellingCollision(
        spelling,
        { name: option.name, owner },
        { name: claimed.name, owner: names.get(claimed.name) ?? { kind: 'application' } },
      );
    }
    options.set(spelling, option);
  }
}

export type { BuiltGlobals, GlobalsState, GlobalTable, InputRecords, OptionOwner, OptionSite };
export {
  boundOptions,
  buildGlobals,
  checkLocalOptions,
  declareGlobalOption,
  emptyGlobals,
  globalTable,
  keyCollision,
  spellingCollision,
};
