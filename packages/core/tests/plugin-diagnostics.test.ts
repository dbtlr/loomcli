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
  'async-extension-schema': [
    'Core validates extension values synchronously while it builds the declaration,',
    'so a schema that answers with a promise leaves it no verdict to read.',
  ],
  'broken-attach-hook': [
    "onCommandAttach receives each Command's declaration at graph build and returns",
    'it, or a value derived from it, synchronously and without throwing. Core builds',
    'the Command the hook returns, so a throw or any other value leaves it nothing to',
    'build.',
  ],
  'extension-output': [
    "Every projection, the manifest included, reads an extension's output as frozen",
    'plain data: strings, finite numbers, Booleans, null, arrays, and plain objects.',
  ],
  'extension-target': [
    'An extension is defined for one target, Commands, options, or arguments, and a',
    'typed read takes that kind of node alone, so a value on another kind would never',
    'be read.',
  ],
  'extension-value-twice': [
    'One extensions list or one extend() call sets each extension once, collecting or',
    'not, so two values of one extension leave it unclear which the author meant.',
  ],
  'extension-without-schema': [
    "Core validates each extension value against its descriptor's Standard Schema at",
    'the call that carries it, so a descriptor with no schema leaves the value',
    'unchecked.',
  ],
  'failure-exit-code': [
    "A failure's exit code tells the shell how the run ended: 0 means success, and",
    '126 and above belong to the shell and to signals, so a failure exits with a code',
    'from 1 through 125. Core never clamps or replaces the code a failure class',
    'declares, so a code no failure may exit with is rejected where the class is',
    'first constructed.',
  ],
  'foreign-value': [
    'Core reads a plugin, an extension, an extension value, a declared view, a view',
    'override, and a translation through facts its factory recorded when it built the',
    'value. Any other value carries none, even one of the same shape.',
  ],
  'invalid-extension-value': [
    "An extension value passes its descriptor's schema at the call that carries it,",
    'so every plugin that reads it reads a value the schema accepted.',
  ],
  'invalid-packet': [
    'The packet says whether the application was built for development, which decides',
    'whether a defect shows the author its Developer Diagnostic or the operator one',
    'generic message. Its build reads development or distributed.',
  ],
  'middleware-activation': [
    "Activation decides when core loads a plugin's middleware: on every run with",
    "'always', or only when an invocation supplies one of the plugin's own options",
    'the list names, so a middleware no invocation needs costs it nothing.',
  ],
  'not-a-function': [
    'Core calls each of these values at a point of its own: load when a run first',
    'reaches a middleware or a source, onCommandAttach at graph build, onFailure when',
    'a failure renders, and a translator when a foreign throw reaches it. A value',
    'core cannot call leaves it nothing to run.',
  ],
  'not-a-list': [
    'Core reads plugins, commands, extensions, views, translators, and signals each',
    'as a list, in order. A value of any other kind has no entries to read.',
  ],
  'not-an-object': [
    "Core reads the options of a Command and of the Application, a plugin's",
    'definition, its options record, each of its option declarations, its middleware,',
    'and its source by their keys. A value of any other kind has no keys to read.',
  ],
  'override-key': [
    'An override replaces the view of a declared view or of a failure class, so its',
    'key is one of them.',
  ],
  'override-twice': [
    'Within one contributor, one key answers to one override, so two leave it unclear',
    'which the author meant. The same key overridden by two contributors resolves to',
    'the first installed.',
  ],
  'plugin-identity': [
    "A plugin's identity keys its contributions and names it in every diagnostic, so",
    'it is a nonempty string, by convention the package name.',
  ],
  'plugin-installed-twice': [
    'Core keys each plugin by its identity, and a plugin contributes its options,',
    'middleware, hooks, and views once, so a second installation would contribute',
    'each of them again.',
  ],
  'plugin-option-rule': [
    "A plugin's middleware interprets its own options' values, so a plugin option",
    'declares how it parses and nothing more: no validator and no presence rule.',
  ],
  'rendering-policy': [
    'The rendering policy decides whether output carries color, modifiers,',
    'hyperlinks, and terminal controls. color, modifiers, and hyperlinks each read',
    'auto, always, or never, and terminalControls reads strip or preserve.',
  ],
  'retired-application-option': [
    'The Application no longer reads globals or failures. A global option is declared',
    'with globalOption(), so its type reaches every action, and a failure view is an',
    'override under views.',
  ],
  'rule-docs': [
    "A diagnostic prints a rule's docs as a link the author follows, so it is an",
    'absolute http or https URL.',
  ],
  'rule-identity': [
    "A rule's identity names the package that declares it and the rule inside it, so",
    'tooling keys on it and two packages never share one. It follows the grammar of a',
    "validator package's issue codes: a package name, /, and a kebab-case rule name.",
  ],
  'rule-prose': [
    "A rule's banner prints its headline, and its explanation teaches why the rule",
    'exists, so each holds prose.',
  ],
  'signal-claimed-twice': [
    'Core installs one listener for each signal a plugin claims, and a second',
    'listener on one signal would take the forced path on the first signal the run',
    'receives.',
  ],
  'slot-taken': [
    'A slot is a position exactly one plugin claims: the theme, the process signals,',
    'and the configuration source. A second claim would leave two plugins answering',
    'where core asks one.',
  ],
  'source-binding': [
    'A configuration source answers the options that carry its binding, an extension',
    'the plugin lists under extensions that applies to options. Core asks the source',
    'about those options without knowing what the binding means.',
  ],
  'source-bound-own-option': [
    "A plugin's own options resolve before its configuration source loads, because",
    'the source reads them, so none of them can take a value from that source.',
  ],
  'theme-mapping': [
    "A plugin's theme maps each name to an unapplied chain of concrete styles. A",
    'semantic token reads the theme itself, so a chain that holds one has no concrete',
    'style to resolve to.',
  ],
  'theme-name-taken': [
    'Each theme name becomes a member of the style object beside the built-in',
    'members, so a name a built-in already holds would hide it.',
  ],
  'translation-key': [
    'A translation keys on the foreign error class it replaces. Core offers a',
    'translator only a thrown value no failure class made, so the key is a class and',
    'never a failure class.',
  ],
  'two-package-copies': [
    'Core keys each extension and each declared view by its identity and compares it',
    'by reference. Two distinct objects under one identity mean two copies of the',
    'package that defines it are installed, and a value one copy made cannot be read',
    'through the other.',
  ],
  'unknown-signal': [
    'Core installs listeners for SIGINT and SIGTERM alone, the two signals that ask a',
    'command-line program to stop, so a plugin claims one of those.',
  ],
};

