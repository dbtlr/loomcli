import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** Each rule's explanation as an 80-column diagnostic wraps it. */
const explanations = {
  'config/files': [
    'The configuration plugin reads the project files its settings list, most',
    'specific first, and opens each path as it is written, so files is a list of',
    'nonempty paths with no control character.',
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
  'config-entry': {
    correction: 'Supply a nonempty path with no control character.',
    finding: marked("config({ files: ['ok.json', 7] })", '7'),
    headline: 'INVALID CONFIGURATION FILES',
    rule: 'config/files',
    sentence: 'Plugin "@loomcli/plugins/config" file 1 is not a path.',
  },
  'config-files': {
    correction: 'Supply an array of paths.',
    finding: marked("config({ files: '.app.json' })", "files: '.app.json'"),
    headline: 'INVALID CONFIGURATION FILES',
    rule: 'config/files',
    sentence: 'Plugin "@loomcli/plugins/config" files is not a list.',
  },
  'config-settings': {
    correction: 'Supply an array of paths.',
    finding: marked("config('files')", "'files'"),
    headline: 'INVALID CONFIGURATION FILES',
    rule: 'config/files',
    sentence: 'Plugin "@loomcli/plugins/config" files is not a list.',
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
