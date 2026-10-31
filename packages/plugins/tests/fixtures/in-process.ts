import type { Writable } from 'node:stream';

import type { Application, ProcessHandle, RunOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockFields, MockProcess } from '@loomcli/testing';

export interface Outcome {
  status: number;
  stdout: string;
  stderr: string;
}
export type FixtureRun = (
  args?: string[],
  env?: Record<string, string | undefined>,
) => Promise<Outcome>;

/** Run an application on sealed facts and return only the process effects it recorded. */
export async function runOnMock(
  application: Pick<Application, 'run'>,
  fields: MockFields = {},
  options: Omit<RunOptions, 'process'> & {
    stdout?: Writable;
    afterRun?: (mock: MockProcess) => void;
  } = {},
): Promise<Outcome> {
  const mock = mockProcess(fields);
  const { stdout, afterRun, ...runOptions } = options;
  // The large-sequence fixture deliberately sends the rendered table to a sink.
  const handle: ProcessHandle =
    stdout === undefined
      ? mock
      : {
          ...mock,
          get exitCode() {
            return mock.exitCode;
          },
          set exitCode(value) {
            mock.exitCode = value;
          },
          stdout,
        };
  await application.run({ ...runOptions, process: handle });
  const status = mock.exitCode;
  if (status === undefined) {
    throw new Error('The application run did not record its exit code.');
  }
  afterRun?.(mock);
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}
