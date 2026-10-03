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
  'boolean-option-multiple': [
    'A Boolean option reports whether its spelling was supplied, so a repeat has no',
    'second value to collect. multiple collects each occurrence of a string option',
    'into an array.',
  ],
  'boolean-option-value-rule': [
    'A Boolean option consumes no value, so there is nothing to validate, and its',
    'polarity decides the value an absent option reads. validate, default, required,',
    'and validateOmitted belong to inputs that take a value.',
  ],
  'default-depth': [
    'A default stands in for the value an operator would supply, and every reader of',
    'the graph, help and the manifest included, walks it. Core keeps every path',
    'through a default within 10 levels of arrays and plain objects, and a default',
    'that holds itself nests without end, so every reader stays far inside the call',
    'stack on every runtime.',
  ],
  'default-shape': [
    'A default stands in for the value an operator would supply. Without a validator',
    'it is that raw value, a string or, for an input that takes several values, an',
    "array of strings; with one, it is the validator's input, and an input that takes",
    'several values still takes an array of them.',
  ],
  'env-name': [
    'The input-source stage reads the variable an option binds by its name, and a',
    'shell sets a variable only under a name of letters, digits, and underscores that',
    'does not start with a digit.',
  ],
  'env-on-argument': [
    'An argument is identified by its place among the bare tokens, so no variable can',
    'stand in for it. An option names itself on the command line, which lets a',
    'variable fill it.',
  ],
  'env-on-multiple': [
    'A variable holds one string, and core never splits it, so it cannot supply the',
    'several values a multiple option collects. The configuration source supplies a',
    'list.',
  ],
  'flag-not-boolean': [
    'hidden, shortOnly, multiple, required, variadic, validateOmitted, and an',
    "extension's collect each answer one yes-or-no question about a declaration, so",
    'each holds true or false. A value such as the string "false" would read as true.',
  ],
  'global-option-after-command': [
    'A Command attached with command() and the root action read their types from the',
    'global options declared before them, so a global option declared later would',
    'reach an action whose types never name it.',
  ],
  'global-presence-rule': [
    'A global option is validated on every Command, the Commands of plugins included,',
    'so a rule that its value must exist would fail a Command that never reads it. An',
    'omitted global option is absent.',
  ],
  'invalid-default': [
    'Each run passes every declared default through its validator before it reads a',
    'token, because a default reaches the action as a validated value. A default the',
    'validator rejects would reach no action, whatever the operator supplies.',
  ],
  'name-shared-across-kinds': [
    'An onCommandAttach hook adds inputs to a Command whose other inputs the plugin',
    'did not declare, so each name a hook declares stays apart from every argument',
    "and option in the Command's scope, whichever kind holds it. An author who gives",
    'an argument and an option one name does so knowingly, but a hook cannot see the',
    "Command's inputs, so a shared name there is an accident the author did not",
    'choose.',
  ],
  'not-a-validator': [
    'Core validates every value through the Standard Schema v1 interface: the',
    "object's ~standard property, with version 1, a vendor, and a validate function.",
    'It calls nothing else.',
  ],
  'omission-already-decided': [
    'validateOmitted sends an omitted value to its validator, which only an input',
    'with no other absence rule needs. An omitted required input fails, a default',
    'fills an omitted value, and an omitted multiple option or variadic argument',
    'receives an empty array.',
  ],
  'omission-without-validator': [
    "validateOmitted sends an omitted value to the input's validator, so an input",
    'with no validator has nothing to receive it.',
  ],
  'option-declared-twice': [
    "An action reads the global options and its Command's own options from one",
    'options object, each under its declared name, and the global options, the',
    "application's and every installed plugin's, share every Command's one table of",
    'spellings. Two options with one name in either leave one of them unreadable.',
  ],
  'option-polarity': [
    "Polarity chooses a Boolean option's long forms and its absent value from three",
    'settings: positive, both, and negative.',
  ],
  'option-type': [
    'The type decides how the parser reads an option: a string option consumes a',
    'value, and a Boolean option consumes none. Core reads no other kind.',
  ],
  'polarity-on-string': [
    'Polarity chooses which long forms a Boolean option accepts and what its absence',
    'means. A string option takes its value from the operator, so it has no polarity.',
  ],
  'required-with-default': [
    'A default fills an omitted value, and a required input fails when it is omitted,',
    'so a required input never reads its default.',
  ],
  'schema-converter-failed': [
    'Help, the manifest, and completion read what an input accepts from the JSON',
    'Schema its validator publishes. A converter that throws or returns anything but',
    "a plain object publishes no shape, so a distributed build reads the input's",
    'schema as null.',
  ],
  'short-alias': [
    'An operator types a short alias as a hyphen and one letter, and several combine',
    'into one short group such as -tm, so each is one ASCII letter the parser can',
    'split apart.',
  ],
  'short-only-both-polarities': [
    'Polarity both gives an option one spelling that turns it on and one that turns',
    'it off. shortOnly leaves the option its short alias alone, and one spelling sets',
    'one value.',
  ],
  'short-only-without-short': [
    'shortOnly removes every long spelling of an option, so an option with no short',
    'alias would leave an operator no spelling to type.',
  ],
  'spelling-taken': [
    "The parser reads each spelling as one option, and a Command's own options share",
    "one invocation with the global options and every installed plugin's options. A",
    'spelling two options claim, a short alias or a generated negative form included,',
    'would reach only one of them.',
  ],
  'variable-bound-twice': [
    "Within one invocation's scope a variable fills one option, so two options that",
    'bind it would both take the value an operator set for one of them.',
  ],
};

