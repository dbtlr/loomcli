import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/color-declarations.mjs', import.meta.url);

/** One scenario's outcome: `ok`, or the call that threw, its rule, and its sentence and fix. */
function outcome(scenario: string): unknown {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const rule = '@loomcli/core/color-mark';

test('a Boolean global option with polarity both carries the mark', () => {
  expect(outcome('boolean')).toBe('ok');
});

test.each([
  [
    'local-application',
    'option',
    'The root Command option "color" declares color but is not a global option. Declare it with globalOption().',
  ],
  [
    'local-command',
    'option',
    'Command "paint" option "color" declares color but is not a global option. Declare it with globalOption().',
  ],
  [
    'string',
    'globalOption',
    'Global option "color" declares color but is not Boolean. Use type "boolean".',
  ],
  [
    'count',
    'globalOption',
    'Global option "color" declares color but is not Boolean. Use type "boolean".',
  ],
  [
    'not-true',
    'globalOption',
    'Global option "color" declares color that is not true. Remove color or set it to true.',
  ],
  [
    'not-true-plugin',
    'plugin',
    'Plugin "@fixture/paint" option "color" declares color that is not true. Remove color or set it to true.',
  ],
  [
    'two-global',
    'globalOption',
    'Global option "paint" and plugin "@loomcli/plugins/color" option "color" both declare color. Mark one option.',
  ],
  [
    'two-own',
    'globalOption',
    'Global option "paint" and global option "tint" both declare color. Mark one option.',
  ],
  [
    'two-plugins',
    'new Application',
    'Plugin "@fixture/paint" option "paint" and plugin "@loomcli/plugins/color" option "color" both declare color. Mark one option.',
  ],
  [
    'short',
    'globalOption',
    'Global option "color" declares color and a short alias. Remove short; the run reads its color before it reads short groups.',
  ],
  [
    'short-plugin',
    'plugin',
    'Plugin "@fixture/paint" option "color" declares color and a short alias. Remove short; the run reads its color before it reads short groups.',
  ],
  [
    'env-global',
    'globalOption',
    `Global option "color" declares color and env, a second source for the run's color. Remove env; NO_COLOR and FORCE_COLOR speak for the environment.`,
  ],
  [
    'env-plugin',
    'plugin',
    `Plugin "@fixture/paint" option "color" declares color and env, a second source for the run's color. Remove env; NO_COLOR and FORCE_COLOR speak for the environment.`,
  ],
  [
    'binding-global',
    'globalOption',
    `Global option "color" declares color and carries configuration binding "@loomcli/plugins/config/input", a second source for the run's color. Remove the binding; the run reads its color before configuration.`,
  ],
  [
    'binding-plugin',
    'new Application',
    `Plugin "@fixture/paint" option "color" declares color and carries configuration binding "@loomcli/plugins/config/input", a second source for the run's color. Remove the binding; the run reads its color before configuration.`,
  ],
])('the color mark rejects %s from %s', (scenario, threw, text) => {
  expect(outcome(scenario)).toEqual({ rule, text, threw });
});

test('a binding of a source the Application does not install is inert and no fault', () => {
  expect(outcome('binding-inert')).toBe('ok');
});

test('inspect() publishes color on each Boolean option node, true on the marked one alone', () => {
  // A string option's node carries no color fact, so it reads undefined, which JSON prints as null.
  expect(outcome('inspect')).toEqual([
    ['quiet', false],
    ['tint', null],
    ['color', true],
  ]);
});
