import { DeclarationError } from './errors.js';
import { compileOptions } from './options.js';
import type { DefaultConstraint, NameConstraint, OptionConfig, OptionValue } from './types.js';
import type { InputDeclaration, ValidatedInputs } from './validation.js';

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
    const declared: OptionConfig = { ...config };
    const input: InputDeclaration = { config: declared, kind: 'option', name };
    const previous = this.#bind;
    return new GlobalOptionsBuilder([...this.#inputs, input], (values) => {
      // Validation supplies the declared output, and the computed key is exactly Name.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const value = { [name]: values.get(input) } as Record<Name, OptionValue<Config>>;
      return { ...previous(values), ...value };
    });
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

/** Declarations without globals share this value, so their identity checks still agree. */
const emptyGlobals = new GlobalOptionsBuilder<{}>([], () => ({}));

function defaultGlobals<Globals>(globals: GlobalOptions<Globals> | undefined) {
  // The shared value declares no options, so it binds an empty record for any omitted Globals.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return globals ?? (emptyGlobals as unknown as GlobalOptions<Globals>);
}

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

function buildGlobals(globals: object): BuiltGlobals {
  return nodeOf(globals).build();
}

function bindGlobals<Options>(globals: GlobalOptions<Options>, values: ValidatedInputs): Options {
  // The registered binder belongs to this value, so it produces exactly this value's Options.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nodeOf(globals).bind(values) as Options;
}

const GlobalOptions: new () => GlobalOptions = class extends GlobalOptionsBuilder<{}> {
  constructor() {
    super([], () => ({}));
  }
};

export type { BuiltGlobals };
export { bindGlobals, buildGlobals, defaultGlobals, GlobalOptions };
