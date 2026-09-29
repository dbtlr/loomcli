import { escapeControlCharacters } from './controls.js';
import { registerRule } from './diagnostic-text.js';
import type { DiagnosticRule } from './diagnostic-text.js';
import { DeclarationError } from './errors.js';

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
    throw new DeclarationError(
      `Diagnostic rule ${quoted(identity)} has no package part or a rule name that is not kebab-case. Name it <package>/<kebab-case-rule>, such as "@acme/retry/retry-limit".`,
    );
  }
  const { docs, explanation, headline } = definitionOf(definition);
  if (!isFilled(headline)) {
    throw new DeclarationError(
      `Diagnostic rule ${quoted(identity)} declares an empty headline. Supply a short noun phrase.`,
    );
  }
  if (!isFilled(explanation)) {
    throw new DeclarationError(
      `Diagnostic rule ${quoted(identity)} declares an empty explanation. Supply prose that says why the rule exists.`,
    );
  }
  if (docs !== undefined && (typeof docs !== 'string' || !isWebAddress(docs))) {
    throw new DeclarationError(
      `Diagnostic rule ${quoted(identity)} declares docs that are not a URL. Supply an absolute https URL, or omit docs.`,
    );
  }
  return registerRule(
    identity,
    docs === undefined ? { explanation, headline } : { docs, explanation, headline },
  );
}
