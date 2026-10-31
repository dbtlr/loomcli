import type { Writable } from 'node:stream';

import type { Application, ProcessHandle, RunOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockFields, MockProcess } from '@loomcli/testing';

export interface Outcome {
  status: number;
  stdout: string;
  stderr: string;
}
/** Run an application on sealed facts and return only the process effects it recorded. */
export async function runOnMock(
  application: Pick<Application, 'run'>,
  fields: MockFields = {},
  options: Omit<RunOptions, 'process'> & {
    stdout?: Writable;
    stderr?: (recording: Writable) => Writable;
    publishEnv?: (name: string, value: string) => void;
    afterRun?: (mock: MockProcess) => void;
  } = {},
): Promise<Outcome> {
  const mock = mockProcess(fields);
  const { stdout, stderr, publishEnv, afterRun, ...runOptions } = options;
  // A sink or an environment publisher replaces only that effect; the mock still records the exit code.
  const handle: ProcessHandle =
    stdout === undefined && stderr === undefined && publishEnv === undefined
      ? mock
      : {
          ...mock,
          get exitCode() {
            return mock.exitCode;
          },
          set exitCode(value) {
            mock.exitCode = value;
          },
          stderr: stderr?.(mock.stderr) ?? mock.stderr,
          stdout: stdout ?? mock.stdout,
          ...(publishEnv === undefined ? {} : { publishEnv }),
        };
  const code = await application.run({ ...runOptions, process: handle });
  const status = handle === mock ? mock.exitCode : code;
  if (status === undefined) {
    throw new Error('The application run did not record its exit code.');
  }
  afterRun?.(mock);
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}
