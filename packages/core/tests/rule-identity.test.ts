import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** What the public `isRuleIdentity`, or `plugin()` for `'plugin'`, answers for each value. */
function answers(check: 'plugin' | 'rule', values: readonly unknown[]): unknown {
  const result = invoke(new URL('fixtures/rule-identity.mjs', import.meta.url), [
    check,
    ...values.map((value) => JSON.stringify(value)),
  ]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** A package name of `length` characters. */
const named = (length: number) => 'a'.repeat(length);

/** A scoped package name whose scope and name come to `length` characters together. */
const scoped = (length: number) => `@${'s'.repeat(9)}/${'n'.repeat(length - 11)}`;

test('isRuleIdentity accepts an identity followed by a kebab-case rule name', () => {
  expect(answers('rule', ['@a/b/c-d', 'pkg/rule'])).toEqual([true, true]);
});

test('isRuleIdentity rejects a value with no rule name, a rule name outside kebab-case, an empty segment, and a value that is not a string', () => {
  expect(answers('rule', ['pkg', '@a/b', 'pkg/Rule', 'pkg//r', 7])).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});

test('an identity rejects a tilde in its package name, as npm does', () => {
  expect(answers('plugin', ['~x', 'a~b'])).toEqual([false, false]);
  expect(answers('rule', ['~x/rule', 'a~b/rule'])).toEqual([false, false]);
});

test("an identity's package name holds at most 214 characters, and its segments do not count", () => {
  const segments = `/${'p'.repeat(100)}/${'q'.repeat(100)}`;
  expect(answers('plugin', [named(214), named(215), `${scoped(214)}${segments}`])).toEqual([
    true,
    false,
    true,
  ]);
  expect(
    answers('rule', [`${named(214)}/rule`, `${named(215)}/rule`, `${scoped(214)}${segments}`]),
  ).toEqual([true, false, true]);
  expect(answers('plugin', [scoped(215)])).toEqual([false]);
});
