import { checkEnvBinding, claimVariables } from './bindings.js';
import type { BoundOption } from './bindings.js';
import { DeclarationError } from './errors.js';
import { buildExtensions } from './extension.js';
import { checkDeprecated, checkDescription, checkHidden } from './facts.js';
import { compileOptions } from './options.js';
import type { BuiltPlugin, PluginBuild } from './plugin.js';
import type { OptionConfig, OptionValue } from './types.js';
import type { OptionInput, ValidatedInputs } from './validation.js';

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
 * The compiled global table: one spelling map shared by every Command in the graph. It holds the
 * application's global options and every installed plugin's options, because the pre-scan reads one
 * table. `inputs` holds the application's declarations alone, because a plugin option is never
 * validated and never reaches an action.
 */
interface BuiltGlobals {
  bind: (values: ValidatedInputs) => unknown;
  inputs: readonly OptionInput[];
  names: ReadonlyMap<string, OptionOwner>;
  options: ReturnType<typeof compileOptions>;
  plugins: readonly BuiltPlugin[];
  /** The variable each option in the table binds, under the phrase a duplicate names it by. */
  variables: ReadonlyMap<string, string>;
}

/** The Application's private global declarations and their schema-derived value binder. */
interface GlobalsState<Globals = unknown> {
  bind: (values: ValidatedInputs) => Globals;
  inputs: readonly OptionInput[];
}

function emptyGlobals(): GlobalsState<{}> {
  return { bind: () => ({}), inputs: [] };
}

function declareGlobalOption<Globals, Name extends string, Config extends OptionConfig>(
  state: GlobalsState<Globals>,
  input: OptionInput<Name, Config>,
): GlobalsState<Globals & Record<Name, OptionValue<Config>>> {
  return {
    bind: (values) => ({ ...state.bind(values), ...values.option(input) }),
    inputs: [...state.inputs, input],
  };
}

/**
 * The one table the pre-scan reads: the application's global options in authoring order, then each
 * installed plugin's options in installation order. Every collision between the two scopes, by key
 * or by spelling, is reported here, so the pre-scan meets a table with one owner per name.
 */
function buildGlobals(
  node: GlobalsState,
  plugins: readonly BuiltPlugin[],
  build: PluginBuild,
): BuiltGlobals {
  const names = new Map<string, OptionOwner>();
  const application: OptionOwner = { kind: 'application' };
  // A global option belongs to the application, not to one Command, so its facts read that way.
  for (const input of node.inputs) {
    const sentence = `Global option "${input.name}"`;
    checkDescription(sentence, input.config.description);
    checkHidden(sentence, input.config.hidden);
    checkDeprecated(sentence, input.config.deprecated);
    checkEnvBinding(sentence, input.config);
    build.extensions.set(
      input,
      buildExtensions({
        declared: input.config.extensions,
        descriptors: build.descriptors,
        subject: { phrase: `on the global option "${input.name}"`, sentence },
        target: 'option',
      }),
    );
    names.set(input.name, application);
  }
  const options = compileOptions(node.inputs, globalSubject);
  plugins.forEach((installed, order) => {
    join({ identity: installed.identity, kind: 'plugin', order }, installed.inputs, {
      names,
      options,
    });
  });
  const variables = claimVariables([
    ...boundOptions(node.inputs, (name) => `global option "${name}"`),
    ...plugins.flatMap((installed) =>
      boundOptions(installed.inputs, (name) => `plugin "${installed.identity}" option "${name}"`),
    ),
  ]);
  return { bind: node.bind, inputs: node.inputs, names, options, plugins, variables };
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

export type { BuiltGlobals, GlobalsState, OptionOwner, OptionSite };
export {
  boundOptions,
  buildGlobals,
  declareGlobalOption,
  emptyGlobals,
  keyCollision,
  spellingCollision,
};
