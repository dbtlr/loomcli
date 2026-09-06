import { DeclarationError } from './errors.js';
import { compileOptions } from './options.js';
import type { DefaultConstraint, NameConstraint, OptionConfig, OptionValue } from './types.js';
import type { InputDeclaration, OptionInput, ValidatedInputs } from './validation.js';

const globalSubject = 'the global options';

/** Phantom key. It keeps the declared option types exact and holds no runtime value. */
declare const declaredTypes: unique symbol;

/** The compiled global table: one spelling map shared by every Command in the graph. */
interface BuiltGlobals {
  inputs: readonly InputDeclaration[];
  names: ReadonlySet<string>;
  options: ReturnType<typeof compileOptions>;
  source: unknown;
}

/** The declarations behind one GlobalOptions value. Only this package reaches them. */
interface GlobalsNode {
  bind: (values: ValidatedInputs) => unknown;
  build: () => BuiltGlobals;
}

/** Authored values register here, so the public type publishes no state to reach or replace. */
const nodes = new WeakMap<object, GlobalsNode>();

function compileTable(inputs: readonly InputDeclaration[], source: unknown): BuiltGlobals {
  return {
    inputs,
    names: new Set(inputs.map((input) => input.name)),
    options: compileOptions(
      inputs.filter((input) => input.kind === 'option'),
      globalSubject,
    ),
    source,
  };
}

class GlobalOptionsBuilder<Options> {
  declare readonly [declaredTypes]: Options;
  readonly #bind: (values: ValidatedInputs) => Options;
  readonly #inputs: readonly InputDeclaration[];

  constructor(inputs: readonly InputDeclaration[], bind: (values: ValidatedInputs) => Options) {
    this.#bind = bind;
    this.#inputs = inputs;
    nodes.set(this, { bind, build: () => compileTable(inputs, this) });
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config & NameConstraint<Name> & NoInfer<DefaultConstraint<Config>>,
  ): GlobalOptions<Options & Record<Name, OptionValue<Config>>> {
    const input: OptionInput<Name, Config> = { config: { ...config }, kind: 'option', name };
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

/** Absent globals compile to an empty table whose source is `undefined`, like the declarations. */
function buildGlobals(globals: object | undefined): BuiltGlobals {
  return globals === undefined ? compileTable([], undefined) : nodeOf(globals).build();
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

export type { BuiltGlobals };
export { bindGlobals, buildGlobals, GlobalOptions };
