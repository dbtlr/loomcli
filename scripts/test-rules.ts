import { readFileSync } from 'node:fs';

import { expect } from 'vite-plus/test';

/**
 * The parts of one Developer Diagnostic a rule's own test pins. The layout around them, and the
 * explanation the rule's registry declares, belong to the layout goldens and the registry test.
 */
interface RuleParts {
  readonly identity: string;
  readonly sentence: string;
  readonly correction: string;
}

/**
 * The parts of the Developer Diagnostic printed text holds: the identity that closes its banner,
 * the sentence in the section under the banner, and the correction in its last section, before any
 * docs link. Text before the banner, such as another line on the same stream, is passed over.
 */
function ruleParts(text: string): RuleParts | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('-- '));
  if (start === -1) {
    return undefined;
  }
  const sections = lines
    .slice(start + 1)
    .join('\n')
    .trim()
    .split('\n\n');
  const closing = sections.filter((section) => !section.startsWith('See '));
  return {
    correction: closing.at(-1) ?? '',
    identity: lines[start]?.split(' ').at(-1) ?? '',
    sentence: sections[0] ?? '',
  };
}

/** The findings printed text holds: each section of indented code a diagnostic quotes, in order. */
function findingsOf(text: string): string[] {
  return text.split('\n\n').filter((section) => section.startsWith('    '));
}

/** One rule as its registry's source declares it. */
interface RegisteredRule {
  readonly name: string;
  readonly headline: string | undefined;
  readonly explanation: string | undefined;
}

/** One string literal in any of the three quotes, its escapes kept as written. */
const literal = /(?<quote>['"`])(?<text>(?:\\.|(?!\k<quote>)[^\\])*)\k<quote>/su;

/** The text of the literal `key:` holds in one rule's definition, its escapes undone. */
function definitionText(definition: string, key: string): string | undefined {
  const start = definition.search(new RegExp(`\\b${key}:\\s*['"\`]`, 'u'));
  if (start === -1) {
    return undefined;
  }
  const text = literal.exec(definition.slice(start))?.groups?.text;
  return text?.replaceAll(/\\(?<escaped>.)/gu, '$<escaped>');
}

/**
 * Every rule one registry source declares, read from its text. `call` matches the opening of each
 * declaring call and captures the rule's `name`; the headline and the explanation are the string
 * literals the definition that follows holds, up to the call's close.
 */
function registeredRules(file: URL, call: RegExp): RegisteredRule[] {
  const source = readFileSync(file, 'utf8');
  return Array.from(source.matchAll(call), (match) => {
    const start = match.index + match[0].length;
    const definition = source.slice(start, source.indexOf('\n});', start));
    return {
      explanation: definitionText(definition, 'explanation'),
      headline: definitionText(definition, 'headline'),
      name: match.groups?.name ?? '',
    };
  });
}

/**
 * The registry's own contract for one rule's prose: a one-line headline without a closing period,
 * and an explanation of whole sentences on one line, which the diagnostic wraps to the terminal's
 * width.
 */
function ruleContract(name: string): object {
  return {
    explanation: expect.stringMatching(/^\S(?:[^\n ]| (?! ))*\.$/u),
    headline: expect.stringMatching(/^\S[^\n]*[^.\s]$/u),
    name,
  };
}

export type { RegisteredRule, RuleParts };
export { findingsOf, registeredRules, ruleContract, ruleParts };
