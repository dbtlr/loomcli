import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { declaredRules } from './rule-parts.js';

const fixture = new URL('fixtures/input-diagnostics.mjs', import.meta.url);

/** The diagnostic one scenario's faulty declaration throws, as its message holds it. */
function thrown(...args: string[]): string {
  const result = invoke(fixture, args);
  expect(result.stderr).toBe('');
  return result.stdout;
}

/** Each rule's explanation as an 80-column diagnostic wraps it. */
const explanations = {
  'invalid-default': [
    'Each run passes every declared default through its validator before it reads a',
    'token, because a default reaches the action as a validated value. A default the',
    'validator rejects would reach no action, whatever the operator supplies.',
  ],
  'invalid-implied': [
    'Each run passes every implied value through its validator before it reads a',
    'token, because a bare spelling supplies it to the action as a validated value.',
    'An implied value the validator rejects is the declaration at fault, whatever the',
    'operator supplies, so the run reports it whether or not a bare spelling was',
    'typed.',
  ],
  'name-shared-across-kinds': [
    'An onCommandAttach hook adds inputs to a Command whose other inputs the plugin',
    'did not declare, so each name a hook declares stays apart from every argument',
    "and option in the Command's scope, whichever kind holds it. An author who gives",
    'an argument and an option one name does so knowingly, but a hook cannot see the',
    "Command's inputs, so a shared name there is an accident the author did not",
    'choose.',
  ],
  'option-declared-twice': [
    "An action reads the global options and its Command's own options from one",
    'options object, each under its declared name, and the global options, the',
    "application's and every installed plugin's, share every Command's one table of",
    'spellings. Two options with one name in either leave one of them unreadable.',
  ],
  'schema-converter-failed': [
    'Help, the manifest, and completion read what an input accepts from the JSON',
    'Schema its validator publishes. A converter that throws or returns anything but',
    "a plain object publishes no shape, so a distributed build reads the input's",
    'schema as null.',
  ],
  'spelling-taken': [
    "The parser reads each spelling as one option, and a Command's own options share",
    "one invocation with the global options and every installed plugin's options. A",
    'spelling two options claim, a short alias, an alias, or a generated negative',
    'form included, would reach only one of them.',
  ],
  'variable-bound-twice': [
    "Within one invocation's scope a variable fills one option, so two options that",
    'bind it would both take the value an operator set for one of them.',
  ],
};

/** The rules this family shares with the Command and plugin families, which pin their explanations. */
const shared = {
  'declared-name': [
    'An action reads each argument and option under its name, and help and',
    'diagnostics print it. A leading "-" reads as an option, and whitespace or "="',
    'splits the name where the parser reads it.',
  ],
};

type Rule = keyof typeof explanations | keyof typeof shared;