/** The rules of other families this family raises too. */
const shared = {
  'flag-not-boolean': [
    'hidden, shortOnly, multiple, required, variadic, validateOmitted, and an',
    "extension's collect each answer one yes-or-no question about a declaration, so",
    'each holds true or false. A value such as the string "false" would read as true.',
  ],
  'not-a-command': [
    'A Command value carries the declaration that routing, parsing, and help read.',
    'Any other value carries none.',
  ],
  'plugin-option-collision': [
    "A plugin's options join the one table the pre-scan reads with the global",
    "options, so every Command meets them, and an input a plugin's onCommandAttach",
    "hook declares joins the Command's own. A name or a spelling that another input",
    'in that scope also claims would reach only one of the two.',
  ],
  'view-shape': [
    'A views entry is a view with render, which receives the whole result, or a row',
    'view with row, which receives one row at a time. Core reads which function it',
    'holds to decide how to feed it.',
  ],
};

/** The rules core declares beside its defects that this family raises. */
const fromCore = ['failure-exit-code', 'rule-docs', 'rule-identity', 'rule-prose'];

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
  'activation-empty': {
    correction: "Name at least one of the plugin's options or use 'always'.",
    findings: [
      bare("plugin('@acme/help', { middleware: { activate: [], load: … } })", 'activate: []'),
    ],
    headline: 'INVALID MIDDLEWARE ACTIVATION',
    rule: 'middleware-activation',
    sentence: 'Plugin "@acme/help" declares middleware with an empty activation list.',
  },
  'activation-missing': {
    correction: "Supply activate: 'always' or a list of the plugin's own option names.",
    findings: [
      bare("plugin('@acme/help', { middleware: { load: … } })", 'middleware: { load: … }'),
    ],
    headline: 'INVALID MIDDLEWARE ACTIVATION',
    rule: 'middleware-activation',
    sentence: 'Plugin "@acme/help" declares middleware with no activation.',
  },
  'activation-unknown': {
    correction: "Name one of the plugin's own options.",
    findings: [
      bare("plugin('@acme/help', { middleware: { activate: ['hlep'], load: … } })", "'hlep'"),
    ],
    headline: 'INVALID MIDDLEWARE ACTIVATION',
    rule: 'middleware-activation',
    sentence:
      'Plugin "@acme/help" activates middleware on option "hlep", which it does not declare.',
  },
  'application-failures': {
    correction: 'Declare view overrides under views with override(key, view).',
    findings: [bare("new Application('probe', { failures: {} })", 'failures: {}')],
    headline: 'RETIRED APPLICATION OPTION',
    rule: 'retired-application-option',
    sentence: 'The Application options contain failures.',
  },
  'application-globals': {
    correction: 'Declare them with globalOption(name, config).',
    findings: [bare("new Application('probe', { globals: {} })", 'globals: {}')],
    headline: 'RETIRED APPLICATION OPTION',
    rule: 'retired-application-option',
    sentence: 'The Application options contain globals.',
  },
  'application-view-declared': {
    correction: 'Supply the value returned by override(key, view).',
    findings: [
      bare("new Application('probe', { views: [view('@acme/page', …)] })", "view('@acme/page', …)"),
    ],
    headline: 'VALUE NOT FROM ITS FACTORY',
    rule: 'foreign-value',
    sentence: 'The Application holds a value that is not a view override.',
  },
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
  'commands-entry': {
    correction: 'Supply the value returned by new Command(name).',
    findings: [
      bare("plugin('@acme/doctor', { commands: [new Command('check'), 'probe'] })", "'probe'"),
    ],
    headline: 'NOT A COMMAND',
    rule: 'not-a-command',
    sentence: 'Plugin "@acme/doctor" holds a value that is not a Command.',
  },
  'commands-not-list': {
    correction: 'Supply a list of Command values.',
    findings: [bare("plugin('@acme/doctor', { commands: 'check' })", "commands: 'check'")],
    headline: 'NOT A LIST',
    rule: 'not-a-list',
    sentence: 'Plugin "@acme/doctor" declares commands that are not an array.',
  },
  'extension-async': {
    correction: 'Supply a schema that answers synchronously.',
    findings: [
      bare("new Command('get', { extensions: […] })", '…', 'extension "@acme/slow/command"'),
    ],
    headline: 'ASYNCHRONOUS EXTENSION SCHEMA',
    rule: 'async-extension-schema',
    sentence: 'Extension "@acme/slow/command" validates asynchronously.',
  },
  'extension-collect': {
    correction: 'Use true or false.',
    findings: [
      bare("plugin('@acme/notes', { extensions: […] })", '…', 'extension "@acme/notes/list"'),
    ],
    headline: 'FLAG NOT A BOOLEAN',
    rule: 'flag-not-boolean',
    sentence: 'Extension "@acme/notes/list" declares collect that is not a Boolean.',
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
  'extension-entry': {
    correction: 'Supply the value returned by extension(identity, config).',
    findings: [
      bare(
        "plugin('@acme/notes', { extensions: ['@acme/notes/command'] })",
        "'@acme/notes/command'",
      ),
    ],
    headline: 'VALUE NOT FROM ITS FACTORY',
    rule: 'foreign-value',
    sentence: 'Plugin "@acme/notes" holds a value that is not an extension.',
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
  'extension-list': {
    correction: 'Supply a list of values returned by calling an extension.',
    findings: [bare("new Command('get', { extensions: … })", 'extensions: …')],
    headline: 'NOT A LIST',
    rule: 'not-a-list',
    sentence: 'Command "get" declares extensions that are not an array.',
  },
  'extension-no-schema': {
    correction: 'Supply a Standard Schema v1 object that answers synchronously.',
    findings: [onCommand(['get'], 'extend(…)', '…', 'extension "@acme/bare/command"')],
    headline: 'EXTENSION WITHOUT A SCHEMA',
    rule: 'extension-without-schema',
    sentence: 'Command "get" holds extension "@acme/bare/command", which declares no schema.',
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
  'extension-target': {
    correction: 'Supply an extension that applies to Commands.',
    findings: [
      bare("new Command('get', { extensions: […] })", '…', 'extension "@acme/notes/option"'),
    ],
    headline: 'EXTENSION ON THE WRONG TARGET',
    rule: 'extension-target',
    sentence: 'Command "get" holds extension "@acme/notes/option", which applies to options.',
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
  'extension-twice': {
    correction: 'Supply one value.',
    findings: [
      onCommand(['get'], 'extend(…, …)', '…', 'the first value'),
      onCommand(['get'], 'extend(…, …)', '…', 'the second value', 1),
    ],
    headline: 'EXTENSION VALUE TWICE',
    rule: 'extension-value-twice',
    sentence: 'Command "get" holds extension "@acme/notes/command" twice.',
  },
  'extension-value': {
    correction: 'Supply the value returned by calling an extension.',
    findings: [
      onCommand(
        ['get'],
        "extend({ identity: '@acme/notes/command' })",
        "{ identity: '@acme/notes/command' }",
      ),
    ],
    headline: 'VALUE NOT FROM ITS FACTORY',
    rule: 'foreign-value',
    sentence: 'Command "get" holds a value that is not an extension value.',
  },
  'failure-exit-code': {
    correction: 'Declare a whole number from 1 through 125.',
    findings: [],
    headline: 'UNDECLARABLE EXIT CODE',
    rule: 'failure-exit-code',
    sentence: 'Failure class "OffScaleError" declares exit code 200.',
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
    headline: 'PLUGIN OPTION COLLISION',
    rule: 'plugin-option-collision',
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
    headline: 'PLUGIN OPTION COLLISION',
    rule: 'plugin-option-collision',
    sentence:
      'Plugin "@acme/format" declares option "shape" with spelling "-f" on Command "count", which "--file" already uses.',
  },
  'middleware-load': {
    correction: "Supply load: () => import('./middleware.js').",
    findings: [
      bare(
        "plugin('@acme/help', { middleware: { activate: 'always' } })",
        "middleware: { activate: 'always' }",
      ),
    ],
    headline: 'NOT A FUNCTION',
    rule: 'not-a-function',
    sentence: 'Plugin "@acme/help" declares middleware with no load function.',
  },
  'middleware-object': {
    correction: 'Supply { activate, load }.',
    findings: [bare("plugin('@acme/help', { middleware: 'help' })", "middleware: 'help'")],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Plugin "@acme/help" declares middleware that is not an object.',
  },
  'on-failure': {
    correction: 'Supply a function of the failure and its context.',
    findings: [bare("plugin('@acme/suggest', { onFailure: 'hint' })", "onFailure: 'hint'")],
    headline: 'NOT A FUNCTION',
    rule: 'not-a-function',
    sentence: 'Plugin "@acme/suggest" declares onFailure that is not a function.',
  },
  'option-config': {
    correction: 'Supply { type, ... }.',
    findings: [bare("plugin('@acme/log', { options: { level: 'debug' } })", "level: 'debug'")],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Plugin "@acme/log" option "level" is not an option declaration.',
  },
  'option-rule': {
    correction:
      'Remove it; a plugin option carries no validator or presence rule, and the middleware interprets the value.',
    findings: [
      bare(
        "plugin('@acme/log', { options: { level: { required: true, type: 'string' } } })",
        'required: true',
      ),
    ],
    headline: 'RULE ON A PLUGIN OPTION',
    rule: 'plugin-option-rule',
    sentence: 'Plugin "@acme/log" option "level" declares required.',
  },
  'options-record': {
    correction: 'Supply a record of option declarations.',
    findings: [bare("plugin('@acme/log', { options: [] })", 'options: []')],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Plugin "@acme/log" declares options that are not an object.',
  },
  'override-key': {
    correction:
      'Key the override on a value view(identity, definition) returned, or on a failure class.',
    findings: [bare("new Application('probe', { views: [override(…, …)] })", 'override(…, …)')],
    headline: 'INVALID OVERRIDE KEY',
    rule: 'override-key',
    sentence:
      'The Application overrides a key that is neither a declared view nor a failure class.',
  },
  'override-twice': {
    correction: 'Remove one override.',
    findings: [
      bare(
        "plugin('@acme/brand', { views: [override(InputError, …), override(InputError, …)] })",
        'override(InputError, …)',
        'the first override',
      ),
      bare(
        "plugin('@acme/brand', { views: [override(InputError, …), override(InputError, …)] })",
        'override(InputError, …)',
        'the second override',
        1,
      ),
    ],
    headline: 'KEY OVERRIDDEN TWICE',
    rule: 'override-twice',
    sentence: 'Plugin "@acme/brand" overrides the view for "InputError" twice.',
  },
  'packet-build': {
    correction: 'Set build to "development" or "distributed".',
    findings: [
      bare("new Application('probe', { packet: { build: 'staging' } })", "build: 'staging'"),
    ],
    headline: 'INVALID PACKET',
    rule: 'invalid-packet',
    sentence: 'The packet\'s build is "staging".',
  },
  'packet-object': {
    correction: 'Import loom.packet.json and pass it as packet.',
    findings: [
      bare("new Application('probe', { packet: 'development' })", "packet: 'development'"),
    ],
    headline: 'INVALID PACKET',
    rule: 'invalid-packet',
    sentence: 'The Application packet must be an object.',
  },
  'plugin-definition': {
    correction: 'Supply { options, middleware, extensions, views }.',
    findings: [bare("plugin('@acme/log', 'debug')", "'debug'")],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Plugin "@acme/log" declares a definition that is not an object.',
  },
  'plugin-empty-identity': {
    correction: 'Supply a nonempty string, such as the package name.',
    findings: [bare("plugin('', …)", "''")],
    headline: 'INVALID PLUGIN IDENTITY',
    rule: 'plugin-identity',
    sentence: 'A plugin declares an empty identity.',
  },
  'plugin-entry': {
    correction: 'Supply the value returned by plugin(identity, definition).',
    findings: [
      bare(
        "new Application('probe', { plugins: [{ identity: '@acme/log' }] })",
        "{ identity: '@acme/log' }",
      ),
    ],
    headline: 'VALUE NOT FROM ITS FACTORY',
    rule: 'foreign-value',
    sentence: 'The Application holds a value that is not a plugin.',
  },
  'plugin-identity': {
    correction: 'Supply a nonempty string, such as the package name.',
    findings: [bare('plugin(7, …)', '7')],
    headline: 'INVALID PLUGIN IDENTITY',
    rule: 'plugin-identity',
    sentence: 'A plugin declares an identity that is not a string.',
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
  'plugins-not-list': {
    correction: 'Supply a list of plugin values.',
    findings: [bare("new Application('probe', { plugins: 'log' })", "plugins: 'log'")],
    headline: 'NOT A LIST',
    rule: 'not-a-list',
    sentence: 'The Application declares plugins that are not an array.',
  },
  'rendering-field': {
    correction: 'Supply one of the three, or omit color.',
    findings: [bare("new Application('probe', { rendering: { color: 'yes' } })", "color: 'yes'")],
    headline: 'INVALID RENDERING POLICY',
    rule: 'rendering-policy',
    sentence: 'Rendering color is not auto, always, or never.',
  },
  'rendering-object': {
    correction: 'Supply an object, or omit rendering.',
    findings: [bare("new Application('probe', { rendering: 'auto' })", "rendering: 'auto'")],
    headline: 'INVALID RENDERING POLICY',
    rule: 'rendering-policy',
    sentence: 'The rendering policy is not an object.',
  },
  'rendering-terminal': {
    correction: 'Supply strip or preserve, or omit terminalControls.',
    findings: [
      bare(
        "new Application('probe', { rendering: { terminalControls: 'keep' } })",
        "terminalControls: 'keep'",
      ),
    ],
    headline: 'INVALID RENDERING POLICY',
    rule: 'rendering-policy',
    sentence: 'Rendering terminalControls is not strip or preserve.',
  },
  'rule-docs': {
    correction: 'Supply an absolute https URL, or omit docs.',
    findings: [
      bare(
        "diagnosticRule('@acme/retry/retry-limit', { docs: 'retry.md', explanation: 'Each retry repeats the request.', headline: 'Retry limit out of range' })",
        "docs: 'retry.md'",
      ),
    ],
    headline: 'INVALID RULE DOCS',
    rule: 'rule-docs',
    sentence: 'Diagnostic rule "@acme/retry/retry-limit" declares docs that are not a URL.',
  },
  'rule-explanation': {
    correction: 'Supply prose that says why the rule exists.',
    findings: [
      bare(
        "diagnosticRule('@acme/retry/retry-limit', { explanation: ' ', headline: 'Retry limit' })",
        "explanation: ' '",
      ),
    ],
    headline: 'EMPTY RULE TEXT',
    rule: 'rule-prose',
    sentence: 'Diagnostic rule "@acme/retry/retry-limit" declares an empty explanation.',
  },
  'rule-identity': {
    correction: 'Name it <package>/<kebab-case-rule>, such as "@acme/retry/retry-limit".',
    findings: [
      bare(
        "diagnosticRule('Retry Limit', { explanation: 'Each retry repeats.', headline: 'Retry limit' })",
        "'Retry Limit'",
      ),
    ],
    headline: 'INVALID RULE IDENTITY',
    rule: 'rule-identity',
    sentence:
      'Diagnostic rule "Retry Limit" has no package part or a rule name that is not kebab-case.',
  },
  'signal-twice': {
    correction: 'Claim each signal once.',
    findings: [
      bare(
        "plugin('@acme/signals', { signals: ['SIGINT', 'SIGINT'] })",
        "'SIGINT'",
        'the first claim',
      ),
      bare(
        "plugin('@acme/signals', { signals: ['SIGINT', 'SIGINT'] })",
        "'SIGINT'",
        'the second claim',
        1,
      ),
    ],
    headline: 'SIGNAL CLAIMED TWICE',
    rule: 'signal-claimed-twice',
    sentence: 'Plugin "@acme/signals" claims signal "SIGINT" twice.',
  },
  'signal-unknown': {
    correction: 'Claim SIGINT or SIGTERM.',
    findings: [bare("plugin('@acme/signals', { signals: ['SIGHUP'] })", "'SIGHUP'")],
    headline: 'UNKNOWN SIGNAL',
    rule: 'unknown-signal',
    sentence: 'Plugin "@acme/signals" claims signal "SIGHUP".',
  },
  'signals-not-list': {
    correction: 'Supply a list of signal names.',
    findings: [bare("plugin('@acme/signals', { signals: 'SIGINT' })", "signals: 'SIGINT'")],
    headline: 'NOT A LIST',
    rule: 'not-a-list',
    sentence: 'Plugin "@acme/signals" declares signals that are not an array.',
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
  'source-binding': {
    correction: 'Supply a descriptor the plugin lists under extensions.',
    findings: [bare("plugin('@acme/config', { source: { binding: …, load: … } })", 'binding: …')],
    headline: 'INVALID SOURCE BINDING',
    rule: 'source-binding',
    sentence: 'Plugin "@acme/config" declares a source binding that is not one of its extensions.',
  },
  'source-load': {
    correction: "Supply load: () => import('./source.js').",
    findings: [
      bare("plugin('@acme/config', { source: { binding: … } })", 'source: { binding: … }'),
    ],
    headline: 'NOT A FUNCTION',
    rule: 'not-a-function',
    sentence: 'Plugin "@acme/config" declares a source with no load function.',
  },
  'source-object': {
    correction: 'Supply { binding, load }.',
    findings: [bare("plugin('@acme/config', { source: 'files' })", "source: 'files'")],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Plugin "@acme/config" declares a source that is not an object.',
  },
  'source-own-option': {
    correction: "Remove the value; the source's own options resolve before it loads.",
    findings: [
      bare(
        "plugin('@acme/config', { options: { config: { extensions: […], type: 'string' } } })",
        'extensions: […]',
      ),
    ],
    headline: 'SOURCE BOUND TO ITS OWN OPTION',
    rule: 'source-bound-own-option',
    sentence: 'Plugin "@acme/config" option "config" carries its own source binding.',
  },
  'source-target': {
    correction: 'Supply an extension that applies to options.',
    findings: [bare("plugin('@acme/config', { source: { binding: …, load: … } })", 'binding: …')],
    headline: 'INVALID SOURCE BINDING',
    rule: 'source-binding',
    sentence:
      'Plugin "@acme/config" declares source binding "@acme/notes/command", which applies to Commands.',
  },
  'theme-chain': {
    correction:
      'Map the name to a concrete chain such as style.cyan.bold, without calling it or naming a semantic style.',
    findings: [bare("plugin('@acme/theme', { theme: { highlight: … } })", 'highlight: …')],
    headline: 'INVALID THEME MAPPING',
    rule: 'theme-mapping',
    sentence:
      'Plugin "@acme/theme" theme mapping "highlight" is not an unapplied concrete style chain without semantic tokens.',
  },
  'theme-name': {
    correction: 'Rename the theme entry.',
    findings: [bare("plugin('@acme/theme', { theme: { bold: … } })", 'bold: …')],
    headline: 'THEME NAME TAKEN',
    rule: 'theme-name-taken',
    sentence: 'Plugin "@acme/theme" theme name "bold" shadows a built-in style member.',
  },
  'theme-object': {
    correction: 'Supply a mapping of names to concrete style chains.',
    findings: [bare("plugin('@acme/theme', { theme: 'copper' })", "theme: 'copper'")],
    headline: 'INVALID THEME MAPPING',
    rule: 'theme-mapping',
    sentence: 'Plugin "@acme/theme" declares a theme that is not a mapping.',
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
  'translate-failure-key': {
    correction: 'Key the translation on the foreign class it replaces.',
    findings: [bare('translate(FatalError, …)', 'FatalError')],
    headline: 'INVALID TRANSLATION KEY',
    rule: 'translation-key',
    sentence: 'translate() received a failure class as its key.',
  },
  'translate-key': {
    correction: 'Supply an error class, such as SyntaxError.',
    findings: [bare("translate('SyntaxError', …)", "'SyntaxError'")],
    headline: 'INVALID TRANSLATION KEY',
    rule: 'translation-key',
    sentence: 'translate() received a key that is not a class.',
  },
  'translate-translator': {
    correction: 'Supply a function that returns a failure or undefined.',
    findings: [bare("translate(SyntaxError, 'invalid')", "'invalid'")],
    headline: 'NOT A FUNCTION',
    rule: 'not-a-function',
    sentence: 'translate() received a translator that is not a function.',
  },
  'translators-entry': {
    correction: 'Supply the value returned by translate(ErrorClass, translator).',
    findings: [bare("new Application('probe', { translators: […] })", '…')],
    headline: 'VALUE NOT FROM ITS FACTORY',
    rule: 'foreign-value',
    sentence: 'The Application holds a translator entry that is not a translation.',
  },
  'translators-not-list': {
    correction: 'Supply a list of values returned by translate(ErrorClass, translator).',
    findings: [bare("plugin('@acme/http', { translators: 'none' })", "translators: 'none'")],
    headline: 'NOT A LIST',
    rule: 'not-a-list',
    sentence: 'Plugin "@acme/http" declares translators that are not an array.',
  },
  'view-both': {
    correction: 'Supply one of the two.',
    findings: [bare("view('@acme/page', { render: …, row: … })", '{ render: …, row: … }')],
    headline: 'NOT ONE VIEW',
    rule: 'view-shape',
    sentence: 'View "@acme/page" carries render and row.',
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
  'view-neither': {
    correction: 'Supply a view with render or a row view with row.',
    findings: [bare("view('@acme/page', {})", '{}')],
    headline: 'NOT ONE VIEW',
    rule: 'view-shape',
    sentence: 'View "@acme/page" carries neither render nor row.',
  },
  'views-entry': {
    correction: 'Supply the value returned by view(identity, definition) or override(key, view).',
    findings: [bare("plugin('@acme/brand', { views: […] })", '…')],
    headline: 'VALUE NOT FROM ITS FACTORY',
    rule: 'foreign-value',
    sentence: 'Plugin "@acme/brand" holds a value that is not a view.',
  },
  'views-not-list': {
    correction: 'Supply a list of declared views and override values.',
    findings: [bare("plugin('@acme/brand', { views: 'page' })", "views: 'page'")],
    headline: 'NOT A LIST',
    rule: 'not-a-list',
    sentence: 'Plugin "@acme/brand" declares views that are not an array.',
  },
};

test.each(Object.entries(cases))(
  'the %s fault throws its rule’s Developer Diagnostic',
  (scenario, expected) => {
    expect(thrown(scenario)).toBe(diagnostic(expected));
  },
);

test('a rendering policy run() receives reports from run() under the Application it runs', () => {
  expect(invoke(fixture, ['run-rendering'])).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Supply one of the three, or omit hyperlinks.',
      findings: [
        [
          '    // probe',
          "    new Application('probe')",
          ...marked("      .run({ rendering: { hyperlinks: 'maybe' } })", "hyperlinks: 'maybe'"),
        ],
      ],
      headline: 'INVALID RENDERING POLICY',
      rule: 'rendering-policy',
      sentence: 'Rendering hyperlinks is not auto, always, or never.',
    }),
    stdout: '',
  });
});

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
