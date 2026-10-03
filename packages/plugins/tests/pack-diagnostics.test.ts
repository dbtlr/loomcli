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

/** Each configuration settings fault, which a JavaScript author alone reaches, by scenario. */
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
};

test.each(Object.entries(settingsCases))(
  'the %s fault throws its rule’s Developer Diagnostic',
  (scenario, expected) => {
    const result = invoke(new URL('fixtures/pack-diagnostics.mjs', import.meta.url), [scenario]);
    expect(result).toEqual({ status: 0, stderr: '', stdout: `${diagnostic(expected)}\n` });
  },
);

/** The pack's rule that `--manifest` raises, which the manifest failures test pins. */
const pinnedElsewhere = ['manifest/failure-name-conflict'];

test('every rule the pack declares has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(settingsCases).map((expected) => expected.rule));
  const source = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
  const declared = Array.from(
    source.matchAll(/diagnosticRule\(`\$\{Package\.name\}\/(?<name>[a-z0-9/-]+)`/gu),
    (match) => match.groups?.name ?? '',
  );
  expect([...pinned].toSorted()).toEqual(Object.keys(explanations).toSorted());
  expect(declared.toSorted()).toEqual([...pinned, ...pinnedElsewhere].toSorted());
});
