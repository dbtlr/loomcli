import { DeclarationError, validationContext } from '@loomcli/core';
import type { StandardJSONSchemaV1, StandardSchemaV1, ValidationContext } from '@loomcli/core';

import { fault } from './faults.js';
import { contextOutsideRun, inputSchema } from './rules.js';

/** What `parse` returns: `{ value }` for an accepted token or `{ issues }` for a rejected one. */
type ParseResult<Output> = StandardSchemaV1.Result<Output>;

/** A validator that publishes its input schema, as every catalog factory returns. */
type Validator<Output> = StandardSchemaV1<string, Output> & StandardJSONSchemaV1<string, Output>;

/** What `parse` may return: a result, directly or as a promise. */
type ParseReturn<Output> = ParseResult<Output> | Promise<ParseResult<Output>>;

/**
 * The output a parse result accepts: the `value` of every branch that is not `{ issues }`.
 * Without `exactOptionalPropertyTypes`, TypeScript gives an `{ issues }` literal returned beside a
 * `{ value }` literal an optional `value` of `undefined`, which this leaves out.
 */
type AcceptedOutput<Result> = Result extends StandardSchemaV1.FailureResult
  ? never
  : Result extends { readonly value: infer Value }
    ? Value
    : never;

/**
 * The author's definition of one validator. `Return` is what `parse` returns, read whole so a
 * branch that answers directly and one that answers through a promise both count, and the output is
 * read from its accepted branches rather than from every branch.
 */
interface ValidatorDefinition<Output, Return extends ParseReturn<Output> = ParseReturn<Output>> {
  parse: (raw: string, context: ValidationContext) => Return;
  inputSchema?: Readonly<Record<string, unknown>>;
}

/** The vendor every Standard Schema value this package builds reports. */
const vendor = '@loomcli/validators';

const target = 'draft-2020-12';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

/** A read of the context outside a run, which no declaration call stands for. */
function unavailable(): never {
  throw new DeclarationError(contextOutsideRun, {
    correction:
      'Call the validator through an Application run or with the options validationOptions builds, or leave the context unread.',
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

/**
 * The converter that publishes the input schema for draft 2020-12 and nothing else. Each answer is
 * a new object, so a consumer that changes it changes no other answer.
 */
function converter(schema: Readonly<Record<string, unknown>>): StandardJSONSchemaV1.Converter {
  return {
    input: (options: StandardJSONSchemaV1.Options) => {
      if (options.target !== target) {
        throw new Error(
          `This validator publishes JSON Schema for ${target} only, not ${options.target}.`,
        );
      }
      return { $schema: dialect, ...schema };
    },
    output: () => {
      throw new Error('This validator publishes no output schema.');
    },
  };
}

/** Faults on an input schema that declares its own dialect, which the converter publishes itself. */
function checkSchema(definition: ValidatorDefinition<unknown>): void {
  if (definition.inputSchema !== undefined && Object.hasOwn(definition.inputSchema, '$schema')) {
    throw fault(
      inputSchema,
      { arguments: [definition], factory: 'createValidator', mark: '0.inputSchema.$schema' },
      {
        correction: 'Leave out $schema, which the validator publishes itself.',
        sentence: 'createValidator() inputSchema declares its own $schema.',
      },
    );
  }
}

/**
 * Builds a Standard Schema value from the author's parse function.
 * With an input schema it also publishes that schema through Standard JSON Schema.
 */
function createValidator<Output, Return extends ParseReturn<Output> = ParseReturn<Output>>(
  definition: ValidatorDefinition<Output, Return> & {
    inputSchema: Readonly<Record<string, unknown>>;
  },
): Validator<AcceptedOutput<Awaited<Return>>>;
function createValidator<Output, Return extends ParseReturn<Output> = ParseReturn<Output>>(
  definition: ValidatorDefinition<Output, Return>,
): StandardSchemaV1<string, AcceptedOutput<Awaited<Return>>>;
function createValidator<Output>(
  definition: ValidatorDefinition<Output>,
): StandardSchemaV1<string, Output> {
  checkSchema(definition);
  const { inputSchema: schema, parse } = definition;
  const props: StandardSchemaV1.Props<string, Output> = {
    // Core passes the raw string, which String() returns as it is.
    validate: (value: unknown, options?: StandardSchemaV1.Options) =>
      parse(String(value), validationContext(options) ?? outsideRun),
    vendor,
    version: 1,
  };
  if (schema === undefined) {
    return { '~standard': props };
  }
  const published = { ...props, jsonSchema: converter(schema) };
  return { '~standard': published };
}

export { createValidator, vendor };
export type { ParseResult, Validator, ValidatorDefinition };
