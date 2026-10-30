import { fileURLToPath } from 'node:url';

import { Application, InputError, extension, plugin, validationContext } from '@loomcli/core';
import type { SourceAnswer, StandardSchemaV1 } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/option-groups.mjs', import.meta.url);

test('exclusive supplied options fail before the action with one group problem', () => {
  const result = invoke(fixture, ['exclusive', '--json', '--yaml']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(
    'groups: Options "--json" and "--yaml" cannot be used together. Supply only one of them.\n',
  );
});

test.each([
  ['exclusive', [], 0],
  ['exclusive', ['--json'], 0],
  ['oneRequired', [], 2],
  ['oneRequired', ['--yaml'], 0],
  ['oneRequired', ['--json', '--yaml'], 0],
  ['requiredTogether', [], 0],
  ['requiredTogether', ['--json'], 2],
  ['requiredTogether', ['--json', '--yaml'], 0],
])('%s checks supplied members %j', (kind, words, code) => {
  const result = invoke(fixture, [kind, ...words]);
  expect(result.status).toBe(code);
  expect(result.stdout).toBe(code === 0 ? 'action\n' : '');
});

const advanced = new URL('fixtures/group-inputs.mjs', import.meta.url);

test('defaults do not satisfy groups and combined groups express exactly one', () => {
  const absent = invoke(advanced, ['defaults']);
  expect(absent.status).toBe(2);
  expect(absent.stderr).toContain('Supply at least one of them.');
  expect(invoke(advanced, ['defaults', '--first', 'chosen']).status).toBe(0);
  expect(invoke(advanced, ['defaults', '--first', 'chosen', '--second', 'other']).status).toBe(2);
});

test('invalid supplied values and group problems report together in declaration order', () => {
  const result = invoke(advanced, ['invalid', '--first', 'bad', '--second', '2']);
  expect(result.status).toBe(2);
  expect(result.stderr.split('\n')).toEqual([
    'groups: Option "--first": Supply digits.',
    'groups: Options "--first" and "--second" cannot be used together. Supply only one of them.',
    'groups: Options "--first" and "--c" must be supplied together. Supply all of them, or none.',
    '',
  ]);
});

test.each(['false', '0', '[]'])('a source-filled %s member loses to a typed sibling', (value) => {
  const result = invoke(advanced, ['source', value]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('action\n');
});

test('environment values satisfy required groups and lose to a typed sibling', () => {
  expect(invoke(advanced, ['env']).status).toBe(0);
  const typed = invoke(advanced, ['env', '--second', 'typed']);
  expect(typed.status).toBe(0);
});

test('named calls preserve lowering presence and expose structured group problems', () => {
  const result = invoke(advanced, ['named']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    absent: 2,
    present: 0,
    problems: [
      {
        inputs: [
          { global: false, kind: 'option', name: 'first' },
          { global: false, kind: 'option', name: 'second' },
        ],
        reason: 'exclusive',
        spellings: ['first', 'second'],
        supplied: ['first', 'second'],
      },
    ],
  });
});

test('group declarations are immutable and inspection freezes their facts', () => {
  const result = invoke(advanced, ['inspect']);
  expect(JSON.parse(result.stdout)).toEqual({
    frozen: true,
    grouped: [{ kind: 'exclusive', options: ['first', 'second'] }],
    original: [],
  });
});

const declarations = new URL('fixtures/group-declarations.mjs', import.meta.url);

test.each([
  'unknown',
  'argument',
  'global',
  'repeat',
  'short',
  'required',
  'conditional',
  'content',
  'minimum',
  'overlap',
  'reverse-overlap',
])('rejects declaration fault %s', (scenario) => {
  const result = invoke(declarations, [scenario]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'DeclarationError' });
  expect(JSON.parse(result.stdout).message).toContain('@loomcli/core/option-group');
});

test('redundancy and required members in oneRequired remain valid', () => {
  expect(invoke(declarations, ['redundancy']).stdout).toBe('accepted\n');
});

