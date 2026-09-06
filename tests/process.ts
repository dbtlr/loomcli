import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export function invoke(file: string, args: string[] = []) {
  const result = spawnSync(process.env.LOOM_TEST_RUNTIME ?? 'node', [resolve(file), ...args], {
    encoding: 'utf8',
    env: { ...process.env, LOOM_CAPTURE_TEST: 'present' },
    timeout: 10_000,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
