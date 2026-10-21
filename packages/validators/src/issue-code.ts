import { isRuleIdentity } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

import { fault } from './faults.js';
import { issueCodeName, issueParameters } from './rules.js';

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

/** Whether a value is an object or a function, which alone can carry fields. */
function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/**
 * The parameters a schema's answer accepts, or undefined when it rejects them. Both `issue` and
 * `read` read the answer synchronously, so an answer that is a promise accepts nothing.
 */
function accepted<Params>(
  answer: StandardSchemaV1.Result<Params> | Promise<StandardSchemaV1.Result<Params>>,
): { readonly params: Params } | undefined {
  if (answer instanceof Promise || answer.issues !== undefined) {
    return undefined;
  }
  return { params: answer.value };
}

/**
 * Declares one issue code with its parameter schema and its one sentence, and returns its
 * descriptor. The code follows the rule-identity grammar. `issue` builds the rejection a `parse`
 * function returns, and `read` recovers the typed parameters from an issue carrying the code.
 */
function issueCode<Params>(code: string, config: IssueCodeConfig<Params>): IssueCode<Params> {
  if (!isRuleIdentity(code)) {
    throw fault(
      issueCodeName,
      { arguments: [code, config], factory: 'issueCode', mark: '0' },
      {
        correction:
          'Supply a code such as "@acme/validators/port-range", with each subpath segment and the rule of lowercase letters and digits in words joined by single hyphens.',
        sentence: `issueCode() code ${JSON.stringify(code)} is not a package name, any subpath segments, and a rule name joined by slashes.`,
      },
    );
  }
  const { message, schema } = config;
  return {
    code,
    issue: (params: Params): StandardSchemaV1.Issue => {
      const verdict = accepted(schema['~standard'].validate(params));
      if (verdict === undefined) {
        throw fault(
          issueParameters,
          { arguments: [params], factory: 'issue', mark: '0' },
          {
            correction: 'Supply parameters its schema accepts.',
            sentence: `Issue code ${JSON.stringify(code)} rejects the parameters passed to issue().`,
          },
        );
      }
      // The issue carries its code and parameters beside the message, which views read by code.
      const built = { code, message: message(verdict.params), params: verdict.params };
      return built;
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
      return accepted(schema['~standard'].validate(params))?.params;
    },
    schema,
  };
}

export { issueCode };
export type { IssueCode, IssueCodeConfig };
