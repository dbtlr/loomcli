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
  'alias-without-names': [
    'alias() adds each name it receives to the names that route to its Command, so a',
    'call with none adds nothing.',
  ],
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
  'command-globals': [
    'Global options belong to the Application, which declares them with',
    'globalOption() and hands their values to every action. A named Command reads',
    "their types from the Application's registered environment.",
  ],
  'command-without-action': [
    "Routing ends at a Command that runs its action, or passes on to one of a group's",
    'children. A Command with neither leaves an invocation that reaches it nothing to',
    'run.',
  ],
  'declared-after-action': [
    "action() finishes a Command's declaration: the handler's types read every",
    'argument, option, alias, result, and child declared before it, so a later call',
    'would declare what the handler never sees.',
  ],
  'declared-name': [
    'An action reads each argument and option under its name, and help and',
    'diagnostics print it. A leading "-" reads as an option, and whitespace or "="',
    'splits the name where the parser reads it.',
  ],
  'group-option': [
    'A Command with no action is a group, which passes an invocation on to one of its',
    'children. A local option is never inherited, so no action reads an option a',
    'group declares.',
  ],
  'media-type': [
    "A view's media type tells a reader how to parse the text the view writes, such",
    'as application/json, so it is a string. Core stores it as declared and never',
    'checks it against the text.',
  ],
  'misplaced-listing-fact': [
    'hidden and deprecated keep a named Command or an option off a listing, or mark',
    'it retired. The root is the entry point of every page, and an argument cannot',
    'leave the grammar it sits in, so neither carries them. control marks an option',
    "that controls the invocation rather than feeding the Command's work, and an",
    "argument is always the Command's input, so it carries no control mark.",
  ],
  'multiple-actions': [
    'Routing runs one handler for the Command it selects, so a second action would',
    'leave one of the two unreachable.',
  ],
  'multiple-results': [
    "A Command's action emits one result through out.results(), declared once, as a",
    'value with result() or as rows with rows(), so its consumers read one',
    'declaration.',
  ],
  'nesting-depth': [
    'Each level of nesting adds a token an operator types before a Command runs. Loom',
    'keeps every Command at most two levels below the root, so every invocation stays',
    'short enough to remember.',
  ],
  'not-a-command': [
    'A Command value carries the declaration that routing, parsing, and help read.',
    'Any other value carries none.',
  ],
  'not-one-line': [
    'Help, --version, the manifest, and every other listing print a description, a',
    'deprecated message, and a version on one line beside what each names, so each',
    'holds prose and no line break. An operator or an agent follows a deprecated',
    'message to the replacement, so a bare true names none, and a version is a string',
    'as the package manifest spells it.',
  ],
  'optional-argument-last': [
    'Positional tokens fill the arguments in order, and an operator leaves out an',
    'optional argument from the end of the line. An argument after an optional one',
    'would take the token the optional one was meant to receive.',
  ],
  'portable-name': [
    'An operator types the application name, each Command name, and each alias as a',
    'command at a shell prompt. A character outside the POSIX portable filename set',
    'needs quoting there, a leading "-" reads as an option, and a leading "." names a',
    'file a shell hides.',
  ],
  'repeated-alias': [
    'A Command or an option answers to its name and to each of its aliases, so an',
    'alias that repeats one of them adds nothing new.',
  ],
  'result-without-action': [
    'A declared result is a promise the action keeps by emitting through',
    'out.results(). A Command with no action has nothing to keep it.',
  ],
  'result-without-views': [
    'A result prints through one of its views: the default one, or the one an',
    'operator or a middleware selects. A result with none has no way to print.',
  ],
  'row-view-on-value': [
    'A row view renders one row at a time, which only a result declared with rows()',
    'emits. A value result arrives whole, so a view with render reads it.',
  ],
  'sibling-name-taken': [
    'Every canonical name and alias under one parent routes one token to one child,',
    'so a name that two siblings share cannot route.',
  ],
  'unknown-default-view': [
    'The default view renders a result when nothing selects another, so it names one',
    'of the views the result declares.',
  ],
  'variadic-argument-last': [
    'A variadic argument takes every positional token that remains, so an argument',
    'after it would never receive one.',
  ],
  'view-name': [
    'An operator and a middleware select a view by its name, so it is a bare token.',
    'It is not integer-like either, because an object moves such a key ahead of every',
    'other and the views lose the order they were declared in.',
  ],
  'view-shape': [
    'A views entry is a view with render, which receives the whole result, or a row',
    'view with row, which receives one row at a time. Core reads which function it',
    'holds to decide how to feed it.',
  ],
  'views-without-result': [
    'views() reshapes the views a declared result renders through. A Command that',
    'declares no result emits nothing for a view to render.',
  ],
};

