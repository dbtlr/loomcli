import { compileOptions } from './options.js';
import type { DefaultConstraint, NameConstraint, OptionConfig, OptionValue } from './types.js';
import type { InputDeclaration, ValidatedInputs } from './validation.js';

const globalSubject = 'the global options';

/** The compiled global table: one spelling map shared by every Command in the graph. */
interface BuiltGlobals {
  inputs: readonly InputDeclaration[];
  names: ReadonlySet<string>;
  options: ReturnType<typeof compileOptions>;
  source: unknown;
}

/** Application-wide options. Each call returns a new value; the last one is the graph's globals. */
class GlobalOptionsBuilder<Options> {
  readonly bind: (values: ValidatedInputs) => Options;
  readonly inputs: readonly InputDeclaration[];

  constructor(inputs: readonly InputDeclaration[], bind: (values: ValidatedInputs) => Options) {
    this.bind = bind;
    this.inputs = inputs;
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config & NameConstraint<Name> & NoInfer<DefaultConstraint<Config>>,
  ): GlobalOptions<Options & Record<Name, OptionValue<Config>>> {
    const declared: OptionConfig = { ...config };
    const input: InputDeclaration = { config: declared, kind: 'option', name };
    return new GlobalOptionsBuilder([...this.inputs, input], (values) => {
      const previous = this.bind(values);
      // Validation supplies the declared output, and the computed key is exactly Name.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const value = { [name]: values.get(input) } as Record<Name, OptionValue<Config>>;
      return { ...previous, ...value };
    });
  }

  build(): BuiltGlobals {
    return {
      inputs: this.inputs,
      names: new Set(this.inputs.map((input) => input.name)),
      options: compileOptions(
        this.inputs.filter((input) => input.kind === 'option'),
        globalSubject,
      ),
      source: this,
    };
  }
}

/** Declarations without globals share this value, so their identity checks still agree. */
const emptyGlobals = new GlobalOptionsBuilder<{}>([], () => ({}));

function defaultGlobals<Globals>(globals: GlobalOptions<Globals> | undefined) {
  // The shared value declares no options, so it binds an empty record for any omitted Globals.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return globals ?? (emptyGlobals as GlobalOptions<Globals>);
}

type GlobalOptions<Options = {}> = GlobalOptionsBuilder<Options>;

const GlobalOptions: new () => GlobalOptions = class extends GlobalOptionsBuilder<{}> {
  constructor() {
    super([], () => ({}));
  }
};

export type { BuiltGlobals };
export { defaultGlobals, GlobalOptions };
