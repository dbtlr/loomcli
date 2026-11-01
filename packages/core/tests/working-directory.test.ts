/*
 * Acceptance plan for an unreadable working directory
 * (docs/core/host.md#an-unreadable-working-directory).
 *
 * An unreadable working directory is proven when public APIs alone produce these results under Node
 * and Bun:
 *
 * - A removed directory. A process test removes its working directory and runs a fixture
 *   application's `run()`. It writes exactly `cwd: The current working directory cannot be read.
 *   Change to a directory that exists and run the command again.` and one newline to stderr, writes
 *   nothing to stdout, and exits 1.
 * - Both builds. A process whose working directory capture throws, in a distributed and a
 *   development build, writes the same line to the captured stderr and runs no hook, view override,
 *   or action.
 * - Embedding. `app.invoke([...], …)` from a process whose working directory capture throws resolves `failed` with exit
 *   1, a `WorkingDirectoryError`, the form `{ code: 'working-directory-unreadable', exitCode: 1,
 *   message, hints: [] }`, and the line in `messages`, and never rejects.
 * - Overrides. `run({ process: processHandle({ cwd }) })` and `app.invoke` with `process: processHandle({ cwd })` from a removed
 *   directory complete, and an action's `invoke` in such a run completes with its run's `cwd`.
 * - The class. `WorkingDirectoryError.code` reads `working-directory-unreadable` and
 *   `WorkingDirectoryError.exitCode` reads 1 without an instance.
 */

import { expect, test } from 'vite-plus/test';

import { invoke, invokeFromRemovedDirectory } from '../../../scripts/test-process.js';

/** The sentence a `WorkingDirectoryError` carries, which core's default text opens with the name. */
const message =
  'The current working directory cannot be read. Change to a directory that exists and run the command again.';

/** One scenario's JSON report from a process whose working directory capture throws. */
function report(scenario: string, build: 'development' | 'distributed' = 'distributed') {
  const result = invoke(new URL('fixtures/working-directory.mjs', import.meta.url), [
    scenario,
    build,
  ]);
  expect(result.stderr).toBe('');
  return { ...JSON.parse(result.stdout), status: result.status };
}

test('run() from a really removed working directory writes the line to stderr, nothing to stdout, and exits 1', () => {
  expect(
    invokeFromRemovedDirectory(new URL('fixtures/working-directory-real.mjs', import.meta.url)),
  ).toEqual({ status: 1, stderr: `cwd: ${message}\n`, stdout: '' });
});

test('the class reads its failure code and exit code without an instance, and its cause is the thrown value', () => {
  expect(report('statics')).toEqual({
    cause: true,
    code: 'working-directory-unreadable',
    exitCode: 1,
    instanceExitCode: 1,
    message,
    name: 'WorkingDirectoryError',
    status: 0,
  });
});

test.each(['distributed', 'development'] as const)(
  'run() in a %s build fails with the line on the captured stderr, reads the directory once, and runs no hook, view override, or action',
  (build) => {
    expect(report('run', build)).toEqual({
      calls: [],
      code: 1,
      exitCode: 1,
      reads: 1,
      status: 1,
      stderr: `cwd: ${message}\n`,
      stdout: '',
    });
  },
);

test('app.invoke resolves failed with the failure, its form, and the line, and reads the directory once', () => {
  expect(report('invoke')).toEqual({
    calls: [],
    cause: true,
    exitCode: 1,
    failure: 'WorkingDirectoryError',
    form: { code: 'working-directory-unreadable', exitCode: 1, hints: [], message },
    instance: true,
    message,
    messages: `cwd: ${message}\n`,
    output: '',
    reads: 1,
    status: 0,
  });
});

test('a host.cwd override replaces the capture at both doors, so neither reads the directory', () => {
  expect(report('overrides')).toEqual({
    calls: ['action:where', 'action:where'],
    named: { messages: '', output: '/srv/named\n', status: 'completed' },
    ran: { code: 0, exitCode: 0, stderr: '', stdout: '/srv/override\n' },
    reads: 0,
    status: 0,
  });
});

test("an action's invoke reads its run's working directory and captures nothing", () => {
  expect(report('action')).toEqual({
    calls: ['action:nested', 'action:where'],
    code: 0,
    exitCode: 0,
    reads: 0,
    status: 0,
    stderr: '',
    stdout: 'completed:/srv/override\n\n',
  });
});
