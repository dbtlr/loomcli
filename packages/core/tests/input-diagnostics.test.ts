import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { findingsOf } from '../../../scripts/test-rules.js';
import { declaredRules, coreRuleParts } from './rule-parts.js';
import type { RuleParts } from './rule-parts.js';

const fixture = new URL('fixtures/input-diagnostics.mjs', import.meta.url);

/** The diagnostic one scenario's faulty declaration throws, as its message holds it. */
function thrown(...args: string[]): string {
  const result = invoke(fixture, args);
  expect(result.stderr).toBe('');
  return result.stdout;
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

const changeOne = 'Change one declaration.';

const declaredName = 'Use a nonempty name without a leading hyphen, whitespace, or "=".';

/** Each scenario's fault by the parts its rule's test pins; the layout goldens pin the rest. */
const cases: Record<string, RuleParts> = {
  'alias-global-local': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence:
      'Option spelling "--input" is used by the global option "file" and the local option "input" on Command "get".',
  },
  'alias-name': {
    correction: declaredName,
    rule: 'declared-name',
    sentence: 'Option "min-bytes" declares an alias named "bad=name".',
  },
  'alias-negative-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence: 'Option spelling "--no-colour" is used by both "color" and "no-colour".',
  },
  'alias-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence: 'Option spelling "--limit" is used by both "min-bytes" and "limit".',
  },
  'env-delimiter': {
    correction: 'Name the string that separates the items, such as ",".',
    rule: 'env-delimiter',
    sentence: 'Option "fields" declares an empty envDelimiter.',
  },
  'global-local-key': {
    correction: 'Rename the local option.',
    rule: 'option-declared-twice',
    sentence:
      'Option "file" is declared as a global option and as a local option on Command "get".',
  },
  'global-local-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence:
      'Option spelling "-f" is used by the global option "file" and the local option "force" on Command "get".',
  },
  'hook-argument-option': {
    correction: "Rename the Command's option or omit the plugin.",
    rule: 'name-shared-across-kinds',
    sentence:
      'Plugin "@acme/tag" declares argument "tag" on Command "count", which is already declared as a local option.',
  },
  'negative-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence: 'Option spelling "--no-color" is used by both "color" and "no-color".',
  },
  'option-name': {
    correction: declaredName,
    rule: 'declared-name',
    sentence: 'Option name "-raw" is invalid.',
  },
  'option-twice': {
    correction: 'Remove or rename the duplicate.',
    rule: 'option-declared-twice',
    sentence: 'Option "raw" is declared more than once on Command "get".',
  },
  'plugin-alias-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence:
      'Option spelling "--tail" is used by plugin "@acme/trace" option "trace" and the local option "tail" on Command "get".',
  },
  'plugin-global-key': {
    correction: 'Rename one declaration.',
    rule: 'option-declared-twice',
    sentence: 'Option "verbose" is declared by plugin "@acme/trace" and as a global option.',
  },
  'plugin-local-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence:
      'Option spelling "-t" is used by plugin "@acme/trace" option "trace" and the local option "tail" on Command "get".',
  },
  'plugins-alias-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence:
      'Option spelling "--verbosity" is used by plugin "@acme/log" option "level" and plugin "@acme/trace" option "verbosity".',
  },
  'plugins-key': {
    correction: 'Install one of them or rename the option.',
    rule: 'option-declared-twice',
    sentence: 'Option "verbose" is declared by plugin "@acme/log" and plugin "@acme/trace".',
  },
  'short-spelling': {
    correction: changeOne,
    rule: 'spelling-taken',
    sentence: 'Option spelling "-f" is used by both "force" and "file".',
  },
  'variable-twice': {
    correction: 'Bind each variable to one option.',
    rule: 'variable-bound-twice',
    sentence:
      'Variable "LIMIT" is bound by global option "limit" and Command "count" option "max".',
  },
};

test.each(Object.entries(cases))('the %s fault throws its rule’s diagnostic', (scenario, parts) => {
  expect(coreRuleParts(thrown(scenario))).toEqual(parts);
});

test('an empty delimiter marks the envDelimiter of the option that declared it', () => {
  expect(findingsOf(thrown('env-delimiter'))).toContain(
    onCommand(
      ['get'],
      "option('fields', { env: 'FIELDS', envDelimiter: '', multiple: true, type: 'string' })",
      "envDelimiter: ''",
    ).join('\n'),
  );
});

const converterCorrection =
  'Fix the converter so it returns a JSON Schema object, or declare a validator that publishes none.';

const invalidDefault = {
  correction: 'Fix the default or its validator.',
  rule: 'invalid-default',
};

const invalidImplied = {
  correction: 'Fix the implied value or its validator.',
  rule: 'invalid-implied',
};

/** The fault a converter that throws raises, from run() and from inspect() alike. */
const converterThrows: RuleParts = {
  correction: converterCorrection,
  rule: 'schema-converter-failed',
  sentence: String.raw`Argument "path" validator's JSON Schema converter failed for target "draft-2020-12": No JSON Schema\u000afor a transform.`,
};

