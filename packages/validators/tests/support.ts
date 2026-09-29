import { DeclarationError } from '@loomcli/core';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';

/** The draft the catalog publishes, with the formats checked in full mode and patterns under `u`. */
const ajv = new Ajv2020({ unicodeRegExp: true });
addFormats(ajv, { mode: 'full' });

/** The input schema a validator publishes for the one target core asks for. */
export function published(validator: StandardJSONSchemaV1<string, unknown>) {
  return validator['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
}

/** Whether the value a token stands for satisfies the published schema, under Ajv's draft 2020-12. */
export function conforms(validator: StandardJSONSchemaV1<string, unknown>, value: unknown) {
  return ajv.validate(published(validator), value);
}

/** The result of one direct call, awaited so a synchronous and an asynchronous verdict read alike. */
export async function verdict<Output>(validator: StandardSchemaV1<string, Output>, raw: unknown) {
  return await validator['~standard'].validate(raw);
}

/**
 * The messages of one direct call's issues, and whether any of them repeats the token.
 * The empty token is inside every string, so it never counts as repeated. Each issue's code and
 * parameters are pinned under `codes.test.ts`.
 */
export async function rejection(validator: StandardSchemaV1<string, unknown>, token: string) {
  const result = await verdict(validator, token);
  const messages = result.issues?.map((issue) => issue.message);
  return {
    messages,
    repeatsToken: token !== '' && (messages ?? []).some((message) => message.includes(token)),
  };
}

/** What `rejection` reads for a token rejected with exactly one issue carrying the message. */
export function rejectedWith(message: string) {
  return { messages: [message], repeatsToken: false };
}

/**
 * What the call threw: whether it was a `DeclarationError`, and its sentence, which a declaration
 * fault holds apart from the whole diagnostic its message carries.
 */
export function faultOf(call: () => unknown) {
  try {
    call();
  } catch (error) {
    return {
      declaration: error instanceof DeclarationError,
      message: sentenceOf(error),
    };
  }
  return undefined;
}

/** What `faultOf` reads for a `DeclarationError` carrying the message. */
export function declarationFault(message: string) {
  return { declaration: true, message };
}

/**
 * An issue built by hand, as another validator or a schema library would return it, with fields
 * the Standard Schema issue type does not name.
 */
export function foreignIssue(fields: { message: string } & Record<string, unknown>) {
  const issue: StandardSchemaV1.Issue = fields;
  return issue;
}

/** The sentence one thrown value states: a declaration fault's own, or any Error's message. */
export function sentenceOf(error: unknown): string {
  if (error instanceof DeclarationError) {
    return error.sentence;
  }
  return error instanceof Error ? error.message : String(error);
}
