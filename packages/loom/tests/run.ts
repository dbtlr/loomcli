import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mockProcess } from '@loomcli/testing';
import type { ProgramCall } from '@loomcli/testing';
import { z } from 'zod';

import { childEnvironment } from '../../../scripts/test-process.js';
import { loom } from '../src/application.js';
import { pnpmManifestPath } from '../src/helpers/release-files.js';
import { temporaryRoot } from './fixture.js';

/**
 * The script `loom init` runs under Bun to read an application module's exports.
 * `src/helpers/application-exports.ts` names `read-application.js` beside itself, which exists in
 * `dist` beside the built bundle but not in `src/helpers` beside the source, so the `bun` program
 * runs `src/read-application.ts` in its place, as Bun runs TypeScript directly.
 */
const sourceReader = {
  built: fileURLToPath(new URL('../src/helpers/read-application.js', import.meta.url)),
  source: fileURLToPath(new URL('../src/read-application.ts', import.meta.url)),
};

/** Runs one of the toolchain's child programs against the fixture's real files and repositories. */
function spawnProgram(command: string, args: readonly string[], call: ProgramCall) {
  const result = spawnSync(command, args, {
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

/** Runs git or pnpm as the run named it. */
function program(call: ProgramCall) {
  return spawnProgram(call.command, call.args, call);
}

/**
 * The `bun` program, which runs the source reader in place of the built one. A script Bun is asked
 * to run that does not exist throws, so the exit is `unstarted`, and the error joins `missing`, so
 * `run` fails the test too: `loom init` turns a read that could not start into a warning and still
 * exits 0, which would let a case pass while it skipped the writes that need the read.
 */
function bunProgram(missing: Error[]) {
  return (call: ProgramCall) => {
    const args = call.args.map((arg) => (arg === sourceReader.built ? sourceReader.source : arg));
    const script = args.find((arg) => !arg.startsWith('-'));
    if (script !== undefined && isAbsolute(script) && !existsSync(script)) {
      const error = new Error(`The bun program was asked to run ${script}, which does not exist.`);
      missing.push(error);
      throw error;
    }
    return spawnProgram(call.command, args, call);
  };
}

/** One toolchain run, with process facts and effects confined to the fixture. */
export async function run(
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
  const manifestPath = pnpmManifestPath();
  const manifest = z
    .object({ bin: z.object({ pnpm: z.string() }) })
    .parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const pnpm = join(dirname(manifestPath), manifest.bin.pnpm);
  const home = temporaryRoot('loom-run-home-');
  const missing: Error[] = [];
  const mock = mockProcess({
    arch: process.arch,
    argv: args,
    cwd: options.cwd ?? home,
    env: childEnvironment(options.env),
    home,
    platform: process.platform,
    programs: { bun: bunProgram(missing), git: program, [pnpm]: program },
    tmpdir: home,
  });
  await loom.run({ process: mock });
  const [unstarted] = missing;
  if (unstarted !== undefined) {
    throw unstarted;
  }
  return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
}
