import type { Application, RunOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockFields } from '@loomcli/testing';

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
  options: Omit<RunOptions, 'process'> = {},
): Promise<Outcome> {
  const mock = mockProcess(fields);
  await application.run({ ...options, process: mock });
  const status = mock.exitCode;
  if (status === undefined) {
    throw new Error('The application run did not record its exit code.');
  }
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}
