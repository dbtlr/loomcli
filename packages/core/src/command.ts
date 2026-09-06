import { DeclarationError, InputError } from './errors.js';
import type { Action } from './types.js';

export interface BuiltCommand<Args> {
  name: null;
  arguments: readonly string[];
  action: Action<Args>;
  bind: (tokens: string[]) => Args;
}

export class Command<Args> {
  readonly name = null;
  readonly arguments: string[];
  readonly actions: Action<Args>[];
  readonly bind: (tokens: string[]) => Args;

  constructor(arguments_: string[], actions: Action<Args>[], bind: (tokens: string[]) => Args) {
    this.arguments = arguments_;
    this.actions = actions;
    this.bind = bind;
  }

  argument<const Name extends string>(name: Name): Command<Args & Record<Name, string[]>> {
    return new Command([...this.arguments, name], [...this.actions], (tokens) => {
      // The computed property contains exactly the declared key and validated string values.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const value = { [name]: tokens } as Record<Name, string[]>;
      return { ...this.bind(tokens), ...value };
    });
  }

  build(): BuiltCommand<Args> {
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
    return { action, arguments: [...this.arguments], bind: this.bind, name: this.name };
  }
}

export function route<Args>(root: BuiltCommand<Args>, tokens: string[]) {
  const unsupported = tokens.find((token) => token.startsWith('-'));
  if (unsupported !== undefined) {
    throw new InputError(
      `Unsupported token "${unsupported}". Supply a positional value; prefix a hyphenated path with "./".`,
    );
  }
  return { command: root, tokens };
}

export function validateInputs<Args>(command: BuiltCommand<Args>, tokens: string[]): Args {
  const name = command.arguments[0];
  if (name !== undefined && tokens.length === 0) {
    throw new InputError(
      `Argument "${name}" requires at least one value. Supply a value for "${name}".`,
    );
  }
  if (name === undefined && tokens.length !== 0) {
    throw new InputError('The root Command accepts no arguments. Remove the supplied values.');
  }
  return command.bind(tokens);
}
