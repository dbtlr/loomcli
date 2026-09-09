import { DeclarationError } from './errors.js';
import { buildExtensions } from './extension.js';
import { checkDescription } from './facts.js';
import { compileOptions } from './options.js';
import type { BuiltPlugin, PluginBuild } from './plugin.js';
import type {
  DefaultConstraint,
  MultipleConstraint,
  NameConstraint,
  OptionConfig,
  OptionValue,
  ValidateOmittedConstraint,
} from './types.js';
import type { InputDeclaration, OptionInput, ValidatedInputs } from './validation.js';
import { captureConfig } from './validation.js';

const globalSubject = 'the global options';

/** Phantom key. It keeps the declared option types exact and holds no runtime value. */
declare const declaredTypes: unique symbol;

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
  inputs: readonly InputDeclaration[];
  names: ReadonlyMap<string, OptionOwner>;
  options: ReturnType<typeof compileOptions>;
  plugins: readonly BuiltPlugin[];
  source: unknown;
}

/** The declarations behind one GlobalOptions value. Only this package reaches them. */
interface GlobalsNode {
  bind: (values: ValidatedInputs) => unknown;
  inputs: readonly InputDeclaration[];
  source: unknown;
}

/** Authored values register here, so the public type publishes no state to reach or replace. */
const nodes = new WeakMap<object, GlobalsNode>();

class GlobalOptionsBuilder<Options> {
  declare readonly [declaredTypes]: Options;
  readonly #bind: (values: ValidatedInputs) => Options;
  readonly #inputs: readonly InputDeclaration[];

  constructor(inputs: readonly InputDeclaration[], bind: (values: ValidatedInputs) => Options) {
    this.#bind = bind;
    this.#inputs = inputs;
    nodes.set(this, { bind, inputs, source: this });
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<MultipleConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): GlobalOptions<Options & Record<Name, OptionValue<Config>>> {
    const input: OptionInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'option',
      name,
    };
    const previous = this.#bind;
    return new GlobalOptionsBuilder([...this.#inputs, input], (values) => ({
      ...previous(values),
      ...values.option(input),
    }));
  }
}

/**
 * Application-wide options. `option()` is the whole authoring surface: it returns a new value and
 * leaves its receiver unchanged. The value the declarations share is the application's globals.
 * The declarations themselves stay private, so no consumer can read or replace them.
 */
type GlobalOptions<Options = {}> = Pick<
  GlobalOptionsBuilder<Options>,
  typeof declaredTypes | 'option'
>;

/** Reads the declarations behind an authored value; anything else is a declaration error. */
function nodeOf(globals: object): GlobalsNode {
  const node = nodes.get(globals);
  if (!node) {
    throw new DeclarationError(
      'The Application holds a value that is not a GlobalOptions declaration. Supply the value returned by new GlobalOptions().',
    );
  }
  return node;
}

/**
 * Whether a value is an authored GlobalOptions declaration, whichever call produced it. The
 * registry is the test, because `option()` returns a new declaration of its own and the exported
 * constructor is only the first of them.
 */
function isGlobalOptions(value: unknown): boolean {
  return typeof value === 'object' && value !== null && nodes.has(value);
}

/**
 * The one table the pre-scan reads: the application's global options in authoring order, then each
 * installed plugin's options in installation order. Every collision between the two scopes, by key
 * or by spelling, is reported here, so the pre-scan meets a table with one owner per name.
 */
function compileTable(
  node: GlobalsNode,
  plugins: readonly BuiltPlugin[],
  build: PluginBuild,
): BuiltGlobals {
  const names = new Map<string, OptionOwner>();
  const application: OptionOwner = { kind: 'application' };
  // A global option belongs to the application, not to one Command, so its facts read that way.
  for (const input of node.inputs) {
    const sentence = `Global option "${input.name}"`;
    checkDescription(sentence, input.config.description);
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
  const options = compileOptions(
    node.inputs.filter((input) => input.kind === 'option'),
    globalSubject,
  );
  plugins.forEach((installed, order) => {
    join({ identity: installed.identity, kind: 'plugin', order }, installed.inputs, {
      names,
      options,
    });
  });
  return { inputs: node.inputs, names, options, plugins, source: node.source };
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

/** Absent globals compile to an empty table whose source is `undefined`, like the declarations. */
function buildGlobals(
  globals: object | undefined,
  plugins: readonly BuiltPlugin[],
  build: PluginBuild,
): BuiltGlobals {
  const node: GlobalsNode =
    globals === undefined ? { bind: () => ({}), inputs: [], source: undefined } : nodeOf(globals);
  return compileTable(node, plugins, build);
}

function bindGlobals<Options>(
  globals: GlobalOptions<Options> | undefined,
  values: ValidatedInputs,
): Options {
  const bound: unknown = globals === undefined ? {} : nodeOf(globals).bind(values);
  // Last resort: no typed path exists. The public GlobalOptions type hides its declarations.
  // The registry is the only bridge from a value to its binder, and a WeakMap cannot carry the
  // Options type of its key. It holds because the registered binder belongs to this value alone.
  // Its record composes exactly the declarations that its Options type records.
  // A declaration without globals publishes `Options = {}`, and the empty record is exactly that.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return bound as Options;
}

const GlobalOptions: new () => GlobalOptions = class extends GlobalOptionsBuilder<{}> {
  constructor() {
    super([], () => ({}));
  }
};

export type { BuiltGlobals, OptionOwner, OptionSite };
export {
  bindGlobals,
  buildGlobals,
  GlobalOptions,
  isGlobalOptions,
  keyCollision,
  spellingCollision,
};
