import type { StandardSchemaV1 } from '@loomcli/core';

import { isPlainObject } from './data.js';
import { fault, quote } from './faults.js';

/**
 * One issue code a validator package declares: the code string, the schema its parameters pass,
 * a builder for the issue a `parse` function returns, and a typed read of that issue.
 */
interface IssueCode<Params> {
  readonly code: string;
  readonly schema: StandardSchemaV1<Params>;
  issue(this: void, params: Params): StandardSchemaV1.Issue;
  read(this: void, issue: StandardSchemaV1.Issue): Params | undefined;
}

/** What `issueCode` declares beside the code: the parameter schema and the one sentence. */
interface IssueCodeConfig<Params> {
  schema: StandardSchemaV1<Params>;
  message: (params: Params) => string;
}

/**
 * A package name as npm spells one, scoped or not, then `/` and a rule name of lowercase letters
 * and digits in words joined by single hyphens: `@loomcli/validators/integer-range`.
 */
const grammar =
  /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** The Standard Schema version this package reads. */
const standardVersion = 1;

/** Whether a value answers the Standard Schema v1 contract, as core checks a validator. */
function isStandardSchema(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  const standard: unknown = '~standard' in value ? value['~standard'] : undefined;
  return (
    standard !== null &&
    typeof standard === 'object' &&
    'version' in standard &&
    standard.version === standardVersion &&
    'vendor' in standard &&
    typeof standard.vendor === 'string' &&
    'validate' in standard &&
    typeof standard.validate === 'function'
  );
}

/**
 * Whether a schema's answer is a promise or another thenable, which a synchronous read cannot
 * wait for. A value whose `then` cannot be read is not a thenable, so the test never throws.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  try {
    return (
      (typeof value === 'object' || typeof value === 'function') &&
      value !== null &&
      'then' in value &&
      typeof value.then === 'function'
    );
  } catch {
    return false;
  }
}

/** Faults on a declaration that bypassed the types: a code outside the grammar, or a bad config. */
function checkDeclaration(code: unknown, config: unknown): void {
  if (typeof code !== 'string' || !grammar.test(code)) {
    throw fault(
      `issueCode() code ${quote(code)} is not a package name, a slash, and a rule name. Supply a code such as "@acme/validators/port-range", with a rule of lowercase letters and digits in words joined by single hyphens.`,
    );
  }
  if (!isPlainObject(config)) {
    throw fault(
      'issueCode() config is not a plain object. Supply an object with a schema and a message function.',
    );
  }
  if (!isStandardSchema(config.schema)) {
    throw fault(
      'issueCode() schema is not a Standard Schema. Supply a Standard Schema value that validates the parameters.',
    );
  }
  if (typeof config.message !== 'function') {
    throw fault(
      'issueCode() message is not a function. Supply a function that builds the sentence from the parameters.',
    );
  }
}

/**
 * Declares one issue code with its parameter schema and its one sentence, and returns a frozen
 * descriptor. `issue` builds the rejection a `parse` function returns, and `read` recovers the
 * typed parameters from an issue carrying the code.
 */
function issueCode<Params>(code: string, config: IssueCodeConfig<Params>): IssueCode<Params> {
  checkDeclaration(code, config);
  const { message, schema } = config;

  /** The schema's synchronous answer; a promise faults, since neither caller can wait for it. */
  function validate(value: unknown): StandardSchemaV1.Result<Params> {
    const result = schema['~standard'].validate(value);
    if (isThenable(result)) {
      // The unawaited answer may still reject, and an unobserved rejection would end the process.
      void Promise.resolve(result).catch(() => undefined);
      throw fault(
        `Issue code ${JSON.stringify(code)} has a schema that answers with a promise. Supply a schema that validates synchronously.`,
      );
    }
    return result;
  }

  return Object.freeze({
    code,
    issue: (params: Params): StandardSchemaV1.Issue => {
      const result = validate(params);
      if (result.issues !== undefined) {
        throw fault(
          `Issue code ${JSON.stringify(code)} rejects the parameters passed to issue(). Supply parameters its schema accepts.`,
        );
      }
      return Object.freeze({ code, message: message(result.value), params: result.value });
    },
    read: (issue: StandardSchemaV1.Issue): Params | undefined => {
      if (!('code' in issue) || issue.code !== code) {
        return undefined;
      }
      const result = validate('params' in issue ? issue.params : undefined);
      return result.issues === undefined ? result.value : undefined;
    },
    schema,
  });
}

export { issueCode };
export type { IssueCode, IssueCodeConfig };
