// Acceptance plan: see packages/core/tests/failure-encoders.test.ts.

import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/format-failures.js';

async function run(scenario: string, argv: string[]) {
  return await fixtureRun([scenario, ...argv]);
}

/** Help's hint for `app count`, which every usage failure carries. */
const usage = String.raw`"hints":["Run \"app count --help\" to see the usage."]`;

test('a held fault under --format json writes one JSON line to stderr, and --format jsonl the same bytes', async () => {
  const line = `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \\"--depth\\": Use decimal digits.",${usage}}}\n`;
  for (const selected of ['json', 'jsonl']) {
    await expect(run('plain', ['count', '--format', selected, '--depth', 'x'])).resolves.toEqual({
      status: 2,
      stderr: line,
      stdout: '',
    });
  }
});

test("a held structural fault still selects the formatter's view, because core validates --format under it", async () => {
  await expect(run('plain', ['count', '--format', 'json', '--bogus'])).resolves.toEqual({
    status: 2,
    stderr: `{"error":{"code":"unknown-option","exitCode":2,"message":"Unknown option \\"--bogus\\". Supply a declared option; prefix a hyphenated path with \\"./\\".",${usage}}}\n`,
    stdout: '',
  });
});

test('an action failure under --format json writes the fatal line, with C1 controls escaped', async () => {
  await expect(run('plain', ['count', '--format', 'json', '--fail', 'yes'])).resolves.toEqual({
    status: 1,
    stderr: '{"error":{"code":"fatal","exitCode":1,"message":"The count failed.","hints":[]}}\n',
    stdout: '',
  });
  const fixtureResult1 = await run('preserve', ['count', '--format', 'json', '--fail', 'controls']);
  expect(fixtureResult1.stderr).toBe(
    '{"error":{"code":"fatal","exitCode":1,"message":"A \\u009b control and a \\"quote\\".","hints":[]}}\n',
  );
});

test('a rejected or omitted --format writes the text diagnostic, because the default view declares no media type', async () => {
  await expect(run('plain', ['count', '--format', 'yaml'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Option "--format": Supply one of table, json, jsonl.\nRun "app count --help" to see the usage.\n',
    stdout: '',
  });
  const fixtureResult2 = await run('plain', ['count', '--depth', 'x']);
  expect(fixtureResult2.stderr).toBe(
    'app: Option "--depth": Use decimal digits.\nRun "app count --help" to see the usage.\n',
  );
});

test('a default view that is json() writes the JSON line with no --format', async () => {
  await expect(run('json-default', ['count'])).resolves.toEqual({
    status: 1,
    stderr: '{"error":{"code":"fatal","exitCode":1,"message":"The count failed.","hints":[]}}\n',
    stdout: '',
  });
});
