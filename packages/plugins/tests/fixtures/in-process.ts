import { processHandle } from '@loomcli/core';
import type { Program } from '@loomcli/testing';

/** Keep external fixture programs real while the application itself runs in-process. */
export const externalProgram: Program = async (call) => {
  const handle = processHandle({ cwd: call.cwd, env: call.env, home: call.env.HOME ?? '' });
  const exit = await handle.spawn(call.command, call.args, {
    cwd: call.cwd,
    env: call.env,
    input: call.input,
    signal: call.signal,
  }).exited;
  if (exit.kind === 'unstarted') {
    throw exit.error;
  }
  return { code: exit.code, stderr: exit.stderr.text, stdout: exit.stdout.text };
};

export interface Outcome {
  status: number;
  stdout: string;
  stderr: string;
}
export type FixtureRun = (
  args?: string[],
  env?: Record<string, string | undefined>,
) => Promise<Outcome>;
