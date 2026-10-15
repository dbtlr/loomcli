import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** Each rule's explanation as an 80-column diagnostic wraps it. */
const explanations = {
  'config/file-path': [
    'The configuration plugin looks for its file in the working directory and then in',
    'the home directory, so file is a relative path whose segments each name a',
    'directory or a file, with no control character.',
  ],
  'config/file-pattern': [
    "The configuration plugin chooses a file's parser by its extension, so file holds",
    'glob syntax only as the whole extension of its name: * for any format the plugin',
    'reads, or a brace list of json, toml, yaml, and yml, tried in the order listed.',
  ],
  'dotenv/variables': [
    'The dotenv plugin imports only variables explicitly named by the application.',
    'List at least one distinct name, each a letter or underscore followed by',
    'letters, digits, or underscores.',
  ],
  'logging/settings': [
    'The logging plugin writes records to a file or to the console, so to is file or',
    'console; a file is a nonempty name, absolute path, or path under ~/ with no',
    'control character; level is one of the five written levels; maxBytes and keep',
    'are whole numbers of 1 or more; onError is a function; and the console',
    'destination takes only a level.',
  ],
  'self-update/settings': [
    'The self-update plugin calls afterReplace once it has replaced the binary and',
    'rewritten its installation record, so afterReplace is a function, and notices is',
    'true, false, or an object whose env names the environment variable that turns',
    'update notices off.',
  ],
  'service/settings': [
    'The service plugin names its unit by label, a reverse-DNS name of two or more',
    'segments of letters, digits, and hyphens, each opening with a letter or digit,',
    '247 characters at most; runs the application with the words in run, a nonempty',
    'list of strings with no control character; and calls probe, a function, from',
    'status.',
  ],
  'skills/settings': [
    'The skills plugin installs each skill the application declares from a name and a',
    'function that returns its files, so skills is a nonempty list of objects, each',
    'name is lowercase letters and digits joined by single hyphens, 64 characters at',
    'most, no name repeats, and files is a function. A name is one path segment in an',
    "agent's skills folder.",
  ],
  'version/postfix': [
    'The version plugin prints the postfix after the version on its one line, so the',
    'postfix holds a character other than whitespace and no line terminator.',
  ],
};

type Rule = keyof typeof explanations;

/** One rule's diagnostic: its banner, the sentence, each finding, the explanation, and the fix. */
interface Expected {
  readonly rule: Rule;
  readonly headline: string;
  readonly sentence: string;
  readonly finding: readonly string[];
  readonly correction: string;
}

/** The banner fills 80 columns between the headline and the identity. */
function banner(headline: string, rule: Rule): string {
  const left = `-- ${headline} `;
  const right = ` @loomcli/plugins/${rule}`;
  return `${left}${'-'.repeat(80 - left.length - right.length)}${right}`;
}

function diagnostic({ correction, finding, headline, rule, sentence }: Expected): string {
  const sections = [
    banner(headline, rule),
    sentence,
    finding.join('\n'),
    explanations[rule].join('\n'),
    correction,
  ];
  return sections.join('\n\n');
}

/** One printed call, and the carets under the place `target` occurs in it. */
function marked(call: string, target: string): string[] {
  const line = `    ${call}`;
  const start = line.indexOf(target);
  expect(start).toBeGreaterThanOrEqual(0);
  return [line, `${' '.repeat(start)}${'^'.repeat(target.length)}`];
}

/** One postfix fault: the call that declares it, and what the finding marks. */
function postfixFault(call: string, target: string): Expected {
  return {
    correction: 'Supply one line, such as "(Report schema v1)", or omit the postfix.',
    finding: marked(call, target),
    headline: 'INVALID VERSION POSTFIX',
    rule: 'version/postfix',
    sentence:
      'Plugin "@loomcli/plugins/version" postfix must be a string that holds a character other than whitespace and no line terminator.',
  };
}

/** One service settings fault: the call, what the finding marks, and the fault's words. */
function serviceFault(
  call: string,
  target: string | undefined,
  fault: { readonly key: string; readonly sentence: string; readonly correction: string },
): Expected {
  return {
    correction: fault.correction,
    finding: target === undefined ? [`    ${call}`] : marked(call, target),
    headline: 'INVALID SERVICE SETTING',
    rule: 'service/settings',
    sentence: `Plugin "@loomcli/plugins/service" setting "${fault.key}" ${fault.sentence}`,
  };
}

const labelFault = {
  correction: 'Supply a label such as com.acme.notes.',
  key: 'label',
  sentence: 'is not a reverse-DNS name.',
};

const runFault = {
  correction: "Supply the words that run the service's Command, such as ['serve'].",
  key: 'run',
  sentence: 'is not a list of argument words.',
};

