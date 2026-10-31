import { expect, test } from 'vite-plus/test';
// Acceptance plan: see packages/core/tests/background.test.ts.

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/background-declarations.mjs', import.meta.url);

/** One scenario's outcome: `ok`, or the call that threw, its rule, and its sentence and fix. */
async function outcome(scenario: string): Promise<unknown> {
  const result = await invokeFixture(fixture, [scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const rule = '@loomcli/core/background-mark';

test('a string global option carries the background mark, with aliases', async () => {
  await expect(outcome('string')).resolves.toBe('ok');
  await expect(outcome('alias')).resolves.toBe('ok');
});

test.each([
  [
    'two-global',
    'globalOption',
    'Global option "shade" and plugin "@loomcli/plugins/background" option "background" both declare background. Mark one option.',
  ],
  [
    'two-own',
    'globalOption',
    'Global option "shade" and global option "tint" both declare background. Mark one option.',
  ],
  [
    'two-plugins',
    'new Application',
    'Plugin "@fixture/shade" option "shade" and plugin "@loomcli/plugins/background" option "background" both declare background. Mark one option.',
  ],
  [
    'binding-global',
    'globalOption',
    'Global option "background" declares background and carries configuration binding "@loomcli/plugins/config/input", a second source for the run\'s background. Remove the binding; the run reads its background before configuration.',
  ],
  [
    'binding-plugin',
    'new Application',
    'Plugin "@fixture/shade" option "background" declares background and carries configuration binding "@loomcli/plugins/config/input", a second source for the run\'s background. Remove the binding; the run reads its background before configuration.',
  ],
])('the background mark rejects %s from %s', async (scenario, threw, text) => {
  await expect(outcome(scenario)).resolves.toEqual({ rule, text, threw });
});

test('a binding of a source the Application does not install is inert beside the mark', async () => {
  await expect(outcome('binding-inert')).resolves.toBe('ok');
});

test('inspect() publishes background on each string option node, true on the marked one', async () => {
  // A Boolean option's node carries no background fact, so it reads undefined, which JSON prints as null.
  await expect(outcome('inspect')).resolves.toEqual([
    ['name', false],
    ['dry', null],
    ['background', true],
  ]);
});

test('style.adaptive takes an unapplied concrete chain for dark and for light, and nothing else', async () => {
  const fault =
    'TypeError: Adaptive styles take an unapplied concrete style chain for dark and for light.';
  await expect(outcome('adaptive')).resolves.toEqual({
    adaptive: fault,
    applied: fault,
    array: fault,
    extra: fault,
    missing: fault,
    none: fault,
    semantic: fault,
    undefined: fault,
  });
});

test('a bare theme() accepts an adaptive entry and a custom token named adaptive', async () => {
  await expect(outcome('adaptive-entry')).resolves.toBe('ok');
  await expect(outcome('adaptive-name')).resolves.toBe('ok');
});
