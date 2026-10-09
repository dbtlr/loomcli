import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { definePair } from './build-facts.js';
import type { BuildFacts } from './build-facts.js';
import type { BuildTarget } from './build-target.js';
import { holdingSignals, superviseBun, watchBun } from './bun.js';
import type { HeldSignals } from './bun.js';

/**
 * The `bun build` arguments that write the plan's artifact to `out`. A bundle splits, so each
 * plugin's lazily loaded middleware stays in a chunk of its own, and its chunks are named as
 * `Bun.build` names them. Each bundle entry point is named for its module alone, whatever directory
 * it lives in, so the entry writes `main.js` beside `application.js`. A binary compiles the entry
 * alone.
 */
function bunArguments(plan: BuildPlan, out: string): string[] {
  const define = ['--define', definePair(plan.facts)];
  if (plan.target.kind === 'compile') {
    return [
      'build',
      plan.entry,
      '--compile',
      '--target',
      plan.target.name,
      '--outfile',
      out,
      ...define,
    ];
  }
  const entries = plan.application === undefined ? [plan.entry] : [plan.entry, plan.application];
  return [
    'build',
    ...entries,
    '--outdir',
    out,
    '--target',
    plan.target.name,
    '--splitting',
    '--entry-naming',
    '[name].[ext]',
    '--chunk-naming',
    'chunk-[hash].[ext]',
    ...define,
  ];
}

/** The names of the `.bun-build` files in a directory, which Bun's compile writes there. */
function bunBuildFiles(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.endsWith('.bun-build'));
}

/**
 * Runs Bun for the plan. A binary's compile writes a temporary `.bun-build` file into Bun's working
 * directory, the package, and leaves it there when Bun is stopped partway, so a compile removes each
 * `.bun-build` file that was not in the package before it ran, whether Bun ended well, failed, or
 * was stopped, and leaves every other file there alone.
 */
async function superviseBuild(plan: BuildPlan, out: string, signals: HeldSignals) {
  const before = plan.target.kind === 'compile' ? bunBuildFiles(plan.directory) : [];
  try {
    return await superviseBun(bunArguments(plan, out), plan.directory, 'collect', signals);
  } finally {
    if (plan.target.kind === 'compile') {
      for (const name of bunBuildFiles(plan.directory).filter((file) => !before.includes(file))) {
        rmSync(join(plan.directory, name), { force: true });
      }
    }
  }
}

/** Every file under a directory, by its path relative to that directory. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
}

/**
 * One build, every path absolute: the package directory Bun runs in, the entry, the application
 * module a bundle carries as a second bundle entry point beside the entry, the target, the output,
 * a bundle's directory or a binary's file, and the facts it bakes.
 */
export interface BuildPlan {
  readonly application: string | undefined;
  readonly directory: string;
  readonly entry: string;
  readonly facts: BuildFacts;
  readonly out: string;
  readonly target: BuildTarget;
}

/**
 * Builds the plan's artifact into a temporary directory beside the output, on the same file
 * system, and moves each file it wrote into place only once the whole build succeeded, replacing
 * the file of the same name. A failed build removes the temporary directory and any output
 * directory it created, so earlier output and every file the build does not write stay as they were.
 * SIGINT and SIGTERM are held from before the build creates anything until it has finished or
 * undone its work. A binary's compile also removes the temporary file Bun leaves in the package. A signal stops Bun; one that arrives before the moves start cleans up as a failure
 * does, and one that arrives during them lets them complete, so output is never partly replaced.
 * Either way `loom` then ends with that signal.
 */
export async function build(plan: BuildPlan): Promise<void> {
  await holdingSignals(async (signals) => {
    const outDirectory = plan.target.kind === 'compile' ? dirname(plan.out) : plan.out;
    const created = mkdirSync(outDirectory, { recursive: true });
    const staging = mkdtempSync(join(outDirectory, '.loom-build-'));
    try {
      const out = plan.target.kind === 'compile' ? join(staging, basename(plan.out)) : staging;
      const result = await superviseBuild(plan, out, signals);
      if (signals.received !== undefined) {
        rmSync(created ?? staging, { force: true, recursive: true });
        return;
      }
      if (result.status !== 0) {
        throw new Error(
          `${result.output.trim()}\n\nBun could not build the application, so no output changed.`,
        );
      }
      for (const file of filesUnder(staging)) {
        const target = plan.target.kind === 'compile' ? plan.out : join(outDirectory, file);
        mkdirSync(dirname(target), { recursive: true });
        renameSync(join(staging, file), target);
      }
    } catch (error) {
      rmSync(created ?? staging, { force: true, recursive: true });
      throw error;
    } finally {
      rmSync(staging, { force: true, recursive: true });
    }
  });
}

/**
 * Runs `bun build --watch` for the plan, writing straight to the output as Bun writes, until it is
 * stopped. A watcher Bun ends with a failure fails the command.
 */
export async function watch(plan: BuildPlan): Promise<void> {
  const status = await watchBun([...bunArguments(plan, plan.out), '--watch'], plan.directory);
  if (status !== 0 && status !== null) {
    throw new Error(`bun build --watch exited with ${status}.`);
  }
}
