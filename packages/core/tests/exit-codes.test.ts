import { describe, expect, it, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function exits(scenario: string, env: Record<string, string> = {}) {
  return invoke(new URL('fixtures/exit-codes.mjs', import.meta.url), [scenario], { env });
}

/** The correction every reserved-code diagnostic ends with. */
const correction = 'Declare a whole number from 1 through 125.';

test('a declared code decides the exit status, and the view reads it on the instance', () => {
  expect(exits('declared')).toEqual({
    status: 69,
    stderr: '69: The registry answered 503.\n',
    stdout: 'resolved:69\n',
  });
});

test('a subclass that declares nothing exits with the nearest declared code', () => {
  expect(exits('inherited')).toEqual({
    status: 69,
    stderr: 'The registry answered 504.\n',
    stdout: 'resolved:69\n',
  });
  expect(exits('undeclared')).toEqual({
    status: 1,
    stderr: 'Config is unreadable.\n',
    stdout: 'resolved:1\n',
  });
});

test('a class reads its code without an instance', () => {
  expect(JSON.parse(exits('statics').stdout)).toEqual({
    ConfigError: 1,
    InputError: 2,
    LoomError: 1,
    RegistryTimeoutError: 69,
    RegistryUnavailableError: 69,
    UsageError: 2,
  });
});

test('a class that declares 2 outside UsageError takes no usage prefix and no usage override', () => {
  expect(exits('strict')).toEqual({
    status: 2,
    stderr: 'Strict mode refused the value.\n',
    stdout: 'resolved:2\n',
  });
});

test.each([
  ['SuccessError', 'declares exit code 0.'],
  ['ShellError', 'declares exit code 126.'],
  ['InterruptError', 'declares exit code 130.'],
  ['FractionError', 'declares exit code 3.5.'],
  ['StringError', 'declares an exit code that is not a finite number.'],
  ['NaNError', 'declares an exit code that is not a finite number.'],
  ['InfinityError', 'declares an exit code that is not a finite number.'],
])('%s throws a DeclarationError at construction', (name, clause) => {
  const message = `Failure class "${name}" ${clause} ${correction}`;
  // Outside a run the construction throws at that line.
  expect(exits('construct', { FIXTURE_CLASS: name })).toEqual({
    status: 0,
    stderr: '',
    stdout: `thrown:DeclarationError:1: ${message}\n`,
  });
  // Inside a run the fault is a defect a distributed build reports generically, with code 1.
  expect(exits('reserved', { FIXTURE_CLASS: name })).toEqual({
    status: 1,
    stderr: `exits: Something went wrong.\n`,
    stdout: 'resolved:1\n',
  });
});

/** A value that inherits from a failure class without being constructed is a defect, reported generically. */
const unconstructed = 'exits: Something went wrong.\n';

describe.each(['action', 'middleware', 'source'])('a failure raised from a %s', (where) => {
  function tampered(variant: string, value?: unknown) {
    return exits('tampered', {
      FIXTURE_CASE: variant,
      FIXTURE_WHERE: where,
      ...(value === undefined ? {} : { FIXTURE_VALUE: JSON.stringify(value) }),
    });
  }

  it.each([200, 300, 0, '69', 'abc'])(
    'rejects a strict-mode assignment of %j to its exitCode as an internal error',
    (value) => {
      const result = tampered('assigned', value);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('exits: Something went wrong.\n');
      expect(result.stderr).not.toContain('The registry answered 503.');
    },
  );

  it.each([200, 0, '69', 'abc'])(
    'ignores a sloppy-mode assignment of %j and exits with its class code',
    (value) => {
      expect(tampered('assigned-sloppy', value)).toMatchObject({
        status: 69,
        stderr: 'The registry answered 503.\n',
      });
    },
  );

  it.each([65, 200, 0, '69'])(
    'keeps its class code when a subclass instance field shadows exitCode with %j',
    (value) => {
      expect(tampered('field', value)).toMatchObject({ status: 1, stderr: 'Shadowed.\n' });
    },
  );

  it.each(['created', 'reprototyped', 'foreign'])(
    'reports a %s object that was never constructed as an internal error with code 1',
    (variant) => {
      expect(tampered(variant, 75)).toMatchObject({ status: 1, stderr: unconstructed });
    },
  );
});

test('one class keeps the code captured at its first construction', () => {
  // A static reassigned between two constructions leaves both instances with the first code.
  expect(exits('captured', { FIXTURE_CASE: 'reassigned' })).toEqual({
    status: 69,
    stderr: 'Second.\n',
    stdout: 'instances:69,69\nresolved:69\n',
  });
  // A static getter is read once, so a second read's answer never reaches a failure.
  expect(exits('captured', { FIXTURE_CASE: 'flipping' })).toEqual({
    status: 69,
    stderr: 'Second.\n',
    stdout: 'instances:69,69\nresolved:69\n',
  });
  // A reserved static written after construction reaches neither the instance nor the process.
  expect(exits('captured', { FIXTURE_CASE: 'mutated' })).toEqual({
    status: 69,
    stderr: 'Mutated.\n',
    stdout: 'instance:69\nresolved:69\n',
  });
});

test('a static getter that throws reports its error as an internal error with code 1', () => {
  expect(exits('unreadable')).toEqual({
    status: 1,
    stderr: 'exits: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});

test('overwriting the statics of core classes changes no code core resolves', () => {
  expect(exits('core-statics', { FIXTURE_CASE: 'fatal' })).toEqual({
    status: 1,
    stderr: 'Stopped.\n',
    stdout: 'resolved:1\n',
  });
  // A subclass that declares nothing reads its core ancestor's captured code.
  expect(exits('core-statics', { FIXTURE_CASE: 'fatal', FIXTURE_THROWN: 'subclass' })).toEqual({
    status: 1,
    stderr: 'Config is unreadable.\n',
    stdout: 'resolved:1\n',
  });
  expect(
    invoke(new URL('fixtures/exit-codes.mjs', import.meta.url), ['core-statics', 'bogus'], {
      env: { FIXTURE_CASE: 'usage' },
    }),
  ).toEqual({
    status: 2,
    stderr: 'exits: Unknown command "bogus". Use one of: known.\n',
    stdout: 'resolved:2\n',
  });
  // The DeclarationError a reserved code raises keeps code 1 and constructs without recursion.
  expect(exits('core-statics', { FIXTURE_CASE: 'declaration' })).toEqual({
    status: 1,
    stderr: `exits: Something went wrong.\n`,
    stdout: 'resolved:1\n',
  });
});

test('a middleware that throws the class before next() exits with its code', () => {
  expect(exits('middleware')).toEqual({
    status: 69,
    stderr: 'The registry answered 503.\n',
    stdout: 'resolved:69\n',
  });
});

test('a cancelled run resolves the signal code over the declared one', () => {
  expect(exits('cancelled')).toEqual({
    status: 130,
    stderr: 'The registry answered 503.\n',
    stdout: 'resolved:130\n',
  });
});

test('a broken view of the class falls back to the default text and returns 1', () => {
  expect(exits('broken')).toEqual({
    status: 1,
    stderr: 'The registry answered 503.\nexits: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});

test('core exports the fifteen sysexits names with their values and no EX_OK', () => {
  expect(JSON.parse(exits('exports').stdout)).toEqual({
    EX_CANTCREAT: 73,
    EX_CONFIG: 78,
    EX_DATAERR: 65,
    EX_IOERR: 74,
    EX_NOHOST: 68,
    EX_NOINPUT: 66,
    EX_NOPERM: 77,
    EX_NOUSER: 67,
    EX_OSERR: 71,
    EX_OSFILE: 72,
    EX_PROTOCOL: 76,
    EX_SOFTWARE: 70,
    EX_TEMPFAIL: 75,
    EX_UNAVAILABLE: 69,
    EX_USAGE: 64,
  });
});