test('lifecycle hooks can group their declared local options after action registration', () => {
  const result = invoke(advanced, ['hook', '--first', '--second']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('cannot be used together');
});

test('unanswered configuration members suppress only unproven group failures', () => {
  const source = new URL('fixtures/group-unanswered.mjs', import.meta.url);
  const unknown = invoke(source, ['one']);
  expect(unknown.status).toBe(2);
  expect(unknown.stderr).toContain('Use good.');
  expect(unknown.stderr).not.toContain('Supply at least one');
  const together = invoke(source, ['together']);
  expect(together.status).toBe(2);
  expect(together.stderr).toContain('must be supplied together');
  const exclusive = invoke(source, ['exclusive']);
  expect(exclusive.status).toBe(2);
  expect(exclusive.stderr).toContain('cannot be used together');
});

test('piped stdin attaches content but is not a supplied option for a group', () => {
  const content = new URL('fixtures/group-content.mjs', import.meta.url);
  expect(invoke(content, ['oneRequired'], { input: 'piped' }).status).toBe(2);
  const allowed = invoke(content, ['exclusive', '--url', 'https://example.test'], {
    input: 'piped',
  });
  expect(allowed.status).toBe(0);
  expect(allowed.stdout).toBe('stdin\n');
  expect(
    invoke(content, ['requiredTogether', '--url', 'https://example.test'], { input: 'piped' })
      .status,
  ).toBe(2);
  expect(invoke(content, ['oneRequired', '--file', fileURLToPath(content)]).status).toBe(0);
});

/** What one run of the tiered application saw: its status, its stderr, and what the action read. */
interface Tiered {
  readonly seen: { options: Record<string, unknown>; supplied: Record<string, unknown> }[];
  readonly status: number;
  readonly stderr: string;
}

/** One group over the tiered application's options. */
type Rule = readonly [
  'exclusive' | 'oneRequired' | 'requiredTogether',
  'json' | 'plain' | 'yaml',
  'json' | 'plain' | 'yaml',
];

const jsonOrYaml: readonly Rule[] = [['exclusive', 'json', 'yaml']];

/**
 * A configuration source that answers `answers`, each labeled as a key in `tiers.json`, and the
 * binding its options carry. A `directory` is the directory of the file each answer came from.
 */
function tiersSource(answers: Record<string, SourceAnswer['value']>, directory?: string) {
  const binding = extension('@test/tiers/key', { schema: z.string(), target: 'option' });
  const source = plugin('@test/tiers', {
    extensions: [binding],
    source: {
      binding,
      load: async () => ({
        default: async () =>
          Object.fromEntries(
            Object.entries(answers).map(([name, value]) => [
              name,
              { label: `${name} in tiers.json`, value, ...(directory ? { directory } : {}) },
            ]),
          ),
      }),
    },
  });
  return { binding, source };
}

/** Builds the application: a configuration source that answers `answers`, and the groups under test. */
function tieredApplication(
  answers: Record<string, boolean>,
  rules: readonly Rule[] = jsonOrYaml,
  seen: Tiered['seen'] = [],
) {
  const { binding, source } = tiersSource(answers);
  let app = new Application('export', { plugins: [source] })
    .option('json', {
      description: 'Write JSON.',
      env: 'EXPORT_JSON',
      extensions: [binding('json')],
      type: 'boolean',
    })
    .option('yaml', {
      description: 'Write YAML.',
      env: 'EXPORT_YAML',
      extensions: [binding('yaml')],
      type: 'boolean',
    })
    .option('plain', {
      description: 'Write plain text.',
      extensions: [binding('plain')],
      type: 'boolean',
    });
  for (const [kind, first, second] of rules) {
    app = app[kind](first, second);
  }
  return app.action(({ options, supplied }) => {
    seen.push({ options: { ...options }, supplied: { ...supplied.options } });
  });
}

/** One run of the tiered application. */
async function tiered(
  words: { argv?: string[]; env?: Record<string, string>; answers?: Record<string, boolean> },
  rules?: readonly Rule[],
): Promise<Tiered> {
  const seen: Tiered['seen'] = [];
  const mock = mockProcess({ argv: words.argv ?? [], env: words.env ?? {} });
  const status = await tieredApplication(words.answers ?? {}, rules, seen).run({ process: mock });
  return { seen, status, stderr: mock.stderr.text };
}

test('a typed member wins over a configured sibling, which reads at its default and unsupplied', async () => {
  const result = await tiered({ answers: { json: true }, argv: ['--yaml'] });
  expect(result.status).toBe(0);
  expect(result.seen).toHaveLength(1);
  expect(result.seen[0]?.options).toMatchObject({ json: false, yaml: true });
  expect(result.seen[0]?.supplied).not.toHaveProperty('json', true);
  expect(result.seen[0]?.supplied.yaml).toBe(true);
});

test('a typed member wins over a bound variable of a sibling', async () => {
  const result = await tiered({ argv: ['--yaml'], env: { EXPORT_JSON: '1' } });
  expect(result.status).toBe(0);
  expect(result.seen[0]?.options).toMatchObject({ json: false, yaml: true });
});

test('an environment member wins over a configured sibling', async () => {
  const result = await tiered({ answers: { yaml: true }, env: { EXPORT_JSON: '1' } });
  expect(result.status).toBe(0);
  expect(result.seen[0]?.options).toMatchObject({ json: true, yaml: false });
  expect(result.seen[0]?.supplied).not.toHaveProperty('yaml', true);
});

test('members one tier supplied still conflict, and the diagnostic names each source', async () => {
  const typed = await tiered({ argv: ['--json', '--yaml'] });
  expect(typed.status).toBe(2);
  expect(typed.stderr).toContain('cannot be used together');
  const bound = await tiered({ env: { EXPORT_JSON: '1', EXPORT_YAML: '1' } });
  expect(bound.status).toBe(2);
  expect(bound.stderr).toContain('"--json" (from EXPORT_JSON) and "--yaml" (from EXPORT_YAML)');
  const configured = await tiered({ answers: { json: true, yaml: true } });
  expect(configured.status).toBe(2);
  expect(configured.stderr).toContain('"--json" (from json in tiers.json)');
  expect(configured.stderr).toContain('"--yaml" (from yaml in tiers.json)');
});

test('a withdrawn member is never validated', async () => {
  const validated: unknown[] = [];
  const mock = mockProcess({ argv: ['--yaml'], env: { EXPORT_FILE: 'out.txt' } });
  const status = await new Application('export')
    .option('file', {
      description: 'Write to a file.',
      env: 'EXPORT_FILE',
      type: 'string',
      validate: {
        '~standard': {
          validate: (value: unknown) => {
            validated.push(value);
            return { value };
          },
          vendor: 'test',
          version: 1,
        },
      },
    })
    .option('yaml', { description: 'Write YAML.', type: 'boolean' })
    .exclusive('file', 'yaml')
    .action(() => {})
    .run({ process: mock });
  expect(status).toBe(0);
  expect(validated).toEqual([]);
});

test('oneRequired is satisfied by a configured member', async () => {
  const rules: readonly Rule[] = [['oneRequired', 'json', 'yaml']];
  const satisfied = await tiered({ answers: { json: true } }, rules);
  expect(satisfied.status).toBe(0);
  const missing = await tiered({}, rules);
  expect(missing.status).toBe(2);
});

test('requiredTogether counts a member that the exclusive group withdrew', async () => {
  const rules: readonly Rule[] = [
    ['exclusive', 'json', 'yaml'],
    ['requiredTogether', 'json', 'plain'],
  ];
  const result = await tiered({ answers: { json: true }, argv: ['--yaml', '--plain'] }, rules);
  expect(result.status).toBe(0);
  expect(result.seen[0]?.options).toMatchObject({ json: false, plain: true, yaml: true });
});

test('a member in two exclusive groups withdraws when either holds a higher tier, whatever the declaration order', async () => {
  const forward: readonly Rule[] = [
    ['exclusive', 'json', 'yaml'],
    ['exclusive', 'yaml', 'plain'],
  ];
  const backward: readonly Rule[] = [
    ['exclusive', 'yaml', 'plain'],
    ['exclusive', 'json', 'yaml'],
  ];
  for (const rules of [forward, backward]) {
    const result = await tiered(
      { answers: { plain: true }, argv: ['--json'], env: { EXPORT_YAML: '1' } },
      rules,
    );
    expect(result.status).toBe(0);
    expect(result.seen[0]?.options).toMatchObject({ json: true, plain: false, yaml: false });
  }
});

test('a variable outside the grammar beside a typed sibling is not reported', async () => {
  const result = await tiered({ argv: ['--yaml'], env: { EXPORT_JSON: 'maybe' } });
  expect(result.status).toBe(0);
  const bound = await tiered({ env: { EXPORT_JSON: 'maybe', EXPORT_YAML: '1' } });
  expect(bound.status).toBe(2);
  expect(bound.stderr).toContain('EXPORT_JSON');
});

test('the named values of an invocation by name are the argv tier', async () => {
  const seen: Tiered['seen'] = [];
  const app = tieredApplication({ yaml: true }, undefined, seen);
  const won = await app.invoke([], { options: { json: true } });
  expect(won.status).toBe('completed');
  expect(seen[0]?.options).toMatchObject({ json: true, yaml: false });
  const conflict = await app.invoke([], { options: { json: true, yaml: true } });
  expect(conflict.status).toBe('failed');
});

test('a requiredTogether failure over a withdrawn member names the source that filled it', async () => {
  const rules: readonly Rule[] = [
    ['exclusive', 'json', 'yaml'],
    ['requiredTogether', 'json', 'plain'],
  ];
  const result = await tiered({ answers: { json: true }, argv: ['--yaml'] }, rules);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('"--json" (from json in tiers.json) and "--plain" must be');
});

test('oneRequired is satisfied by a member that the exclusive group withdrew', async () => {
  const rules: readonly Rule[] = [
    ['exclusive', 'json', 'yaml'],
    ['oneRequired', 'json', 'plain'],
  ];
  const result = await tiered({ answers: { json: true }, argv: ['--yaml'] }, rules);
  expect(result.status).toBe(0);
  expect(result.seen[0]?.options).toMatchObject({ json: false, plain: false, yaml: true });
});

test('a variable outside the grammar beside a typed sibling satisfies no other group', async () => {
  const rules: readonly Rule[] = [
    ['exclusive', 'json', 'yaml'],
    ['oneRequired', 'json', 'plain'],
  ];
  const result = await tiered({ argv: ['--yaml'], env: { EXPORT_JSON: 'maybe' } }, rules);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('One of options "--json" and "--plain" is required.');
});

test("a group problem's supplied list names a withdrawn member it counted", async () => {
  const rules: readonly Rule[] = [
    ['exclusive', 'json', 'yaml'],
    ['requiredTogether', 'json', 'plain'],
  ];
  const result = await tieredApplication({ json: true }, rules).invoke([], {
    options: { yaml: true },
  });
  expect(result.status).toBe('failed');
  const problems =
    result.status === 'failed' && result.failure instanceof InputError
      ? result.failure.problems
      : [];
  expect(problems).toEqual([
    expect.objectContaining({ reason: 'requiredTogether', supplied: ['json'] }),
  ]);
});

test("a withdrawn configured member's omission reads the run's working directory", async () => {
  const directories: string[] = [];
  const { binding, source } = tiersSource({ file: 'out.txt' }, '/srv/project');
  const mock = mockProcess({ argv: ['--yaml'], cwd: '/loom-test' });
  const status = await new Application('export', { plugins: [source] })
    .option('file', {
      description: 'Write to a file.',
      extensions: [binding('file')],
      type: 'string',
      validate: {
        '~standard': {
          validate: (value: unknown, options?: StandardSchemaV1.Options) => {
            directories.push(validationContext(options)?.host.cwd ?? 'no context');
            return { value };
          },
          vendor: 'test',
          version: 1,
        },
      },
      validateOmitted: true,
    })
    .option('yaml', { description: 'Write YAML.', type: 'boolean' })
    .exclusive('file', 'yaml')
    .action(() => {})
    .run({ process: mock });
  expect(status).toBe(0);
  expect(directories).toEqual(['/loom-test']);
});
