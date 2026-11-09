import { validationContext } from '@loomcli/core';
import type { StandardJSONSchemaV1, StandardSchemaV1, ValidationContext } from '@loomcli/core';

import { noOutputSchema, outsideRun, vendor } from './create.js';
import type { AcceptedOutput, ParseReturn } from './create.js';

/** What a stage answers: a result, directly or as a promise, as `createValidator`'s `parse` does. */
type StageAnswer<Output> = ParseReturn<Output>;

/** A parse function step: the previous stage's output and the validation context in, a result out. */
type StepFunction<Previous> = (value: Previous, context: ValidationContext) => StageAnswer<unknown>;

/** What a step may be before its fit is checked: any Standard Schema value or a parse function. */
type Step<Previous> = StandardSchemaV1 | StepFunction<Previous>;

/** The output a stage hands the next one: a schema's output type, or a function's accepted value. */
type StageOutput<Stage> = Stage extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Stage>
  : Stage extends (...parameters: never[]) => infer Answer
    ? AcceptedOutput<Awaited<Answer>>
    : never;

/**
 * A step checked against the output before it. A schema step fits when that output is assignable to
 * its input type; Standard Schema's input type is covariant, so the schema value's own
 * assignability would let a narrower step through. An `unknown` output is not checked, because
 * TypeScript reads a step before a parse function's output is inferred as `unknown`, and checking
 * it then would reject every schema step after a parse function.
 */
type Fitted<Stage, Previous> = Stage extends StandardSchemaV1
  ? unknown extends Previous
    ? Stage
    : [Previous] extends [StandardSchemaV1.InferInput<Stage>]
      ? Stage
      : { readonly 'A schema step must accept the previous output': Previous }
  : Stage;

/** The value `pipe` returns: first's input type, the output given, and first's converter if any. */
type Piped<First extends StandardSchemaV1, Output> = First extends StandardJSONSchemaV1
  ? StandardSchemaV1<StandardSchemaV1.InferInput<First>, Output> &
      StandardJSONSchemaV1<StandardSchemaV1.InferInput<First>, Output>
  : StandardSchemaV1<StandardSchemaV1.InferInput<First>, Output>;

/** The output type of `first`, which the first step reads. */
type FirstOutput<First extends StandardSchemaV1> = StandardSchemaV1.InferOutput<First>;

/** Whether a stage is a Standard Schema value. A schema library's value may itself be callable. */
function isSchema(stage: StandardSchemaV1 | StepFunction<unknown>): stage is StandardSchemaV1 {
  return '~standard' in stage;
}

/**
 * Whether a validator declares the Standard JSON Schema converter, both sides, beside `validate`.
 * It reads a converter as core's graph build does, so a pipe publishes exactly when core would read
 * `first`'s schema.
 */
function publishesSchema(
  schema: StandardSchemaV1,
): schema is StandardSchemaV1 & StandardJSONSchemaV1 {
  const props: object = schema['~standard'];
  return (
    'jsonSchema' in props &&
    typeof props.jsonSchema === 'object' &&
    props.jsonSchema !== null &&
    'input' in props.jsonSchema &&
    typeof props.jsonSchema.input === 'function' &&
    'output' in props.jsonSchema &&
    typeof props.jsonSchema.output === 'function'
  );
}

/** The converter a pipe publishes: first's input side for the same options, and no output side. */
function converterOf(
  first: StandardSchemaV1 & StandardJSONSchemaV1,
): StandardJSONSchemaV1.Converter {
  return {
    input: (options: StandardJSONSchemaV1.Options) => first['~standard'].jsonSchema.input(options),
    output: noOutputSchema,
  };
}

/**
 * Runs `first` and then each step on the value the stage before it accepted. A function step's
 * value is typed from the output before it, and a schema step must accept that output.
 *
 * @example
 * ```ts
 * const pairs = pipe(integer({ min: 2 }), (count) =>
 *   count % 2 === 0 ? { value: count } : { issues: [{ message: 'Expected an even number.' }] },
 * );
 * ```
 * @public
 */
function pipe<First extends StandardSchemaV1, S1 extends Step<FirstOutput<First>>>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
): Piped<First, StageOutput<S1>>;
function pipe<
  First extends StandardSchemaV1,
  S1 extends Step<FirstOutput<First>>,
  S2 extends Step<StageOutput<S1>>,
>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
  s2: Fitted<S2, StageOutput<S1>>,
): Piped<First, StageOutput<S2>>;
function pipe<
  First extends StandardSchemaV1,
  S1 extends Step<FirstOutput<First>>,
  S2 extends Step<StageOutput<S1>>,
  S3 extends Step<StageOutput<S2>>,
>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
  s2: Fitted<S2, StageOutput<S1>>,
  s3: Fitted<S3, StageOutput<S2>>,
): Piped<First, StageOutput<S3>>;
function pipe<
  First extends StandardSchemaV1,
  S1 extends Step<FirstOutput<First>>,
  S2 extends Step<StageOutput<S1>>,
  S3 extends Step<StageOutput<S2>>,
  S4 extends Step<StageOutput<S3>>,