/** The rules this family shares with the Command family, which pins their explanations. */
const shared = {
  'declared-name': [
    'An action reads each argument and option under its name, and help and',
    'diagnostics print it. A leading "-" reads as an option, and whitespace or "="',
    'splits the name where the parser reads it.',
  ],
};

type Rule = keyof typeof explanations | keyof typeof shared;

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
  return rule === 'declared-name' ? shared[rule] : explanations[rule];
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

/** One printed line of code, and the carets under the first place `target` occurs in it. */
function marked(line: string, target: string, note?: string): string[] {
  const start = line.indexOf(target);
  expect(start).toBeGreaterThanOrEqual(0);
  const carets = `${' '.repeat(start)}${'^'.repeat(target.length)}`;
  return [line, note === undefined ? carets : `${carets} ${note}`];
}

/** A finding for one call on the Command at `path`, which the comment above it names. */
function onCommand(path: readonly string[], call: string, target: string, note?: string) {
  return [
    `    // ${path.join(' ')}`,
    `    new Command('${path.at(-1) ?? ''}')`,
    ...marked(`      .${call}`, target, note),
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

const booleanRemedy = 'use polarity to control its absent value.';

const cases: Record<string, Expected> = {
  'argument-env': {
    correction: 'Remove it.',
    findings: [onCommand(['get'], "argument('path', { env: 'PATH' })", "env: 'PATH'")],
    headline: 'ENVIRONMENT BINDING ON AN ARGUMENT',
    rule: 'env-on-argument',
    sentence: 'Command "get" argument "path" declares env, which applies to options alone.',
  },
  'boolean-default': {
    correction: `Remove default; ${booleanRemedy}`,
    findings: [
      onCommand(
        ['get'],
        "option('verbose', { default: false, type: 'boolean' })",
        'default: false',
      ),
    ],
    headline: 'VALUE RULE ON A BOOLEAN OPTION',
    rule: 'boolean-option-value-rule',
    sentence: 'Option "verbose" is Boolean and declares default.',
  },
  'boolean-multiple': {
    correction: 'Remove multiple or declare a string option.',
    findings: [
      onCommand(
        ['list'],
        "option('verbose', { multiple: true, type: 'boolean' })",
        'multiple: true',
      ),
    ],
    headline: 'BOOLEAN OPTION TAKES ONE VALUE',
    rule: 'boolean-option-multiple',
    sentence: 'Option "verbose" is a boolean option and declares multiple.',
  },
  'default-depth': {
    correction: 'Nest a default at most 10 levels deep.',
    findings: [onCommand(['get'], "option('limit', { default: … })", 'default: …')],
    headline: 'DEFAULT NESTED TOO DEEP',
    rule: 'default-depth',
    sentence: 'Option "limit" default nests deeper than 10 levels.',
  },
  'default-shape': {
    correction: 'Supply a string default.',
    findings: [onCommand(['get'], "option('limit', { default: 7, type: 'string' })", 'default: 7')],
    headline: 'DEFAULT OF THE WRONG SHAPE',
    rule: 'default-shape',
    sentence: 'Option "limit" default must be a string without a validator.',
  },
  'env-multiple': {
    correction: 'Remove env; a list comes from the configuration source.',
    findings: [
      onCommand(
        ['get'],
        "option('field', { env: 'FIELD', multiple: true, type: 'string' })",
        "env: 'FIELD'",
      ),
    ],
    headline: 'ENVIRONMENT BINDING ON A LIST',
    rule: 'env-on-multiple',
    sentence: 'Command "get" option "field" is a multiple option and declares env.',
  },
  'env-name': {
    correction: 'Use a letter or an underscore, then letters, digits, or underscores.',
    findings: [
      onCommand(['get'], "option('limit', { env: '9LIMIT', type: 'string' })", "env: '9LIMIT'"),
    ],
    headline: 'INVALID VARIABLE NAME',
    rule: 'env-name',
    sentence: 'Command "get" option "limit" env "9LIMIT" is not a variable name.',
  },
  'global-after-command': {
    correction: 'Declare global options before attaching Commands or registering an action.',
    findings: [onApplication("globalOption('file', …)", "'file'")],
    headline: 'GLOBAL OPTION AFTER A COMMAND',
    rule: 'global-option-after-command',
    sentence: 'The Application declares global option "file" after command() or action().',
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
  'global-presence': {
    correction: 'Remove required, and check for the value in each Command that needs it.',
    findings: [
      onApplication("globalOption('file', { required: false, type: 'string' })", 'required: false'),
    ],
    headline: 'PRESENCE RULE ON A GLOBAL OPTION',
    rule: 'global-presence-rule',
    sentence: 'Global option "file" declares required.',
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
  'multiple-flag': {
    correction: 'Use true or false.',
    findings: [
      onCommand(['get'], "option('field', { multiple: 'yes', type: 'string' })", "multiple: 'yes'"),
    ],
    headline: 'FLAG NOT A BOOLEAN',
    rule: 'flag-not-boolean',
    sentence: 'Command "get" option "field" declares multiple that is not a Boolean.',
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
  'not-a-validator': {
    correction: 'Supply a compatible validator.',
    findings: [
      onCommand(['get'], "option('limit', { type: 'string', validate: {} })", 'validate: {}'),
    ],
    headline: 'NOT A STANDARD SCHEMA',
    rule: 'not-a-validator',
    sentence: 'Option "limit" validate must be a Standard Schema v1 object.',
  },
  'omission-default': {
    correction: 'Remove one; the default already fills an omitted value.',
    findings: [
      onCommand(
        ['get'],
        "option('file', { default: 'a.json', type: 'string', validate: …, validateOmitted: true })",
        'validateOmitted: true',
      ),
    ],
    headline: 'ABSENCE ALREADY DECIDED',
    rule: 'omission-already-decided',
    sentence: 'Option "file" declares a default and validateOmitted.',
  },
  'omission-required': {
    correction: 'Remove validateOmitted or make the input optional.',
    findings: [
      onCommand(
        ['get'],
        "argument('path', { required: true, validate: …, validateOmitted: true })",
        'validateOmitted: true',
      ),
    ],
    headline: 'ABSENCE ALREADY DECIDED',
    rule: 'omission-already-decided',
    sentence: 'Argument "path" is required and declares validateOmitted.',
  },
  'omission-variadic': {
    correction:
      'Remove validateOmitted; with no values the action receives an empty array and no validator runs.',
    findings: [
      onCommand(
        ['get'],
        "argument('paths', { validate: …, validateOmitted: true, variadic: true })",
        'validateOmitted: true',
      ),
    ],
    headline: 'ABSENCE ALREADY DECIDED',
    rule: 'omission-already-decided',
    sentence: 'Argument "paths" takes several values and declares validateOmitted.',
  },
  'omission-without-validator': {
    correction: 'Add validate or remove validateOmitted.',
    findings: [
      onCommand(
        ['get'],
        "option('file', { type: 'string', validateOmitted: true })",
        'validateOmitted: true',
      ),
    ],
    headline: 'OMISSION WITH NO VALIDATOR',
    rule: 'omission-without-validator',
    sentence: 'Option "file" declares validateOmitted without a validator.',
  },
  'option-name': {
    correction: 'Use a nonempty name without a leading hyphen, whitespace, or "=".',
    findings: [onCommand(['get'], "option('-raw', …)", "'-raw'")],
    headline: 'INVALID DECLARED NAME',
    rule: 'declared-name',
    sentence: 'Option name "-raw" is invalid.',
  },
  'option-name-kind': {
    correction: 'Supply a string name.',
    findings: [onCommand(['get'], 'option(7, …)', '7')],
    headline: 'INVALID DECLARED NAME',
    rule: 'declared-name',
    sentence: 'Option name 7 is not a string.',
  },
  'option-polarity': {
    correction: 'Use "positive", "both", or "negative".',
    findings: [
      onCommand(['get'], "option('color', { polarity: 'on', type: 'boolean' })", "polarity: 'on'"),
    ],
    headline: 'INVALID POLARITY',
    rule: 'option-polarity',
    sentence: 'Option "color" has an invalid polarity.',
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
  'option-type': {
    correction: 'Use "string" or "boolean".',
    findings: [onCommand(['get'], "option('limit', { type: 'number' })", "type: 'number'")],
    headline: 'INVALID OPTION TYPE',
    rule: 'option-type',
    sentence: 'Option "limit" has an invalid type.',
  },
  'plugin-boolean-default': {
    correction: `Remove default; ${booleanRemedy}`,
    findings: [
      bare(
        "plugin('@acme/trace', { options: { verbose: { default: true, type: 'boolean' } } })",
        'default: true',
      ),
    ],
    headline: 'VALUE RULE ON A BOOLEAN OPTION',
    rule: 'boolean-option-value-rule',
    sentence: 'Plugin "@acme/trace" option "verbose" is Boolean and declares default.',
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
  'polarity-on-string': {
    correction: 'Remove polarity or use type "boolean".',
    findings: [
      onCommand(
        ['get'],
        "option('color', { polarity: 'both', type: 'string' })",
        "polarity: 'both'",
      ),
    ],
    headline: 'POLARITY ON A STRING OPTION',
    rule: 'polarity-on-string',
    sentence: 'Option "color" declares polarity but is not Boolean.',
  },
  'required-default': {
    correction: 'Remove the default or make the input optional.',
    findings: [
      onCommand(
        ['get'],
        "option('limit', { default: '5', required: true, type: 'string' })",
        "default: '5'",
      ),
    ],
    headline: 'DEFAULT ON A REQUIRED INPUT',
    rule: 'required-with-default',
    sentence: 'Option "limit" is required and declares a default.',
  },
  'required-flag': {
    correction: 'Use true or false.',
    findings: [
      onCommand(['get'], "option('limit', { required: 'yes', type: 'string' })", "required: 'yes'"),
    ],
    headline: 'FLAG NOT A BOOLEAN',
    rule: 'flag-not-boolean',
    sentence: 'Command "get" option "limit" declares required that is not a Boolean.',
  },
  'short-alias': {
    correction: 'Supply one ASCII letter.',
    findings: [
      onCommand(['get'], "option('file', { short: 'fi', type: 'string' })", "short: 'fi'"),
    ],
    headline: 'INVALID SHORT ALIAS',
    rule: 'short-alias',
    sentence: 'Option "file" declares a short alias that is not one ASCII letter.',
  },
  'short-only-both': {
    correction: 'Enable long forms or select one polarity.',
    findings: [
      onCommand(
        ['get'],
        "option('color', { polarity: 'both', short: 'c', shortOnly: true, type: 'boolean' })",
        'shortOnly: true',
      ),
    ],
    headline: 'BOTH POLARITIES WITH SHORT ONLY',
    rule: 'short-only-both-polarities',
    sentence: 'Option "color" cannot express both polarities with shortOnly.',
  },
  'short-only-flag': {
    correction: 'Use true or false.',
    findings: [
      onCommand(
        ['get'],
        "option('file', { short: 'f', shortOnly: 'yes', type: 'string' })",
        "shortOnly: 'yes'",
      ),
    ],
    headline: 'FLAG NOT A BOOLEAN',
    rule: 'flag-not-boolean',
    sentence: 'Command "get" option "file" declares shortOnly that is not a Boolean.',
  },
  'short-only-without-short': {
    correction: 'Add short or remove shortOnly.',
    findings: [
      onCommand(['get'], "option('file', { shortOnly: true, type: 'string' })", 'shortOnly: true'),
    ],
    headline: 'SHORT ONLY WITH NO SHORT ALIAS',
    rule: 'short-only-without-short',
    sentence: 'Option "file" declares shortOnly and no short alias.',
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
  'validate-omitted-flag': {
    correction: 'Use true or false.',
    findings: [
      onCommand(
        ['get'],
        "option('file', { type: 'string', validate: …, validateOmitted: 'yes' })",
        "validateOmitted: 'yes'",
      ),
    ],
    headline: 'FLAG NOT A BOOLEAN',
    rule: 'flag-not-boolean',
    sentence: 'Command "get" option "file" declares validateOmitted that is not a Boolean.',
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
  'variadic-default': {
    correction: 'Supply an array of values.',
    findings: [
      onCommand(
        ['get'],
        "argument('paths', { default: 'a', validate: …, variadic: true })",
        "default: 'a'",
      ),
    ],
    headline: 'DEFAULT OF THE WRONG SHAPE',
    rule: 'default-shape',
    sentence: 'Argument "paths" default must be an array.',
  },
  'variadic-flag': {
    correction: 'Use true or false.',
    findings: [onCommand(['get'], "argument('paths', { variadic: 'yes' })", "variadic: 'yes'")],
    headline: 'FLAG NOT A BOOLEAN',
    rule: 'flag-not-boolean',
    sentence: 'Command "get" argument "paths" declares variadic that is not a Boolean.',
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
    findings: [onCommand(path, "argument('path', { validate: … })", 'validate: …')],
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
          "option('limit', { default: 'x', type: 'string', validate: … })",
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
          "option('limit', { type: 'string', validate: … })",
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
        "option('limit', { type: 'string', validate: … })",
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
    "option('limit', { type: 'string', validate: … })",
    'validate: …',
  );
  expect(result.stderr).toContain(`\n\n${finding.join('\n')}\n\n`);
});

test('a global option validator that throws marks the validate key of its globalOption() call', () => {
  const result = invoke(fixture, ['global-validator-throws']);
  expect(result.status).toBe(1);
  const finding = marked(
    "      .globalOption('limit', { type: 'string', validate: … })",
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
          "    plugin('@acme/log', { options: { level: { default: 'x', type: 'string', validate: … } } })",
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
    "    plugin('@acme/log', { options: { level: { type: 'string', validate: … } } })",
    'validate: …',
  );
  expect(result.stderr).toContain(`\n\n${finding.join('\n')}\n\n`);
});

test('every rule of the family has a pinned diagnostic', () => {
  const pinned = new Set([
    ...Object.values(cases).map((expected) => expected.rule),
    'invalid-default',
    'schema-converter-failed',
  ]);
  expect([...pinned].toSorted()).toEqual(
    [...Object.keys(explanations), ...Object.keys(shared)].toSorted(),
  );
  expect(declaredRules('input-rules.ts').toSorted()).toEqual(Object.keys(explanations).toSorted());
});

test('a JavaScript module whose option() declares multiple on a Boolean option prints its diagnostic as it loads', () => {
  const expected = diagnostic({
    correction: 'Remove multiple or declare a string option.',
    findings: [
      onCommand(
        ['list'],
        "option('verbose', { multiple: true, type: 'boolean' })",
        'multiple: true',
      ),
    ],
    headline: 'BOOLEAN OPTION TAKES ONE VALUE',
    rule: 'boolean-option-multiple',
    sentence: 'Option "verbose" is a boolean option and declares multiple.',
  });
  for (const runtime of ['node', 'bun']) {
    const result = invoke(new URL('fixtures/boolean-multiple.mjs', import.meta.url), [], {
      runtime,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(expected);
  }
});
