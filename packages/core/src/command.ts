import { DeclarationError, InputError } from './errors.js';
import { compileOptions, parseInputs } from './options.js';
import type { Action, ArgumentConfig, ArgumentValue, OptionConfig, OptionValue } from './types.js';
import { validateValues } from './validation.js';
import type { InputDeclaration, ValidatedInputs } from './validation.js';

export interface BuiltCommand<Args, Options> {
  name: null;
  arguments: readonly string[];
  inputs: readonly InputDeclaration[];
  action: Action<Args, Options>;
  bind: (values: ValidatedInputs) => { args: Args; options: Options };
  options: ReturnType<typeof compileOptions>;
}

export class Command<Args, Options> {
  readonly name = null;
  constructor(
    readonly inputs: readonly InputDeclaration[],
    readonly actions: Action<Args, Options>[],
    readonly bind: (values: ValidatedInputs) => { args: Args; options: Options },
  ) {}

  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config,
  ): Command<Args & Record<Name, ArgumentValue<Config>>, Options> {
    const input: InputDeclaration = { config: { ...config }, kind: 'argument', name };
    return new Command([...this.inputs, input], [...this.actions], (values) => {
      const previous = this.bind(values);
      // Validation supplies the schema output, and the computed key is exactly Name.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const value = { [name]: values.get(input) } as Record<Name, ArgumentValue<Config>>;
      return { ...previous, args: { ...previous.args, ...value } };
    });
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config,
  ): Command<Args, Options & Record<Name, OptionValue<Config>>> {
    const input: InputDeclaration = { config: { ...config }, kind: 'option', name };
    return new Command([...this.inputs, input], [...this.actions], (values) => {
      const previous = this.bind(values);
      // Validation supplies the declared output, and the computed key is exactly Name.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const value = { [name]: values.get(input) } as Record<Name, OptionValue<Config>>;
      return { ...previous, options: { ...previous.options, ...value } };
    });
  }

  build(): BuiltCommand<Args, Options> {
    const argumentNames = this.inputs
      .filter((input) => input.kind === 'argument')
      .map((input) => input.name);
    const options = this.inputs.filter((input) => input.kind === 'option');
    const seen = new Set<string>();
    for (const name of argumentNames) {
      if (seen.has(name)) {
        throw new DeclarationError(
          `Argument "${name}" is declared more than once on the root Command. Remove or rename the duplicate.`,
        );
      }
      seen.add(name);
    }
    if (argumentNames.length > 1) {
      throw new DeclarationError(
        `Arguments ${argumentNames.map((name) => `"${name}"`).join(', ')} compete for variadic values on the root Command. Keep one variadic argument.`,
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
      arguments: argumentNames,
      bind: this.bind,
      inputs: this.inputs,
      name: this.name,
      options: compileOptions(options),
    };
  }
}

export function route<Args, Options>(root: BuiltCommand<Args, Options>, tokens: string[]) {
  return { command: root, tokens };
}

export async function validateInputs<Args, Options>(
  command: BuiltCommand<Args, Options>,
  tokens: string[],
  defaults: ValidatedInputs,
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
    ...command.bind(await validateValues(command.inputs, parsed, defaults)),
    passthrough: parsed.passthrough,
  };
}
