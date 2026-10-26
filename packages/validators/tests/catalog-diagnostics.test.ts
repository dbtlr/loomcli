// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { DeclarationError } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { registeredRules, ruleContract, ruleParts } from '../../../scripts/test-rules.js';
import {
  createValidator,
  dateTime,
  duration,
  integer,
  issueCode,
  oneOf,
  text,
  url,
} from '../src/index.js';

const parse = (raw: unknown) => ({ value: raw });

/** The parameters of the fixture issue code, whatever a call passes. */
interface Shout {
  readonly word: unknown;
}

/** A Standard Schema over the issue code's parameters that answers each value with `answer`. */
function schema(
  answer: (value: unknown) => StandardSchemaV1.Result<Shout>,
): StandardSchemaV1<Shout, Shout> {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}

const message = ({ word }: Shout) => `Expected ${String(word)} in capitals.`;

/** One faulty factory call per scenario, each reachable from JavaScript alone. */
const scenarios: Record<string, () => unknown> = {
  'bound-value': () => integer({ min: Number.POSITIVE_INFINITY }),
  'bounds-order': () => integer({ max: 1, min: 5 }),
  'context-outside-run': () =>
    createValidator({ parse: (_raw, context) => ({ value: context.host }) })['~standard'].validate(
      'x',
    ),
  'duration-bound-value': () => duration({ min: 'abc' }),
  'duration-bounds-order': () => duration({ max: '30s', min: '1h' }),
  'input-schema': () => createValidator({ inputSchema: { $schema: 'x', type: 'string' }, parse }),
  'issue-code-name': () =>
    issueCode('Bad Code', { message, schema: schema((value) => ({ value: { word: value } })) }),
  'issue-parameters': () =>
    issueCode('@acme/checks/shout', {
      message,
      schema: schema(() => ({ issues: [{ message: 'Expected a string.' }] })),
    }).issue({ word: 7 }),
  'one-of-twice': () => oneOf(['dev', 'prod', 'dev']),
  'text-bounds-order': () => text({ maxLength: 0 }),
  'text-pattern': () => text({ message: 'Expected letters.', pattern: /[a-z]+/g }),
  'time-zone': () => dateTime({ timeZone: 'Mars/Olympus' }),
  'url-protocols': () => url({ protocols: ['https', 'https:'] }),
};

/** The Developer Diagnostic the scenario's call throws as a declaration fault. */
function diagnosticOf(scenario: string): string {
  try {
    scenarios[scenario]?.();
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return `${error.message}\n`;
  }
  return 'returned\n';
}

/** One fault by the parts its rule's test pins: the rule under the catalog's name, the sentence, the fix. */
interface Expected {
  readonly rule: string;
  readonly sentence: string;
  readonly correction: string;
}

const cases: Record<string, Expected> = {
  'bound-value': {
    correction: 'Supply a finite number.',
    rule: 'bound-value',
    sentence: 'integer() min is not a finite number.',
  },
  'bounds-order': {
    correction: 'Supply a min at or below max.',
    rule: 'bounds-order',
    sentence: 'integer() min 5 is above max 1.',
  },
  'context-outside-run': {
    correction:
      'Call the validator through an Application run or with the options validationOptions builds, or leave the context unread.',
    rule: 'context-outside-run',
    sentence: 'This validator reads the validation context, which only exists during a Loom run.',
  },
  'duration-bound-value': {
    correction: 'Supply a duration such as "30s" or "2h30m".',
    rule: 'bound-value',
    sentence: 'duration() min is not a duration.',
  },
  'duration-bounds-order': {
    correction: 'Supply a min at or below max.',
    rule: 'bounds-order',
    sentence: 'duration() min 1h is above max 30s.',
  },
  'input-schema': {
    correction: 'Leave out $schema, which the validator publishes itself.',
    rule: 'input-schema',
    sentence: 'createValidator() inputSchema declares its own $schema.',
  },
  'issue-code-name': {
    correction:
      'Supply a code such as "@acme/validators/port-range", with each subpath segment and the rule of lowercase letters and digits in words joined by single hyphens.',
    rule: 'issue-code-name',
    sentence:
      'issueCode() code "Bad Code" is not a package name, any subpath segments, and a rule name joined by slashes.',
  },
  'issue-parameters': {
    correction: 'Supply parameters its schema accepts.',
    rule: 'issue-parameters',
    sentence: 'Issue code "@acme/checks/shout" rejects the parameters passed to issue().',
  },
  'one-of-twice': {
    correction: 'List each value once.',
    rule: 'one-of-values',
    sentence: 'oneOf() lists "dev" twice.',
  },
  'text-bounds-order': {
    correction: 'Supply a minLength at or below maxLength.',
    rule: 'bounds-order',
    sentence: 'text() minLength 1 is above maxLength 0.',
  },
  'text-pattern': {
    correction: 'Supply a pattern with no flag other than u.',
    rule: 'invalid-pattern',
    sentence: 'text() pattern carries the flag g.',
  },
  'time-zone': {
    correction: 'Supply a name such as America/New_York.',
    rule: 'time-zone',
    sentence: 'dateTime() timeZone is not an IANA time zone name.',
  },
  'url-protocols': {
    correction: 'List a letter followed by letters, digits, +, -, or ., with no trailing colon.',
    rule: 'url-protocols',
    sentence: 'url() protocols lists "https:", which is not a scheme name.',
  },
};

test.each(Object.entries(cases))(
  'the %s fault throws its rule’s diagnostic',
  (scenario, expected) => {
    expect(ruleParts(diagnosticOf(scenario))).toEqual({
      correction: expected.correction,
      identity: `@loomcli/validators/${expected.rule}`,
      sentence: expected.sentence,
    });
  },
);

/** Every rule the catalog's registry declares, under the catalog's name. */
const declared = registeredRules(
  new URL('../src/rules.ts', import.meta.url),
  /catalogRule\('(?<name>[a-z0-9-]+)', \{/gu,
);

test('every rule of the catalog has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(cases).map((expected) => expected.rule));
  expect(declared.map((rule) => rule.name).toSorted()).toEqual([...pinned].toSorted());
});

// Each explanation lives in the registry alone; a rule's own test pins its sentence and correction.
test('every rule of the catalog has a one-line headline and an explanation of whole sentences', () => {
  const names = declared.map((rule) => rule.name);
  expect(names).toEqual([...new Set(names)]);
  expect(declared).toEqual(names.map((name) => ruleContract(name)));
});