function isShared(rule: Rule): rule is keyof typeof shared {
  return Object.hasOwn(shared, rule);
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

function explanationOf(rule: Rule): readonly string[] {
  return isShared(rule) ? shared[rule] : explanations[rule];
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

/** One printed line of code, and the carets under the `nth` place `target` occurs in it. */
function marked(line: string, target: string, note?: string, nth = 0): string[] {
  let start = line.indexOf(target);
  for (let seen = 0; seen < nth; seen += 1) {
    start = line.indexOf(target, start + target.length);
  }
  expect(start).toBeGreaterThanOrEqual(0);
  const carets = `${' '.repeat(start)}${'^'.repeat(target.length)}`;
  return [line, note === undefined ? carets : `${carets} ${note}`];
}

/** A finding for one call on the Command at `path`, which the comment above it names. */
function onCommand(path: readonly string[], call: string, target: string, note?: string, nth = 0) {
  return [
    `    // ${path.join(' ')}`,
    `    new Command('${path.at(-1) ?? ''}')`,
    ...marked(`      .${call}`, target, note, nth),
  ];
}

/** A finding for one call on the Application, whose name a thrown fault does not know. */
function onApplication(call: string, target: string, note?: string) {
  return ['    new Application(…)', ...marked(`      .${call}`, target, note)];
}

/** A finding for one call that sits on no receiver, such as `plugin()`. */
function bare(call: string, target: string, note?: string) {
  return marked(`    ${call}`, target, note);
}

const cases: Record<string, Expected> = {
  'alias-global-local': {
    correction: 'Change one declaration.',
    findings: [
      onApplication(
        "globalOption('file', { aliases: ['input'], type: 'string' })",
        "'input'",
        'the global option',
      ),
      onCommand(['get'], "option('input', { type: 'boolean' })", "'input'", 'the local option'),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence:
      'Option spelling "--input" is used by the global option "file" and the local option "input" on Command "get".',
  },
  'alias-name': {
    correction: 'Use a nonempty name without a leading hyphen, whitespace, or "=".',
    findings: [
      onCommand(
        ['get'],
        "option('min-bytes', { aliases: ['bad=name'], type: 'string' })",
        "'bad=name'",
      ),
    ],
    headline: 'INVALID DECLARED NAME',
    rule: 'declared-name',
    sentence: 'Option "min-bytes" declares an alias named "bad=name".',
  },
  'alias-negative-spelling': {
    correction: 'Change one declaration.',
    findings: [
      onCommand(
        ['get'],
        "option('color', { aliases: ['colour'], polarity: 'both', type: 'boolean' })",
        "'colour'",
      ),
      onCommand(['get'], "option('no-colour', { type: 'boolean' })", "'no-colour'"),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence: 'Option spelling "--no-colour" is used by both "color" and "no-colour".',
  },
  'alias-spelling': {
    correction: 'Change one declaration.',
    findings: [
      onCommand(['get'], "option('min-bytes', { aliases: ['limit'], type: 'string' })", "'limit'"),
      onCommand(['get'], "option('limit', { type: 'string' })", "'limit'"),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence: 'Option spelling "--limit" is used by both "min-bytes" and "limit".',
  },
  'global-local-key': {
    correction: 'Rename the local option.',
    findings: [
      onApplication("globalOption('file', { type: 'string' })", "'file'", 'the global option'),
      onCommand(['get'], "option('file', { type: 'boolean' })", "'file'", 'the local option'),
    ],
    headline: 'OPTION DECLARED TWICE',
    rule: 'option-declared-twice',
    sentence:
      'Option "file" is declared as a global option and as a local option on Command "get".',
  },
  'global-local-spelling': {
    correction: 'Change one declaration.',
    findings: [
      onApplication(
        "globalOption('file', { short: 'f', type: 'string' })",
        "short: 'f'",
        'the global option',
      ),
      onCommand(
        ['get'],
        "option('force', { short: 'f', type: 'boolean' })",
        "short: 'f'",
        'the local option',
      ),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence:
      'Option spelling "-f" is used by the global option "file" and the local option "force" on Command "get".',
  },
  'hook-argument-option': {
    correction: "Rename the Command's option or omit the plugin.",
    findings: [
      onCommand(['count'], "argument('tag', {})", "'tag'", 'declared by plugin "@acme/tag"'),
      onCommand(['count'], "option('tag', { type: 'string' })", "'tag'", 'the local option'),
    ],
    headline: 'ARGUMENT AND OPTION SHARE A NAME',
    rule: 'name-shared-across-kinds',
    sentence:
      'Plugin "@acme/tag" declares argument "tag" on Command "count", which is already declared as a local option.',
  },
  'negative-spelling': {
    correction: 'Change one declaration.',
    findings: [
      onCommand(
        ['get'],
        "option('color', { polarity: 'both', type: 'boolean' })",
        "polarity: 'both'",
      ),
      onCommand(['get'], "option('no-color', { type: 'boolean' })", "'no-color'"),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence: 'Option spelling "--no-color" is used by both "color" and "no-color".',
  },
  'option-name': {
    correction: 'Use a nonempty name without a leading hyphen, whitespace, or "=".',
    findings: [onCommand(['get'], "option('-raw', …)", "'-raw'")],
    headline: 'INVALID DECLARED NAME',
    rule: 'declared-name',
    sentence: 'Option name "-raw" is invalid.',
  },
  'option-twice': {
    correction: 'Remove or rename the duplicate.',
    findings: [
      onCommand(['get'], "option('raw', { type: 'boolean' })", "'raw'", 'the first declaration'),
      onCommand(['get'], "option('raw', { type: 'string' })", "'raw'", 'the second declaration'),
    ],
    headline: 'OPTION DECLARED TWICE',
    rule: 'option-declared-twice',
    sentence: 'Option "raw" is declared more than once on Command "get".',
  },
  'plugin-alias-spelling': {
    correction: 'Change one declaration.',
    findings: [
      bare(
        "plugin('@acme/trace', { options: { trace: { aliases: ['tail'], type: 'boolean' } } })",
        "'tail'",
        "the plugin's global option",
      ),
      onCommand(['get'], "option('tail', { type: 'string' })", "'tail'", 'the local option'),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence:
      'Option spelling "--tail" is used by plugin "@acme/trace" option "trace" and the local option "tail" on Command "get".',
  },
  'plugin-global-key': {
    correction: 'Rename one declaration.',
    findings: [
      bare(
        "plugin('@acme/trace', { options: { verbose: { type: 'boolean' } } })",
        "verbose: { type: 'boolean' }",
        "the plugin's global option",
      ),
      onApplication(
        "globalOption('verbose', { type: 'boolean' })",
        "'verbose'",
        'the global option',
      ),
    ],
    headline: 'OPTION DECLARED TWICE',
    rule: 'option-declared-twice',
    sentence: 'Option "verbose" is declared by plugin "@acme/trace" and as a global option.',
  },
  'plugin-local-spelling': {
    correction: 'Change one declaration.',
    findings: [
      bare(
        "plugin('@acme/trace', { options: { trace: { short: 't', type: 'boolean' } } })",
        "short: 't'",
        "the plugin's global option",
      ),
      onCommand(
        ['get'],
        "option('tail', { short: 't', type: 'string' })",
        "short: 't'",
        'the local option',
      ),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence:
      'Option spelling "-t" is used by plugin "@acme/trace" option "trace" and the local option "tail" on Command "get".',
  },
  'plugins-alias-spelling': {
    correction: 'Change one declaration.',
    findings: [
      bare(
        "plugin('@acme/log', { options: { level: { aliases: ['verbosity'], type: 'string' } } })",
        "'verbosity'",
        "the plugin's global option",
      ),
      bare(
        "plugin('@acme/trace', { options: { verbosity: { type: 'boolean' } } })",
        "verbosity: { type: 'boolean' }",
        "the plugin's global option",
      ),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence:
      'Option spelling "--verbosity" is used by plugin "@acme/log" option "level" and plugin "@acme/trace" option "verbosity".',
  },
  'plugins-key': {
    correction: 'Install one of them or rename the option.',
    findings: [
      bare(
        "plugin('@acme/log', { options: { verbose: { type: 'boolean' } } })",
        "verbose: { type: 'boolean' }",
        "the plugin's global option",
      ),
      bare(
        "plugin('@acme/trace', { options: { verbose: { polarity: 'both', type: 'boolean' } } })",
        "verbose: { polarity: 'both', type: 'boolean' }",
        "the plugin's global option",
      ),
    ],
    headline: 'OPTION DECLARED TWICE',
    rule: 'option-declared-twice',
    sentence: 'Option "verbose" is declared by plugin "@acme/log" and plugin "@acme/trace".',
  },
  'short-spelling': {
    correction: 'Change one declaration.',
    findings: [
      onCommand(['get'], "option('force', { short: 'f', type: 'boolean' })", "short: 'f'"),
      onCommand(['get'], "option('file', { short: 'f', type: 'string' })", "short: 'f'"),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence: 'Option spelling "-f" is used by both "force" and "file".',
  },
  'variable-twice': {
    correction: 'Bind each variable to one option.',
    findings: [
      onApplication("globalOption('limit', { env: 'LIMIT', type: 'string' })", "env: 'LIMIT'"),
      onCommand(['count'], "option('max', { env: 'LIMIT', type: 'string' })", "env: 'LIMIT'"),
    ],
    headline: 'VARIABLE BOUND TWICE',
    rule: 'variable-bound-twice',
    sentence:
      'Variable "LIMIT" is bound by global option "limit" and Command "count" option "max".',
  },
};

test.each(Object.entries(cases))(
  'the %s fault throws its rule’s Developer Diagnostic',
  (scenario, expected) => {
    expect(thrown(scenario)).toBe(diagnostic(expected));
  },
);

/** The converter fault, whose findings open with `path`, the application name first under run(). */
function converterFault(path: readonly string[]): Expected {
  return {
    correction:
      'Fix the converter so it returns a JSON Schema object, or declare a validator that publishes none.',
    findings: [
      onCommand(path, "argument('path', { description: 'Path.', validate: … })", 'validate: …'),
    ],
    headline: 'SCHEMA CONVERTER FAILED',
    rule: 'schema-converter-failed',
    sentence: String.raw`Argument "path" validator's JSON Schema converter failed for target "draft-2020-12": No JSON Schema\u000afor a transform.`,
  };
}

test('a default its validator rejects reports from run() with the issue lines under the sentence', () => {
  expect(invoke(fixture, ['invalid-default'])).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Fix the default or its validator.',
      findings: [
        onCommand(
          ['probe', 'get'],
          "option('limit', { default: 'x', description: 'Limit.', type: 'string', validate: … })",
          "default: 'x'",
        ),
      ],
      headline: 'DEFAULT REJECTED',
      rule: 'invalid-default',
      sentence: 'Option "limit" has an invalid default.\nOption "limit": Use a whole number.',
    }),
    stdout: '',
  });
});

test('an implied value its validator rejects reports from run() before any token is read', () => {
  expect(invoke(fixture, ['invalid-implied'])).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Fix the implied value or its validator.',
      findings: [
        onCommand(
          ['probe', 'get'],
          "option('backup', { description: 'Backup.', implied: 'x', type: 'string', validate: … })",
          "implied: 'x'",
        ),
      ],
      headline: 'IMPLIED VALUE REJECTED',
      rule: 'invalid-implied',
      sentence:
        'Option "backup" has an invalid implied value.\nOption "backup": Use none, simple, or numbered.',
    }),
    stdout: '',
  });
});

test("an implied value its validator rejects on a plugin's option marks implied in the plugin's options record", () => {
  expect(invoke(fixture, ['plugin-invalid-implied'])).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Fix the implied value or its validator.',
      findings: [
        marked(
          "    plugin('@acme/copy', { options: { backup: { description: 'Backup.', implied: 'x', type: 'string', validate: … } } })",
          "implied: 'x'",
        ),
      ],
      headline: 'IMPLIED VALUE REJECTED',
      rule: 'invalid-implied',
      sentence:
        'Option "backup" has an invalid implied value.\nOption "backup": Use none, simple, or numbered.',
    }),
    stdout: '',
  });
});

