import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { ActionContext, SuppliedInputs, ValidationContext } from './types.js';

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

/** A schema call gets its own raw-input copies, as invocation validators do. */
function copiedSupplied(supplied: SuppliedInputs): SuppliedInputs {
  const args = { ...supplied.args };
  const options = { ...supplied.options };
  for (const [name, value] of Object.entries(args)) {
    if (typeof value === 'object') {
      args[name] = [...value];
    }
  }
  for (const [name, value] of Object.entries(options)) {
    if (typeof value === 'object') {
      options[name] = [...value];
    }
  }
  return { args, options };
}

/** The prompts library uses the same authenticated Standard Schema channel as input validation. */
function questionValidationOptions(
  context: Pick<ActionContext<unknown>, 'host' | 'command' | 'passthrough' | 'supplied'>,
  question: { message: string; option?: string },
): StandardSchemaV1.Options {
  return schemaOptions({
    command: [...context.command.path],
    host: context.host,
    input:
      question.option === undefined
        ? { global: false, kind: 'question', name: question.message }
        : { global: false, kind: 'option', name: question.option },
    passthrough: [...context.passthrough],
    phase: 'question',
    supplied: copiedSupplied(context.supplied),
  });
}

/** Reads the context core attached to a schema call, or undefined when another caller ran it. */
function validationContext(
  options: StandardSchemaV1.Options | undefined,
): ValidationContext | undefined {
  const carried: unknown = options?.libraryOptions?.[validationContextKey];
  return carried !== null && typeof carried === 'object' ? emitted.get(carried) : undefined;
}

export { questionValidationOptions, schemaOptions, validationContext, validationContextKey };
