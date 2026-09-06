import type { StandardSchemaV1 } from '@standard-schema/spec';

import { DeclarationError, InputError } from './errors.js';
import type { OptionValues } from './options.js';
import type { ArgumentConfig, OptionConfig } from './types.js';

/** Phantom key. It records the value type a declaration produces and holds no runtime value. */
declare const declaredValue: unique symbol;

/**
 * One declared input. `Name` is its literal name and `Value` the type validation produces for it.
 * Both are fixed where the declaration is authored, so a validated value can take its declared type
 * in exactly one place: `ValidatedInputs.field()`. Untyped readers use the defaults.
 */
export interface ArgumentInput<Name extends string = string, Value = unknown> {
  readonly [declaredValue]?: Value;
  kind: 'argument';
  name: Name;
  config: ArgumentConfig;
}
export interface OptionInput<Name extends string = string, Value = unknown> {
  readonly [declaredValue]?: Value;
  kind: 'option';
  name: Name;
  config: OptionConfig;
}
export type InputDeclaration<Name extends string = string, Value = unknown> =
  | ArgumentInput<Name, Value>
  | OptionInput<Name, Value>;

/** Validated defaults, read before any token is parsed. Values stay `unknown` here. */
export type DefaultValues = ReadonlyMap<InputDeclaration, unknown>;

/**
 * The validated values of one invocation, keyed by declaration. `field()` is the only place where a
 * validated value takes its declared type, so every binder reads through it and none asserts alone.
 */
export class ValidatedInputs {
  readonly #values: ReadonlyMap<InputDeclaration, unknown>;

  constructor(values: ReadonlyMap<InputDeclaration, unknown>) {
    this.#values = values;
  }

  /** The one-key record this declaration contributes to an args or options object. */
  field<Name extends string, Value>(input: InputDeclaration<Name, Value>): Record<Name, Value> {
    // Last resort: no typed path exists. The map stores every validated value as `unknown`.
    // An object literal with a generic computed key types as a string index, not `Record<Name, _>`.
    // Neither the value nor the key can reach `Record<Name, Value>` without this assertion.
    // It holds because validation stores the declared output under this exact declaration.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { [input.name]: this.#values.get(input) } as Record<Name, Value>;
  }
}

function identity(input: InputDeclaration) {
  return input.kind === 'argument' ? `Argument "${input.name}"` : `Option "--${input.name}"`;
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
  if (
    input.kind === 'argument' &&
    (!input.config.required ||
      (input.config.variadic !== undefined && typeof input.config.variadic !== 'boolean'))
  ) {
    throw new DeclarationError(
      `${identity(input)} must declare required: true, with variadic true, false, or absent.`,
    );
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
    if (input.config.validate === undefined && typeof input.config.default !== 'string') {
      throw new DeclarationError(
        `${identity(input)} default must be a string without a schema. Supply a string default.`,
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
      const raw =
        input.kind === 'argument'
          ? supplied.args.get(input)
          : supplied.options.strings.get(input.name);
      if (raw === undefined) {
        if (input.config.required) {
          issues.push(`${identity(input)} is required. Supply a value.`);
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