/** One skills settings fault: the call, what the finding marks, and the fault's words. */
function skillsFault(
  call: string,
  target: string | undefined,
  fault: { readonly sentence: string; readonly correction: string },
): Expected {
  return {
    correction: fault.correction,
    finding: target === undefined ? [`    ${call}`] : marked(call, target),
    headline: 'INVALID SKILLS SETTING',
    rule: 'skills/settings',
    sentence: `Plugin "@loomcli/plugins/skills" setting "skills" ${fault.sentence}`,
  };
}

const listFault = {
  correction: "Supply at least one skill, such as { name: 'notes', files: loadNotesSkill }.",
  sentence: 'is not a list of skills.',
};

const nameCorrection =
  'Use lowercase letters, digits, and single hyphens, 64 characters at most, such as notes.';

/** One self-update `notices` fault: the call, what the finding marks, and the fault's words. */
function noticesFault(call: string, target: string, key: 'notices' | 'notices.env'): Expected {
  const notices = key === 'notices';
  return {
    correction: notices
      ? 'Supply true, false, or { env }, or omit the setting.'
      : 'Name it with letters, digits, and underscores, not starting with a digit.',
    finding: marked(call, target),
    headline: 'INVALID SELF-UPDATE SETTING',
    rule: 'self-update/settings',
    sentence: `Plugin "@loomcli/plugins/self-update" setting "${key}" ${notices ? 'is not a Boolean or an object.' : 'is not an environment variable name.'}`,
  };
}

/** Each settings fault a pack factory throws at its call, by scenario. */
const settingsCases: Record<string, Expected> = {
  'config-glob': {
    correction:
      'Write the name literally, and use * or a brace list only as the whole text after its last dot.',
    finding: marked("config({ file: '*.json' })", "file: '*.json'"),
    headline: 'INVALID CONFIGURATION FILE PATTERN',
    rule: 'config/file-pattern',
    sentence:
      'Plugin "@loomcli/plugins/config" file holds glob syntax other than an extension of * or a brace list.',
  },
  'config-list': {
    correction: 'List only json, toml, yaml, or yml in the braces, or use * for any of them.',
    finding: marked("config({ file: '.textstat.{toml,ini}' })", "file: '.textstat.{toml,ini}'"),
    headline: 'INVALID CONFIGURATION FILE PATTERN',
    rule: 'config/file-pattern',
    sentence: 'Plugin "@loomcli/plugins/config" file lists an extension the plugin cannot read.',
  },
  'config-path': {
    correction:
      'Supply a relative path such as .textstat.toml, with no control character and no empty, ., or .. segment.',
    finding: marked("config({ file: '/etc/textstat.json' })", "file: '/etc/textstat.json'"),
    headline: 'INVALID CONFIGURATION FILE PATH',
    rule: 'config/file-path',
    sentence: 'Plugin "@loomcli/plugins/config" file is not a relative path.',
  },
  'dotenv-empty': {
    correction:
      'Supply a nonempty variables list of distinct names, each a letter or underscore followed by letters, digits, or underscores.',
    finding: marked('dotenv({ variables: [] })', 'variables: []'),
    headline: 'INVALID DOTENV VARIABLES',
    rule: 'dotenv/variables',
    sentence: 'Plugin "@loomcli/plugins/dotenv" declares an invalid variables allowlist.',
  },
  'logging-console': {
    correction: 'Remove the setting, or set "to" to "file".',
    finding: marked("logging({ file: 'a.jsonl', to: 'console' })", "file: 'a.jsonl'"),
    headline: 'INVALID LOGGING SETTING',
    rule: 'logging/settings',
    sentence:
      'Plugin "@loomcli/plugins/logging" setting "file" is not accepted when "to" is "console".',
  },
  'logging-keep': {
    correction: 'Supply a whole number of 1 or more.',
    finding: marked('logging({ keep: 0 })', 'keep: 0'),
    headline: 'INVALID LOGGING SETTING',
    rule: 'logging/settings',
    sentence: 'Plugin "@loomcli/plugins/logging" setting "keep" is not a positive whole number.',
  },
  'self-update-hook': {
    correction: 'Supply a function, or omit the setting.',
    finding: marked('selfUpdate({ afterReplace: 1 })', 'afterReplace: 1'),
    headline: 'INVALID SELF-UPDATE SETTING',
    rule: 'self-update/settings',
    sentence: 'Plugin "@loomcli/plugins/self-update" setting "afterReplace" is not a function.',
  },
  'self-update-notices-env': noticesFault(
    "selfUpdate({ notices: { env: '1X' } })",
    "env: '1X'",
    'notices.env',
  ),
  'self-update-notices-hyphen': noticesFault(
    "selfUpdate({ notices: { env: 'A-B' } })",
    "env: 'A-B'",
    'notices.env',
  ),
  'self-update-notices-list': noticesFault('selfUpdate({ notices: [] })', 'notices: []', 'notices'),
  'self-update-notices-number': noticesFault('selfUpdate({ notices: 1 })', 'notices: 1', 'notices'),
  'service-label': serviceFault(
    "service({ label: 'notes', run: ['serve'] })",
    "label: 'notes'",
    labelFault,
  ),
  'service-none': serviceFault('service()', undefined, labelFault),
  'service-probe': serviceFault(
    "service({ label: 'com.acme.notes', probe: 1, run: ['serve'] })",
    'probe: 1',
    {
      correction: 'Supply a function, or omit the setting.',
      key: 'probe',
      sentence: 'is not a function.',
    },
  ),
  'service-run-control': serviceFault(
    String.raw`service({ label: 'com.acme.notes', run: ['serve', 'a\u0007b'] })`,
    String.raw`run: ['serve', 'a\u0007b']`,
    {
      correction: 'Remove the control character from the word.',
      key: 'run',
      sentence: 'holds a word with a control character.',
    },
  ),
  'service-run-empty': serviceFault(
    "service({ label: 'com.acme.notes', run: [] })",
    'run: []',
    runFault,
  ),
  'service-run-word': serviceFault(
    "service({ label: 'com.acme.notes', run: ['serve', 8080] })",
    "run: ['serve', 8080]",
    runFault,
  ),
  'skills-empty': skillsFault('skills({ skills: [] })', 'skills: []', listFault),
  'skills-entry': skillsFault('skills({ skills: [1] })', 'skills: [1]', {
    correction: 'Supply each skill as { name, files }.',
    sentence: 'holds an entry that is not a skill.',
  }),
  'skills-files': skillsFault(
    "skills({ skills: [{ files: 'notes.md', name: 'notes' }] })",
    "skills: [{ files: 'notes.md', name: 'notes' }]",
    {
      correction: "Supply a function that returns the skill's files.",
      sentence: 'holds a skill whose files is not a function: notes.',
    },
  ),
  'skills-list': skillsFault("skills({ skills: 'notes' })", "skills: 'notes'", listFault),
  'skills-name': skillsFault(
    "skills({ skills: [{ files: …, name: 'Notes' }] })",
    "skills: [{ files: …, name: 'Notes' }]",
    { correction: nameCorrection, sentence: 'holds a name that is not a skill name: Notes.' },
  ),
  'skills-name-none': skillsFault('skills({ skills: [{ files: … }] })', 'skills: [{ files: … }]', {
    correction: nameCorrection,
    sentence: 'holds a name that is not a skill name: (none).',
  }),
  'skills-none': skillsFault('skills()', undefined, listFault),
  'skills-twice': skillsFault(
    "skills({ skills: [{ files: …, name: 'notes' }, { files: …, name: 'notes' }] })",
    "skills: [{ files: …, name: 'notes' }, { files: …, name: 'notes' }]",
    { correction: 'Give each skill its own name.', sentence: 'holds the skill name notes twice.' },
  ),
  'version-blank': postfixFault("version({ postfix: ' ' })", "postfix: ' '"),
  'version-lines': postfixFault(
    String.raw`version({ postfix: 'schema\u000av1' })`,
    String.raw`postfix: 'schema\u000av1'`,
  ),
  'version-number': postfixFault('version({ postfix: 1 })', 'postfix: 1'),
};

