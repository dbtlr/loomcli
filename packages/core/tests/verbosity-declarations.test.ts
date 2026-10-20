import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/verbosity-declarations.mjs', import.meta.url);

/** One scenario's outcome: `ok`, or the call that threw, its rule, and its sentence and fix. */
function outcome(mark: string, scenario: string): unknown {
  const result = invoke(fixture, [mark, scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/** The rows one mark's table holds, each sentence written with the mark's own name. */
function rows(mark: 'verbose' | 'quiet'): [string, string, string][] {
  const subject = (owner: string) => `${owner} "${mark}"`;
  return [
    [
      'local-application',
      'option',
      `The root Command option "${mark}" declares ${mark} but is not a global option. Declare it with globalOption().`,
    ],
    [
      'local-command',
      'option',
      `Command "loud" option "${mark}" declares ${mark} but is not a global option. Declare it with globalOption().`,
    ],
    [
      'string',
      'globalOption',
      `${subject('Global option')} declares ${mark} but is not a counted option. Use type "count".`,
    ],
    [
      'boolean',
      'globalOption',
      `${subject('Global option')} declares ${mark} but is not a counted option. Use type "count".`,
    ],
    [
      'not-true',
      'globalOption',
      `${subject('Global option')} declares ${mark} that is not true. Remove ${mark} or set it to true.`,
    ],
    [
      'not-true-plugin',
      'plugin',
      `Plugin "@fixture/loud" option "${mark}" declares ${mark} that is not true. Remove ${mark} or set it to true.`,
    ],
    [
      'two-global',
      'globalOption',
      `Global option "loud" and plugin "@loomcli/plugins/verbose" option "${mark}" both declare ${mark}. Mark one option.`,
    ],
    [
      'two-own',
      'globalOption',
      `Global option "loud" and global option "louder" both declare ${mark}. Mark one option.`,
    ],
    [
      'two-plugins',
      'new Application',
      `Plugin "@fixture/loud" option "loud" and plugin "@loomcli/plugins/verbose" option "${mark}" both declare ${mark}. Mark one option.`,
    ],
    [
      'env-global',
      'globalOption',
      `${subject('Global option')} declares ${mark} and env, a second source for the run's verbosity. Remove env; the run settles its verbosity before it reads the environment.`,
    ],
    [
      'env-plugin',
      'plugin',
      `Plugin "@fixture/loud" option "${mark}" declares ${mark} and env, a second source for the run's verbosity. Remove env; the run settles its verbosity before it reads the environment.`,
    ],
    [
      'binding-global',
      'globalOption',
      `${subject('Global option')} declares ${mark} and carries configuration binding "@loomcli/plugins/config/input", a second source for the run's verbosity. Remove the binding; the run settles its verbosity before configuration.`,
    ],
    [
      'binding-plugin',
      'new Application',
      `Plugin "@fixture/loud" option "${mark}" declares ${mark} and carries configuration binding "@loomcli/plugins/config/input", a second source for the run's verbosity. Remove the binding; the run settles its verbosity before configuration.`,
    ],
  ];
}

test.each(['verbose', 'quiet'])('a counted global option carries the %s mark', (mark) => {
  expect(outcome(mark, 'count')).toBe('ok');
});

test.each(['verbose', 'quiet'])(
  'the %s mark takes a short alias and aliases, and a short-only spelling',
  (mark) => {
    expect(outcome(mark, 'short')).toBe('ok');
    expect(outcome(mark, 'short-only')).toBe('ok');
  },
);

test.each(rows('verbose'))('the verbose mark rejects %s from %s', (scenario, threw, text) => {
  expect(outcome('verbose', scenario)).toEqual({
    rule: '@loomcli/core/verbose-mark',
    text,
    threw,
  });
});

test.each(rows('quiet'))('the quiet mark rejects %s from %s', (scenario, threw, text) => {
  expect(outcome('quiet', scenario)).toEqual({ rule: '@loomcli/core/quiet-mark', text, threw });
});

test.each([
  ['both-global', 'globalOption', 'Global option "verbose"'],
  ['both-plugin', 'plugin', 'Plugin "@fixture/loud" option "verbose"'],
])(
  'both marks on one option are rejected under the verbose rule, %s',
  (scenario, threw, subject) => {
    expect(outcome('both', scenario)).toEqual({
      rule: '@loomcli/core/verbose-mark',
      text: `${subject} declares verbose and quiet. Mark one; declare a second counted option for the other.`,
      threw,
    });
  },
);

test('an author may mark a verbose option alone', () => {
  expect(outcome('both', 'verbose-alone')).toBe('ok');
});

test.each(['verbose', 'quiet'])(
  'a binding of a source the Application does not install is inert beside the %s mark',
  (mark) => {
    expect(outcome(mark, 'binding-inert')).toBe('ok');
  },
);

test('inspect() publishes verbose and quiet on each counted option node, true on the marked one', () => {
  // A Boolean option's node carries neither fact, so each reads undefined, which JSON prints as null.
  expect(outcome('inspect', '')).toEqual([
    ['level', false, false],
    ['dry', null, null],
    ['verbose', true, false],
    ['quiet', false, true],
  ]);
});
