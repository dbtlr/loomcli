// Acceptance plan: see packages/core/tests/developer-diagnostics.test.ts.

import { expect, test } from 'vite-plus/test';

import { ruleContract } from '../../../scripts/test-rules.js';
import { coreRules } from './rule-parts.js';

// Each explanation lives in the registry alone; a rule's own test pins its sentence and correction.
test('every rule core declares has one declaration, a one-line headline, and an explanation of whole sentences', () => {
  const rules = coreRules();
  const names = rules.map((rule) => rule.name);
  expect(names).toContain('declared-name');
  expect(names).toEqual([...new Set(names)]);
  expect(rules).toEqual(names.map((name) => ruleContract(name)));
});
