/*
 * The rule-identity grammar diagnostic rules and a validator package's issue codes share. A plugin,
 * extension, or view identity follows the same package-name convention, which core compares by
 * equality and never checks.
 */

/**
 * A package name as npm spells one, scoped or not: `help` or `@acme/config`. The group captures it,
 * scope included, so its length is checked against npm's limit.
 */
const packageName = String.raw`(?<package>(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*)`;

/** The longest package name npm accepts, scope included. */
const packageNameLimit = 214;

/** One segment after a `/`, of lowercase letters and digits in words joined by single hyphens. */
const kebabSegment = String.raw`\/[a-z0-9]+(?:-[a-z0-9]+)*`;

/**
 * A package name, then one or more kebab-case segments, the last of them the rule name:
 * `@loomcli/core/spelling-taken` or `@loomcli/plugins/manifest/failure-code-conflict`. It is the
 * grammar of a diagnostic rule's identity and of a validator package's issue codes.
 */
const ruleGrammar = new RegExp(`^${packageName}(?:${kebabSegment})+$`, 'u');

/** Whether a value is a diagnostic rule identity: an identity and a kebab-case rule name. */
function isRuleIdentity(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const name = ruleGrammar.exec(value)?.groups?.package;
  return name !== undefined && name.length <= packageNameLimit;
}

/**
 * The grammar of a failure code: one or more words of lowercase ASCII letters and digits joined by
 * single hyphens, the grammar of the rule name that ends a rule identity.
 */
const failureCodeGrammar = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Whether a value is a failure code: a string in the grammar, such as `path-not-found`. */
function isFailureCode(value: unknown): value is string {
  return typeof value === 'string' && failureCodeGrammar.test(value);
}

export { isFailureCode, isRuleIdentity };
