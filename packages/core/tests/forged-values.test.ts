import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

/**
 * Each scenario's rule, when an author-supplied value that holds line breaks and a bidirectional
 * control, or a value that is not a string, reaches its sentence.
 */
const rules = {
  'argument-after-action': 'declared-name',
  'extension-copies': 'two-package-copies',
  'extension-issue': 'invalid-extension-value',
  'hook-option-name': 'declared-name',
  'option-after-action': 'declared-name',
  'rule-bare': 'rule-identity',
};

/** A control character, a line or paragraph separator, or a bidirectional control. */
const control = /[\p{Cc}\p{Zl}\p{Zp}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u;

test('an author-supplied value reaches a declaration sentence escaped, and a value of another kind reaches its rule', () => {
  const result = invoke(new URL('fixtures/forged-values.mjs', import.meta.url), []);
  expect(result.stderr).toBe('');
  const report = z
    .record(z.string(), z.object({ rule: z.string(), sentence: z.string() }))
    .parse(JSON.parse(result.stdout));
  expect(
    Object.fromEntries(Object.entries(report).map(([scenario, { rule }]) => [scenario, rule])),
  ).toEqual(
    Object.fromEntries(
      Object.entries(rules).map(([scenario, rule]) => [scenario, `@loomcli/core/${rule}`]),
    ),
  );
  expect(Object.values(report).filter(({ sentence }) => control.test(sentence))).toEqual([]);
});
