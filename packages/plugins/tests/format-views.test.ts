import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/format-views.mjs', import.meta.url);

function run(scenario: string, color?: string) {
  return invoke(fixture, color === undefined ? [scenario] : [scenario, color]);
}

/** One invocation that wrote its whole result to stdout and reported no failure. */
function rendered(stdout: string) {
  return { status: 0, stderr: '', stdout: `${stdout}resolved:0\n` };
}

/** One invocation whose view threw, reported as an internal fault with exit code 1. */
function faulted(message: string) {
  return { status: 1, stderr: `Internal error: ${message}\n`, stdout: 'resolved:1\n' };
}

test('json() over an object renders one indented document', () => {
  expect(run('json-object')).toEqual(rendered('{\n  "count": 1,\n  "name": "a"\n}\n'));
});

test('json() over an array renders one indented document', () => {
  expect(run('json-array')).toEqual(rendered('[\n  1,\n  2,\n  3\n]\n'));
});

test('json() over an empty array renders the empty array', () => {
  expect(run('json-empty-array')).toEqual(rendered('[]\n'));
});

test('json() applies its map before encoding', () => {
  expect(run('json-map')).toEqual(rendered('{\n  "count": 2\n}\n'));
});

test("json() honors a value's toJSON", () => {
  expect(run('json-tojson')).toEqual(rendered('{\n  "wrapped": 5\n}\n'));
});

test('jsonl() over an array renders one compact line per element', () => {
  expect(run('jsonl-array')).toEqual(rendered('{"count":1}\n{"count":2}\n'));
});

test('jsonl() over a non-array renders one compact line', () => {
  expect(run('jsonl-non-array')).toEqual(rendered('{"count":1}\n'));
});

test('jsonl() over an empty array prints nothing', () => {
  expect(run('jsonl-empty-array')).toEqual(rendered(''));
});

test('jsonl() applies its map before encoding', () => {
  expect(run('jsonl-map')).toEqual(rendered('1\n2\n'));
});

test("jsonl() honors each element's toJSON", () => {
  expect(run('jsonl-tojson')).toEqual(rendered('{"wrapped":1}\n{"wrapped":2}\n'));
});

test('a top-level undefined value makes json() throw, reported at exit 1', () => {
  expect(run('json-undefined')).toEqual(
    faulted('The value cannot be encoded as JSON: the value is undefined.'),
  );
});

test('a bigint makes jsonl() throw, reported at exit 1', () => {
  // JSON.stringify's own bigint message differs between engines.
  // Only the plugin's wrapping and the mention of BigInt are asserted here.
  const result = run('jsonl-bigint');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('resolved:1\n');
  expect(result.stderr).toMatch(/^Internal error: The value cannot be encoded as JSON: .+\.\n$/u);
  expect(result.stderr).toMatch(/BigInt/u);
});

test.each(['never', 'always'] as const)(
  String.raw`U+001B, U+009B, and U+007F print as \u001b, \u009b, and \u007f under color %s`,
  (color) => {
    expect(run('jsonl-controls', color)).toEqual(rendered('"a\\u001bb\\u009bc\\u007fd"\n'));
  },
);
