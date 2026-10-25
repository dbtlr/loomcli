import type { StandardSchemaV1 } from '@standard-schema/spec';

import { captureHost, settleTerminal, statedBackground } from './host.js';
import type {
  ActionContext,
  InputIdentity,
  ProcessHandle,
  SuppliedInputs,
  ValidationContext,
} from './types.js';

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

/** A context a test builds outside a run: the default or the invocation phase, with its fields. */
type ValidationOptionsContext =
  | { readonly phase: 'default'; readonly input: InputIdentity }
  | {
      readonly phase: 'invocation';
      readonly input: InputIdentity;
      /** `[]` when omitted, the root. */
      readonly command?: readonly string[];
      /** `[]` when omitted. */
      readonly passthrough?: readonly string[];
      /** `{ args: {}, options: {} }` when omitted. */
      readonly supplied?: SuppliedInputs;
    };

/**
 * The application name the host capture looks up an installation record under. Outside a run no
 * Application names one, and only a compiled binary with a baked release asset reads the record,
 * so the empty name stands for none: the record it would find, `installation/install.json` right
 * under the base folder, belongs to no application. A test running from source reads no record.
 */
const noApplication = '';

/**
 * The Standard Schema options a run passes to a validator in the default or invocation phase,
 * built over a process handle, so a test calls one validator with no Application. The host is
 * captured as `run()` captures it at entry, and nothing a run adds later applies: no environment
 * preparation, and no background query, so the background is the one the handle's terminal states.
 * A handle a run would fail to capture throws the failure the run would report.
 */
function validationOptions(
  handle: ProcessHandle,
  context: ValidationOptionsContext,
): StandardSchemaV1.Options {
  const capture = captureHost(noApplication, handle, handle.stderr);
  if ('failure' in capture) {
    throw capture.failure;
  }
  const { host } = capture;
  settleTerminal(host.terminal, statedBackground(host.terminal));
  const input = { ...context.input };
  if (context.phase === 'default') {
    return schemaOptions({ host, input, phase: 'default' });
  }
  return schemaOptions({
    command: [...(context.command ?? [])],
    host,
    input,
    passthrough: [...(context.passthrough ?? [])],
    phase: 'invocation',
    supplied: copiedSupplied(context.supplied ?? { args: {}, options: {} }),
  });
}

/** Reads the context core attached to a schema call, or undefined when another caller ran it. */
function validationContext(
  options: StandardSchemaV1.Options | undefined,
): ValidationContext | undefined {
  const carried: unknown = options?.libraryOptions?.[validationContextKey];
  return carried !== null && typeof carried === 'object' ? emitted.get(carried) : undefined;
}

export type { ValidationOptionsContext };
export {
  questionValidationOptions,
  schemaOptions,
  validationContext,
  validationContextKey,
  validationOptions,
};