test('a converter that throws is a declaration fault from run() in a development build', () => {
  expect(invoke(fixture, ['converter-throws'])).toEqual({
    status: 1,
    stderr: diagnostic(converterFault(['probe', 'get'])),
    stdout: '',
  });
});

test('a converter that throws is a declaration fault from inspect() in a development build', () => {
  expect(thrown('converter-throws', 'inspect')).toBe(diagnostic(converterFault(['get'])));
});

test('a converter that answers with a value that is not a plain object is a declaration fault in a development build', () => {
  expect(invoke(fixture, ['converter-list'])).toEqual({
    status: 1,
    stderr: diagnostic({
      correction:
        'Fix the converter so it returns a JSON Schema object, or declare a validator that publishes none.',
      findings: [
        onCommand(
          ['probe', 'get'],
          "option('limit', { description: 'Limit.', type: 'string', validate: … })",
          'validate: …',
        ),
      ],
      headline: 'SCHEMA CONVERTER FAILED',
      rule: 'schema-converter-failed',
      sentence:
        'Option "limit" validator\'s JSON Schema converter answered target "draft-2020-12" with a value that is not a plain object.',
    }),
    stdout: '',
  });
});

test('a distributed build reads a failing converter as no published schema', () => {
  expect(invoke(fixture, ['converter-throws-distributed'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '',
  });
  expect(thrown('converter-throws-distributed', 'inspect')).toBe('{"schema":null}\n');
});

/** The converter fault for option "limit" on `get`, whose converter failed as `failure` says. */
function limitConverterFault(failure: string): Expected {
  return {
    correction:
      'Fix the converter so it returns a JSON Schema object, or declare a validator that publishes none.',
    findings: [
      onCommand(
        ['probe', 'get'],
        "option('limit', { description: 'Limit.', type: 'string', validate: … })",
        'validate: …',
      ),
    ],
    headline: 'SCHEMA CONVERTER FAILED',
    rule: 'schema-converter-failed',
    sentence: `Option "limit" validator's JSON Schema converter ${failure}`,
  };
}

test.each([['converter-getter', 'failed for target "draft-2020-12": getter boom.']])(
  'a converter whose answer throws while core reads it is a declaration fault in a development build (%s)',
  (scenario, failure) => {
    expect(invoke(fixture, [scenario])).toEqual({
      status: 1,
      stderr: diagnostic(limitConverterFault(failure)),
      stdout: '',
    });
  },
);

test.each(['converter-getter-distributed'])(
  'a distributed build reads a converter whose answer throws while core reads it as no published schema (%s)',
  (scenario) => {
    expect(thrown(scenario, 'inspect')).toBe('{"schema":null}\n');
    expect(invoke(fixture, [scenario])).toEqual({ status: 0, stderr: '', stdout: '' });
  },
);

test.each(['converter-cyclic', 'converter-cyclic-distributed'])(
  'a converter answer that holds itself publishes a frozen copy holding the same cycle (%s)',
  (scenario) => {
    expect(thrown(scenario, 'cycle')).toBe('{"cycle":true,"frozen":true,"type":"string"}\n');
    expect(invoke(fixture, [scenario])).toEqual({ status: 0, stderr: '', stdout: '' });
  },
);

test("a converter fault keeps the converter's thrown value as its cause", () => {
  expect(thrown('converter-throws', 'cause')).toBe(
    `${JSON.stringify({ cause: 'No JSON Schema\nfor a transform.' })}\n`,
  );
});

test('a validator that throws marks the validate key of the call that declared its input', () => {
  const result = invoke(fixture, ['validator-throws']);
  expect(result.status).toBe(1);
  const finding = onCommand(
    ['probe', 'get'],
    "option('limit', { description: 'Limit.', type: 'string', validate: … })",
    'validate: …',
  );
  expect(result.stderr).toContain(`\n\n${finding.join('\n')}\n\n`);
});

test('a global option validator that throws marks the validate key of its globalOption() call', () => {
  const result = invoke(fixture, ['global-validator-throws']);
  expect(result.status).toBe(1);
  const finding = marked(
    "      .globalOption('limit', { description: 'Limit.', type: 'string', validate: … })",
    'validate: …',
  );
  expect(result.stderr).toContain(`\n${finding.join('\n')}\n\n`);
});

test("a default its validator rejects on a plugin's option marks the default in the plugin's options record", () => {
  expect(invoke(fixture, ['plugin-invalid-default'])).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Fix the default or its validator.',
      findings: [
        marked(
          "    plugin('@acme/log', { options: { level: { default: 'x', description: 'Level.', type: 'string', validate: … } } })",
          "default: 'x'",
        ),
      ],
      headline: 'DEFAULT REJECTED',
      rule: 'invalid-default',
      sentence: 'Option "level" has an invalid default.\nOption "level": Use a whole number.',
    }),
    stdout: '',
  });
});

