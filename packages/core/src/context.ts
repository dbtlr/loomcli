import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { ValidationContext } from './types.js';

/** The `libraryOptions` key core writes its context under. It names the package that owns it. */
const validationContextKey = '@loomcli/core';

/**
 * Every context core has emitted. The accessor answers from this registry alone, so a value some
 * other caller wrote under the same key reads as no context, and the reading needs no assertion.
 */
const emitted = new WeakMap<object, ValidationContext>();

/** The options of one schema call, with its context registered for the accessor to recognize. */
function schemaOptions(context: ValidationContext): StandardSchemaV1.Options {
  emitted.set(context, context);
  return { libraryOptions: { [validationContextKey]: context } };
}

/** Reads the context core attached to a schema call, or undefined when another caller ran it. */
function validationContext(
  options: StandardSchemaV1.Options | undefined,
): ValidationContext | undefined {
  const carried: unknown = options?.libraryOptions?.[validationContextKey];
  return carried !== null && typeof carried === 'object' ? emitted.get(carried) : undefined;
}

export { schemaOptions, validationContext, validationContextKey };
