import type { Application } from '@loomcli/core';

/**
 * Throws when the application does not assemble, and returns when it does. It calls
 * `application.check()` and covers what that covers: every build rule, the input-schema converter
 * check, and every `onGraphBuilt` hook. A declared default or implied value is not run through its
 * validator, so a bad default surfaces on the application's first run.
 *
 * The thrown `Error` holds each fault's Developer Diagnostic in order, separated by a blank line,
 * under a one-sentence lead line, so the test runner prints the diagnostics and fails the test. Its
 * `cause` is the list of `DeclarationError`s. It imports no test runner, so it runs under
 * `bun test` and vitest alike.
 *
 * It takes an application in any authoring state, so a test passes the application module's export
 * as it is.
 *
 * ```ts
 * import { test } from 'bun:test'; // or: from 'vitest'
 * import { assertAssembles } from '@loomcli/testing';
 *
 * import { application } from './application.js';
 *
 * test('the application assembles', () => {
 *   assertAssembles(application);
 * });
 * ```
 */
export function assertAssembles(application: Pick<Application, 'check'>): void {
  const faults = application.check();
  const [first, second] = faults;
  if (first === undefined) {
    return;
  }
  const noun = second === undefined ? 'fault' : 'faults';
  const lead = `The application does not assemble: ${faults.length} ${noun}.`;
  const diagnostics = faults.map((fault) => fault.message);
  throw new Error([lead, ...diagnostics].join('\n\n'), { cause: faults });
}
