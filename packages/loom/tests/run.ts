import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import type { ProgramCall } from '@loomcli/testing';
import { z } from 'zod';

import { childEnvironment } from '../../../scripts/test-process.js';
import { loom } from '../src/application.js';
import { pnpmManifestPath } from '../src/helpers/release-files.js';
import { temporaryRoot } from './fixture.js';

/** Runs the toolchain's child programs against the fixture's real files and repositories. */
function program(call: ProgramCall) {
  const result = spawnSync(call.command, call.args, {
    cwd: call.cwd,
    env: call.env,
    input: call.input,
    maxBuffer: Number.POSITIVE_INFINITY,
    timeout: 120_000,
  });
  if (result.error) {
    throw result.error;
  }
  return { code: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
}

/** One toolchain run, with process facts and effects confined to the fixture. */
export async function run(
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; runtime?: string } = {},
) {
  const manifestPath = pnpmManifestPath();
  const manifest = z
    .object({ bin: z.object({ pnpm: z.string() }) })
    .parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const pnpm = join(dirname(manifestPath), manifest.bin.pnpm);
  const home = temporaryRoot('loom-run-home-');
  const mock = mockProcess({
    arch: process.arch,
    argv: args,
    cwd: options.cwd ?? home,
    env: childEnvironment(options.env),
    home,
    platform: process.platform,
    programs: { bun: program, git: program, [pnpm]: program },
    tmpdir: home,
  });
  await loom.run({ process: mock });
  return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
}
