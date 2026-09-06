import type { StandardSchemaV1 } from '@standard-schema/spec';

import { DeclarationError, InputError } from './errors.js';
import type { OptionDeclaration, OptionValues } from './options.js';
import type { ArgumentConfig } from './types.js';

export type InputDeclaration =
  | { kind: 'argument'; name: string; config: ArgumentConfig }
  | ({ kind: 'option' } & OptionDeclaration);
export type ValidatedInputs = ReadonlyMap<InputDeclaration, unknown>;

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
    (!input.config.required || typeof input.config.variadic !== 'boolean' || !input.config.variadic)
  ) {
    throw new DeclarationError(
      `${identity(input)} must declare required: true and variadic: true.`,
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

async function validate(
  input: InputDeclaration,
  raw: unknown,
): Promise<StandardSchemaV1.Result<unknown>> {
  const schema = input.config.validate;
  if (schema === undefined) {
    return { value: raw };
  }
  try {
    const result = await schema['~standard'].validate(raw);
    if (
      result === null ||
      typeof result !== 'object' ||
      (result.issues === undefined ? !('value' in result) : !Array.isArray(result.issues))
    ) {
      throw new Error('The validator returned an invalid Standard Schema result.');
    }
    return result;
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

export async function prepareInputs(inputs: readonly InputDeclaration[]): Promise<ValidatedInputs> {
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
  parsed: { positionals: string[]; options: OptionValues },
  defaults: ValidatedInputs,
): Promise<ValidatedInputs> {
  const values = new Map<InputDeclaration, unknown>();
  const issues: string[] = [];
  for (const input of inputs) {
    if (input.kind === 'option' && input.config.type === 'boolean') {
      values.set(
        input,
        parsed.options.booleans.get(input.name) ?? input.config.polarity === 'negative',
      );
    } else {
      const raw =
        input.kind === 'argument' ? parsed.positionals : parsed.options.strings.get(input.name);
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
  return values;
}
