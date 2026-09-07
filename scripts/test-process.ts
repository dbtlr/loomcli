import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function invoke(
  file: URL,
  args: string[] = [],
  options: { cwd?: string; input?: string } = {},
) {
  const result = spawnSync(
    process.env.LOOM_TEST_RUNTIME ?? 'node',
    [fileURLToPath(file), ...args],
    {
      ...options,
      encoding: 'utf8',
      env: { ...process.env, LOOM_CAPTURE_TEST: 'present' },
      timeout: 10_000,
    },
  );
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
