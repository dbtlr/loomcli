import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for the failure form (docs/core/failures.md#the-failure-form).
 *
 * The failure form is proven when public APIs alone produce these results under Node and Bun:
 *
 * - A fatal failure. A failed outcome and its handler carry one frozen form that reads `{ code:
 *   'fatal', exitCode: 1, message: 'The registry is down.', hints: [] }` in the contract's key
 *   order.
 * - Two problems. An `InputError` with two problems reads both lines in `message`, with no
 *   application name and no trailing newline.
 * - Plain text. A `FatalError` whose message carries a style mark, and a hint that carries one,
 *   read as plain text with no ANSI and no markup under `FORCE_COLOR=1`.
 * - By build. A `TypeError` from an action reads `Something went wrong.` from a bundle and the
 *   defect's sentence from source, and neither form holds a stack frame.
 * - Hints. Two fixture plugins' hints read in installation order, and a build fault reads `[]`.
 * - Exit codes. A usage error whose `onFailure` hook breaks reads `exitCode` 2 in the form and 1 on
 *   the outcome.
 * - Frozen. An assignment to a form's member throws in strict mode code.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

async function form(
  scenario: string,
  build: 'development' | 'distributed' = 'distributed',
  env: Record<string, string> = {},
): Promise<unknown> {
  const result = await invokeFixture(
    new URL('fixtures/failure-form.mjs', import.meta.url),
    [scenario, build],
    {
      env,
    },
  );
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test("a failed outcome and its handler carry one frozen form, whose keys read in the contract's order", async () => {
  await expect(form('fatal')).resolves.toEqual({
    exitCode: 1,
    form: { code: 'fatal', exitCode: 1, hints: [], message: 'The registry is down.' },
    frozen: true,
    keys: ['code', 'exitCode', 'message', 'hints'],
    same: true,
  });
});

test('an input error with two problems holds both lines, with no application name and no trailing newline', async () => {
  await expect(form('two-problems')).resolves.toEqual({
    code: 'invalid-input',
    exitCode: 2,
    hints: [],
    message:
      'Option "limit": Use decimal digits.\nArgument "path" requires a value. Supply a value for "path".',
  });
});

test('a marked message and a marked hint read as plain text', async () => {
  await expect(form('plain', 'distributed', { FORCE_COLOR: '1' })).resolves.toEqual({
    code: 'fatal',
    exitCode: 1,
    hints: ['Run it again.'],
    message: 'The registry is down.',
  });
});

test('a defect reads the generic message from a bundle and its sentence from source, with no stack', async () => {
  await expect(form('defect', 'distributed')).resolves.toEqual({
    code: 'internal',
    exitCode: 1,
    hints: [],
    message: 'Something went wrong.',
  });
  await expect(form('defect', 'development')).resolves.toEqual({
    code: 'internal',
    exitCode: 1,
    hints: [],
    message: 'Cannot read the value.',
  });
});

test("two plugins' hints read in installation order, and a build fault reads none", async () => {
  await expect(form('hints')).resolves.toEqual(['First hint.', 'Second.', 'Third.']);
  await expect(form('build-fault')).resolves.toEqual({
    exitCode: 1,
    form: { code: 'internal', exitCode: 1, hints: [], message: 'Something went wrong.' },
  });
});

test("a broken hook forces 1 on the outcome while the form keeps the failure's own exit code", async () => {
  await expect(form('broken-hook')).resolves.toEqual({
    exitCode: 1,
    form: {
      code: 'unknown-command',
      exitCode: 2,
      hints: [],
      message: 'Unknown command "nope". Use one of: get.',
    },
  });
});

test("an assignment to a form's member throws in strict mode code", async () => {
  await expect(form('frozen')).resolves.toBe('TypeError');
});
