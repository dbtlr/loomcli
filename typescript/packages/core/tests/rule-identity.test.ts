import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

/** What the public `isRuleIdentity` answers for each value. */
async function answers(values: readonly unknown[]): Promise<unknown> {
  const result = await invokeFixture(
    new URL('fixtures/rule-identity.mjs', import.meta.url),
    values.map((value) => JSON.stringify(value)),
  );
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** A package name of `length` characters. */
const named = (length: number) => 'a'.repeat(length);

/** A scoped package name whose scope and name come to `length` characters together. */
const scoped = (length: number) => `@${'s'.repeat(9)}/${'n'.repeat(length - 11)}`;

test('isRuleIdentity accepts an identity followed by a kebab-case rule name', async () => {
  await expect(answers(['@a/b/c-d', 'pkg/rule'])).resolves.toEqual([true, true]);
});

test('isRuleIdentity rejects a value with no rule name, a rule name outside kebab-case, an empty segment, and a value that is not a string', async () => {
  await expect(answers(['pkg', '@a/b', 'pkg/Rule', 'pkg//r', 7])).resolves.toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});

test('a rule identity rejects a tilde in its package name, as npm does', async () => {
  await expect(answers(['~x/rule', 'a~b/rule'])).resolves.toEqual([false, false]);
});

test("a rule identity's package name holds at most 214 characters, and its segments do not count", async () => {
  const segments = `/${'p'.repeat(100)}/${'q'.repeat(100)}`;
  await expect(
    answers([`${named(214)}/rule`, `${named(215)}/rule`, `${scoped(214)}${segments}`]),
  ).resolves.toEqual([true, false, true]);
  await expect(answers([`${scoped(215)}/rule`])).resolves.toEqual([false]);
});
