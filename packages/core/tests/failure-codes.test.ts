import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function codes(
  scenario: string,
  build: 'development' | 'distributed' = 'distributed',
  env: Record<string, string> = {},
) {
  return invoke(new URL('fixtures/failure-codes.mjs', import.meta.url), [scenario, build], { env });
}

/** The correction every invalid failure code's diagnostic ends with. */
const correction =
  'Declare a kebab-case code of lowercase letters and digits, such as "registry-down".';

test("each core class reads its failure code without an instance, and an author's class inherits its parent's", () => {
  expect(JSON.parse(codes('statics').stdout)).toEqual({
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

test('a failure reaches its form with the code its class declares or inherits', () => {
  expect(JSON.parse(codes('inherited').stdout)).toEqual({
    BareError: 'fatal',
    DirectError: 'failure',
    NestedPathError: 'path-not-found',
  });
});

test("a failure core raises reaches invoke()'s form with its class's code", () => {
  expect(JSON.parse(codes('core-forms').stdout)).toEqual({
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
])('%s throws @loomcli/core/failure-code at construction', (name, clause) => {
  const sentence = `Failure class "${name}" ${clause}`;
  // Outside a run the construction throws at that line.
  expect(codes('construct', 'distributed', { FIXTURE_CLASS: name })).toEqual({
    status: 0,
    stderr: '',
    stdout: `thrown:DeclarationError:@loomcli/core/failure-code:${sentence}\n`,
  });
  // Inside a run a distributed build reports the defect generically, with code 1.
  expect(codes('invalid', 'distributed', { FIXTURE_CLASS: name })).toEqual({
    status: 1,
    stderr: 'codes: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
  // A development build shows the author its Developer Diagnostic.
  const developed = codes('invalid', 'development', { FIXTURE_CLASS: name });
  expect(developed.status).toBe(1);
  expect(developed.stderr).toContain(' @loomcli/core/failure-code\n');
  expect(developed.stderr).toContain(`\n${sentence}\n`);
  expect(developed.stderr).toContain(`\n${correction}\n`);
});

test('a class keeps the code it read at its first construction', () => {
  expect(codes('reassigned').stdout).toBe('first-code,first-code\n');
});

test("a write to a core class's static changes no code core reports", () => {
  expect(codes('core-statics').stdout).toBe('unknown-command,fatal\n');
});

test.each(['development', 'distributed'] as const)(
  'every author fault reads internal in a %s build',
  (build) => {
    expect(JSON.parse(codes('author-faults', build).stdout)).toEqual({
      build: 'internal',
      internal: 'internal',
      result: 'internal',
      'type-error': 'internal',
      unconstructed: 'internal',
    });
  },
);
