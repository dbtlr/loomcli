import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { declaredRules } from './rule-parts.js';

/** The diagnostic one scenario's faulty declaration throws, as its message holds it. */
function thrown(scenario: string): string {
  const result = invoke(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [scenario]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

/** Each rule's explanation as an 80-column diagnostic wraps it. */
const explanations = {
  'argument-declared-twice': [
    'An action reads each argument under its name, so two arguments with one name',
    'leave one of them unreadable.',
  ],
  'arguments-beside-children': [
    "A Command's first bare token either names a child or fills an argument, so a",
    'Command that holds both cannot tell which one an operator meant.',
  ],
  'command-attached-twice': [
    'A Command value sits at one place in the tree, where its path, its help page,',
    'and its parent read it, so one value attached at two places would have two',
    'paths.',
  ],
  'command-without-action': [
    "Routing ends at a Command that runs its action, or passes on to one of a group's",
    'children. A Command with neither leaves an invocation that reaches it nothing to',
    'run.',
  ],
  'declared-name': [
    'An action reads each argument and option under its name, and help and',
    'diagnostics print it. A leading "-" reads as an option, and whitespace or "="',
    'splits the name where the parser reads it.',
  ],
  'optional-argument-last': [
    'Bare words fill the arguments in order, and an operator leaves out optional',
    'arguments from the end of the line. A required argument after an optional one',
    'would leave the parser unable to tell which of the two a lone bare word fills.',
  ],
  'portable-name': [
    'An operator types the application name, each Command name, and each alias as a',
    'command at a shell prompt. A character outside the POSIX portable filename set',
    'needs quoting there, a leading "-" reads as an option, and a leading "." names a',
    'file a shell hides.',
  ],
  'sibling-name-taken': [
    'Every canonical name and alias under one parent routes one token to one child,',
    'so a name that two siblings share cannot route.',
  ],
  undescribed: [
    'Agents, MCP tools, help, and the manifest read each Command, option, and',
    'argument by its description, so a development build fails a run whose graph',
    'leaves one out, and the author meets the gap before an operator or an agent',
    'does. A distributed build skips the check.',
  ],
  'variadic-argument-last': [
    'A variadic argument takes every positional token that remains, so an argument',
    'after it would never receive one.',
  ],
};

type Rule = keyof typeof explanations;

function explanationOf(rule: Rule): readonly string[] {
  return explanations[rule];
}

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
  const right = ` @loomcli/core/${rule}`;
  return `${left}${'-'.repeat(80 - left.length - right.length)}${right}`;
}

function diagnostic({ correction, findings, headline, rule, sentence }: Expected): string {
  const sections = [
    banner(headline, rule),
    sentence,
    ...findings.map((lines) => lines.join('\n')),
    explanationOf(rule).join('\n'),
    correction,
  ];
  return `${sections.join('\n\n')}\n`;
}

const portable =
  'Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".';

const cases: Record<string, Expected> = {
  'alias-portable': {
    correction: portable,
    findings: [
      [
        '    // keys',
        "    new Command('keys')",
        "      .alias('ls', 'bad name')",
        '                   ^^^^^^^^^^',
      ],
    ],
    headline: 'NAME NOT PORTABLE',
    rule: 'portable-name',
    sentence: 'Command "keys" declares an alias named "bad name".',
  },
  'application-name': {
    correction: portable,
    findings: [["    new Application('bad name')", '                    ^^^^^^^^^^']],
    headline: 'NAME NOT PORTABLE',
    rule: 'portable-name',
    sentence: 'Application name "bad name" is invalid.',
  },
  'argument-beside-child': {
    correction: 'Move the argument into a child Command or remove the children.',
    findings: [
      [
        '    new Application(…)',
        "      .argument('files', { variadic: true })",
        '                ^^^^^^^ the argument',
      ],
      [
        "    plugin('@acme/doctor', { commands: [new Command('check')] })",
        '                                        ^^^^^^^^^^^^^^^^^^^^ the child',
      ],
    ],
    headline: 'ARGUMENTS BESIDE CHILDREN',
    rule: 'arguments-beside-children',
    sentence: 'The root Command declares argument "files" and attaches child "check".',
  },
  'argument-name': {
    correction: 'Use a nonempty name without a leading hyphen, whitespace, or "=".',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .argument('-path', …)",
        '                ^^^^^^^',
      ],
    ],
    headline: 'INVALID DECLARED NAME',
    rule: 'declared-name',
    sentence: 'Command "get" declares an argument named "-path".',
  },
  'argument-twice': {
    correction: 'Remove or rename the duplicate.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .argument('path', { required: true })",
        '                ^^^^^^ the first declaration',
      ],
      [
        '    // get',
        "    new Command('get')",
        "      .argument('path', {})",
        '                ^^^^^^ the second declaration',
      ],
    ],
    headline: 'ARGUMENT DECLARED TWICE',
    rule: 'argument-declared-twice',
    sentence: 'Argument "path" is declared more than once on Command "get".',
  },
  'attached-twice': {
    correction: 'Attach a Command value at one point; create a new Command for each placement.',
    findings: [
      [
        '    // cache',
        "    new Command('cache')",
        "      .command(new Command('clear'))",
        '               ^^^^^^^^^^^^^^^^^^^^ the first placement',
      ],
      [
        '    // tmp',
        "    new Command('tmp')",
        "      .command(new Command('clear'))",
        '               ^^^^^^^^^^^^^^^^^^^^ the second placement',
      ],
    ],
    headline: 'COMMAND ATTACHED TWICE',
    rule: 'command-attached-twice',
    sentence: 'Command "tmp" attaches child "clear", which Command "cache" also attaches.',
  },
  'child-without-action': {
    correction: 'Register an action.',
    findings: [
      [
        '    // store',
        "    new Command('store')",
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ no action and no children',
      ],
    ],
    headline: 'NOTHING TO RUN',
    rule: 'command-without-action',
    sentence: 'Command "get" has no action.',
  },
  'command-name': {
    correction: portable,
    findings: [["    new Command('bad name')", '                ^^^^^^^^^^']],
    headline: 'NAME NOT PORTABLE',
    rule: 'portable-name',
    sentence: 'Command name "bad name" is invalid.',
  },
  'command-name-with-options': {
    correction: portable,
    findings: [["    new Command('bad name', …)", '                ^^^^^^^^^^']],
    headline: 'NAME NOT PORTABLE',
    rule: 'portable-name',
    sentence: 'Command name "bad name" is invalid.',
  },
  'optional-before-required': {
    correction: 'Declare optional arguments after required ones.',
    findings: [
      [
        '    // keys',
        "    new Command('keys')",
        "      .argument('path', {})",
        '                ^^^^^^ the optional argument',
      ],
      [
        '    // keys',
        "    new Command('keys')",
        "      .argument('name', { required: true })",
        '                ^^^^^^ the argument after it',
      ],
    ],
    headline: 'REQUIRED ARGUMENT AFTER OPTIONAL',
    rule: 'optional-argument-last',
    sentence:
      'Argument "path" is optional and precedes required argument "name" on Command "keys".',
  },
  'plugin-sibling': {
    correction: 'Rename or remove one.',
    findings: [
      [
        "    plugin('@acme/doctor', { commands: [new Command('check'), new Command('probe')] })",
        '                                        ^^^^^^^^^^^^^^^^^^^^ child "check"',
      ],
      [
        '    // probe',
        "    new Command('probe')",
        "      .alias('check')",
        '             ^^^^^^^ alias of child "probe"',
      ],
    ],
    headline: 'NAME TAKEN BY A SIBLING',
    rule: 'sibling-name-taken',
    sentence:
      'The root Command attaches child "probe" with alias "check", which is also the name of child "check".',
  },
  'sibling-alias': {
    correction: 'Rename or remove one.',
    findings: [
      [
        '    // store select',
        "    new Command('select')",
        "      .alias('ls')",
        '             ^^^^ alias of child "select"',
      ],
      [
        '    // store keys',
        "    new Command('keys')",
        "      .alias('ls')",
        '             ^^^^ alias of child "keys"',
      ],
    ],
    headline: 'NAME TAKEN BY A SIBLING',
    rule: 'sibling-name-taken',
    sentence:
      'Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select".',
  },
  'sibling-alias-name': {
    correction: 'Rename or remove one.',
    findings: [
      [
        '    // store',
        "    new Command('store')",
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ child "get"',
      ],
      [
        '    // store keys',
        "    new Command('keys')",
        "      .alias('get')",
        '             ^^^^^ alias of child "keys"',
      ],
    ],
    headline: 'NAME TAKEN BY A SIBLING',
    rule: 'sibling-name-taken',
    sentence:
      'Command "store" attaches child "keys" with alias "get", which is also the name of child "get".',
  },
  'sibling-name': {
    correction: 'Rename or remove one.',
    findings: [
      [
        '    // store',
        "    new Command('store')",
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ child "get"',
      ],
      [
        '    // store',
        "    new Command('store')",
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ child "get"',
      ],
    ],
    headline: 'NAME TAKEN BY A SIBLING',
    rule: 'sibling-name-taken',
    sentence: 'Command "store" attaches two children named "get".',
  },
  'sibling-name-alias': {
    correction: 'Rename or remove one.',
    findings: [
      [
        '    // store keys',
        "    new Command('keys')",
        "      .alias('get')",
        '             ^^^^^ alias of child "keys"',
      ],
      [
        '    // store',
        "    new Command('store')",
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ child "get"',
      ],
    ],
    headline: 'NAME TAKEN BY A SIBLING',
    rule: 'sibling-name-taken',
    sentence:
      'Command "store" attaches child "keys" with alias "get", which is also the name of child "get".',
  },
  'variadic-not-last': {
    correction: 'Declare the variadic argument last.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .argument('paths', { variadic: true })",
        '                ^^^^^^^ the variadic argument',
      ],
      [
        '    // get',
        "    new Command('get')",
        "      .argument('path', {})",
        '                ^^^^^^ the argument after it',
      ],
    ],
    headline: 'VARIADIC ARGUMENT NOT LAST',
    rule: 'variadic-argument-last',
    sentence: 'Argument "paths" is variadic and precedes argument "path" on Command "get".',
  },
};