/** The rules of other families this family raises too. */
const shared = {
  'flag-not-boolean': [
    'hidden, control, shortOnly, multiple, required, variadic, validateOmitted, and',
    "an extension's collect each answer one yes-or-no question about a declaration,",
    'so each holds true or false. A value such as the string "false" would read as',
    'true.',
  ],
  'not-an-object': [
    "Core reads the options of a Command and of the Application, a plugin's",
    'definition, its options record, each of its option declarations, its middleware,',
    'its source, the config of an argument or option, and the settings a plugin',
    'factory takes by their keys. A value of any other kind has no keys to read.',
  ],
  'unreadable-declaration': [
    'Core reads a declaration by its keys, and each list in it by index, once, at the',
    'call that declares it, and checks and records the copy it takes. A read that',
    'throws, such as a throwing getter or proxy trap, leaves core nothing to check or',
    'record.',
  ],
};

type Rule = keyof typeof explanations | keyof typeof shared;

/** Every explanation this family pins, its own and the shared ones, by rule. */
const explanationsByRule: Record<Rule, readonly string[]> = { ...explanations, ...shared };

function explanationOf(rule: Rule): readonly string[] {
  return explanationsByRule[rule];
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

/** The correction every unreadable config carries. */
const readable =
  'Declare the config as a plain object literal whose properties read without throwing.';

/**
 * The unreadable-config fault of one call, whose finding marks the key whose read threw, or the
 * whole config when no `slot` is given. `receiver` holds the lines above the call. A part whose
 * read threw is never read again, so it prints as an ellipsis.
 */
function unreadable(
  receiver: readonly string[],
  parts: { call: string; subject: string; slot?: string },
): Expected {
  const { call, slot, subject } = parts;
  const target = slot === undefined ? '…' : `${slot}: …`;
  const line = slot === undefined ? `      .${call}, …)` : `      .${call}, { ${target} })`;
  const start = line.lastIndexOf(target);
  return {
    correction: readable,
    findings: [[...receiver, line, `${' '.repeat(start)}${'^'.repeat(target.length)}`]],
    headline: 'DECLARATION COULD NOT BE READ',
    rule: 'unreadable-declaration',
    sentence: `${subject} config could not be read: boom.`,
  };
}

/** The correction every unreadable options object carries. */
const readableOptions =
  'Declare the options as a plain object literal whose properties read without throwing.';

/** The receiver lines of a call on the Command `get`. */
const onGet = ['    // get', "    new Command('get')"];

const cases: Record<string, Expected> = {
  'alias-after-action': {
    correction: 'Declare aliases before action().',
    findings: [
      [
        '    // keys',
        "    new Command('keys')",
        "      .alias('ls')",
        '             ^^^^ after action()',
      ],
    ],
    headline: 'DECLARED AFTER THE ACTION',
    rule: 'declared-after-action',
    sentence: 'Command "keys" declares alias "ls" after its action.',
  },
  'alias-own-name': {
    correction: 'Remove the alias.',
    findings: [
      [
        '    // keys',
        "    new Command('keys')",
        "      .alias('ls', 'keys')",
        '                   ^^^^^^ its own name',
      ],
    ],
    headline: 'ALIAS REPEATS A NAME',
    rule: 'repeated-alias',
    sentence: 'Command "keys" declares alias "keys", which is its own name.',
  },
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
  'alias-without-names': {
    correction: 'Supply at least one name.',
    findings: [['    // keys', "    new Command('keys')", '      .alias()']],
    headline: 'ALIAS WITH NO NAMES',
    rule: 'alias-without-names',
    sentence: 'Command "keys" declares an alias with no names.',
  },
  'app-option-config': {
    correction: "Supply an option config object, such as { type: 'string' }.",
    findings: [
      [
        '    new Application(…)',
        "      .option('format', undefined)",
        '                        ^^^^^^^^^',
      ],
    ],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Option "format" declares a config that is not an object.',
  },
  'application-description': {
    correction: 'Supply a one-line summary.',
    findings: [
      [
        "    new Application('probe', { description: '  ' })",
        '                               ^^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'The Application description must hold a character other than whitespace and no line terminator.',
  },
  'application-description-read-once': {
    correction: 'Supply a one-line summary.',
    findings: [
      [
        "    new Application('probe', { description: '' })",
        '                               ^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'The Application description must hold a character other than whitespace and no line terminator.',
  },
  'application-hidden': {
    correction: 'Remove it.',
    findings: [
      [
        "    new Application('probe', { hidden: true })",
        '                               ^^^^^^^^^^^^',
      ],
    ],
    headline: 'LISTING FACT OUT OF PLACE',
    rule: 'misplaced-listing-fact',
    sentence: 'The Application declares hidden, which applies to named Commands and options alone.',
  },
  'application-name': {
    correction: portable,
    findings: [["    new Application('bad name')", '                    ^^^^^^^^^^']],
    headline: 'NAME NOT PORTABLE',
    rule: 'portable-name',
    sentence: 'Application name "bad name" is invalid.',
  },
  'application-options': {
    correction: 'Supply an Application options object.',
    findings: [["    new Application('probe', 'fast')", '                             ^^^^^^']],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'The Application declares options that are not an object.',
  },
  'application-options-prototype-unreadable': {
    correction: readableOptions,
    findings: [["    new Application('probe', …)", '                             ^']],
    headline: 'DECLARATION COULD NOT BE READ',
    rule: 'unreadable-declaration',
    sentence: 'The Application options could not be read: boom.',
  },
  'application-options-unreadable': {
    correction: readableOptions,
    findings: [
      ["    new Application('probe', { plugins: … })", '                               ^^^^^^^^^^'],
    ],
    headline: 'DECLARATION COULD NOT BE READ',
    rule: 'unreadable-declaration',
    sentence: 'The Application options could not be read: boom.',
  },
  'application-version': {
    correction: 'Supply a string such as "1.2.0".',
    findings: [
      ["    new Application('probe', { version: 1 })", '                               ^^^^^^^^^^'],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'The Application version must be a string that holds a character other than whitespace and no line terminator.',
  },
  'argument-after-optional': {
    correction: 'Declare an optional argument last.',
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
        "      .argument('name', {})",
        '                ^^^^^^ the argument after it',
      ],
    ],
    headline: 'OPTIONAL ARGUMENT NOT LAST',
    rule: 'optional-argument-last',
    sentence: 'Argument "name" follows optional argument "path" on Command "keys".',
  },
  'argument-beside-child': {
    correction: 'Move the argument into a child Command or remove the children.',
    findings: [
      [
        '    // store',
        "    new Command('store')",
        "      .argument('files', { variadic: true })",
        '                ^^^^^^^ the argument',
      ],
      [
        '    // store',
        "    new Command('store')",
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ the child',
      ],
    ],
    headline: 'ARGUMENTS BESIDE CHILDREN',
    rule: 'arguments-beside-children',
    sentence: 'Command "store" declares argument "files" and attaches child "get".',
  },
  'argument-config': {
    correction: 'Supply an argument config object, such as {}.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .argument('path', 'text')",
        '                        ^^^^^^',
      ],
    ],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Argument "path" declares a config that is not an object.',
  },
  'argument-hidden': {
    correction: 'Remove it.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .argument('path', { hidden: true })",
        '                          ^^^^^^^^^^^^',
      ],
    ],
    headline: 'LISTING FACT OUT OF PLACE',
    rule: 'misplaced-listing-fact',
    sentence:
      'Command "get" argument "path" declares hidden, which applies to named Commands and options alone.',
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
  'argument-read-once': unreadable(onGet, {
    call: "argument('path'",
    slot: 'default',
    subject: 'Argument "path"',
  }),
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
  'argument-unreadable': unreadable(onGet, {
    call: "argument('path'",
    slot: 'default',
    subject: 'Argument "path"',
  }),
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
  'child-after-action': {
    correction: 'Attach children before action().',
    findings: [
      [
        '    new Application(…)',
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ after action()',
      ],
    ],
    headline: 'DECLARED AFTER THE ACTION',
    rule: 'declared-after-action',
    sentence: 'The root Command attaches child "get" after its action.',
  },
  'child-beside-argument': {
    correction: 'Move the argument into a child Command or remove the children.',
    findings: [
      [
        '    // store',
        "    new Command('store')",
        "      .argument('files', {})",
        '                ^^^^^^^ the argument',
      ],
      [
        '    // store',
        "    new Command('store')",
        "      .command(new Command('get'))",
        '               ^^^^^^^^^^^^^^^^^^ the child',
      ],
    ],
    headline: 'ARGUMENTS BESIDE CHILDREN',
    rule: 'arguments-beside-children',
    sentence: 'Command "store" declares argument "files" and attaches child "get".',
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
  'command-deprecated': {
    correction: 'Supply a one-line migration path, such as "Use get instead.".',
    findings: [
      [
        "    new Command('fetch', { deprecated: true })",
        '                           ^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'Command "fetch" deprecated message must hold a character other than whitespace and no line terminator.',
  },
  'command-description': {
    correction: 'Supply a one-line summary.',
    findings: [
      [
        String.raw`    new Command('get', { description: 'Read\u000aone value.' })`,
        '                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'Command "get" description must hold a character other than whitespace and no line terminator.',
  },
  'command-description-read-once': {
    correction: 'Supply a one-line summary.',
    findings: [
      ["    new Command('get', { description: '' })", '                         ^^^^^^^^^^^^^^^'],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'Command "get" description must hold a character other than whitespace and no line terminator.',
  },
  'command-globals': {
    correction: 'Declare globals on the Application and register its environment.',
    findings: [["    new Command('get', { globals: {} })", '                         ^^^^^^^^^^^']],
    headline: 'GLOBALS ON A NAMED COMMAND',
    rule: 'command-globals',
    sentence: 'Command "get" declares globals.',
  },
  'command-hidden': {
    correction: 'Use true or false.',
    findings: [
      ["    new Command('fetch', { hidden: 'yes' })", '                           ^^^^^^^^^^^^^'],
    ],
    headline: 'FLAG NOT A BOOLEAN',
    rule: 'flag-not-boolean',
    sentence: 'Command "fetch" declares hidden that is not a Boolean.',
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
  'command-options': {
    correction: 'Supply a Command options object.',
    findings: [["    new Command('get', 'fast')", '                       ^^^^^^']],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Command "get" declares options that are not an object.',
  },
  'command-options-unreadable': {
    correction: readableOptions,
    findings: [
      ["    new Command('get', { extensions: … })", '                         ^^^^^^^^^^^^^'],
    ],
    headline: 'DECLARATION COULD NOT BE READ',
    rule: 'unreadable-declaration',
    sentence: 'Command "get" options could not be read: boom.',
  },
  'global-option-config': {
    correction: "Supply an option config object, such as { type: 'string' }.",
    findings: [
      [
        '    new Application(…)',
        "      .globalOption('quiet', null)",
        '                             ^^^^',
      ],
    ],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Option "quiet" declares a config that is not an object.',
  },
  'global-option-read-once': unreadable(['    new Application(…)'], {
    call: "globalOption('quiet'",
    slot: 'default',
    subject: 'Option "quiet"',
  }),
  'global-option-unreadable': unreadable(['    new Application(…)'], {
    call: "globalOption('quiet'",
    slot: 'default',
    subject: 'Option "quiet"',
  }),
  'group-option': {
    correction: 'Register an action or remove the option.',
    findings: [
      [
        '    // store cache',
        "    new Command('cache')",
        "      .option('verbose', { type: 'boolean' })",
        '              ^^^^^^^^^ no action reads it',
      ],
    ],
    headline: 'OPTION ON A GROUP',
    rule: 'group-option',
    sentence: 'Command "cache" declares option "verbose" but registers no action to receive it.',
  },
  'hook-argument-config': {
    correction: 'Supply an argument config object, such as {}.',
    findings: [
      [
        '    // count',
        "    new Command('count')",
        "      .argument('path', undefined)",
        '                        ^^^^^^^^^',
      ],
    ],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Argument "path" declares a config that is not an object.',
  },
  'hook-option-config': {
    correction: "Supply an option config object, such as { type: 'string' }.",
    findings: [
      [
        '    // count',
        "    new Command('count')",
        "      .option('format', undefined)",
        '                        ^^^^^^^^^',
      ],
    ],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Option "format" declares a config that is not an object.',
  },
  'hook-option-unreadable': unreadable(['    // count', "    new Command('count')"], {
    call: "option('format'",
    slot: 'default',
    subject: 'Option "format"',
  }),
  'media-type': {
    correction: 'Supply a media type such as "text/csv", or omit mediaType.',
    findings: [
      [
        '    // count',
        "    new Command('count')",
        '      .rows({ views: { csv: { mediaType: 5, render: … } } })',
        '                              ^^^^^^^^^^^^',
      ],
    ],
    headline: 'INVALID MEDIA TYPE',
    rule: 'media-type',
    sentence: 'Command "count" names view "csv" with a media type that is not a string.',
  },
  'multiple-actions': {
    correction: 'Register one action.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        '      .action(…)',
        '              ^ the second action',
      ],
    ],
    headline: 'SECOND ACTION',
    rule: 'multiple-actions',
    sentence: 'Command "get" has multiple actions.',
  },
  'multiple-results': {
    correction: 'Declare one result() or rows() call.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        '      .result({ views: { plain: { render: … } } })',
        '              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ the first result',
      ],
      [
        '    // get',
        "    new Command('get')",
        '      .rows({ views: { lines: { row: … } } })',
        '            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ the second result',
      ],
    ],
    headline: 'SECOND RESULT',
    rule: 'multiple-results',
    sentence: 'Command "get" declares two results.',
  },
  'nesting-depth': {
    correction: 'Nest Commands at most two levels below the root.',
    findings: [
      [
        '    // cache',
        "    new Command('cache')",
        "      .command(new Command('clear'))",
        '               ^^^^^^^^^^^^^^^^^^^^ has children of its own',
      ],
    ],
    headline: 'COMMANDS NESTED TOO DEEP',
    rule: 'nesting-depth',
    sentence: 'Command "cache" attaches child "clear", which has children of its own.',
  },
  'not-a-command': {
    correction: 'Attach the value returned by new Command(name).',
    findings: [
      [
        '    // store',
        "    new Command('store')",
        "      .command({ name: 'get' })",
        '               ^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'NOT A COMMAND',
    rule: 'not-a-command',
    sentence: 'Command "store" attaches a value that is not a Command.',
  },
  'option-after-action': {
    correction: 'Declare arguments and options before action().',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .option('raw', { type: 'boolean' })",
        '              ^^^^^ after action()',
      ],
    ],
    headline: 'DECLARED AFTER THE ACTION',
    rule: 'declared-after-action',
    sentence: 'Command "get" declares option "raw" after its action.',
  },
  'option-config': {
    correction: "Supply an option config object, such as { type: 'string' }.",
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .option('format', undefined)",
        '                        ^^^^^^^^^',
      ],
    ],
    headline: 'NOT AN OBJECT',
    rule: 'not-an-object',
    sentence: 'Option "format" declares a config that is not an object.',
  },
  'option-default-unreadable': unreadable(onGet, {
    call: "option('format'",
    slot: 'default',
    subject: 'Option "format"',
  }),
  'option-description': {
    correction: 'Supply a one-line summary.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .option('raw', { description: '', type: 'boolean' })",
        '                       ^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'Command "get" option "raw" description must hold a character other than whitespace and no line terminator.',
  },
  'option-prototype-unreadable': unreadable(onGet, {
    call: "option('format'",
    subject: 'Option "format"',
  }),
  'option-read-once': unreadable(onGet, {
    call: "option('format'",
    slot: 'default',
    subject: 'Option "format"',
  }),
  'option-unreadable': unreadable(onGet, {
    call: "option('format'",
    slot: 'default',
    subject: 'Option "format"',
  }),
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
    headline: 'OPTIONAL ARGUMENT NOT LAST',
    rule: 'optional-argument-last',
    sentence:
      'Argument "path" is optional and precedes required argument "name" on Command "keys".',
  },
  'plugin-option-description-read-once': {
    correction: 'Supply a one-line summary.',
    findings: [
      [
        "    plugin('@acme/log', { options: { level: { description: '', type: 'string' } } })",
        '                                              ^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'TEXT NOT ONE LINE',
    rule: 'not-one-line',
    sentence:
      'Plugin "@acme/log" option "level" description must hold a character other than whitespace and no line terminator.',
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
  'result-after-action': {
    correction: 'Declare result() or rows() before action().',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        '      .result({ views: { plain: { render: … } } })',
        '              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ after action()',
      ],
    ],
    headline: 'DECLARED AFTER THE ACTION',
    rule: 'declared-after-action',
    sentence: 'Command "get" declares its result after its action.',
  },
  'result-without-action': {
    correction: 'Register an action or remove the result.',
    findings: [
      [
        '    // store get',
        "    new Command('get')",
        '      .result({ views: { plain: { render: … } } })',
        '              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'RESULT WITH NO ACTION',
    rule: 'result-without-action',
    sentence: 'Command "get" declares a result and no action.',
  },
  'result-without-views': {
    correction: 'Name at least one view.',
    findings: [
      [
        '    // store get',
        "    new Command('get')",
        '      .result({ views: {} })',
        '                ^^^^^^^^^',
      ],
    ],
    headline: 'RESULT WITH NO VIEWS',
    rule: 'result-without-views',
    sentence: 'Command "get" declares a result with no views.',
  },
  'row-view-on-value': {
    correction: 'Supply a view with render, or declare the result with rows().',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        '      .result({ views: { lines: { row: … } } })',
        '                         ^^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'ROW VIEW ON A VALUE RESULT',
    rule: 'row-view-on-value',
    sentence: 'Command "get" names row view "lines" on a value result.',
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
  'unknown-default-view': {
    correction: 'Name the view or select a named one.',
    findings: [
      [
        '    // store get',
        "    new Command('get')",
        "      .views({}, { default: 'json' })",
        '                   ^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'DEFAULT VIEW NOT DECLARED',
    rule: 'unknown-default-view',
    sentence: 'Command "get" selects default view "json", which it does not name.',
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
  'view-both': {
    correction: 'Supply one of the two.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        '      .result({ views: { plain: { render: …, row: … } } })',
        '                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'NOT ONE VIEW',
    rule: 'view-shape',
    sentence: 'Command "get" names view "plain" with render and row.',
  },
  'view-name': {
    correction:
      'Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .result({ views: { '1': { render: … } } })",
        '                         ^^^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'INVALID VIEW NAME',
    rule: 'view-name',
    sentence: 'Command "get" names view "1".',
  },
  'view-not-a-view': {
    correction: 'Supply a view with render or a row view with row.',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        "      .rows({ views: { lines: 'text' } })",
        '                       ^^^^^^^^^^^^^',
      ],
    ],
    headline: 'NOT ONE VIEW',
    rule: 'view-shape',
    sentence: 'Command "get" names view "lines" with a value that is not a view.',
  },
  'views-without-result': {
    correction: 'Declare result() or rows() before action().',
    findings: [
      [
        '    // get',
        "    new Command('get')",
        '      .views({ plain: { render: … } })',
        '             ^^^^^^^^^^^^^^^^^^^^^^^^',
      ],
    ],
    headline: 'VIEWS WITH NO RESULT',
    rule: 'views-without-result',
    sentence: 'Command "get" reshapes its views and declares no result.',
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
  expect(declaredRules('command-rules.ts').toSorted()).toEqual(
    Object.keys(explanations).toSorted(),
  );
});

test.each([
  'application-options-prototype-unreadable',
  'application-options-unreadable',
  'argument-unreadable',
  'command-options-unreadable',
  'global-option-unreadable',
  'hook-option-unreadable',
  'option-default-unreadable',
  'option-prototype-unreadable',
  'option-unreadable',
])('the %s fault keeps the value the read threw as its cause', (scenario) => {
  const result = invoke(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [
    scenario,
    'cause',
  ]);
  expect(result).toEqual({ status: 0, stderr: '', stdout: '{"cause":true}\n' });
});

test('an option name in a group-option sentence is escaped as every quoted name is', () => {
  const result = invoke(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [
    'group-option-escaped',
    'sentence',
  ]);
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: `${String.raw`Command "cache" declares option "\u001b[31m" but registers no action to receive it.`}\n`,
  });
});

test.each(['argument-read-once', 'global-option-read-once', 'option-read-once'])(
  'the %s config whose read threw is never read again, so its diagnostic reads it once',
  (scenario) => {
    const result = invoke(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [
      scenario,
      'reads',
    ]);
    expect(result).toEqual({ status: 0, stderr: '', stdout: '{"reads":1}\n' });
  },
);

/** What run() writes for one root fault in a development build. */
function reported(scenario: string) {
  return invoke(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [scenario]);
}

test('a root fault reported from run() opens its findings with the application name', () => {
  expect(reported('root-group-option')).toEqual({
    status: 1,
    stderr: diagnostic({
      correction: 'Register an action or remove the option.',
      findings: [
        [
          '    // probe',
          "    new Application('probe')",
          "      .option('verbose', { type: 'boolean' })",
          '              ^^^^^^^^^ no action reads it',
        ],
      ],
      headline: 'OPTION ON A GROUP',
      rule: 'group-option',
      sentence: 'The root Command declares option "verbose" but registers no action to receive it.',
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
