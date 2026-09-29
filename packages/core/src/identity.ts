import { elided, spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { DeclarationError, quoted } from './errors.js';
import { invalidIdentity } from './plugin-rules.js';

/*
 * The identity grammar plugins, extensions, views, and diagnostic rules share. Both grammars are
 * built here from one source, so every rule identity's prefix is a valid plugin identity.
 */

/** A package name as npm spells one, scoped or not: `help` or `@acme/config`. */
const packageName = String.raw`(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*`;

/** One segment after a `/`, of lowercase letters and digits in words joined by single hyphens. */
const kebabSegment = String.raw`\/[a-z0-9]+(?:-[a-z0-9]+)*`;

/**
 * A package name, then zero or more kebab-case subpath segments: `@acme/config` or
 * `@loomcli/plugins/help/page`. It is the grammar of a plugin, extension, or view identity.
 */
const identityGrammar = new RegExp(`^${packageName}(?:${kebabSegment})*$`, 'u');

/**
 * An identity, then a mandatory kebab-case rule name: `@loomcli/core/spelling-taken` or
 * `@loomcli/plugins/manifest/failure-name-conflict`. It is the grammar of a diagnostic rule's
 * identity and of a validator package's issue codes.
 */
const ruleGrammar = new RegExp(`^${packageName}(?:${kebabSegment})+$`, 'u');

/** The calls that declare an identity. */
type IdentityCall = 'extension' | 'plugin' | 'view';

/** How a sentence names the declarer of each call. */
const declarers: Record<IdentityCall, string> = {
  extension: 'An extension',
  plugin: 'A plugin',
  view: 'A view',
};

/** Whether a value is a plugin, extension, or view identity. */
function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && identityGrammar.test(value);
}

/** Whether a value is a diagnostic rule identity: an identity and a kebab-case rule name. */
function isRuleIdentity(value: unknown): value is string {
  return typeof value === 'string' && ruleGrammar.test(value);
}

/**
 * The fault for one identity outside the grammar. `subject` opens the sentence and says who
 * declares or holds it, such as `A plugin declares the identity`.
 */
function identityFault(subject: string, identity: unknown, findings: readonly Finding[]) {
  return new DeclarationError(invalidIdentity, {
    correction: 'Name it <package>[/<subpath>...], such as "@acme/notes" or "@acme/notes/page".',
    findings,
    sentence: `${subject} ${quoted(identity)}, which is not a package name with optional kebab-case subpath segments.`,
  });
}

/**
 * Checks the identity one `plugin()`, `extension()`, or `view()` call declares, at the call, so a
 * fault throws before the value exists. The finding marks the identity on the rebuilt call.
 */
function checkIdentity(call: IdentityCall, identity: unknown): asserts identity is string {
  if (!isIdentity(identity)) {
    throw identityFault(`${declarers[call]} declares the identity`, identity, [
      { arguments: [identity, spelled(elided)], call, mark: '0' },
    ]);
  }
}

export { checkIdentity, identityFault, isIdentity, isRuleIdentity };
