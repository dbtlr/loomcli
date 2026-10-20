import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { declaredRules } from './rule-parts.js';

const fixture = new URL('fixtures/plugin-diagnostics.mjs', import.meta.url);

/** The diagnostic one scenario's faulty declaration throws, as its message holds it. */
function thrown(scenario: string): string {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

/** Each rule's explanation as an 80-column diagnostic wraps it. */
const explanations = {
  'broken-attach-hook': [
    "onCommandAttach receives each Command's declaration at graph build and returns",
    'it, or a value derived from it, synchronously and without throwing. Core builds',
    'the Command the hook returns, so a throw or any other value leaves it nothing to',
    'build.',
  ],
  'broken-graph-hook': [
    'onGraphBuilt receives the frozen graph once per build and judges it: it returns',
    'nothing, and it rejects the graph only by throwing a DeclarationError. Core',
    'reads no answer from the hook, so a returned value or any other throw is a',
    'defect in the hook.',
  ],
  'extension-output': [
    "Every projection, the manifest included, reads an extension's output as frozen",
    'plain data: strings, finite numbers, Booleans, null, arrays, and plain objects.',
  ],
  'failure-code': [
    "A failure's code tells a script or an agent which failure ended the run, where",
    'many failures share one exit code. A machine reader branches on the code, so it',
    'follows one grammar: words of lowercase letters and digits joined by single',
    'hyphens. A code outside it is rejected where the class is first constructed.',
  ],
  'failure-encoder-taken': [
    'A failed run writes its failure through the one encoder registered for the media',
    'type its selected view declares. Two encoders for one media type leave core no',
    'way to choose between them.',
  ],
  'failure-exit-code': [
    "A failure's exit code tells the shell how the run ended: 0 means success, and",
    '126 and above belong to the shell and to signals, so a failure exits with a code',
    'from 1 through 125. Core never clamps or replaces the code a failure class',
    'declares, so a code no failure may exit with is rejected where the class is',
    'first constructed.',
  ],
  'foreign-value': [
    'Core reads a plugin, an extension value, a declared view, a view override, a',
    'translation, and a failure encoding through facts the copy of @loomcli/core that',
    'built it recorded. When two copies of @loomcli/core are installed, a value one',
    'copy built carries no facts the other copy can read.',
  ],
  'invalid-extension-value': [
    "An extension value passes its descriptor's schema at the call that carries it,",
    'synchronously, so every plugin that reads it reads a value the schema accepted.',
  ],
  'plugin-installed-twice': [
    'Core keys each plugin by its identity, and a plugin contributes its options,',
    'middleware, hooks, and views once, so a second installation would contribute',
    'each of them again.',
  ],
  'rule-identity': [
    "A rule's identity names the package that declares it and the rule inside it, so",
    'tooling keys on it and two packages never share one. It is an identity, a',
    'package name and any kebab-case subpath segments that name the part of the',
    'package that owns the rule, then a kebab-case rule name, joined by /.',
  ],
  'slot-taken': [
    'A slot is a position exactly one plugin claims: the theme, the process signals,',
    'and the configuration source. A second claim would leave two plugins answering',
    'where core asks one.',
  ],
  'two-package-copies': [
    'Core keys each extension and each declared view by its identity and compares it',
    'by reference. Two distinct objects under one identity mean two copies of the',
    'package that defines it are installed, and a value one copy made cannot be read',
    'through the other.',
  ],
};

/** The rules of other families this family raises too. */
const shared = {
  'option-declared-twice': [
    "An action reads the global options and its Command's own options from one",
    'options object, each under its declared name, and the global options, the',
    "application's and every installed plugin's, share every Command's one table of",
    'spellings. Two options with one name in either leave one of them unreadable.',
  ],
  'spelling-taken': [
    "The parser reads each spelling as one option, and a Command's own options share",
    "one invocation with the global options and every installed plugin's options. A",
    'spelling two options claim, a short alias, an alias, or a generated negative',
    'form included, would reach only one of them.',
  ],
};

/** The rules core declares beside its defects that this family raises. */
const fromCore = ['failure-code', 'failure-exit-code', 'rule-identity'];

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

/** Every explanation this family pins, its own and the shared ones, by rule. */
const explanationsByRule: Record<Rule, readonly string[]> = { ...explanations, ...shared };

function explanationOf(rule: Rule): readonly string[] {
  return explanationsByRule[rule];
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

/** A finding for one call that sits on no receiver, such as `plugin()` or `new Application()`. */
function bare(call: string, target: string, note?: string, nth = 0) {
  return marked(`    ${call}`, target, note, nth);
}

const twoPlugins = (first: string, second: string) =>
  `new Application('probe', { plugins: [plugin('${first}', …), plugin('${second}', …)] })`;

const cases: Record<string, Expected> = {
  'attach-hook-returns': {
    correction: 'Return the value it received or a value derived from it.',
    findings: [bare("plugin('@acme/format', { onCommandAttach: … })", 'onCommandAttach: …')],
    headline: 'BROKEN ATTACH HOOK',
    rule: 'broken-attach-hook',
    sentence:
      'Plugin "@acme/format" returned a value that is not the attached Command from onCommandAttach for Command "count".',
  },
  'attach-hook-throws': {
    correction:
      'Return the value the hook received or a value derived from it, and throw only a DeclarationError from the hook.',
    findings: [bare("plugin('@acme/format', { onCommandAttach: … })", 'onCommandAttach: …')],
    headline: 'BROKEN ATTACH HOOK',
    rule: 'broken-attach-hook',
    sentence: String.raw`Plugin "@acme/format" failed in onCommandAttach for Command "count": No format\u000afor this Command.`,
  },
  'encoder-taken': {
    correction: 'Register one.',
    findings: [
      bare("plugin('@acme/json', { failureEncoders: […, …] })", '…', 'the first encoding'),
      bare("plugin('@acme/json', { failureEncoders: […, …] })", '…', 'the second encoding', 1),
    ],
    headline: 'FAILURE ENCODER TAKEN',
    rule: 'failure-encoder-taken',
    sentence: 'Plugin "@acme/json" registers two failure encoders for "application/json".',
  },
  'encoder-taken-across': {
    correction: 'Install one of them.',
    findings: [
      bare(twoPlugins('@acme/json', '@acme/wire'), "plugin('@acme/json', …)", 'the first encoder'),
      bare(twoPlugins('@acme/json', '@acme/wire'), "plugin('@acme/wire', …)", 'the second encoder'),
    ],
    headline: 'FAILURE ENCODER TAKEN',
    rule: 'failure-encoder-taken',
    sentence:
      'Plugin "@acme/wire" registers a failure encoder for "application/json", which plugin "@acme/json" already registers.',
  },
  'extension-async': {
    correction: 'Supply a schema that answers synchronously.',
    findings: [
      bare("new Command('get', { extensions: […] })", '…', 'extension "@acme/slow/command"'),
    ],
    headline: 'INVALID EXTENSION VALUE',
    rule: 'invalid-extension-value',
    sentence:
      'Command "get" holds a "@acme/slow/command" value its schema did not answer synchronously.',
  },
  'extension-defined-twice': {
    correction: 'Install one copy of the package that defines it.',
    findings: [
      bare(
        "plugin('@acme/notes', { extensions: […, …] })",
        '…',
        'another "@acme/notes/command"',
        1,
      ),
    ],
    headline: 'TWO COPIES OF ONE PACKAGE',
    rule: 'two-package-copies',
    sentence: 'Extension "@acme/notes/command" is defined twice.',
  },
  'extension-foreign-read': {
    correction: 'Install one copy of the package that defines it.',
    findings: [],
    headline: 'TWO COPIES OF ONE PACKAGE',
    rule: 'two-package-copies',
    sentence:
      'Extension "@acme/notes/command" was read through a descriptor that did not define the stored value.',
  },
  'extension-invalid': {
    correction: 'Correct the value.',
    findings: [onCommand(['get'], 'extend(…)', '…', 'extension "@acme/limit/command"')],
    headline: 'INVALID EXTENSION VALUE',
    rule: 'invalid-extension-value',
    sentence: 'Command "get" holds an invalid "@acme/limit/command" value: Expected a number.',
  },
  'extension-output': {
    correction: 'Return strings, numbers, booleans, null, arrays, and plain objects.',
    findings: [
      onCommand(
        ['get'],
        "option('raw', { extensions: […], type: 'boolean' })",
        '…',
        'extension "@acme/date/option"',
      ),
    ],
    headline: 'EXTENSION OUTPUT NOT PLAIN DATA',
    rule: 'extension-output',
    sentence:
      'Extension "@acme/date/option" produced a value that is not plain data on Command "get" option "raw".',
  },
  'extension-throws': {
    correction: 'Correct the value.',
    findings: [
      onApplication(
        "globalOption('file', { extensions: […], type: 'string' })",
        '…',
        'extension "@acme/strict/option"',
      ),
    ],
    headline: 'INVALID EXTENSION VALUE',
    rule: 'invalid-extension-value',
    sentence: String.raw`Global option "file" holds an invalid "@acme/strict/option" value: Bad\u000avalue.`,
  },
  'failure-code': {
    correction:
      'Declare a kebab-case code of lowercase letters and digits, such as "registry-down".',
    findings: [],
    headline: 'INVALID FAILURE CODE',
    rule: 'failure-code',
    sentence: 'Failure class "RegistryDownError" declares failure code "Registry_Down".',
  },
  'failure-exit-code': {
    correction: 'Declare a whole number from 1 through 125.',
    findings: [],
    headline: 'UNDECLARABLE EXIT CODE',
    rule: 'failure-exit-code',
    sentence: 'Failure class "OffScaleError" declares exit code 200.',
  },
  'graph-hook-promise': {
    correction: 'Return nothing from the hook; it judges the graph and cannot change it.',
    findings: [bare("plugin('@acme/mcp', { onGraphBuilt: … })", 'onGraphBuilt: …')],
    headline: 'BROKEN GRAPH HOOK',
    rule: 'broken-graph-hook',
    sentence: 'Plugin "@acme/mcp" returned a value from onGraphBuilt.',
  },
  'graph-hook-returns': {
    correction: 'Return nothing from the hook; it judges the graph and cannot change it.',
    findings: [bare("plugin('@acme/mcp', { onGraphBuilt: … })", 'onGraphBuilt: …')],
    headline: 'BROKEN GRAPH HOOK',
    rule: 'broken-graph-hook',
    sentence: 'Plugin "@acme/mcp" returned a value from onGraphBuilt.',
  },
  'graph-hook-throws': {
    correction:
      'Return nothing from the hook, and throw only a DeclarationError to reject the graph.',
    findings: [bare("plugin('@acme/mcp', { onGraphBuilt: … })", 'onGraphBuilt: …')],
    headline: 'BROKEN GRAPH HOOK',
    rule: 'broken-graph-hook',
    sentence: String.raw`Plugin "@acme/mcp" failed in onGraphBuilt: Two tools share\u000athe name "scratch_create".`,
  },
  'hook-alias-spelling': {
    correction: 'Change one of the two spellings or omit the plugin.',
    findings: [
      onCommand(
        ['count'],
        "option('shape', { aliases: ['file'], type: 'string' })",
        "'file'",
        'declared by plugin "@acme/format"',
      ),
      onCommand(
        ['count'],
        "option('file', { type: 'string' })",
        "'file'",
        'the local option "file"',
      ),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence:
      'Plugin "@acme/format" declares option "shape" with spelling "--file" on Command "count", which "--file" already uses.',
  },
  'hook-collision': {
    correction: "Rename the Command's option or omit the plugin.",
    findings: [
      onCommand(
        ['count'],
        "option('format', { type: 'string' })",
        "'format'",
        'declared by plugin "@acme/format"',
      ),
      onCommand(['count'], "option('format', { type: 'boolean' })", "'format'", 'the local option'),
    ],
    headline: 'OPTION DECLARED TWICE',
    rule: 'option-declared-twice',
    sentence:
      'Plugin "@acme/format" declares option "format" on Command "count", which is already declared as a local option.',
  },
  'hook-spelling': {
    correction: 'Change one of the two spellings or omit the plugin.',
    findings: [
      onCommand(
        ['count'],
        "option('shape', { short: 'f', type: 'string' })",
        "short: 'f'",
        'declared by plugin "@acme/format"',
      ),
      onCommand(
        ['count'],
        "option('file', { short: 'f', type: 'string' })",
        "short: 'f'",
        'the local option "file"',
      ),
    ],
    headline: 'SPELLING USED TWICE',
    rule: 'spelling-taken',
    sentence:
      'Plugin "@acme/format" declares option "shape" with spelling "-f" on Command "count", which "--file" already uses.',
  },
  // A plugin another installed copy of core built misses this copy's registry as this value does.
  'plugin-entry': {
    correction:
      'Install one copy of @loomcli/core, so the Application and every plugin package share it.',
    findings: [
      bare(
        "new Application('probe', { plugins: [{ identity: '@acme/log' }] })",
        "{ identity: '@acme/log' }",
      ),
    ],
    headline: 'VALUE FROM ANOTHER COPY OF CORE',
    rule: 'foreign-value',
    sentence: 'The Application holds a plugin another installed copy of @loomcli/core built.',
  },
  'plugin-twice': {
    correction: 'Install each plugin once.',
    findings: [
      bare(
        twoPlugins('@acme/log', '@acme/log'),
        "plugin('@acme/log', …)",
        'the first installation',
      ),
      bare(
        twoPlugins('@acme/log', '@acme/log'),
        "plugin('@acme/log', …)",
        'the second installation',
        1,
      ),
    ],
    headline: 'PLUGIN INSTALLED TWICE',
    rule: 'plugin-installed-twice',
    sentence: 'The Application installs plugin "@acme/log" twice.',
  },
  'rule-identity': {
    correction:
      'Name it <package>[/<subpath>...]/<kebab-case-rule>, such as "@acme/retry/retry-limit".',
    findings: [
      bare(
        "diagnosticRule('Retry Limit', { explanation: 'Each retry repeats.', headline: 'Retry limit' })",
        "'Retry Limit'",
      ),
    ],
    headline: 'INVALID RULE IDENTITY',
    rule: 'rule-identity',
    sentence:
      'Diagnostic rule "Retry Limit" has no package part, or a subpath or rule name that is not kebab-case.',
  },
  'signals-slot': {
    correction: 'Install one owner.',
    findings: [
      bare(
        twoPlugins('@acme/signals', '@acme/trace'),
        "plugin('@acme/signals', …)",
        'holds the signals slot',
      ),
      bare(
        twoPlugins('@acme/signals', '@acme/trace'),
        "plugin('@acme/trace', …)",
        'claims it again',
      ),
    ],
    headline: 'SLOT ALREADY CLAIMED',
    rule: 'slot-taken',
    sentence:
      'Plugin "@acme/trace" claims the signals slot, which plugin "@acme/signals" already holds.',
  },
  'theme-slot': {
    correction: 'Install one owner.',
    findings: [
      bare(
        twoPlugins('@acme/copper', '@acme/slate'),
        "plugin('@acme/copper', …)",
        'holds the theme slot',
      ),
      bare(
        twoPlugins('@acme/copper', '@acme/slate'),
        "plugin('@acme/slate', …)",
        'claims it again',
      ),
    ],
    headline: 'SLOT ALREADY CLAIMED',
    rule: 'slot-taken',
    sentence:
      'Plugin "@acme/slate" claims the theme slot, which plugin "@acme/copper" already holds.',
  },
  'view-copies': {
    correction: 'Install one copy of the package that declares it.',
    findings: [
      bare(
        "plugin('@acme/brand', { views: [view('@acme/page', …), view('@acme/page', …)] })",
        "view('@acme/page', …)",
        'another "@acme/page"',
        1,
      ),
    ],
    headline: 'TWO COPIES OF ONE PACKAGE',
    rule: 'two-package-copies',
    sentence: 'View "@acme/page" is declared by two distinct objects.',
  },
};

test.each(Object.entries(cases))(
  'the %s fault throws its rule’s Developer Diagnostic',
  (scenario, expected) => {
    expect(thrown(scenario)).toBe(diagnostic(expected));
  },
);

test('every rule of the family has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(cases).map((expected) => expected.rule));
  expect([...pinned].toSorted()).toEqual(
    [...Object.keys(explanations), ...Object.keys(shared)].toSorted(),
  );
  expect(declaredRules('rules.ts')).toEqual(expect.arrayContaining(fromCore));
  expect([...declaredRules('plugin-rules.ts'), ...fromCore].toSorted()).toEqual(
    Object.keys(explanations).toSorted(),
  );
});
