import { expect, test } from 'vite-plus/test';

import { run as mediaTypes } from './fixtures/format-media-types.mjs';
import { run as fixtureRun } from './fixtures/format-views.mjs';

async function run(scenario: string, color?: string, env: Record<string, string> = {}) {
  return await fixtureRun(color === undefined ? [scenario] : [scenario, color], env);
}

/** One invocation that wrote its whole result to stdout and reported no failure. */
function rendered(stdout: string) {
  return { status: 0, stderr: '', stdout: `${stdout}resolved:0\n` };
}

/** One invocation whose view threw, a defect a distributed build reports generically, exit 1. */
const faulted = {
  status: 1,
  stderr: 'format-views: Something went wrong.\n',
  stdout: 'resolved:1\n',
};

/**
 * The action awaits the render call and lets its rejection propagate, so a development build
 * states the formatter's own sentence as the unhandled exception's.
 */
async function expectStated(scenario: string, message: string) {
  const fixtureResult1 = await run(scenario, undefined, { FIXTURE_BUILD: 'development' });
  expect(fixtureResult1.stderr).toContain(`\n\n${message}\n`);
}

test('json() over an object renders one indented document', async () => {
  await expect(run('json-object')).resolves.toEqual(
    rendered('{\n  "count": 1,\n  "name": "a"\n}\n'),
  );
});

test('json() over an array renders one indented document', async () => {
  await expect(run('json-array')).resolves.toEqual(rendered('[\n  1,\n  2,\n  3\n]\n'));
});

test('json() over an empty array renders the empty array', async () => {
  await expect(run('json-empty-array')).resolves.toEqual(rendered('[]\n'));
});

test('json() applies its map before encoding', async () => {
  await expect(run('json-map')).resolves.toEqual(rendered('{\n  "count": 2\n}\n'));
});

test("json() honors a value's toJSON", async () => {
  await expect(run('json-tojson')).resolves.toEqual(rendered('{\n  "wrapped": 5\n}\n'));
});

test('jsonl() over an array renders one compact line per element', async () => {
  await expect(run('jsonl-array')).resolves.toEqual(rendered('{"count":1}\n{"count":2}\n'));
});

test('jsonl() over a non-array renders one compact line', async () => {
  await expect(run('jsonl-non-array')).resolves.toEqual(rendered('{"count":1}\n'));
});

test('jsonl() over an empty array prints nothing', async () => {
  await expect(run('jsonl-empty-array')).resolves.toEqual(rendered(''));
});

test('jsonl() applies its map before encoding', async () => {
  await expect(run('jsonl-map')).resolves.toEqual(rendered('1\n2\n'));
});

test("jsonl() honors each element's toJSON", async () => {
  await expect(run('jsonl-tojson')).resolves.toEqual(rendered('{"wrapped":1}\n{"wrapped":2}\n'));
});

test('a top-level undefined value makes json() throw, reported at exit 1', async () => {
  await expect(run('json-undefined')).resolves.toEqual(faulted);
  await expectStated(
    'json-undefined',
    'The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.',
  );
});

test('a bigint makes jsonl() throw one fixed sentence with no engine reason, reported at exit 1', async () => {
  await expect(run('jsonl-bigint')).resolves.toEqual(faulted);
  await expectStated(
    'jsonl-bigint',
    'The value cannot be encoded as JSON. Emit plain JSON data from the action.',
  );
});

test("the encode failure keeps the engine's error as its cause", async () => {
  // The fixture's InternalError view prints the thrown error's cause, which the default text omits.
  await expect(run('jsonl-bigint-cause')).resolves.toEqual({
    status: 1,
    stderr: 'cause: TypeError\n',
    stdout: 'resolved:1\n',
  });
});

test.each(['never', 'always'] as const)(
  String.raw`U+001B, U+009B, and U+007F print as \u001b, \u009b, and \u007f under color %s`,
  async (color) => {
    await expect(run('jsonl-controls', color)).resolves.toEqual(
      rendered('"a\\u001bb\\u009bc\\u007fd"\n'),
    );
  },
);

test('json() and jsonl() declare their media types under every map', async () => {
  const result = await mediaTypes();
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    json: 'application/json',
    jsonl: 'application/jsonl',
    mappedJson: 'application/json',
    mappedJsonl: 'application/jsonl',
  });
});
