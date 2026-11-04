import type { StandardSchemaV1 } from '@loomcli/core';

/** A type with `readonly` removed at every depth, so an interface compares to a schema's type. */
type DeepMutable<Type> = Type extends (...args: never[]) => unknown
  ? Type
  : Type extends object
    ? { -readonly [Key in keyof Type]: DeepMutable<Type[Key]> }
    : Type;

/** Whether each type is assignable to the other, which with optional keys and unions pins both. */
type Identical<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

/**
 * The parameter's second half: it accepts a schema only when the schema's input and output are the
 * given ones, ignoring `readonly`, and it makes the call a type error otherwise.
 */
type MatchesExactly<Schema extends StandardSchemaV1, Input, Output> =
  Identical<DeepMutable<StandardSchemaV1.InferInput<Schema>>, DeepMutable<Input>> extends true
    ? Identical<DeepMutable<StandardSchemaV1.InferOutput<Schema>>, DeepMutable<Output>> extends true
      ? unknown
      : never
    : never;

/**
 * Types a schema as the facts interface it implements, and fails the build when the schema's input
 * or output is wider or narrower than the interface. An annotation alone accepts a narrower schema,
 * so a widened interface would pass it. Call it with the interface's types, then with the schema.
 */
export function exactFacts<Input, Output = Input>(): <
  Schema extends StandardSchemaV1<Input, Output>,
>(
  schema: Schema & MatchesExactly<Schema, Input, Output>,
) => StandardSchemaV1<Input, Output> {
  return (schema) => schema;
}