test.each(Object.entries(cases))(
  'the %s fault throws its rule’s Developer Diagnostic',
  (scenario, expected) => {
    expect(thrown(scenario)).toBe(diagnostic(expected));
  },
);

test('every rule of the family has a pinned diagnostic', () => {
  // A gap in descriptions waits for a development run, so its pinned diagnostic is reported below.
  const pinned = new Set([...Object.values(cases).map((expected) => expected.rule), 'undescribed']);
  expect([...pinned].toSorted()).toEqual(Object.keys(explanations).toSorted());
  expect(declaredRules('command-rules.ts').toSorted()).toEqual(
    Object.keys(explanations).toSorted(),
  );
});

/** What run() writes for one root fault in a development build. */
function reported(scenario: string) {
  return invoke(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [scenario]);
}

test('an undescribed root reported from run() marks the name its constructor received', () => {
  expect(reported('root-undescribed')).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Give each one a description of one line.',
      findings: [
        ["    new Application('probe', { … })", '                    ^^^^^^^ no description'],
      ],
      headline: 'MISSING DESCRIPTION',
      rule: 'undescribed',
      sentence: '1 declaration has no description.',
    }),
    stdout: '',
  });
});

test('a root with nothing to run reports its rule with no finding, because no call declared the absence', () => {
  expect(reported('root-without-action')).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Register an action.',
      findings: [],
      headline: 'NOTHING TO RUN',
      rule: 'command-without-action',
      sentence: 'The root Command has no action.',
    }),
    stdout: '',
  });
});
