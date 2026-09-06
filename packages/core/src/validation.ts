import type { StandardSchemaV1 } from '@standard-schema/spec';

import { DeclarationError, InputError } from './errors.js';
import type { OptionValues } from './options.js';
import type { ArgumentConfig, ArgumentValue, OptionConfig, OptionValue } from './types.js';

/**
 * One declared input, typed by its literal name and its own config. The value type is derived from
 * the config, never claimed apart from it, so a declaration cannot be written under a value type
 * that its config does not produce. Untyped readers use the defaults.
 */
export interface ArgumentInput<
  Name extends string = string,
  Config extends ArgumentConfig = ArgumentConfig,
> {
  readonly kind: 'argument';
  readonly name: Name;
  readonly config: Config;
}
export interface OptionInput<
  Name extends string = string,
  Config extends OptionConfig = OptionConfig,
> {
  readonly kind: 'option';
  readonly name: Name;
  readonly config: Config;
}
export type InputDeclaration<Name extends string = string> =
  | ArgumentInput<Name>
  | OptionInput<Name>;

/** Validated defaults, read before any token is parsed. Values stay `unknown` here. */
export type DefaultValues = ReadonlyMap<InputDeclaration, unknown>;

/**
 * The validated values of one invocation, keyed by declaration. Only `validateValues` constructs
 * one, and its two readers are the only places where a validated value takes its declared type, so
 * every binder reads through them and none asserts on its own.
 */
class ValidatedInputs {
  readonly #values: ReadonlyMap<InputDeclaration, unknown>;

  constructor(values: ReadonlyMap<InputDeclaration, unknown>) {
    this.#values = values;
  }

  /** The one-key record this argument contributes to `args`, typed by its own config. */
  argument<Name extends string, Config extends ArgumentConfig>(
    input: ArgumentInput<Name, Config>,
  ): Record<Name, ArgumentValue<Config>> {
    return this.#field(input);
  }

  /** The one-key record this option contributes to `options`, typed by its own config. */
  option<Name extends string, Config extends OptionConfig>(
    input: OptionInput<Name, Config>,
  ): Record<Name, OptionValue<Config>> {
    return this.#field(input);
  }

  #field<Name extends string, Value>(input: InputDeclaration<Name>): Record<Name, Value> {
    // Last resort: no typed path exists. The map stores every validated value as `unknown`.
    // An object literal with a generic computed key does not type as `Record<Name, _>` either.
    // So neither the value nor the key can reach `Record<Name, Value>` without this assertion.
    // It holds because validation stores the output the config declares under this declaration.
    // The two callers above derive `Value` from that same config.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { [input.name]: this.#values.get(input) } as Record<Name, Value>;
  }
}
export type { ValidatedInputs };

function identity(input: InputDeclaration) {
  return input.kind === 'argument' ? `Argument "${input.name}"` : `Option "--${input.name}"`;
}

/** A multiple option collects its occurrences, so its raw value is the whole `string[]`. */
function collects(input: InputDeclaration) {
  return input.kind === 'option' && input.config.multiple === true;
}

/** One accessor for a supplied option value, so the collected and single shapes read alike. */
function suppliedOption(options: OptionValues, name: string, collected: boolean) {
  return collected ? options.lists.get(name) : options.strings.get(name);
}

/** Without a schema the raw shape is the declared default's only contract. */
function holdsRawDefault(input: InputDeclaration) {
  const value = input.config.default;
  return collects(input)
    ? Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
    : typeof value === 'string';
}

function checkDeclaration(input: InputDeclaration) {
  const { config } = input;
  if (input.kind === 'option' && input.config.type === 'boolean') {
    if ('validate' in config || 'default' in config || 'required' in config) {
      throw new DeclarationError(
        `${identity(input)} is Boolean. Remove validate, default, and required; use polarity to control its absent value.`,
      );
    }
    return;
  }
  if (config.required !== undefined && typeof config.required !== 'boolean') {
    throw new DeclarationError(`${identity(input)} required must be Boolean. Use true or false.`);
  }
  if (input.kind === 'argument') {
    if (input.config.variadic !== undefined && typeof input.config.variadic !== 'boolean') {
      throw new DeclarationError(`${identity(input)} variadic must be Boolean. Use true or false.`);
    }
    if (input.config.variadic === true && !input.config.required) {
      throw new DeclarationError(
        `${identity(input)} is variadic and optional. Declare required: true or remove variadic.`,
      );
    }
  }
  if (config.required && Object.hasOwn(config, 'default')) {
    throw new DeclarationError(
      `${identity(input)} is required and declares a default. Remove the default or make the input optional.`,
    );
  }
  const schema = config.validate;
  if (
    schema !== undefined &&
    (schema === null ||
      (typeof schema !== 'object' && typeof schema !== 'function') ||
      !schema['~standard'] ||
      schema['~standard'].version !== 1 ||
      typeof schema['~standard'].vendor !== 'string' ||
      typeof schema['~standard'].validate !== 'function')
  ) {
    throw new DeclarationError(
      `${identity(input)} validate must be a Standard Schema v1 object. Supply a compatible schema.`,
    );
  }
}

