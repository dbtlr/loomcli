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
