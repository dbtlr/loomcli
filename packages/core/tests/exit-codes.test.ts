import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for declared exit codes (docs/core/failures.md#declared-exit-codes).
 *
 * Declared exit codes are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Declared. A `FatalError` subclass that declares `EX_UNAVAILABLE`, thrown from an action, exits
 *   69 and renders through its own override, whose view reads `failure.exitCode` as 69.
 * - Inherited. A subclass of that class that declares nothing exits 69, a `FatalError` subclass
 *   that declares nothing exits 1, and `LoomError.exitCode`, `UsageError.exitCode`, and
 *   `InputError.exitCode` read 1, 2, and 2 without an instance.
 * - Reserved. A JavaScript class that declares 130 exits 130. The negative type checks reject 0,
 *   126, and a plain `number` on the class line, a subclass property override of `exitCode`
 *   (TS2610), and an assignment to it (TS2540).
 * - Middleware. A middleware that throws the class before calling `next()` exits 69.
 * - Configuration source. A resolver that throws or rejects with the class exits 69 and reports
 *   nothing under `--help`; one that calls `out.fatal()` exits 1 with the message alone; a plain
 *   `Error` that no translator answers stays the plugin fault with code 1; and the class thrown
 *   from a getter on the answers record or from an answer's `value` getter stays the plugin fault
 *   with code 1.
 * - Cancellation. An action that throws the class after a caller abort resolves 130.
 * - Broken view. An override of the class that throws writes the class's default text and the
 *   internal-error line through the fallback path, and the run returns 1.
 * - Exports. The fifteen constants hold their `sysexits.h` values, `EX_OK` is absent, and
 *   `FailureExitCode` accepts 1 and 125 and rejects 0 and 126.
 * - Example. `jsonkit get missing -f doc.json` and `jsonkit keys missing -f doc.json` exit 65, as
 *   the failure example coverage pins.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

async function exits(scenario: string, env: Record<string, string> = {}) {
  return await invokeFixture(new URL('fixtures/exit-codes.mjs', import.meta.url), [scenario], {
    env,
  });
}

test('a declared code decides the exit status, and the view reads it on the instance', async () => {
  await expect(exits('declared')).resolves.toEqual({
    status: 69,
    stderr: '69: The registry answered 503.\n',
    stdout: 'resolved:69\n',
  });
});

test('a subclass that declares nothing exits with the nearest declared code', async () => {
  await expect(exits('inherited')).resolves.toEqual({
    status: 69,
    stderr: 'The registry answered 504.\n',
    stdout: 'resolved:69\n',
  });
  await expect(exits('undeclared')).resolves.toEqual({
    status: 1,
    stderr: 'Config is unreadable.\n',
    stdout: 'resolved:1\n',
  });
});

test('a class reads its code without an instance', async () => {
  expect(JSON.parse(await exits('statics').then((fixtureResult) => fixtureResult.stdout))).toEqual({
    ConfigError: 1,
    InputError: 2,
    LoomError: 1,
    RegistryTimeoutError: 69,
    RegistryUnavailableError: 69,
    UsageError: 2,
  });
});

test('a class that declares 2 outside UsageError takes no usage prefix and no usage override', async () => {
  await expect(exits('strict')).resolves.toEqual({
    status: 2,
    stderr: 'Strict mode refused the value.\n',
    stdout: 'resolved:2\n',
  });
});

test('a JavaScript class that declares a code the types reserve exits with that code', async () => {
  await expect(exits('reserved')).resolves.toEqual({
    status: 130,
    stderr: 'Interrupted by the application.\n',
    stdout: 'resolved:130\n',
  });
});

test('a middleware that throws the class before next() exits with its code', async () => {
  await expect(exits('middleware')).resolves.toEqual({
    status: 69,
    stderr: 'The registry answered 503.\n',
    stdout: 'resolved:69\n',
  });
});

test('a cancelled run resolves the signal code over the declared one', async () => {
  await expect(exits('cancelled')).resolves.toEqual({
    status: 130,
    stderr: 'The registry answered 503.\n',
    stdout: 'resolved:130\n',
  });
});

test('a broken view of the class falls back to the default text and returns 1', async () => {
  await expect(exits('broken')).resolves.toEqual({
    status: 1,
    stderr: 'The registry answered 503.\nexits: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});

test('core exports the fifteen sysexits names with their values and no EX_OK', async () => {
  expect(JSON.parse(await exits('exports').then((fixtureResult) => fixtureResult.stdout))).toEqual({
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