function readIssue(issue: unknown): StandardSchemaV1.Issue {
  if (issue === null || typeof issue !== 'object' || !('message' in issue)) {
    throw new Error('The validator returned an invalid Standard Schema issue.');
  }
  const message = issue.message;
  if (typeof message !== 'string') {
    throw new Error('The validator returned an invalid Standard Schema issue message.');
  }
  const suppliedPath = 'path' in issue ? issue.path : undefined;
  if (suppliedPath === undefined) {
    return { message };
  }
  if (!Array.isArray(suppliedPath)) {
    throw new Error('The validator returned an invalid Standard Schema issue path.');
  }
  const path = Array.from(suppliedPath, (segment: unknown) => {
    const key =
      segment !== null && typeof segment === 'object' && 'key' in segment ? segment.key : segment;
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
      throw new Error('The validator returned an invalid Standard Schema path key.');
    }
    return key;
  });
  return { message, path };
}

async function validate(
  input: InputDeclaration,
  raw: unknown,
): Promise<StandardSchemaV1.Result<unknown>> {
  const schema = input.config.validate;
  if (schema === undefined) {
    return { value: raw };
  }
  try {
    const result: unknown = await schema['~standard'].validate(raw);
    if (result === null || typeof result !== 'object') {
      throw new Error('The validator returned an invalid Standard Schema result.');
    }
    const issues = 'issues' in result ? result.issues : undefined;
    if (issues === undefined && 'value' in result) {
      return { value: result.value };
    }
    if (!Array.isArray(issues)) {
      throw new Error('The validator returned an invalid Standard Schema result.');
    }
    return { issues: Array.from(issues, readIssue) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown validator failure.';
    throw new DeclarationError(
      `${identity(input)} validator failed unexpectedly: ${reason} Fix the validator.`,
    );
  }
}

function messages(input: InputDeclaration, issues: readonly StandardSchemaV1.Issue[]) {
  return (
    issues.length === 0
      ? [{ message: 'The schema rejected this value without an explanation.' }]
      : issues
  ).map((issue) => {
    const path = issue.path
      ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.');
    return `${identity(input)}${path ? ` at ${path}` : ''}: ${issue.message}`;
  });
}

export async function prepareInputs(inputs: readonly InputDeclaration[]): Promise<DefaultValues> {
  for (const input of inputs) {
    checkDeclaration(input);
  }
  const defaults = new Map<InputDeclaration, unknown>();
  for (const input of inputs.filter((entry) => Object.hasOwn(entry.config, 'default'))) {
    if (input.config.validate === undefined && !holdsRawDefault(input)) {
      throw new DeclarationError(
        collects(input)
          ? `${identity(input)} default must be an array of strings without a schema. Supply a string array default.`
          : `${identity(input)} default must be a string without a schema. Supply a string default.`,
      );
    }
    const result = await validate(input, input.config.default);
    if (result.issues !== undefined) {
      throw new DeclarationError(
        `${identity(input)} has an invalid default. Fix the default or its schema.\n${messages(input, result.issues).join('\n')}`,
      );
    }
    defaults.set(input, result.value);
  }
  return defaults;
}

export async function validateValues(
  inputs: readonly InputDeclaration[],
  supplied: { args: ReadonlyMap<InputDeclaration, string | string[]>; options: OptionValues },
  defaults: DefaultValues,
): Promise<ValidatedInputs> {
  const values = new Map<InputDeclaration, unknown>();
  const issues: string[] = [];
  for (const input of inputs) {
    if (input.kind === 'option' && input.config.type === 'boolean') {
      values.set(
        input,
        supplied.options.booleans.get(input.name) ?? input.config.polarity === 'negative',
      );
    } else {
      const collected = collects(input);
      const raw =
        input.kind === 'argument'
          ? supplied.args.get(input)
          : suppliedOption(supplied.options, input.name, collected);
      if (raw === undefined) {
        if (input.config.required) {
          issues.push(
            collected
              ? `${identity(input)} is required. Supply at least one value.`
              : `${identity(input)} is required. Supply a value.`,
          );
        } else if (collected && !defaults.has(input)) {
          values.set(input, []);
        } else {
          values.set(input, defaults.get(input));
        }
      } else {
        const result = await validate(input, raw);
        if (result.issues !== undefined) {
          issues.push(...messages(input, result.issues));
        } else {
          values.set(input, result.value);
        }
      }
    }
  }
  if (issues.length > 0) {
    throw new InputError(issues.join('\n'));
  }
  return new ValidatedInputs(values);
}
