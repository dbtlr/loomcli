import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

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

test.each(['false', '0', '[]'])('source-filled %s counts as supplied', (value) => {
  const result = invoke(advanced, ['source', value]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('(from fixture setting)');
  expect(result.stderr).toContain('cannot be used together');
});

test('environment values satisfy required groups and retain their source in conflicts', () => {
  expect(invoke(advanced, ['env']).status).toBe(0);
  const conflict = invoke(advanced, ['env', '--second', 'typed']);
  expect(conflict.status).toBe(2);
  expect(conflict.stderr).toContain('"--first" (from GROUP_FIRST)');
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
