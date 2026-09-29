import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/catalog-diagnostics.mjs', import.meta.url);

/** Each rule's explanation as an 80-column diagnostic wraps it. */
const explanations = {
  'bound-value': [
    'A bound limits the values or the length a validator accepts, and the published',
    'schema carries it, so it is a number of the kind the validator reads: a safe',
    'integer for integer(), a finite number for number(), and a non-negative safe',
    "integer for text()'s lengths.",
  ],
  'bounds-order': [
    'A validator accepts what lies between its lower and its upper bound, both',
    'inclusive, so a lower bound above the upper one would reject every token.',
  ],
  'context-outside-run': [
    'Core attaches the validation context to each call it makes to a validator. A',
    'call from anywhere else, such as a unit test, carries none, so a validator that',
    'reads it runs inside an Application run.',
  ],
  'factory-options': [
    'A catalog factory reads its settings from one options object, so a value of any',
    'other kind leaves it no settings to read.',
  ],
  'input-schema': [
    'createValidator() publishes its input schema as draft 2020-12 JSON Schema and',
    'adds the $schema dialect itself, so inputSchema is a plain object with no',
    '$schema of its own.',
  ],
  'invalid-pattern': [
    'text() publishes its pattern in the JSON Schema it serves, which reads a pattern',
    'under the u flag alone, so the pattern is a regular expression that compiles',
    'under u and carries no other flag.',
  ],
  'issue-code-config': [
    "An issue code checks each issue's parameters with its schema and builds the",
    "issue's sentence from them with its message function, so its config holds both.",
  ],
  'issue-code-name': [
    'An issue code names the package that declares it and the one sentence it prints,',
    'so a view rewords that sentence by its code. It is a package name, any',
    'kebab-case subpath segments, and a kebab-case rule name, joined by /.',
  ],
  'issue-code-schema': [
    "issue() and read() check an issue's parameters with the code's schema",
    'synchronously, while a validator builds the issue or a view reads it, so the',
    'schema returns its value or its issues, and neither throws nor answers with a',
    'promise.',
  ],
  'issue-parameters': [
    "An issue carries parameters its code's schema accepts, so every view that reads",
    'them through read() gets the shape the code declares.',
  ],
  'one-of-values': [
    'oneOf() accepts a token equal to one of its values, and help, completion, and',
    'the published schema offer each value as a choice, so the list holds at least',
    'one value, each a distinct nonempty string.',
  ],
  'path-check': [
    'path() reads the file system only to check an access, read or write, and kind',
    'narrows that check to a file, a directory, or any entry, so kind has no meaning',
    'without access.',
  ],
  'pattern-message': [
    'Only the author can say what a pattern accepts, so text() takes a pattern',
    'together with one sentence that states it, and prints that sentence when a token',
    'does not match.',
  ],
  'url-protocols': [
    'url() accepts a URL whose scheme the list names and publishes the list as a',
    'pattern, so it holds at least one scheme name: a letter followed by letters,',
    'digits, +, -, or ., with no trailing colon.',
  ],
  'validator-definition': [
    'createValidator() builds a Standard Schema value around one parse function that',
    'validates a raw string, so its definition is an object that holds that function.',
  ],
};

type Rule = keyof typeof explanations;

/** One rule's diagnostic: its banner, the sentence, each finding, the explanation, and the fix. */
interface Expected {
  readonly rule: Rule;
  readonly headline: string;
  readonly sentence: string;
  readonly findings: readonly (readonly string[])[];
  readonly correction: string;
}

/** The banner fills 80 columns between the headline and the identity. */
function banner(headline: string, rule: Rule): string {
  const left = `-- ${headline} `;
  const right = ` @loomcli/validators/${rule}`;
  return `${left}${'-'.repeat(80 - left.length - right.length)}${right}`;
}

function diagnostic({ correction, findings, headline, rule, sentence }: Expected): string {
  const sections = [
    banner(headline, rule),
    sentence,
    ...findings.map((lines) => lines.join('\n')),
    explanations[rule].join('\n'),
    correction,
  ];
  return `${sections.join('\n\n')}\n`;
}

/** One printed call, and the carets under the `nth` place `target` occurs in it. */
function marked(call: string, target: string, note?: string, nth = 0): string[] {
  const line = `    ${call}`;
  let start = line.indexOf(target);
  for (let seen = 0; seen < nth; seen += 1) {
    start = line.indexOf(target, start + target.length);
  }
  expect(start).toBeGreaterThanOrEqual(0);
  const carets = `${' '.repeat(start)}${'^'.repeat(target.length)}`;
  return [line, note === undefined ? carets : `${carets} ${note}`];
}

const schemaCall = "issueCode('@acme/checks/shout', { message: …, schema: … })";

