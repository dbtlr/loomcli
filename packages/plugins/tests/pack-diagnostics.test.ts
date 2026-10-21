import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { registeredRules, ruleContract, ruleParts } from '../../../scripts/test-rules.js';

/** One fault by the parts its rule's test pins: the rule under the pack's name, the sentence, the fix. */
interface Expected {
  readonly rule: string;
  readonly sentence: string;
  readonly correction: string;
}

/** The fault every postfix the version plugin rejects raises. */
const postfixFault: Expected = {
  correction: 'Supply one line, such as "(Report schema v1)", or omit the postfix.',
  rule: 'version/postfix',
  sentence:
    'Plugin "@loomcli/plugins/version" postfix must be a string that holds a character other than whitespace and no line terminator.',
};

/** One service settings fault, from the setting it names and the fault's words. */
function serviceFault(fault: {
  readonly key: string;
  readonly sentence: string;
  readonly correction: string;
}): Expected {
  return {
    correction: fault.correction,
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

/** One skills settings fault, from the fault's words. */
function skillsFault(fault: { readonly sentence: string; readonly correction: string }): Expected {
  return {
    correction: fault.correction,
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

/** One self-update `notices` fault, from the setting it names. */
function noticesFault(key: 'notices' | 'notices.env'): Expected {
  const notices = key === 'notices';
  return {
    correction: notices
      ? 'Supply true, false, or { env }, or omit the setting.'
      : 'Name it with letters, digits, and underscores, not starting with a digit.',
    rule: 'self-update/settings',
    sentence: `Plugin "@loomcli/plugins/self-update" setting "${key}" ${notices ? 'is not a Boolean or an object.' : 'is not an environment variable name.'}`,
  };
}

/** Each settings fault a pack factory throws at its call, by scenario. */
const settingsCases: Record<string, Expected> = {
  'config-glob': {
    correction:
      'Write the name literally, and use * or a brace list only as the whole text after its last dot.',
    rule: 'config/file-pattern',
    sentence:
      'Plugin "@loomcli/plugins/config" file holds glob syntax other than an extension of * or a brace list.',
  },
  'config-list': {
    correction: 'List only json, toml, yaml, or yml in the braces, or use * for any of them.',
    rule: 'config/file-pattern',
    sentence: 'Plugin "@loomcli/plugins/config" file lists an extension the plugin cannot read.',
  },
  'config-path': {
    correction:
      'Supply a relative path such as .textstat.toml, with no control character and no empty, ., or .. segment.',
    rule: 'config/file-path',
    sentence: 'Plugin "@loomcli/plugins/config" file is not a relative path.',
  },
  'dotenv-empty': {
    correction:
      'Supply a nonempty variables list of distinct names, each a letter or underscore followed by letters, digits, or underscores.',
    rule: 'dotenv/variables',
    sentence: 'Plugin "@loomcli/plugins/dotenv" declares an invalid variables allowlist.',
  },
  'logging-console': {
    correction: 'Remove the setting, or set "to" to "file".',
    rule: 'logging/settings',
    sentence:
      'Plugin "@loomcli/plugins/logging" setting "file" is not accepted when "to" is "console".',
  },
  'logging-keep': {
    correction: 'Supply a whole number of 1 or more.',
    rule: 'logging/settings',
    sentence: 'Plugin "@loomcli/plugins/logging" setting "keep" is not a positive whole number.',
  },
  'self-update-hook': {
    correction: 'Supply a function, or omit the setting.',
    rule: 'self-update/settings',
    sentence: 'Plugin "@loomcli/plugins/self-update" setting "afterReplace" is not a function.',
  },
  'self-update-notices-env': noticesFault('notices.env'),
  'self-update-notices-hyphen': noticesFault('notices.env'),
  'self-update-notices-list': noticesFault('notices'),
  'self-update-notices-number': noticesFault('notices'),
  'service-label': serviceFault(labelFault),
  'service-none': serviceFault(labelFault),
  'service-probe': serviceFault({
    correction: 'Supply a function, or omit the setting.',
    key: 'probe',
    sentence: 'is not a function.',
  }),
  'service-run-control': serviceFault({
    correction: 'Remove the control character from the word.',
    key: 'run',
    sentence: 'holds a word with a control character.',
  }),
  'service-run-empty': serviceFault(runFault),
  'service-run-word': serviceFault(runFault),
  'skills-empty': skillsFault(listFault),
  'skills-entry': skillsFault({
    correction: 'Supply each skill as { name, files }.',
    sentence: 'holds an entry that is not a skill.',
  }),
  'skills-files': skillsFault({
    correction: "Supply a function that returns the skill's files.",
    sentence: 'holds a skill whose files is not a function: notes.',
  }),
  'skills-list': skillsFault(listFault),
  'skills-name': skillsFault({
    correction: nameCorrection,
    sentence: 'holds a name that is not a skill name: Notes.',
  }),
  'skills-name-none': skillsFault({
    correction: nameCorrection,
    sentence: 'holds a name that is not a skill name: (none).',
  }),
  'skills-none': skillsFault(listFault),
  'skills-twice': skillsFault({
    correction: 'Give each skill its own name.',
    sentence: 'holds the skill name notes twice.',
  }),
  'version-blank': postfixFault,
  'version-lines': postfixFault,
  'version-number': postfixFault,
};

test.each(Object.entries(settingsCases))(
  'the %s fault throws its rule’s diagnostic',
  (scenario, expected) => {
    const result = invoke(new URL('fixtures/pack-diagnostics.mjs', import.meta.url), [scenario]);
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(ruleParts(result.stdout)).toEqual({
      correction: expected.correction,
      identity: `@loomcli/plugins/${expected.rule}`,
      sentence: expected.sentence,
    });
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

/** Every rule the pack's registry declares, under the pack's name and its plugin's subpath. */
const declared = registeredRules(
  new URL('../src/rules.ts', import.meta.url),
  /diagnosticRule\(`\$\{packageName\}\/(?<name>[a-z0-9/-]+)`, \{/gu,
);

test('every rule the pack declares has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(settingsCases).map((expected) => expected.rule));
  expect(declared.map((rule) => rule.name).toSorted()).toEqual(
    [...pinned, ...pinnedElsewhere].toSorted(),
  );
});

// Each explanation lives in the registry alone; a rule's own test pins its sentence and correction.
test('every rule the pack declares has a one-line headline and an explanation of whole sentences', () => {
  const names = declared.map((rule) => rule.name);
  expect(names).toEqual([...new Set(names)]);
  expect(declared).toEqual(names.map((name) => ruleContract(name)));
});
