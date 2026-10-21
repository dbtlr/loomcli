import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/background-declarations.mjs', import.meta.url);

/** One scenario's outcome: `ok`, or the call that threw, its rule, and its sentence and fix. */
function outcome(scenario: string): unknown {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const rule = '@loomcli/core/background-mark';

test('a string global option carries the background mark, with aliases', () => {
  expect(outcome('string')).toBe('ok');
  expect(outcome('alias')).toBe('ok');
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
])('the background mark rejects %s from %s', (scenario, threw, text) => {
  expect(outcome(scenario)).toEqual({ rule, text, threw });
});

test('a binding of a source the Application does not install is inert beside the mark', () => {
  expect(outcome('binding-inert')).toBe('ok');
});

test('inspect() publishes background on each string option node, true on the marked one', () => {
  // A Boolean option's node carries no background fact, so it reads undefined, which JSON prints as null.
  expect(outcome('inspect')).toEqual([
    ['name', false],
    ['dry', null],
    ['background', true],
  ]);
});

test('style.adaptive takes an unapplied concrete chain for dark and for light, and nothing else', () => {
  const fault =
    'TypeError: Adaptive styles take an unapplied concrete style chain for dark and for light.';
  expect(outcome('adaptive')).toEqual({
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

test('a bare theme() accepts an adaptive entry and a custom token named adaptive', () => {
  expect(outcome('adaptive-entry')).toBe('ok');
  expect(outcome('adaptive-name')).toBe('ok');
});
