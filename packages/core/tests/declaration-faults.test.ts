import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

// A faulty call is an uncaught exception in the module that makes it, so no run reports it.
test("a JavaScript author's faulty call throws while its module is imported, with a stack at the line", () => {
  const result = invoke(new URL('fixtures/import-fault.mjs', import.meta.url));
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'Option "verbose" is a boolean option and declares multiple. Remove multiple or declare a string option.',
  );
  expect(result.stderr).toContain('list.mjs:4:');
  expect(result.stderr).not.toContain('Invalid declaration:');
});

/** One scenario of the declaration-calls fixture, read as the JSON it prints. */
function calls(scenario: string): unknown {
  const result = invoke(new URL('fixtures/declaration-calls.mjs', import.meta.url), [scenario]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test('a Command value publishes its authoring calls and no declared state', () => {
  expect(calls('surface')).toEqual({
    declared: false,
    members: [
      'action',
      'alias',
      'argument',
      'command',
      'constructor',
      'extend',
      'option',
      'result',
      'rows',
      'views',
    ],
  });
});

test('a named parent throws at its own command() call for a child that has children', () => {
  expect(calls('named-parent')).toEqual([
    'thrown: Command "store" attaches child "cache", which has children of its own. Nest Commands at most two levels below the root.',
  ]);
});

const collision =
  'thrown: Option "g" is declared as a global option and as a local option on Command "bad". Rename the local option.';

test('a join that throws leaves no claim, so the value it walked attaches elsewhere', () => {
  expect(calls('owners-after-fault')).toEqual([collision, 'ok']);
});

test('a join that throws leaves no descriptor behind in the Application', () => {
  expect(calls('descriptors-after-fault')).toEqual([collision, 'ok']);
});
