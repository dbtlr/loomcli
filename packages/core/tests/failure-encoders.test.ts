import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { expectRuleParts } from './rule-parts.js';

const fixture = new URL('fixtures/failure-encoders.mjs', import.meta.url);

/** One run of the fixture application, with the encoder and the build each variant names. */
function run(
  words: string[],
  variant: {
    build?: 'development' | 'distributed';
    encoder?: string;
    env?: Record<string, string>;
  } = {},
) {
  return invoke(fixture, ['run', ...words], {
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

test('a held fault under an encoded selection writes the encoded line alone, and nothing to stdout', () => {
  expect(run(['list', '--pick', 'json', '--depth', 'x'])).toEqual({
    status: 2,
    stderr:
      '{"error":{"code":"invalid-input","exitCode":2,"message":"Option \\"--depth\\": Use decimal digits.","hints":["Run \\"enc --help\\" to see the usage."]}}\n',
    stdout: 'exit:2\n',
  });
  expect(run(['list', '--pick', 'json', '--bogus']).stderr).toBe(
    line({
      code: 'unknown-option',
      exitCode: 2,
      message:
        'Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".',
    }),
  );
});

test('an action failure after rows writes the rows on stdout and the line alone on stderr', () => {
  expect(run(['list', '--pick', 'json'])).toEqual({
    status: 1,
    stderr: line({ code: 'fatal', exitCode: 1, message: 'The key "b" is refused.' }),
    stdout: '{"key":"a"}\nexit:1\n',
  });
});

/** The incomplete-result line for the `list` Command and its two counts. */
function incomplete(yielded: number, written: number): string {
  return `Output is incomplete: Command "list" stopped after ${String(yielded)} rows, ${String(written)} written.\n`;
}

test('a stream cancelled mid-sequence under an encoded selection writes the incomplete-result line, because no encoder writes a failure', () => {
  expect(run(['list', '--pick', 'json', '--how', 'stream-cancel'])).toEqual({
    status: 130,
    stderr: incomplete(1, 1),
    stdout: '{"key":"a"}\nexit:130\n',
  });
});

test('a stdout that fails with EPIPE under an encoded selection writes the incomplete-result line beside its plain fallback report', () => {
  expect(run(['list', '--pick', 'json'], { env: { FIXTURE_STDOUT: 'epipe' } })).toEqual({
    status: 1,
    stderr: `${incomplete(1, 0)}enc: Something went wrong.\n`,
    stdout: 'exit:1\n',
  });
});

test('a broken encoder after rows writes the incomplete-result line ahead of the default text', () => {
  expect(run(['list', '--pick', 'json'], { encoder: 'throws' })).toEqual({
    status: 1,
    stderr: `${incomplete(1, 1)}The key "b" is refused.\nenc: Something went wrong.\n`,
    stdout: '{"key":"a"}\nexit:1\n',
  });
});

test('a selection that declares no encoded media type writes its text as before', () => {
  const table = run(['list']);
  expect(table.stdout).toBe('{"key":"a"}\nexit:1\n');
  expect(table.stderr).toBe(
    'Output is incomplete: Command "list" stopped after 1 rows, 1 written.\nbranded: The key "b" is refused.\n',
  );
  expect(run(['list', '--depth', 'x']).stderr).toBe(
    `enc: Option "--depth": Use decimal digits.\n${hint}\n`,
  );
  expect(run(['nope', '--pick', 'json']).stderr).toBe(
    `enc: Unknown command "nope". Use one of: list, wire, flags, extra.\n${hint}\n`,
  );
  expect(invoke(fixture, ['build', 'list', '--pick', 'json']).stderr).toBe(
    'enc: Something went wrong.\n',
  );
});

test('a default view that declares the media type writes the line with no selection', () => {
  expect(run(['wire'])).toEqual({
    status: 1,
    stderr: line({ code: 'fatal', exitCode: 1, message: 'Refused.' }),
    stdout: 'exit:1\n',
  });
});

test("the encoder answers ahead of the application's override, in plain text", () => {
  expect(
    run(['list', '--pick', 'json', '--how', 'fatal'], { env: { FORCE_COLOR: '1' } }).stderr,
  ).toBe(line({ code: 'fatal', exitCode: 1, message: 'The registry is down.' }));
  expect(run(['list', '--how', 'fatal']).stderr).toMatch(
    /^branded: The .*registry.* is down\.\n$/u,
  );
});

test('a defect writes the generic line from a bundle, and its Developer Diagnostic and then the line from source', () => {
  expect(run(['list', '--pick', 'json', '--how', 'defect'])).toEqual({
    status: 1,
    stderr: line({ code: 'internal', exitCode: 1, message: 'Something went wrong.' }),
    stdout: 'exit:1\n',
  });
  const developed = run(['list', '--pick', 'json', '--how', 'defect'], { build: 'development' });
  expect(developed.status).toBe(1);
  expect(developed.stderr).toMatch(/^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n/u);
  expect(
    developed.stderr.endsWith(
      `\n${hint}\n\n${line({ code: 'internal', exitCode: 1, message: 'Cannot read the value.' })}`,
    ),
  ).toBe(true);
});

test("a structural fault core raises from argv words reaches the line with its class's code", () => {
  const cases = {
    'misplaced-option': ['flags', '--deep', 'x'],
    'missing-value': ['flags', '--tag'],
    'repeated-option': ['flags', '--tag', 'a', '--tag', 'b'],
    'unexpected-argument': ['extra', 'a'],
    'unexpected-value': ['flags', '--count=yes'],
    'unknown-option': ['flags', '--bogus'],
  };
  for (const [code, words] of Object.entries(cases)) {
    const encoded: { error: { code: string } } = JSON.parse(run(words).stderr);
    expect(encoded.error.code).toBe(code);
  }
});

const brokenReasons = {
  number: 'The encoder returned number instead of a string.',
  promise: 'The encoder returned a promise instead of a string.',
  throws: 'The encoder broke.',
};

test.each(Object.entries(brokenReasons))(
  'an encoder that %s writes the default text, then the defect by build, and exits 1',
  (encoder, reason) => {
    expect(run(['wire'], { encoder })).toEqual({
      status: 1,
      stderr: 'Refused.\nenc: Something went wrong.\n',
      stdout: 'exit:1\n',
    });
    const developed = run(['wire'], { build: 'development', encoder });
    expect(developed.status).toBe(1);
    expect(developed.stderr.startsWith('Refused.\n\n-- BROKEN FAILURE ENCODER ')).toBe(true);
    expectRuleParts(developed.stderr, {
      correction: 'Return the encoded failure as a string, and throw nothing from the encoder.',
      rule: 'broken-failure-encoder',
      sentence: `Plugin "@fixture/encoding" failed to encode the failure as "application/json": ${reason}`,
    });
  },
);

test('a broken encoder in a cancelled run keeps the signal code', () => {
  const cancelled = run(['list', '--pick', 'json', '--how', 'cancel'], { encoder: 'throws' });
  expect(cancelled).toEqual({
    status: 130,
    stderr: 'Refused after the abort.\nenc: Something went wrong.\n',
    stdout: 'exit:130\n',
  });
});

test('a run by name calls no encoder and carries the form on its outcome', () => {
  expect(JSON.parse(invoke(fixture, ['by-name']).stdout)).toEqual({
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
    'media-type',
    '@loomcli/core/media-type',
    'encodeFailure() received a media type that is not a string.',
  ],
  [
    'not-a-function',
    '@loomcli/core/not-a-function',
    'encodeFailure() received an encoder that is not a function.',
  ],
  [
    'not-a-list',
    '@loomcli/core/not-a-list',
    'Plugin "@fixture/odd" declares failureEncoders that are not an array.',
  ],
  [
    'foreign-entry',
    '@loomcli/core/foreign-value',
    'Plugin "@fixture/odd" holds a failure encoder entry that is not an encoding.',
  ],
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
])('%s is a declaration fault at its call', (scenario, rule, sentence) => {
  expect(invoke(fixture, [scenario]).stdout).toBe(`DeclarationError:${rule}:${sentence}\n`);
});
