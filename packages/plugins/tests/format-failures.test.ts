import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/format-failures.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

/** Help's hint for `app count`, which every usage failure carries. */
const usage = String.raw`"hints":["Run \"app count --help\" to see the usage."]`;

test('a held fault under --format json writes one JSON line to stderr, and --format jsonl the same bytes', () => {
  const line = `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \\"--depth\\": Use decimal digits.",${usage}}}\n`;
  for (const selected of ['json', 'jsonl']) {
    expect(run('plain', ['count', '--format', selected, '--depth', 'x'])).toEqual({
      status: 2,
      stderr: line,
      stdout: '',
    });
  }
});

test("a held structural fault still selects the formatter's view, because core validates --format under it", () => {
  expect(run('plain', ['count', '--format', 'json', '--bogus'])).toEqual({
    status: 2,
    stderr: `{"error":{"code":"unknown-option","exitCode":2,"message":"Unknown option \\"--bogus\\". Supply a declared option; prefix a hyphenated path with \\"./\\".",${usage}}}\n`,
    stdout: '',
  });
});

test('an action failure under --format json writes the fatal line, with C1 controls escaped', () => {
  expect(run('plain', ['count', '--format', 'json', '--fail', 'yes'])).toEqual({
    status: 1,
    stderr: '{"error":{"code":"fatal","exitCode":1,"message":"The count failed.","hints":[]}}\n',
    stdout: '',
  });
  expect(run('preserve', ['count', '--format', 'json', '--fail', 'controls']).stderr).toBe(
    '{"error":{"code":"fatal","exitCode":1,"message":"A \\u009b control and a \\"quote\\".","hints":[]}}\n',
  );
});

test('a rejected or omitted --format writes the text diagnostic, because the default view declares no media type', () => {
  expect(run('plain', ['count', '--format', 'yaml'])).toEqual({
    status: 2,
    stderr:
      'app: Option "--format": Supply one of table, json, jsonl.\nRun "app count --help" to see the usage.\n',
    stdout: '',
  });
  expect(run('plain', ['count', '--depth', 'x']).stderr).toBe(
    'app: Option "--depth": Use decimal digits.\nRun "app count --help" to see the usage.\n',
  );
});

test('a default view that is json() writes the JSON line with no --format', () => {
  expect(run('json-default', ['count'])).toEqual({
    status: 1,
    stderr: '{"error":{"code":"fatal","exitCode":1,"message":"The count failed.","hints":[]}}\n',
    stdout: '',
  });
});
