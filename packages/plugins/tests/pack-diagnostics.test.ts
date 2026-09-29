import { DeclarationError } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { bashScript } from '../src/completion/bash.js';
import { fishScript } from '../src/completion/fish.js';
import { zshScript } from '../src/completion/zsh.js';

/** The diagnostic one faulty call throws, as its message holds it. */
function thrown(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof DeclarationError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('The call returned.');
}

/** Each rule's explanation as an 80-column diagnostic wraps it. */
const explanations = {
  'config-files': [
    'The configuration plugin reads the project files its settings list, most',
    'specific first, and opens each path as it is written, so files is a list of',
    'nonempty paths with no control character.',
  ],
  'script-name': [
    'A completion script carries the application name into shell source, as a',
    "function name and as a quoted string, so it takes a name inside core's portable",
    'name rule alone, which no shell reads as code.',
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
    rule: 'config-files',
    sentence: 'Plugin "@loomcli/plugins/config" file 1 is not a path.',
  },
  'config-files': {
    correction: 'Supply an array of paths.',
    finding: marked("config({ files: '.app.json' })", "files: '.app.json'"),
    headline: 'INVALID CONFIGURATION FILES',
    rule: 'config-files',
    sentence: 'Plugin "@loomcli/plugins/config" files is not a list.',
  },
  'config-settings': {
    correction: 'Supply an array of paths.',
    finding: marked("config('files')", "'files'"),
    headline: 'INVALID CONFIGURATION FILES',
    rule: 'config-files',
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

/** The name no completion script takes, whose line break would end a line of shell source. */
const scriptFault: Expected = {
  correction:
    'Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".',
  finding: marked(
    String.raw`new Application('x\u000atouch pwned')`,
    String.raw`'x\u000atouch pwned'`,
  ),
  headline: 'NAME NOT PORTABLE IN A SCRIPT',
  rule: 'script-name',
  sentence: String.raw`A completion script needs a portable application name, and "x\u000atouch pwned" is not one.`,
};

test.each([bashScript, zshScript, fishScript])(
  '%o for a name outside the portable set throws its rule’s Developer Diagnostic',
  (script) => {
    expect(thrown(() => script('x\ntouch pwned'))).toBe(diagnostic(scriptFault));
  },
);

test('every rule the pack raises at a call has a pinned diagnostic', () => {
  const pinned = new Set([
    ...Object.values(settingsCases).map((expected) => expected.rule),
    scriptFault.rule,
  ]);
  expect([...pinned].toSorted()).toEqual(Object.keys(explanations).toSorted());
});
