import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import type { Program, ProgramCall } from '@loomcli/testing';
import { z } from 'zod';

import { childEnvironment } from '../../../scripts/test-process.js';
import { loom } from '../src/application.js';
import { pnpmManifestPath } from '../src/helpers/release-files.js';
import { temporaryRoot } from './fixture.js';

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
 * The `bun` program. From source, `loom` runs each reader's TypeScript source, because only the
 * build writes the built reader beside the bundle. A script Bun is asked to run that does not exist
 * throws, so the exit is `unstarted`, and the error joins `missing`, so `run` fails the test too:
 * `loom init` turns a read that could not start into a warning and still exits 0, which would let a
 * case pass while it skipped the writes that need the read.
 */
function bunProgram(missing: Error[]) {
  return (call: ProgramCall) => {
    const script = call.args.find((arg) => !arg.startsWith('-'));
    if (script !== undefined && isAbsolute(script) && !existsSync(script)) {
      const error = new Error(`The bun program was asked to run ${script}, which does not exist.`);
      missing.push(error);
      throw error;
    }
    return spawnProgram(call.command, call.args, call);
  };
}

/**
 * A stand-in for one Bun call, which answers in place of the real Bun or hands the call to it, so
 * a test can stub a compile it does not need to run.
 */
export type BunStandIn = (call: ProgramCall, real: Program) => ReturnType<Program>;

/**
 * One toolchain run, with process facts and effects confined to the fixture. `pnpm`, when given,
 * answers in place of the installed pnpm, and `bun` stands in for each Bun call.
 */
export async function run(
  args: string[] = [],
  options: {
    bun?: BunStandIn;
    ceiling?: string;
    cwd?: string;
    env?: Record<string, string | undefined>;
    pnpm?: Program;
  } = {},
) {
  const manifestPath = pnpmManifestPath();
  const manifest = z
    .object({ bin: z.object({ pnpm: z.string() }) })
    .parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const pnpm = join(dirname(manifestPath), manifest.bin.pnpm);
  const home = temporaryRoot('loom-run-home-');
  const missing: Error[] = [];
  const bun = bunProgram(missing);
  const { bun: standIn } = options;
  const mock = mockProcess({
    arch: process.arch,
    argv: args,
    ...(options.ceiling === undefined ? {} : { ceiling: options.ceiling }),
    cwd: options.cwd ?? home,
    env: childEnvironment(options.env),
    home,
    platform: process.platform,
    programs: {
      bun: standIn === undefined ? bun : (call) => standIn(call, bun),
      git: program,
      [pnpm]: options.pnpm ?? program,
    },
    tmpdir: home,
  });
  await loom.run({ process: mock });
  const [unstarted] = missing;
  if (unstarted !== undefined) {
    throw unstarted;
  }
  return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
}
