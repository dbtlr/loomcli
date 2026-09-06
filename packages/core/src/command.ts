import { DeclarationError, InputError } from './errors.js';
import { compileOptions, parseInputs } from './options.js';
import type { OptionDeclaration, OptionValues } from './options.js';
import type { Action, OptionConfig, OptionValue } from './types.js';

export interface BuiltCommand<Args, Options> {
  name: null;
  arguments: readonly string[];
  action: Action<Args, Options>;
  bind: (tokens: string[]) => Args;
  options: ReturnType<typeof compileOptions>;
  bindOptions: (values: OptionValues) => Options;
}

export class Command<Args, Options> {
  readonly name = null;
  readonly arguments: string[];
  readonly actions: Action<Args, Options>[];
  readonly bind: (tokens: string[]) => Args;

  readonly options: readonly OptionDeclaration[];
  readonly bindOptions: (values: OptionValues) => Options;

  constructor(declaration: {
    arguments: string[];
    actions: Action<Args, Options>[];
    bind: (tokens: string[]) => Args;
    options: readonly OptionDeclaration[];
    bindOptions: (values: OptionValues) => Options;
  }) {
    this.arguments = declaration.arguments;
    this.actions = declaration.actions;
    this.bind = declaration.bind;
    this.options = declaration.options;
    this.bindOptions = declaration.bindOptions;
  }

  argument<const Name extends string>(name: Name): Command<Args & Record<Name, string[]>, Options> {
    return new Command({
      actions: [...this.actions],
      arguments: [...this.arguments, name],
      bind: (tokens) => {
        // The computed property contains exactly the declared key and validated string values.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const value = { [name]: tokens } as Record<Name, string[]>;
        return { ...this.bind(tokens), ...value };
      },
      bindOptions: this.bindOptions,
      options: this.options,
    });
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config,
  ): Command<Args, Options & Record<Name, OptionValue<Config>>> {
    const snapshot = { ...config };
    return new Command({
      actions: [...this.actions],
      arguments: this.arguments,
      bind: this.bind,
      bindOptions: (values) => {
        const rawValue =
          snapshot.type === 'string'
            ? values.strings.get(name)
            : (values.booleans.get(name) ?? snapshot.polarity === 'negative');
        // The discriminator selects the parsed value type; the computed key is exactly Name.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const value = { [name]: rawValue } as Record<Name, OptionValue<Config>>;
        return { ...this.bindOptions(values), ...value };
      },
      options: [...this.options, { config: snapshot, name }],
    });
  }

  build(): BuiltCommand<Args, Options> {
    const seen = new Set<string>();
    for (const name of this.arguments) {
      if (seen.has(name)) {
        throw new DeclarationError(
          `Argument "${name}" is declared more than once on the root Command. Remove or rename the duplicate.`,
        );
      }
      seen.add(name);
    }
    if (this.arguments.length > 1) {
      throw new DeclarationError(
        `Arguments ${this.arguments.map((name) => `"${name}"`).join(', ')} compete for variadic values on the root Command. Keep one variadic argument.`,
      );
    }
    if (this.actions.length > 1) {
      throw new DeclarationError('The root Command has multiple actions. Register one action.');
    }
    const action = this.actions[0];
    if (!action) {
      throw new DeclarationError('The root Command has no action. Register an action.');
    }
    return {
      action,
      arguments: [...this.arguments],
      bind: this.bind,
      bindOptions: this.bindOptions,
      name: this.name,
      options: compileOptions(this.options),
    };
  }
}

export function route<Args, Options>(root: BuiltCommand<Args, Options>, tokens: string[]) {
  return { command: root, tokens };
}

export function validateInputs<Args, Options>(
  command: BuiltCommand<Args, Options>,
  tokens: string[],
) {
  const parsed = parseInputs(command.options, tokens);
  const name = command.arguments[0];
  if (name !== undefined && parsed.positionals.length === 0) {
    throw new InputError(
      `Argument "${name}" requires at least one value. Supply a value for "${name}".`,
    );
  }
  if (name === undefined && parsed.positionals.length !== 0) {
    throw new InputError('The root Command accepts no arguments. Remove the supplied values.');
  }
  return {
    args: command.bind(parsed.positionals),
    options: command.bindOptions(parsed.options),
    passthrough: parsed.passthrough,
  };
}
