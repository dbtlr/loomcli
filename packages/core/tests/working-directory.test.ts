import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

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

test('a malformed call is reported from a working directory that cannot be read, which is read once', () => {
  expect(report('malformed')).toEqual({
    calls: [],
    form: { code: 'internal', exitCode: 1, hints: [], message: 'Something went wrong.' },
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
