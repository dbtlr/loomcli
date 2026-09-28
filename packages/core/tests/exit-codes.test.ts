import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function exits(scenario: string, env: Record<string, string> = {}) {
  return invoke(new URL('fixtures/exit-codes.mjs', import.meta.url), [scenario], { env });
}

/** The correction every reserved-code diagnostic ends with. */
const correction =
  'Declare a whole number from 1 through 125; 0 means success, and 126 and above belong to the shell and to signals.';

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
])('%s throws a DeclarationError at construction', (name, clause) => {
  const message = `Failure class "${name}" ${clause} ${correction}`;
  // Outside a run the construction throws at that line.
  expect(exits('construct', { FIXTURE_CLASS: name })).toEqual({
    status: 0,
    stderr: '',
    stdout: `thrown:DeclarationError:1: ${message}\n`,
  });
  // Inside a run the fault reports as a declaration failure with code 1.
  expect(exits('reserved', { FIXTURE_CLASS: name })).toEqual({
    status: 1,
    stderr: `Invalid declaration: ${message}\n`,
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
    stderr:
      'The registry answered 503.\nInternal error: Rendering the failure failed: Cannot render the failure.\n',
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
