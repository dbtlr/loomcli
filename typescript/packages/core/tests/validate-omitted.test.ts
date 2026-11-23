import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

/** The fixture encodes an absent value as this marker, which JSON alone cannot carry. */
const none = '#undefined';

async function omitted(scenario: string, argv: string[] = []) {
  return await invokeFixture(new URL('fixtures/validate-omitted.mjs', import.meta.url), [
    scenario,
    ...argv,
  ]);
}

async function ran(scenario: string, argv: string[] = []) {
  const result = await omitted(scenario, argv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('an omitted option with validateOmitted reaches its schema in the invocation phase', async () => {
  await expect(ran('option')).resolves.toEqual({
    args: {},
    calls: [
      {
        absent: true,
        input: { global: false, kind: 'option', name: 'file' },
        phase: 'invocation',
        supplied: { args: {}, options: { file: none } },
      },
    ],
    options: { file: 'stdin' },
  });
});

test('a supplied value still reaches the same schema as its own string', async () => {
  await expect(ran('option', ['--file', 'doc.json'])).resolves.toEqual({
    args: {},
    calls: [
      {
        absent: false,
        input: { global: false, kind: 'option', name: 'file' },
        phase: 'invocation',
        supplied: { args: {}, options: { file: 'doc.json' } },
      },
    ],
    options: { file: 'file:doc.json' },
  });
});

test("an issue from the omitted call is an input error naming the option's long form", async () => {
  await expect(omitted('option-issue')).resolves.toEqual({
    status: 2,
    stderr: 'omitted: Option "--file": Supply a file or pipe JSON to stdin.\n',
    stdout: '',
  });
  await expect(omitted('option-issue', ['-f', 'doc.json'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: expect.stringContaining('"file":"file:doc.json"'),
  });
});

test('an omitted scalar argument with validateOmitted reaches its schema the same way', async () => {
  await expect(ran('argument')).resolves.toEqual({
    args: { path: 'stdin' },
    calls: [
      {
        absent: true,
        input: { global: false, kind: 'argument', name: 'path' },
        phase: 'invocation',
        supplied: { args: { path: none }, options: {} },
      },
    ],
    options: {},
  });
  await expect(
    ran('argument', ['doc.json']).then((fixtureResult) => fixtureResult.args),
  ).resolves.toEqual({
    path: 'file:doc.json',
  });
});

test('an issue from an omitted argument names the argument', async () => {
  await expect(omitted('argument-issue')).resolves.toEqual({
    status: 2,
    stderr: 'omitted: Argument "path": Supply a path or pipe JSON to stdin.\n',
    stdout: '',
  });
});