>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
  s2: Fitted<S2, StageOutput<S1>>,
  s3: Fitted<S3, StageOutput<S2>>,
  s4: Fitted<S4, StageOutput<S3>>,
): Piped<First, StageOutput<S4>>;
function pipe<
  First extends StandardSchemaV1,
  S1 extends Step<FirstOutput<First>>,
  S2 extends Step<StageOutput<S1>>,
  S3 extends Step<StageOutput<S2>>,
  S4 extends Step<StageOutput<S3>>,
  S5 extends Step<StageOutput<S4>>,
>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
  s2: Fitted<S2, StageOutput<S1>>,
  s3: Fitted<S3, StageOutput<S2>>,
  s4: Fitted<S4, StageOutput<S3>>,
  s5: Fitted<S5, StageOutput<S4>>,
): Piped<First, StageOutput<S5>>;
function pipe<
  First extends StandardSchemaV1,
  S1 extends Step<FirstOutput<First>>,
  S2 extends Step<StageOutput<S1>>,
  S3 extends Step<StageOutput<S2>>,
  S4 extends Step<StageOutput<S3>>,
  S5 extends Step<StageOutput<S4>>,
  S6 extends Step<StageOutput<S5>>,
>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
  s2: Fitted<S2, StageOutput<S1>>,
  s3: Fitted<S3, StageOutput<S2>>,
  s4: Fitted<S4, StageOutput<S3>>,
  s5: Fitted<S5, StageOutput<S4>>,
  s6: Fitted<S6, StageOutput<S5>>,
): Piped<First, StageOutput<S6>>;
function pipe<
  First extends StandardSchemaV1,
  S1 extends Step<FirstOutput<First>>,
  S2 extends Step<StageOutput<S1>>,
  S3 extends Step<StageOutput<S2>>,
  S4 extends Step<StageOutput<S3>>,
  S5 extends Step<StageOutput<S4>>,
  S6 extends Step<StageOutput<S5>>,
  S7 extends Step<StageOutput<S6>>,
>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
  s2: Fitted<S2, StageOutput<S1>>,
  s3: Fitted<S3, StageOutput<S2>>,
  s4: Fitted<S4, StageOutput<S3>>,
  s5: Fitted<S5, StageOutput<S4>>,
  s6: Fitted<S6, StageOutput<S5>>,
  s7: Fitted<S7, StageOutput<S6>>,
): Piped<First, StageOutput<S7>>;
function pipe<
  First extends StandardSchemaV1,
  S1 extends Step<FirstOutput<First>>,
  S2 extends Step<StageOutput<S1>>,
  S3 extends Step<StageOutput<S2>>,
  S4 extends Step<StageOutput<S3>>,
  S5 extends Step<StageOutput<S4>>,
  S6 extends Step<StageOutput<S5>>,
  S7 extends Step<StageOutput<S6>>,
  S8 extends Step<StageOutput<S7>>,
>(
  first: First,
  s1: Fitted<S1, FirstOutput<First>>,
  s2: Fitted<S2, StageOutput<S1>>,
  s3: Fitted<S3, StageOutput<S2>>,
  s4: Fitted<S4, StageOutput<S3>>,
  s5: Fitted<S5, StageOutput<S4>>,
  s6: Fitted<S6, StageOutput<S5>>,
  s7: Fitted<S7, StageOutput<S6>>,
  s8: Fitted<S8, StageOutput<S7>>,
): Piped<First, StageOutput<S8>>;
function pipe(
  first: StandardSchemaV1,
  ...steps: readonly (StandardSchemaV1 | StepFunction<unknown>)[]
): StandardSchemaV1 {
  /**
   * Runs each stage `remaining` still yields, each on the value the one before it accepted, and
   * stops at the first rejection. A promise answer resumes the same iterator once it settles. A step
   * that bypasses the types, such as `undefined`, meets the platform's own error at its call.
   */
  const run = (
    remaining: Iterator<StandardSchemaV1 | StepFunction<unknown>>,
    value: unknown,
    options: StandardSchemaV1.Options | undefined,
  ): StageAnswer<unknown> => {
    let current = value;
    for (let next = remaining.next(); next.done !== true; next = remaining.next()) {
      const stage = next.value;
      const answer = isSchema(stage)
        ? stage['~standard'].validate(current, options)
        : stage(current, validationContext(options) ?? outsideRun);
      // A promise from another realm or library is a promise too, as core's own await reads it.
      if ('then' in answer) {
        return answer.then((result) =>
          result.issues === undefined ? run(remaining, result.value, options) : result,
        );
      }
      if (answer.issues !== undefined) {
        return answer;
      }
      current = answer.value;
    }
    return { value: current };
  };

  const props: StandardSchemaV1.Props = {
    validate: (value: unknown, options?: StandardSchemaV1.Options) =>
      run([first, ...steps].values(), value, options),
    vendor,
    version: 1,
  };
  if (!publishesSchema(first)) {
    return { '~standard': props };
  }
  const published = { ...props, jsonSchema: converterOf(first) };
  return { '~standard': published };
}

export { pipe };