test("a validator that throws on a plugin's option marks the validate key in the plugin's options record", () => {
  const result = invoke(fixture, ['plugin-validator-throws']);
  expect(result.status).toBe(1);
  const finding = marked(
    "    plugin('@acme/log', { options: { level: { description: 'Level.', type: 'string', validate: … } } })",
    'validate: …',
  );
  expect(result.stderr).toContain(`\n\n${finding.join('\n')}\n\n`);
});

test('every rule of the family has a pinned diagnostic', () => {
  const pinned = new Set([
    ...Object.values(cases).map((expected) => expected.rule),
    'invalid-default',
    'invalid-implied',
    'schema-converter-failed',
  ]);
  expect([...pinned].toSorted()).toEqual(
    [...Object.keys(explanations), ...Object.keys(shared)].toSorted(),
  );
  expect(declaredRules('input-rules.ts').toSorted()).toEqual(Object.keys(explanations).toSorted());
});

test('a module whose declaration throws prints its diagnostic as it loads, under Node.js and Bun', () => {
  const expected = diagnostic({
    correction: 'Change one declaration.',
    findings: [
      onCommand(['list'], "option('verbose', { short: 'v', type: 'boolean' })", "short: 'v'"),
      onCommand(['list'], "option('version', { short: 'v', type: 'boolean' })", "short: 'v'"),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence: 'Option spelling "-v" is used by both "verbose" and "version".',
  });
  for (const runtime of ['node', 'bun']) {
    const result = invoke(new URL('fixtures/spelling-taken.mjs', import.meta.url), [], {
      runtime,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(expected);
  }
});