/** The faults run() reports from a development build, before any token is read. */
const reportedCases: Record<string, RuleParts> = {
  'converter-list': {
    correction: converterCorrection,
    rule: 'schema-converter-failed',
    sentence:
      'Option "limit" validator\'s JSON Schema converter answered target "draft-2020-12" with a value that is not a plain object.',
  },
  'converter-throws': converterThrows,
  // The issue lines the validator returned print under the sentence.
  'invalid-default': {
    ...invalidDefault,
    sentence: 'Option "limit" has an invalid default.\nOption "limit": Use a whole number.',
  },
  'invalid-implied': {
    ...invalidImplied,
    sentence:
      'Option "backup" has an invalid implied value.\nOption "backup": Use none, simple, or numbered.',
  },
  'plugin-invalid-default': {
    ...invalidDefault,
    sentence: 'Option "level" has an invalid default.\nOption "level": Use a whole number.',
  },
  'plugin-invalid-implied': {
    ...invalidImplied,
    sentence:
      'Option "backup" has an invalid implied value.\nOption "backup": Use none, simple, or numbered.',
  },
};

test.each(Object.entries(reportedCases))(
  'the %s fault reports its rule’s diagnostic from run()',
  (scenario, parts) => {
    const result = invoke(fixture, [scenario]);
    expect(result).toMatchObject({ status: 1, stdout: '' });
    expect(coreRuleParts(result.stderr)).toEqual(parts);
  },
);

test('a default its validator rejects marks the default of the call that declared it', () => {
  expect(findingsOf(invoke(fixture, ['invalid-default']).stderr)).toContain(
    onCommand(
      ['probe', 'get'],
      "option('limit', { default: 'x', description: 'Limit.', type: 'string', validate: … })",
      "default: 'x'",
    ).join('\n'),
  );
});

test("an implied value its validator rejects on a plugin's option marks implied in the plugin's options record", () => {
  expect(findingsOf(invoke(fixture, ['plugin-invalid-implied']).stderr)).toContain(
    marked(
      "    plugin('@acme/copy', { options: { backup: { description: 'Backup.', implied: 'x', type: 'string', validate: … } } })",
      "implied: 'x'",
    ).join('\n'),
  );
});

test("a default its validator rejects on a plugin's option marks the default in the plugin's options record", () => {
  expect(findingsOf(invoke(fixture, ['plugin-invalid-default']).stderr)).toContain(
    marked(
      "    plugin('@acme/log', { options: { level: { default: 'x', description: 'Level.', type: 'string', validate: … } } })",
      "default: 'x'",
    ).join('\n'),
  );
});

test('a converter that throws is a declaration fault from inspect() in a development build', () => {
  const text = thrown('converter-throws', 'inspect');
  expect(coreRuleParts(text)).toEqual(converterThrows);
  expect(findingsOf(text)).toContain(
    onCommand(
      ['get'],
      "argument('path', { description: 'Path.', validate: … })",
      'validate: …',
    ).join('\n'),
  );
});

test('a distributed build reads a failing converter as no published schema', () => {
  expect(invoke(fixture, ['converter-throws-distributed'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '',
  });
  expect(thrown('converter-throws-distributed', 'inspect')).toBe('{"schema":null}\n');
});

test("a converter fault keeps the converter's thrown value as its cause", () => {
  expect(thrown('converter-throws', 'cause')).toBe(
    `${JSON.stringify({ cause: 'No JSON Schema\nfor a transform.' })}\n`,
  );
});

test('a validator that throws marks the validate key of the call that declared its input', () => {
  const result = invoke(fixture, ['validator-throws']);
  expect(result.status).toBe(1);
  expect(findingsOf(result.stderr)).toContain(
    onCommand(
      ['probe', 'get'],
      "option('limit', { description: 'Limit.', type: 'string', validate: … })",
      'validate: …',
    ).join('\n'),
  );
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

test("a validator that throws on a plugin's option marks the validate key in the plugin's options record", () => {
  const result = invoke(fixture, ['plugin-validator-throws']);
  expect(result.status).toBe(1);
  expect(findingsOf(result.stderr)).toContain(
    marked(
      "    plugin('@acme/log', { options: { level: { description: 'Level.', type: 'string', validate: … } } })",
      'validate: …',
    ).join('\n'),
  );
});

test('every rule of the family has a pinned diagnostic', () => {
  const pinned = new Set(
    [...Object.values(cases), ...Object.values(reportedCases)].map((parts) => parts.rule),
  );
  // Declared-name is the Command family's rule, which an option's name and aliases share.
  expect([...declaredRules('input-rules.ts'), 'declared-name'].toSorted()).toEqual(
    [...pinned].toSorted(),
  );
});

test('a module whose declaration throws prints its diagnostic as it loads, under Node.js and Bun', () => {
  for (const runtime of ['node', 'bun']) {
    const result = invoke(new URL('fixtures/spelling-taken.mjs', import.meta.url), [], {
      runtime,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    // The runtime prints the stack after the message, so the correction is not the last section.
    expect(result.stderr).toContain(
      ' @loomcli/core/spelling-taken\n\nOption spelling "-v" is used by both "verbose" and "version".\n',
    );
    expect(result.stderr).toContain(`\n${changeOne}\n`);
  }
});
