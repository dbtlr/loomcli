import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { definePair } from './build-facts.js';
import type { BuildFacts } from './build-facts.js';
import type { BuildTarget } from './build-target.js';
import { holdingSignals, superviseBun } from './bun.js';

/**
 * The argument that has Bun read the package's `bunfig.toml`, when the package holds one. Bun reads
 * only the `bunfig.toml` in its working directory, which is a directory loom owns rather than the
 * package. `--config` takes its value after `=`, because a value after a space reads as an entry.
 */
function configArguments(directory: string): string[] {
  const bunfig = join(directory, 'bunfig.toml');
  return existsSync(bunfig) ? [`--config=${bunfig}`] : [];
}

/**
 * The `bun build` arguments that write the plan's artifact to `out`, every path among them
 * absolute, since Bun runs outside the package. A bundle splits, so each plugin's lazily loaded
 * middleware stays in a chunk of its own, and its chunks are named as `Bun.build` names them. Each
 * bundle entry point is named for its module alone, whatever directory it lives in, so the entry
 * writes `main.js` beside `application.js`. A binary compiles the entry alone.
 */
function bunArguments(plan: BuildPlan, out: string): string[] {
  const define = ['--define', definePair(plan.facts)];
  const config = configArguments(plan.directory);
  if (plan.target.kind === 'compile') {
    return [
      'build',
      ...config,
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
    ...config,
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

/** Every file under a directory, by its path relative to that directory. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
}

/** The directory a plan's output lives in: a binary's parent directory, or a bundle's directory. */
function outputDirectory(plan: BuildPlan): string {
  return plan.target.kind === 'compile' ? dirname(plan.out) : plan.out;
}

/**
 * One build, every path absolute: the package directory, whose `bunfig.toml` Bun reads, the entry,
 * the application module a bundle carries as a second bundle entry point beside the entry, the
 * target, the output, a bundle's directory or a binary's file, and the facts it bakes.
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
 * the file of the same name. Bun runs in that temporary directory, so the temporary file a binary's
 * compile writes into Bun's working directory lands there too, and builds that run at once in one
 * package never share one. A failed build removes the temporary directory and any output directory
 * it created, so earlier output and every file the build does not write stay as they were. SIGINT
 * and SIGTERM are held from before the build creates anything until it has finished or undone its
 * work. A signal stops Bun; one that arrives before the moves start cleans up as a failure does,
 * and one that arrives during them lets them complete, so output is never partly replaced. Either
 * way `loom` then ends with that signal.
 */
export async function build(plan: BuildPlan): Promise<void> {
  await holdingSignals(async (signals) => {
    const outDirectory = outputDirectory(plan);
    const created = mkdirSync(outDirectory, { recursive: true });
    const staging = mkdtempSync(join(outDirectory, '.loom-build-'));
    try {
      const out = plan.target.kind === 'compile' ? join(staging, basename(plan.out)) : staging;
      const result = await superviseBun(bunArguments(plan, out), staging, 'collect', signals);
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
 * stopped. Bun runs in a temporary directory beside the output, on the same file system, so the
 * temporary file a binary's compile writes into Bun's working directory lands there, and the watch
 * removes that directory when it ends, and the output directory it created if Bun wrote nothing
 * into it. SIGINT and SIGTERM are held for the whole watch: a signal stops Bun, the watch removes
 * what it created, and `loom` then ends with that signal. A watcher Bun ends with a failure fails
 * the command.
 */
export async function watch(plan: BuildPlan): Promise<void> {
  const result = await holdingSignals(async (signals) => {
    const outDirectory = outputDirectory(plan);
    const created = mkdirSync(outDirectory, { recursive: true });
    const workspace = mkdtempSync(join(outDirectory, '.loom-watch-'));
    try {
      const args = [...bunArguments(plan, plan.out), '--watch'];
      return await superviseBun(args, workspace, 'inherit', signals);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
      if (created !== undefined && readdirSync(outDirectory).length === 0) {
        rmSync(created, { force: true, recursive: true });
      }
    }
  });
  if (result.status !== 0 && result.status !== null) {
    throw new Error(`bun build --watch exited with ${result.status}.`);
  }
}
