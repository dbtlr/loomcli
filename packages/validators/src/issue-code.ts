import type { StandardSchemaV1 } from '@loomcli/core';

import { isPlainObject } from './data.js';
import { fault, quote } from './faults.js';
import { issueCodeConfig, issueCodeName, issueCodeSchema, issueParameters } from './rules.js';

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
 * A package name as npm spells one, scoped or not, then zero or more subpath segments and a rule
 * name, each after a `/` and each of lowercase letters and digits in words joined by single
 * hyphens: `@loomcli/validators/integer-range`. It is the grammar of a diagnostic rule's identity.
 */
const grammar =
  /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/u;

/** The Standard Schema version this package reads. */
const standardVersion = 1;

/** Whether a value is an object or a function, which alone can carry fields. */
function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/**
 * Whether a value answers the Standard Schema v1 contract, as core checks a validator. A value
 * whose fields throw when read, through a getter or a proxy trap, is not a Standard Schema.
 */
function isStandardSchema(value: unknown): boolean {
  try {
    if (!isObjectLike(value)) {
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
  } catch {
    return false;
  }
}

/** What a schema's synchronous result says: the parameters it outputs, or that it rejects them. */
type Verdict<Params> = { kind: 'accepted'; params: Params } | { kind: 'rejected' };

/**
 * The verdict a schema's result states, or `undefined` for a value that is not a Standard Schema
 * result: a success must hold its own `value` and no issues, and a failure an issues array. Both
 * `issue` and `read` read a result here, so neither keeps parameters the schema never output. A
 * getter or a proxy trap that throws while the result is read propagates to the caller.
 */
function verdictOf<Params>(result: StandardSchemaV1.Result<Params>): Verdict<Params> | undefined {
  if (!isObjectLike(result)) {
    return undefined;
  }
  if (result.issues === undefined) {
    return Object.hasOwn(result, 'value') ? { kind: 'accepted', params: result.value } : undefined;
  }
  const issues: unknown = result.issues;
  return Array.isArray(issues) ? { kind: 'rejected' } : undefined;
}

/** The verdict a result states, where a result that throws while it is read states none. */
function verdictOrNothing<Params>(
  result: StandardSchemaV1.Result<Params>,
): Verdict<Params> | undefined {
  try {
    return verdictOf(result);
  } catch {
    return undefined;
  }
}

/**
 * Whether a schema's answer is a promise or another thenable, which a synchronous read cannot
 * wait for. A value whose `then` cannot be read is not a thenable, so the test never throws.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  try {
    return isObjectLike(value) && 'then' in value && typeof value.then === 'function';
  } catch {
    return false;
  }
}

/** The `issueCode()` call a fault marks one part of: the code, the config, or one of its keys. */
function declarationAt(code: unknown, config: unknown, mark: string) {
  return { arguments: [code, config], factory: 'issueCode', mark };
}

/** The mark for one key of a config object, or the config itself when the key is absent. */
function keyMark(config: Readonly<Record<string, unknown>>, key: string): string {
  return key in config ? `1.${key}` : '1';
}

/** Faults on a declaration that bypassed the types: a code outside the grammar, or a bad config. */
function checkDeclaration(code: unknown, config: unknown): void {
  if (typeof code !== 'string' || !grammar.test(code)) {
    throw fault(issueCodeName, declarationAt(code, config, '0'), {
      correction:
        'Supply a code such as "@acme/validators/port-range", with each subpath segment and the rule of lowercase letters and digits in words joined by single hyphens.',
      sentence: `issueCode() code ${quote(code)} is not a package name, any subpath segments, and a rule name joined by slashes.`,
    });
  }
  if (!isPlainObject(config)) {
    throw fault(issueCodeConfig, declarationAt(code, config, '1'), {
      correction: 'Supply an object with a schema and a message function.',
      sentence: 'issueCode() config is not a plain object.',
    });
  }
  if (!isStandardSchema(config.schema)) {
    throw fault(issueCodeConfig, declarationAt(code, config, keyMark(config, 'schema')), {
      correction: 'Supply a Standard Schema value that validates the parameters.',
      sentence: 'issueCode() schema is not a Standard Schema.',
    });
  }
  if (typeof config.message !== 'function') {
    throw fault(issueCodeConfig, declarationAt(code, config, keyMark(config, 'message')), {
      correction: 'Supply a function that builds the sentence from the parameters.',
      sentence: 'issueCode() message is not a function.',
    });
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
  // A schema fault is the declaration's, so it marks the schema the code was declared with.
  const schemaAt = declarationAt(code, config, '1.schema');

  /** The schema's synchronous result; a promise faults, since neither caller can wait for it. */
  function settled(
    answer: StandardSchemaV1.Result<Params> | Promise<StandardSchemaV1.Result<Params>>,
  ): StandardSchemaV1.Result<Params> {
    if (isThenable(answer)) {
      // The unawaited answer may still reject, and an unobserved rejection would end the process.
      void Promise.resolve(answer).catch(() => undefined);
      throw fault(issueCodeSchema, schemaAt, {
        correction: 'Supply a schema that validates synchronously.',
        sentence: `Issue code ${JSON.stringify(code)} has a schema that answers with a promise.`,
      });
    }
    return answer;
  }

  /** The schema's answer to the parameters `issue` was given; a throw is the declaration's fault. */
  function declaredAnswer(params: Params) {
    try {
      return schema['~standard'].validate(params);
    } catch {
      throw fault(issueCodeSchema, schemaAt, {
        correction: 'Supply a schema that returns its issues instead of throwing.',
        sentence: `Issue code ${JSON.stringify(code)} has a schema that throws in issue().`,
      });
    }
  }

  /**
   * The verdict `issue` builds from. Anything but a well-formed synchronous result is the
   * declaration's fault, so a result that throws while it is read is not a result either.
   */
  function declaredVerdict(params: Params): Verdict<Params> {
    const verdict = verdictOrNothing(settled(declaredAnswer(params)));
    if (verdict === undefined) {
      throw fault(issueCodeSchema, schemaAt, {
        correction: 'Supply a schema that returns its value or its issues.',
        sentence: `Issue code ${JSON.stringify(code)} has a schema that answers with a value that is not a Standard Schema result.`,
      });
    }
    return verdict;
  }

  return Object.freeze({
    code,
    issue: (params: Params): StandardSchemaV1.Issue => {
      const verdict = declaredVerdict(params);
      if (verdict.kind === 'rejected') {
        throw fault(
          issueParameters,
          { arguments: [params], factory: 'issue', mark: '0' },
          {
            correction: 'Supply parameters its schema accepts.',
            sentence: `Issue code ${JSON.stringify(code)} rejects the parameters passed to issue().`,
          },
        );
      }
      return Object.freeze({ code, message: message(verdict.params), params: verdict.params });
    },
    // Core hands a failure view a plain-object copy of each issue a validator returned.
    // Reading the copy's own fields runs no getter, and its parameters reach the schema as they are.
    read: (issue: StandardSchemaV1.Issue): Params | undefined => {
      const candidate: unknown = issue;
      if (!isObjectLike(candidate) || !('code' in candidate) || candidate.code !== code) {
        return undefined;
      }
      const params = 'params' in candidate ? candidate.params : undefined;
      if (!isObjectLike(params)) {
        return undefined;
      }
      const verdict = verdictOf(settled(schema['~standard'].validate(params)));
      return verdict?.kind === 'accepted' ? verdict.params : undefined;
    },
    schema,
  });
}

export { issueCode };
export type { IssueCode, IssueCodeConfig };
