import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for failure codes (docs/core/failures.md#failure-codes).
 *
 * Failure codes are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Core's codes. Each class in the table reads its code without an instance, and a failure core
 *   raises for each reaches `invoke`'s `failed.form.code` with it.
 * - Inherited. A `FatalError` subclass that declares nothing reads `fatal`, a subclass of
 *   `PathNotFoundError` that declares nothing reads `path-not-found`, and a direct `LoomError`
 *   subclass that declares nothing reads `failure`.
 * - The example. jsonkit's `PathNotFoundError` declares `path-not-found` and its `InvalidJsonError`
 *   declares `invalid-json`, and `jsonkit.invoke(['get'], { args: { path: 'missing' }, options: {
 *   file: 'doc.json' } })` reads `path-not-found` with exit 65.
 * - Invalid. Classes that declare `'Path_Not_Found'`, `''`, `'-x'`, `'a--b'`, `'path not found'`,
 *   and `42` each throw `@loomcli/core/failure-code` at construction, and an action that constructs
 *   one exits 1 with the Developer Diagnostic from source and the generic defect message from a
 *   bundle.
 * - Author faults. A `TypeError` from an action, a `ResultError`, a build fault, and an author's
 *   `InternalError` subclass that declares `'oops'` each read `internal` in both builds.
 * - Types. The negative type checks reject a numeric static `code` and a subclass whose literal
 *   code conflicts with a literal-typed parent's.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

async function codes(
  scenario: string,
  build: 'development' | 'distributed' = 'distributed',
  env: Record<string, string> = {},
) {
  return await invokeFixture(
    new URL('fixtures/failure-codes.mjs', import.meta.url),
    [scenario, build],
    { env },
  );
}

/** The correction every invalid failure code's diagnostic ends with. */
const correction =
  'Declare a kebab-case code of lowercase letters and digits, such as "registry-down".';

test("each core class reads its failure code without an instance, and an author's class inherits its parent's", async () => {
  expect(JSON.parse(await codes('statics').then((fixtureResult) => fixtureResult.stdout))).toEqual({
    BareError: 'fatal',
    DeclarationError: 'internal',
    DirectError: 'failure',
    FatalError: 'fatal',
    InputError: 'invalid-input',
    InternalError: 'internal',
    LoomError: 'failure',
    MisplacedOptionError: 'misplaced-option',
    MissingValueError: 'missing-value',
    NestedPathError: 'path-not-found',
    NonCallableCommandError: 'missing-subcommand',
    RepeatedOptionError: 'repeated-option',
    ResultError: 'internal',
    UnexpectedArgumentError: 'unexpected-argument',
    UnexpectedValueError: 'unexpected-value',
    UnknownCommandError: 'unknown-command',
    UnknownOptionError: 'unknown-option',
    UsageError: 'usage',
    WorkingDirectoryError: 'working-directory-unreadable',
  });
});

test('a failure reaches its form with the code its class declares or inherits', async () => {
  expect(
    JSON.parse(await codes('inherited').then((fixtureResult) => fixtureResult.stdout)),
  ).toEqual({
    BareError: 'fatal',
    DirectError: 'failure',
    NestedPathError: 'path-not-found',
  });
});

test("a failure core raises reaches invoke()'s form with its class's code", async () => {
  expect(
    JSON.parse(await codes('core-forms').then((fixtureResult) => fixtureResult.stdout)),
  ).toEqual({
    declaration: 'internal',
    fatal: 'fatal',
    'invalid-input': 'invalid-input',
    'missing-subcommand': 'missing-subcommand',
    'unexpected-argument': 'unexpected-argument',
    'unknown-command': 'unknown-command',
    'unknown-option': 'unknown-option',
  });
});

test.each([
  ['UnderscoreError', 'declares failure code "Path_Not_Found".'],
  ['EmptyError', 'declares failure code "".'],
  ['LeadingError', 'declares failure code "-x".'],
  ['DoubledError', 'declares failure code "a--b".'],
  ['SpacedError', 'declares failure code "path not found".'],
  ['NumericError', 'declares a failure code that is not a string.'],
])('%s throws @loomcli/core/failure-code at construction', async (name, clause) => {
  const sentence = `Failure class "${name}" ${clause}`;
  // Outside a run the construction throws at that line.
  await expect(codes('construct', 'distributed', { FIXTURE_CLASS: name })).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `thrown:DeclarationError:@loomcli/core/failure-code:${sentence}\n`,
  });
  // Inside a run a distributed build reports the defect generically, with code 1.
  await expect(codes('invalid', 'distributed', { FIXTURE_CLASS: name })).resolves.toEqual({
    status: 1,
    stderr: 'codes: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
  // A development build shows the author its Developer Diagnostic.
  const developed = await codes('invalid', 'development', { FIXTURE_CLASS: name });
  expect(developed.status).toBe(1);
  expect(developed.stderr).toContain(' @loomcli/core/failure-code\n');
  expect(developed.stderr).toContain(`\n${sentence}\n`);
  expect(developed.stderr).toContain(`\n${correction}\n`);
});

test.each(['development', 'distributed'] as const)(
  'every author fault reads internal in a %s build',
  async (build) => {
    expect(
      JSON.parse(await codes('author-faults', build).then((fixtureResult) => fixtureResult.stdout)),
    ).toEqual({
      build: 'internal',
      internal: 'internal',
      result: 'internal',
      'type-error': 'internal',
    });
  },
);
