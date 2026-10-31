import { expect, test } from 'vite-plus/test';
// Acceptance plan: see packages/core/tests/developer-diagnostics.test.ts.

import { invoke } from '../../../scripts/test-process.js';
import { invoke as invokeFixture } from './run-fixture.ts';

// A faulty call is an uncaught exception in the module that makes it, so no run reports it.
test("an author's faulty call throws while its module is imported, with a stack at the line", () => {
  const result = invoke(new URL('fixtures/import-fault.mjs', import.meta.url));
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('list.mjs:6:');
  // The runtime prints the diagnostic the error's message holds, banner included.
  expect(result.stderr).toContain(
    '-- SPELLING USED TWICE ---------------------------- @loomcli/core/spelling-taken\n\nOption spelling "-v" is used by both "verbose" and "version".\n',
  );
  expect(result.stderr).toContain('\nChange one declaration.\n');
  expect(result.stderr).not.toContain('Invalid declaration:');
});

/** One scenario of the declaration-calls fixture, read as the JSON it prints. */
async function calls(scenario: string): Promise<unknown> {
  const result = await invokeFixture(new URL('fixtures/declaration-calls.mjs', import.meta.url), [
    scenario,
  ]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test('a Command value publishes its authoring calls and no declared state', async () => {
  await expect(calls('surface')).resolves.toEqual({
    declared: false,
    members: [
      'action',
      'alias',
      'argument',
      'command',
      'constructor',
      'exclusive',
      'extend',
      'oneRequired',
      'option',
      'requiredTogether',
      'result',
      'rows',
      'stdin',
      'views',
    ],
  });
});

const collision =
  'thrown: Option "g" is declared as a global option and as a local option on Command "bad". Rename the local option.';

test('a join that throws leaves no claim, so the value it walked attaches elsewhere', async () => {
  await expect(calls('owners-after-fault')).resolves.toEqual([collision, 'ok']);
});

test('a join that throws leaves no descriptor behind in the Application', async () => {
  await expect(calls('descriptors-after-fault')).resolves.toEqual([collision, 'ok']);
});
