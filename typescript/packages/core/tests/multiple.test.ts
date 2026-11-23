import { expect, test } from 'vite-plus/test';

import { coreRuleParts } from './rule-parts.js';
import { invoke as invokeFixture } from './run-fixture.ts';

async function multiple(scenario: string, argv: string[] = []) {
  return await invokeFixture(new URL('fixtures/multiple.mjs', import.meta.url), [
    scenario,
    ...argv,
  ]);
}

test('a multiple option collects every occurrence across its spellings in supplied order', async () => {
  await expect(multiple('plain', ['--field', 'a', '-F', 'b', '--field=c'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a","b","c"],"total":false},"passthrough":[]}\n',
  });
  await expect(multiple('plain', ['-tF', 'b', '--', 'tail'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["b"],"total":true},"passthrough":["tail"]}\n',
  });
});

test('a multiple string alias ends its short group, taking the rest of the word as its value', async () => {
  await expect(multiple('plain', ['-Ft', '-F=b', '-tFc'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["t","b","c"],"total":true},"passthrough":[]}\n',
  });
});

test('an omitted multiple option calls no validator and gives the action an empty array', async () => {
  await expect(multiple('schema')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"calls":0,"options":{"field":[]}}\n',
  });
});

test("the action receives the array of each value's validator output", async () => {
  await expect(multiple('counted', ['--field', 'a', '--field', 'abc'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":[1,3]},"passthrough":[]}\n',
  });
});

test('required is checked before any validator, so it answers an omission first', async () => {
  await expect(multiple('required-schema')).resolves.toEqual({
    status: 2,
    stderr: 'multiple: Option "--field" is required. Supply at least one value.\n',
    stdout: '',
  });
});

test('a multiple validator runs once per value and reports each issue at its position', async () => {
  await expect(multiple('schema', ['--field', 'a', '--field=b'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"calls":2,"options":{"field":["a","b"]}}\n',
  });
  await expect(multiple('schema', ['-F', '', '--field', 'a', '-F', ''])).resolves.toEqual({
    status: 2,
    stderr:
      'multiple: Option "--field" at 0: Supply a field name.\nmultiple: Option "--field" at 2: Supply a field name.\n',
    stdout: '',
  });
});

test("a run cancelled inside one value's validator starts no call for the next value", async () => {
  await expect(
    multiple('abort-mid-list', ['--field', 'a', '--field', 'b', '--field', 'c']),
  ).resolves.toEqual({
    status: 130,
    stderr: '',
    stdout: 'calls:1:code:130\n',
  });
});

test('each per-value call reads its own context, so a write in one call never reaches the next', async () => {
  await expect(multiple('per-value-context', ['--field', 'a', '--field', 'b'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify([
      { command: [], field: ['a', 'b'], kept: true },
      { command: [], field: ['a', 'b'], kept: true },
    ])}\n`,
  });
});

test('a value issue with its own path reads after the value position', async () => {
  await expect(multiple('pathed', ['--field', 'a', '--field', 'b'])).resolves.toEqual({
    status: 2,
    stderr: 'multiple: Option "--field" at 1.name: Unknown name.\n',
    stdout: '',
  });
});

test('each multiple default value passes through the validator and a supplied array replaces it', async () => {
  await expect(multiple('default')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["A","B"]},"passthrough":[]}\n',
  });
  await expect(multiple('default', ['--field', 'x', '--field', 'y'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["X","Y"]},"passthrough":[]}\n',
  });
});

test('a rejected default value fails every run with its position', async () => {
  const result = await multiple('invalid-default', ['--field', 'fine']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  // The fixture is a development build, so the fault prints its Developer Diagnostic.
  expect(coreRuleParts(result.stderr)).toEqual({
    correction: 'Fix the default or its validator.',
    rule: 'invalid-default',
    sentence: 'Option "field" has an invalid default.\nOption "field" at 1: Supply a field name.',
  });
});

test('a multiple default without a validator stays a raw string array', async () => {
  await expect(multiple('raw-default')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a"]},"passthrough":[]}\n',
  });
});

test('a required multiple option reports absence as a validation issue', async () => {
  await expect(multiple('required')).resolves.toEqual({
    status: 2,
    stderr: 'multiple: Option "--field" is required. Supply at least one value.\n',
    stdout: '',
  });
  await expect(multiple('required', ['-F', 'a'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a"]},"passthrough":[]}\n',
  });
});

test('a multiple global is collected at every placement, whichever layer reads it', async () => {
  await expect(
    multiple('global', ['--field', 'a', 'show', '-F', 'b', '--local', '--field=c']),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a","b","c"],"local":true},"passthrough":[]}\n',
  });
  await expect(multiple('global', ['-F', 'a', '--field', 'b'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a","b"]},"passthrough":[]}\n',
  });
  await expect(multiple('global', ['show'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":[],"local":false},"passthrough":[]}\n',
  });
});
