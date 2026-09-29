import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** What the public `isRuleIdentity` answers for each value, read back from the fixture. */
function answers(values: readonly unknown[]): unknown {
  const result = invoke(
    new URL('fixtures/rule-identity.mjs', import.meta.url),
    values.map((value) => JSON.stringify(value)),
  );
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test('isRuleIdentity accepts an identity followed by a kebab-case rule name', () => {
  expect(answers(['@a/b/c-d', 'pkg/rule'])).toEqual([true, true]);
});

test('isRuleIdentity rejects a value with no rule name, a rule name outside kebab-case, an empty segment, and a value that is not a string', () => {
  expect(answers(['pkg', '@a/b', 'pkg/Rule', 'pkg//r', 7])).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});