test.each(Object.entries(settingsCases))(
  'the %s fault throws its rule’s Developer Diagnostic',
  (scenario, expected) => {
    const result = invoke(new URL('fixtures/pack-diagnostics.mjs', import.meta.url), [scenario]);
    expect(result).toEqual({ status: 0, stderr: '', stdout: `${diagnostic(expected)}\n` });
  },
);

/**
 * The pack's rules a build raises rather than a factory call: the one `--manifest` raises, which
 * the manifest failures test pins, the MCP plugin's build faults, which the MCP test pins, the
 * service plugin's, which the service test pins, the skills plugin's file faults, which the
 * skills test pins, and the manpage plugin's page names, which the man page test pins.
 */
const pinnedElsewhere = [
  'manifest/failure-code-conflict',
  'manpage/page-name-taken',
  'mcp/property-name-taken',
  'mcp/tool-name-taken',
  'mcp/tool-without-action',
  'service/run-unrouted',
  'skills/files',
];

test('every rule the pack declares has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(settingsCases).map((expected) => expected.rule));
  const source = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
  const declared = Array.from(
    source.matchAll(/diagnosticRule\(`\$\{packageName\}\/(?<name>[a-z0-9/-]+)`/gu),
    (match) => match.groups?.name ?? '',
  );
  expect([...pinned].toSorted()).toEqual(Object.keys(explanations).toSorted());
  expect(declared.toSorted()).toEqual([...pinned, ...pinnedElsewhere].toSorted());
});
