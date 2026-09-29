import { escapeControlCharacters } from './controls.js';
import { registerRule } from './diagnostic-text.js';
import type { DiagnosticRule } from './diagnostic-text.js';
import { DeclarationError } from './errors.js';
import { ruleDocs, ruleIdentity, ruleProse } from './rules.js';

/**
 * A package name as npm spells one, scoped or not, then `/` and a rule name of lowercase letters
 * and digits in words joined by single hyphens: `@loomcli/core/plugin-option-collision`. It is the
 * grammar of a validator package's issue codes.
 */
const identityGrammar =
  /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Whether a text holds a character other than whitespace. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Whether a docs value is an absolute web address. */
function isWebAddress(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const { protocol } = new URL(value);
  return protocol === 'https:' || protocol === 'http:';
}

/** A value a sentence quotes, escaped so it cannot break or reorder the line. */
function quoted(value: unknown): string {
  return `"${escapeControlCharacters(String(value))}"`;
}

/** The definition's own fields, read by shape, because a JavaScript caller reaches the call. */
function definitionOf(
  definition: unknown,
): Partial<Record<'docs' | 'explanation' | 'headline', unknown>> {
  return typeof definition === 'object' && definition !== null ? { ...definition } : {};
}

/** The finding for one `diagnosticRule()` call, marking the argument or key at fault. */
function callFinding(identity: unknown, definition: unknown, mark: string) {
  return { arguments: [identity, definition], call: 'diagnosticRule', mark };
}

/**
 * The definition's headline, explanation, and docs, checked. A fault marks the key at fault, or the
 * definition itself when the author left the key out.
 */
function checkDefinition(identity: string, definition: unknown) {
  const fields = definitionOf(definition);
  const { docs, explanation, headline } = fields;
  const part = (key: keyof typeof fields) =>
    callFinding(identity, definition, key in fields ? `1.${key}` : '1');
  if (!isFilled(headline)) {
    throw new DeclarationError(ruleProse, {
      correction: 'Supply a short noun phrase.',
      findings: [part('headline')],
      sentence: `Diagnostic rule ${quoted(identity)} declares an empty headline.`,
    });
  }
  if (!isFilled(explanation)) {
    throw new DeclarationError(ruleProse, {
      correction: 'Supply prose that says why the rule exists.',
      findings: [part('explanation')],
      sentence: `Diagnostic rule ${quoted(identity)} declares an empty explanation.`,
    });
  }
  if (docs !== undefined && (typeof docs !== 'string' || !isWebAddress(docs))) {
    throw new DeclarationError(ruleDocs, {
      correction: 'Supply an absolute https URL, or omit docs.',
      findings: [part('docs')],
      sentence: `Diagnostic rule ${quoted(identity)} declares docs that are not a URL.`,
    });
  }
  return docs === undefined ? { explanation, headline } : { docs, explanation, headline };
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
  if (typeof identity !== 'string' || !identityGrammar.test(identity)) {
    throw new DeclarationError(ruleIdentity, {
      correction: 'Name it <package>/<kebab-case-rule>, such as "@acme/retry/retry-limit".',
      findings: [callFinding(identity, definition, '0')],
      sentence: `Diagnostic rule ${quoted(identity)} has no package part or a rule name that is not kebab-case.`,
    });
  }
  return registerRule(identity, checkDefinition(identity, definition));
}
