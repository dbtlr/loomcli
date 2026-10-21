import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { declaredRules, coreRuleParts } from './rule-parts.js';
import type { RuleParts } from './rule-parts.js';

const fixture = new URL('fixtures/command-diagnostics.mjs', import.meta.url);

/** The diagnostic one scenario's faulty declaration throws, as its message holds it. */
function thrown(scenario: string): string {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

const portable =
  'Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".';

/** Each scenario's fault by the parts its rule's test pins; the layout goldens pin the rest. */
const cases: Record<string, RuleParts> = {
  'alias-portable': {
    correction: portable,
    rule: 'portable-name',
    sentence: 'Command "keys" declares an alias named "bad name".',
  },
  'application-name': {
    correction: portable,
    rule: 'portable-name',
    sentence: 'Application name "bad name" is invalid.',
  },
  'argument-beside-child': {
    correction: 'Move the argument into a child Command or remove the children.',
    rule: 'arguments-beside-children',
    sentence: 'The root Command declares argument "files" and attaches child "check".',
  },
  'argument-name': {
    correction: 'Use a nonempty name without a leading hyphen, whitespace, or "=".',
    rule: 'declared-name',
    sentence: 'Command "get" declares an argument named "-path".',
  },
  'argument-twice': {
    correction: 'Remove or rename the duplicate.',
    rule: 'argument-declared-twice',
    sentence: 'Argument "path" is declared more than once on Command "get".',
  },
  'attached-twice': {
    correction: 'Attach a Command value at one point; create a new Command for each placement.',
    rule: 'command-attached-twice',
    sentence: 'Command "tmp" attaches child "clear", which Command "cache" also attaches.',
  },
  'child-without-action': {
    correction: 'Register an action.',
    rule: 'command-without-action',
    sentence: 'Command "get" has no action.',
  },
  'command-name': {
    correction: portable,
    rule: 'portable-name',
    sentence: 'Command name "bad name" is invalid.',
  },
  'optional-before-required': {
    correction: 'Declare optional arguments after required ones.',
    rule: 'optional-argument-last',
    sentence:
      'Argument "path" is optional and precedes required argument "name" on Command "keys".',
  },
  'plugin-sibling': {
    correction: 'Rename or remove one.',
    rule: 'sibling-name-taken',
    sentence:
      'The root Command attaches child "probe" with alias "check", which is also the name of child "check".',
  },
  'sibling-alias': {
    correction: 'Rename or remove one.',
    rule: 'sibling-name-taken',
    sentence:
      'Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select".',
  },
  'sibling-alias-name': {
    correction: 'Rename or remove one.',
    rule: 'sibling-name-taken',
    sentence:
      'Command "store" attaches child "keys" with alias "get", which is also the name of child "get".',
  },
  'sibling-name': {
    correction: 'Rename or remove one.',
    rule: 'sibling-name-taken',
    sentence: 'Command "store" attaches two children named "get".',
  },
  'sibling-name-alias': {
    correction: 'Rename or remove one.',
    rule: 'sibling-name-taken',
    sentence:
      'Command "store" attaches child "keys" with alias "get", which is also the name of child "get".',
  },
  'variadic-not-last': {
    correction: 'Declare the variadic argument last.',
    rule: 'variadic-argument-last',
    sentence: 'Argument "paths" is variadic and precedes argument "path" on Command "get".',
  },
};

test.each(Object.entries(cases))('the %s fault throws its rule’s diagnostic', (scenario, parts) => {
  expect(coreRuleParts(thrown(scenario))).toEqual(parts);
});

/** The faults run() reports from a development build, which wait for the graph to be built. */
const reportedCases: Record<string, RuleParts> = {
  'root-without-action': {
    correction: 'Register an action.',
    rule: 'command-without-action',
    sentence: 'The root Command has no action.',
  },
};

test.each(Object.entries(reportedCases))(
  'the %s fault reports its rule’s diagnostic from run()',
  (scenario, parts) => {
    const result = invoke(fixture, [scenario]);
    expect(result).toMatchObject({ status: 1, stdout: '' });
    expect(coreRuleParts(result.stderr)).toEqual(parts);
  },
);

test('every rule of the family has a pinned diagnostic', () => {
  const pinned = new Set(
    [...Object.values(cases), ...Object.values(reportedCases)].map((parts) => parts.rule),
  );
  expect(declaredRules('command-rules.ts').toSorted()).toEqual([...pinned].toSorted());
});
