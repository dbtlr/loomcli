import { readFileSync } from 'node:fs';

import { expect } from 'vite-plus/test';

/** The parts of one Developer Diagnostic a test pins where the rest of the text is another test's. */
export interface RuleParts {
  readonly rule: string;
  readonly sentence: string;
  readonly correction: string;
}

/**
 * Asserts that printed text holds one rule's Developer Diagnostic: the rule's identity on its
 * banner, and the sentence and the correction each on lines of their own.
 */
export function expectRuleParts(text: string, { correction, rule, sentence }: RuleParts): void {
  expect(text).toContain(` @loomcli/core/${rule}\n`);
  expect(text).toContain(`\n${sentence}\n`);
  expect(text).toContain(`\n${correction}\n`);
}

/**
 * The names of the rules one of core's rule files declares, read from its source as text, so a rule
 * a family declares without a pinned diagnostic fails that family's test.
 */
export function declaredRules(file: string): string[] {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  return Array.from(
    source.matchAll(/registerRule\('@loomcli\/core\/(?<name>[a-z0-9-]+)'/gu),
    (match) => match.groups?.name ?? '',
  );
}
