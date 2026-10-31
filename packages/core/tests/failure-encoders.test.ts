import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for failure encoders (docs/core/failure-views.md#failure-encoders).
 *
 * Failure encoders are proven when public APIs alone produce these results under Node and Bun, with
 * textstat and jsonkit installing the formatter:
 *
 * - A held fault. `textstat --format json --metric nope one.txt` writes exactly
 *   `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \"--metric\": Expected one of:
 *   bytes, words, lines.","hints":["Run \"textstat --help\" to see the usage."]}}` and one newline
 *   to stderr, nothing to stdout, and exits 2. `--format jsonl` writes the same bytes. `textstat
 *   --format json --bogus one.txt` writes the `unknown-option` line and exits 2, and `textstat
 *   --format json -c missing.json one.txt` writes the configuration failure's `invalid-input` line
 *   and exits 2, because core validates the formatter's `--format` under the held structural and
 *   input-source faults.
 * - An action failure. `jsonkit paths --format json -f broken.json` writes the `invalid-json` line
 *   with exit code 65, and `jsonkit paths --format jsonl -f <document with a refused key>` writes
 *   nothing on stdout, because `jsonl()` is a whole view and the sequence stopped, and the `fatal`
 *   line alone on stderr, with no incomplete-result line. A fixture row view under an encoded media
 *   type writes its earlier rows on stdout and the line alone on stderr.
 * - Text. `textstat --metric nope one.txt`, `textstat --format yaml one.txt`, and `jsonkit typo
 *   --format json -f doc.json` write their text diagnostics unchanged, as does a build fault under
 *   `--format json`, and `jsonkit paths -f <document with a refused key>` still writes the
 *   incomplete-result line ahead of its text.
 * - The default view. A fixture Command whose default view is `json()` writes the JSON line for a
 *   failure with no `--format`.
 * - Defects. A fixture action that throws a `TypeError` under `--format json` writes
 *   `{"error":{"code":"internal","exitCode":1,"message":"Something went wrong.","hints":[]}}` from
 *   a bundle, with no generic text line, and its Developer Diagnostic and then the line with its
 *   sentence from source.
 * - Overrides. jsonkit's `FatalError` override renders `jsonkit paths -f broken.json` and is not
 *   consulted under `--format json`.
 * - Registration faults. Two encodings for one media type in one plugin, and in two installed
 *   plugins, throw `@loomcli/core/failure-encoder-taken`.
 * - Broken. An encoder that throws, one that returns a number, and one that returns a promise each
 *   write the failure's default text, then the generic defect message from a bundle or the
 *   `@loomcli/core/broken-failure-encoder` diagnostic from source, whose reason for the promise is
 *   `The encoder returned a promise instead of a string.`, and exit 1, or 130 in a run a caller
 *   cancelled. A broken encoder after a sequence stopped writes the incomplete-result line ahead of
 *   the default text.
 * - The incomplete-result line. Under an encoded media type, a stream the caller cancels
 *   mid-sequence writes the incomplete-result line alone and exits 130, and a stdout write that
 *   fails with an `ENOSPC`-style error writes the line beside its plain fallback report and exits
 *   1. A stdout whose reader closed the pipe writes no line and exits 141, under Signals and
 *   cancellation.
 * - By name. `textstat.invoke([], …, { view: 'json' })` with an invalid metric captures the text
 *   diagnostic in `messages`, calls no encoder, and carries the form on the outcome.
 */

import { coreRuleParts } from './rule-parts.js';
import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/failure-encoders.mjs', import.meta.url);

/** One run of the fixture application, with the encoder and the build each variant names. */
async function run(
  words: string[],
  variant: {
    build?: 'development' | 'distributed';
    encoder?: string;
    env?: Record<string, string>;
  } = {},
) {
  return await invokeFixture(fixture, ['run', ...words], {
    env: {
      FIXTURE_BUILD: variant.build ?? 'distributed',
      FIXTURE_ENCODER: variant.encoder ?? 'line',
      ...variant.env,
    },
  });
}

/**
 * The line the fixture's encoder writes for one form. The entries are listed in the form's key
 * order, which a sorted object literal would not keep.
 */
function line(form: { code: string; exitCode: number; message: string; hints?: string[] }): string {
  const { code, exitCode, hints = [hint], message } = form;
  const ordered = Object.fromEntries([
    ['code', code],
    ['exitCode', exitCode],
    ['message', message],
    ['hints', hints],
  ]);
  return `${JSON.stringify({ error: ordered })}\n`;
}

/** The hint the fixture plugin adds to every failure. */
const hint = 'Run "enc --help" to see the usage.';

test('a held fault under an encoded selection writes the encoded line alone, and nothing to stdout', async () => {
  await expect(run(['list', '--pick', 'json', '--depth', 'x'])).resolves.toEqual({
    status: 2,
    stderr:
      '{"error":{"code":"invalid-input","exitCode":2,"message":"Option \\"--depth\\": Use decimal digits.","hints":["Run \\"enc --help\\" to see the usage."]}}\n',
    stdout: 'exit:2\n',
  });
  await expect(
    run(['list', '--pick', 'json', '--bogus']).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toBe(
    line({
      code: 'unknown-option',
      exitCode: 2,
      message:
        'Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".',
    }),
  );
});

test("a validator that throws on another input still writes the encoded line, because the selection's own option validated before it", async () => {
  await expect(run(['list', '--pick', 'json', '--depth', 'throw'])).resolves.toEqual({
    status: 1,
    stderr: line({ code: 'internal', exitCode: 1, message: 'Something went wrong.' }),
    stdout: 'exit:1\n',
  });
});

test('an action failure after rows writes the rows on stdout and the line alone on stderr', async () => {
  await expect(run(['list', '--pick', 'json'])).resolves.toEqual({
    status: 1,
    stderr: line({ code: 'fatal', exitCode: 1, message: 'The key "b" is refused.' }),
    stdout: '{"key":"a"}\nexit:1\n',
  });
});

/** The incomplete-result line for the `list` Command and its two counts. */
function incomplete(yielded: number, written: number): string {
  return `Output is incomplete: Command "list" stopped after ${String(yielded)} rows, ${String(written)} written.\n`;
}

test('a stream cancelled mid-sequence under an encoded selection writes the incomplete-result line, because no encoder writes a failure', async () => {
  await expect(run(['list', '--pick', 'json', '--how', 'stream-cancel'])).resolves.toEqual({
    status: 130,
    stderr: incomplete(1, 1),
    stdout: '{"key":"a"}\nexit:130\n',
  });
});

test('a stdout that fails a write under an encoded selection writes the incomplete-result line beside its plain fallback report', async () => {
  await expect(
    run(['list', '--pick', 'json'], { env: { FIXTURE_STDOUT: 'full' } }),
  ).resolves.toEqual({
    status: 1,
    stderr: `${incomplete(1, 0)}enc: Something went wrong.\n`,
    stdout: 'exit:1\n',
  });
});

test('a broken encoder after rows writes the incomplete-result line ahead of the default text', async () => {
  await expect(run(['list', '--pick', 'json'], { encoder: 'throws' })).resolves.toEqual({
    status: 1,
    stderr: `${incomplete(1, 1)}The key "b" is refused.\nenc: Something went wrong.\n`,
    stdout: '{"key":"a"}\nexit:1\n',
  });
});

test('a selection that declares no encoded media type writes its text as before', async () => {
  const table = await run(['list']);
  expect(table.stdout).toBe('{"key":"a"}\nexit:1\n');
  expect(table.stderr).toBe(
    'Output is incomplete: Command "list" stopped after 1 rows, 1 written.\nbranded: The key "b" is refused.\n',
  );
  await expect(
    run(['list', '--depth', 'x']).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toBe(`enc: Option "--depth": Use decimal digits.\n${hint}\n`);
  await expect(
    run(['nope', '--pick', 'json']).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toBe(`enc: Unknown command "nope". Use one of: list, wire, flags, extra.\n${hint}\n`);
  await expect(
    invokeFixture(fixture, ['build', 'list', '--pick', 'json']).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe('enc: Something went wrong.\n');
});

test('a default view that declares the media type writes the line with no selection', async () => {
  await expect(run(['wire'])).resolves.toEqual({
    status: 1,
    stderr: line({ code: 'fatal', exitCode: 1, message: 'Refused.' }),
    stdout: 'exit:1\n',
  });
});

test("the encoder answers ahead of the application's override, in plain text", async () => {
  await expect(
    run(['list', '--pick', 'json', '--how', 'fatal'], { env: { FORCE_COLOR: '1' } }).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe(line({ code: 'fatal', exitCode: 1, message: 'The registry is down.' }));
  await expect(
    run(['list', '--how', 'fatal']).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toMatch(/^branded: The .*registry.* is down\.\n$/u);
});

test('a defect writes the generic line from a bundle, and its Developer Diagnostic and then the line from source', async () => {
  await expect(run(['list', '--pick', 'json', '--how', 'defect'])).resolves.toEqual({
    status: 1,
    stderr: line({ code: 'internal', exitCode: 1, message: 'Something went wrong.' }),
    stdout: 'exit:1\n',
  });
  const developed = await run(['list', '--pick', 'json', '--how', 'defect'], {
    build: 'development',
  });
  expect(developed.status).toBe(1);
  expect(developed.stderr).toMatch(/^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n/u);
  expect(
    developed.stderr.endsWith(
      `\n${hint}\n\n${line({ code: 'internal', exitCode: 1, message: 'Cannot read the value.' })}`,
    ),
  ).toBe(true);
});

test("a structural fault core raises from argv words reaches the line with its class's code", async () => {
  const cases = {
    'misplaced-option': ['flags', '--deep', 'x'],
    'missing-value': ['flags', '--tag'],
    'repeated-option': ['flags', '--tag', 'a', '--tag', 'b'],
    'unexpected-argument': ['extra', 'a'],
    'unexpected-value': ['flags', '--count=yes'],
    'unknown-option': ['flags', '--bogus'],
  };
  for (const [code, words] of Object.entries(cases)) {
    const encoded: { error: { code: string } } = JSON.parse(
      await run(words).then((fixtureResult) => fixtureResult.stderr),
    );
    expect(encoded.error.code).toBe(code);
  }
});

const brokenReasons = {
  number: 'The encoder returned number instead of a string.',
  throws: 'The encoder broke.',
};

test.each(Object.entries(brokenReasons))(
  'an encoder that %s writes the default text, then the defect by build, and exits 1',
  async (encoder, reason) => {
    await expect(run(['wire'], { encoder })).resolves.toEqual({
      status: 1,
      stderr: 'Refused.\nenc: Something went wrong.\n',
      stdout: 'exit:1\n',
    });
    const developed = await run(['wire'], { build: 'development', encoder });
    expect(developed.status).toBe(1);
    expect(developed.stderr.startsWith('Refused.\n\n-- BROKEN FAILURE ENCODER ')).toBe(true);
    expect(coreRuleParts(developed.stderr)).toEqual({
      correction: 'Return the encoded failure as a string, and throw nothing from the encoder.',
      rule: 'broken-failure-encoder',
      sentence: `Plugin "@fixture/encoding" failed to encode the failure as "application/json": ${reason}`,
    });
  },
);

test('a broken encoder in a cancelled run keeps the signal code', async () => {
  const cancelled = await run(['list', '--pick', 'json', '--how', 'cancel'], { encoder: 'throws' });
  expect(cancelled).toEqual({
    status: 130,
    stderr: 'Refused after the abort.\nenc: Something went wrong.\n',
    stdout: 'exit:130\n',
  });
});

test('a run by name calls no encoder and carries the form on its outcome', async () => {
  expect(
    JSON.parse(
      await invokeFixture(fixture, ['by-name']).then((fixtureResult) => fixtureResult.stdout),
    ),
  ).toEqual({
    encoded: 0,
    form: {
      code: 'invalid-input',
      exitCode: 2,
      hints: [],
      message: 'Option "depth": Use decimal digits.',
    },
    messages: 'enc: Option "depth": Use decimal digits.\n',
  });
});

test.each([
  [
    'taken-in-plugin',
    '@loomcli/core/failure-encoder-taken',
    'Plugin "@fixture/odd" registers two failure encoders for "application/json".',
  ],
  [
    'taken-across-plugins',
    '@loomcli/core/failure-encoder-taken',
    'Plugin "@fixture/second" registers a failure encoder for "application/json", which plugin "@fixture/first" already registers.',
  ],
])('%s is a declaration fault at its call', async (scenario, rule, sentence) => {
  await expect(
    invokeFixture(fixture, [scenario]).then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe(`DeclarationError:${rule}:${sentence}\n`);
});
