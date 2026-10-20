import { registerRule } from './diagnostic-text.js';
import type { DiagnosticRule } from './diagnostic-text.js';
import { DeclarationError, quoted } from './errors.js';
import { isRuleIdentity } from './identity.js';
import { ruleIdentity } from './rules.js';

/** The finding for one `diagnosticRule()` call, marking its identity. */
function callFinding(identity: unknown, definition: unknown) {
  return { arguments: [identity, definition], call: 'diagnosticRule', mark: '0' };
}

/**
 * Declares one Developer Diagnostic rule: its identity, the headline its banner prints, the
 * explanation that says why the rule exists, and an optional docs link. It returns a frozen
 * descriptor that every site raising the rule shares, as `extension()` and `issueCode()` do.
 */
export function diagnosticRule(
  identity: string,
  definition: { readonly headline: string; readonly explanation: string; readonly docs?: string },
): DiagnosticRule {
  if (!isRuleIdentity(identity)) {
    throw new DeclarationError(ruleIdentity, {
      correction:
        'Name it <package>[/<subpath>...]/<kebab-case-rule>, such as "@acme/retry/retry-limit".',
      findings: [callFinding(identity, definition)],
      sentence: `Diagnostic rule ${quoted(identity)} has no package part, or a subpath or rule name that is not kebab-case.`,
    });
  }
  return registerRule(identity, definition);
}
