import { DeclarationError, validationContext } from '@loomcli/core';
import type { StandardJSONSchemaV1, StandardSchemaV1, ValidationContext } from '@loomcli/core';

import { copyRecord, isPlainObject } from './data.js';
import { fault } from './faults.js';
import { contextOutsideRun, inputSchema, validatorDefinition } from './rules.js';

/** What `parse` returns: `{ value }` for an accepted token or `{ issues }` for a rejected one. */
type ParseResult<Output> = StandardSchemaV1.Result<Output>;

/** A validator that publishes its input schema, as every catalog factory returns. */
type Validator<Output> = StandardSchemaV1<string, Output> & StandardJSONSchemaV1<string, Output>;

/** The author's definition of one validator. */
interface ValidatorDefinition<Output> {
  parse: (
    raw: string,
    context: ValidationContext,
  ) => ParseResult<Output> | Promise<ParseResult<Output>>;
  inputSchema?: Readonly<Record<string, unknown>>;
}

/** The vendor every Standard Schema value this package builds reports. */
const vendor = '@loomcli/validators';

const target = 'draft-2020-12';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

/** A read of the context outside a run, which no declaration call stands for. */
function unavailable(): never {
  throw new DeclarationError(contextOutsideRun, {
    correction: 'Call the validator through an Application run, or leave the context unread.',
    sentence: 'This validator reads the validation context, which only exists during a Loom run.',
  });
}

/**
 * The context `parse` receives when core did not make the call.
 * Every field throws at the read, so only a validator that reads the context fails.
 */
const outsideRun: ValidationContext = Object.freeze({
  get command(): never {
    return unavailable();
  },
  get host(): never {
    return unavailable();
  },
  get input(): never {
    return unavailable();
  },
  get passthrough(): never {
    return unavailable();
  },
  get phase(): never {
    return unavailable();
  },
  get supplied(): never {
    return unavailable();
  },
});

/** The converter that publishes a frozen input schema for draft 2020-12 and nothing else. */
function converter(schema: Readonly<Record<string, unknown>>): StandardJSONSchemaV1.Converter {
  return Object.freeze({
    input: (options: StandardJSONSchemaV1.Options) => {
      if (options.target !== target) {
        throw new Error(
          `This validator publishes JSON Schema for ${target} only, not ${options.target}.`,
        );
      }
      return { $schema: dialect, ...copyRecord(schema, false) };
    },
    output: () => {
      throw new Error('This validator publishes no output schema.');
    },
  });
}

/**
 * Checks a definition that bypassed the types, and returns its input schema copied and frozen, or
 * undefined when it declares none.
 */
function checkDefinition(definition: unknown) {
  const at = (mark: string) => ({ arguments: [definition], factory: 'createValidator', mark });
  if (!isPlainObject(definition)) {
    throw fault(validatorDefinition, at('0'), {
      correction: 'Supply an object with a parse function.',
      sentence: 'createValidator() definition is not a plain object.',
    });
  }
  if (typeof definition.parse !== 'function') {
    throw fault(validatorDefinition, at('parse' in definition ? '0.parse' : '0'), {
      correction: 'Supply a function that validates one raw string.',
      sentence: 'createValidator() parse is not a function.',
    });
  }
  return declaredSchema(definition.inputSchema, at);
}

/**
 * The declared input schema, checked, copied, and frozen, or undefined when none is declared. `at`
 * rebuilds the `createValidator()` call, marking the part at fault.
 */
function declaredSchema(
  declared: unknown,
  at: (mark: string) => { factory: string; arguments: readonly unknown[]; mark: string },
) {
  if (declared === undefined) {
    return undefined;
  }
  if (!isPlainObject(declared)) {
    throw fault(inputSchema, at('0.inputSchema'), {
      correction: 'Supply the JSON Schema as a plain object.',
      sentence: 'createValidator() inputSchema is not a plain object.',
    });
  }
  if (Object.hasOwn(declared, '$schema')) {
    throw fault(inputSchema, at('0.inputSchema.$schema'), {
      correction: 'Leave out $schema, which the validator publishes itself.',
      sentence: 'createValidator() inputSchema declares its own $schema.',
    });
  }
  return copyRecord(declared, true);
}

/**
 * Builds a frozen Standard Schema value from the author's parse function.
 * With an input schema it also publishes that schema through Standard JSON Schema.
 */
function createValidator<Output>(
  definition: ValidatorDefinition<Output> & { inputSchema: Readonly<Record<string, unknown>> },
): Validator<Output>;
function createValidator<Output>(
  definition: ValidatorDefinition<Output>,
): StandardSchemaV1<string, Output>;
function createValidator<Output>(
  definition: ValidatorDefinition<Output>,
): StandardSchemaV1<string, Output> {
  const schema = checkDefinition(definition);
  const { parse } = definition;
  const props: StandardSchemaV1.Props<string, Output> = {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      if (typeof value !== 'string') {
        throw new TypeError(
          `A validator reads one raw string, and received a value of type ${typeof value}.`,
        );
      }
      return parse(value, validationContext(options) ?? outsideRun);
    },
    vendor,
    version: 1,
  };
  if (schema === undefined) {
    return Object.freeze({ '~standard': Object.freeze(props) });
  }
  return Object.freeze({ '~standard': Object.freeze({ ...props, jsonSchema: converter(schema) }) });
}

export { createValidator, vendor };
export type { ParseResult, Validator, ValidatorDefinition };