const cases: Record<string, Expected> = {
  'bound-value': {
    correction: 'Supply a whole number from -9007199254740991 through 9007199254740991.',
    findings: [marked('integer({ min: 1.5 })', 'min: 1.5')],
    headline: 'INVALID BOUND',
    rule: 'bound-value',
    sentence: 'integer() min is not a safe integer.',
  },
  'bounds-order': {
    correction: 'Supply a min at or below max.',
    findings: [marked('integer({ max: 1, min: 5 })', 'min: 5')],
    headline: 'BOUNDS OUT OF ORDER',
    rule: 'bounds-order',
    sentence: 'integer() min 5 is above max 1.',
  },
  'context-outside-run': {
    correction: 'Call the validator through an Application run, or leave the context unread.',
    findings: [],
    headline: 'CONTEXT OUTSIDE A RUN',
    rule: 'context-outside-run',
    sentence: 'This validator reads the validation context, which only exists during a Loom run.',
  },
  'factory-options': {
    correction: 'Supply an object or leave it out.',
    findings: [marked("number('5')", "'5'")],
    headline: 'OPTIONS NOT AN OBJECT',
    rule: 'factory-options',
    sentence: 'number() options is not a plain object.',
  },
  'input-schema': {
    correction: 'Leave out $schema, which the validator publishes itself.',
    findings: [
      marked(
        "createValidator({ inputSchema: { $schema: 'x', type: 'string' }, parse: … })",
        "$schema: 'x'",
      ),
    ],
    headline: 'INVALID INPUT SCHEMA',
    rule: 'input-schema',
    sentence: 'createValidator() inputSchema declares its own $schema.',
  },
  'issue-code-config': {
    correction: 'Supply a function that builds the sentence from the parameters.',
    findings: [
      marked("issueCode('@acme/checks/shout', { message: 'x', schema: … })", "message: 'x'"),
    ],
    headline: 'INVALID ISSUE CODE CONFIG',
    rule: 'issue-code-config',
    sentence: 'issueCode() message is not a function.',
  },
  'issue-code-name': {
    correction:
      'Supply a code such as "@acme/validators/port-range", with each subpath segment and the rule of lowercase letters and digits in words joined by single hyphens.',
    findings: [marked("issueCode('Bad Code', { message: …, schema: … })", "'Bad Code'")],
    headline: 'INVALID ISSUE CODE',
    rule: 'issue-code-name',
    sentence:
      'issueCode() code "Bad Code" is not a package name, any subpath segments, and a rule name joined by slashes.',
  },
  'issue-code-schema': {
    correction: 'Supply a schema that returns its issues instead of throwing.',
    findings: [marked(schemaCall, 'schema: …')],
    headline: 'BROKEN ISSUE CODE SCHEMA',
    rule: 'issue-code-schema',
    sentence: 'Issue code "@acme/checks/shout" has a schema that throws in issue().',
  },
  'issue-parameters': {
    correction: 'Supply parameters its schema accepts.',
    findings: [marked('issue({ word: 7 })', '{ word: 7 }')],
    headline: 'ISSUE PARAMETERS REJECTED',
    rule: 'issue-parameters',
    sentence: 'Issue code "@acme/checks/shout" rejects the parameters passed to issue().',
  },
  'one-of-empty': {
    correction: 'List at least one value.',
    findings: [marked('oneOf([])', '[]')],
    headline: 'INVALID ONEOF VALUES',
    rule: 'one-of-values',
    sentence: 'oneOf() values is empty.',
  },
  'one-of-twice': {
    correction: 'List each value once.',
    findings: [
      marked("oneOf(['dev', 'prod', 'dev'])", "'dev'", 'the first'),
      marked("oneOf(['dev', 'prod', 'dev'])", "'dev'", 'the second', 1),
    ],
    headline: 'INVALID ONEOF VALUES',
    rule: 'one-of-values',
    sentence: 'oneOf() lists "dev" twice.',
  },
  'path-check': {
    correction: 'Supply an access or leave out kind.',
    findings: [marked("path({ kind: 'file' })", "kind: 'file'")],
    headline: 'INVALID PATH CHECK',
    rule: 'path-check',
    sentence: 'path() kind has no access to check.',
  },
  'pattern-message': {
    correction: 'Supply a message that states what the pattern accepts.',
    findings: [marked('text({ pattern: … })', 'pattern: …')],
    headline: 'PATTERN AND MESSAGE APART',
    rule: 'pattern-message',
    sentence: 'text() pattern has no message to describe it.',
  },
  'text-bounds-order': {
    correction: 'Supply a minLength at or below maxLength.',
    findings: [marked('text({ maxLength: 0 })', 'maxLength: 0')],
    headline: 'BOUNDS OUT OF ORDER',
    rule: 'bounds-order',
    sentence: 'text() minLength 1 is above maxLength 0.',
  },
  'text-pattern': {
    correction: 'Supply a pattern with no flag other than u.',
    findings: [marked("text({ message: 'Expected letters.', pattern: … })", 'pattern: …')],
    headline: 'INVALID PATTERN',
    rule: 'invalid-pattern',
    sentence: 'text() pattern carries the flag g.',
  },
  'url-protocols': {
    correction: 'List a letter followed by letters, digits, +, -, or ., with no trailing colon.',
    findings: [marked("url({ protocols: ['https:'] })", "'https:'")],
    headline: 'INVALID URL PROTOCOLS',
    rule: 'url-protocols',
    sentence: 'url() protocols lists "https:", which is not a scheme name.',
  },
  'validator-definition': {
    correction: 'Supply a function that validates one raw string.',
    findings: [marked("createValidator({ parse: 'x' })", "parse: 'x'")],
    headline: 'INVALID VALIDATOR DEFINITION',
    rule: 'validator-definition',
    sentence: 'createValidator() parse is not a function.',
  },
};

test.each(Object.entries(cases))(
  'the %s fault throws its rule’s Developer Diagnostic',
  (scenario, expected) => {
    const result = invoke(fixture, [scenario]);
    expect(result).toEqual({ status: 0, stderr: '', stdout: diagnostic(expected) });
  },
);

test('every rule of the catalog has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(cases).map((expected) => expected.rule));
  const source = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
  const declared = Array.from(
    source.matchAll(/catalogRule\('(?<name>[a-z0-9-]+)'/gu),
    (match) => match.groups?.name ?? '',
  );
  expect([...pinned].toSorted()).toEqual(Object.keys(explanations).toSorted());
  expect(declared.toSorted()).toEqual(Object.keys(explanations).toSorted());
});
