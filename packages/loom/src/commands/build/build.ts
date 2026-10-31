import { existsSync, statSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';

import { InputError } from '@loomcli/core';
import type { ActionHandler } from '@loomcli/core';

import {
  applicationName,
  buildFacts,
  definePair,
  readManifest,
} from '../../helpers/build-facts.js';
import { hostTarget } from '../../helpers/build-target.js';
import type { BuildTarget } from '../../helpers/build-target.js';
import { build, watch } from '../../helpers/build.js';
import { packagePaths } from '../../helpers/loom-config.js';
import type { PackagePaths } from '../../helpers/loom-config.js';
import { existingModule, shown } from '../../helpers/modules.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import type { buildCommand } from './command.js';

/** The option error one option draws from another it cannot be passed with, with exit code 2. */
function optionError(name: string, message: string): InputError {
  return new InputError(`Option "--${name}": ${message}`, [
    {
      input: { global: false, kind: 'option', name },
      issues: [{ message }],
      reason: 'invalid',
      spelling: `--${name}`,
    },
  ]);
}

/**
 * The entry the build starts from: the one `--entry` names, else `paths.entry`, which must exist. A
 * missing module names the key when the configuration file set it, and `--entry` otherwise.
 */
function entryModule(cwd: string, paths: PackagePaths, option: string | undefined): string {
  if (option !== undefined) {
    return existingModule(cwd, resolve(cwd, option), '--entry');
  }
  const naming = paths.configured.has('entry') ? 'paths.entry' : '--entry';
  return existingModule(cwd, paths.entry, naming);
}

/**
 * The application module a bundle carries beside the entry: the one `--application` names, else the
 * one `paths.application` in the configuration file names, each of which must exist, else the
 * conventional `<source>/application.ts` when it exists. A binary compiles the entry alone, and the
 * action refuses `--application` with one before it gets here.
 */
function applicationModule(
  cwd: string,
  paths: PackagePaths,
  target: BuildTarget,
  option: string | undefined,
): string | undefined {
  if (target.kind === 'compile') {
    return undefined;
  }
  if (option !== undefined) {
    return existingModule(cwd, resolve(cwd, option), '--application');
  }
  if (paths.configured.has('application')) {
    return existingModule(cwd, paths.application, 'paths.application');
  }
  return existsSync(paths.application) ? paths.application : undefined;
}

/**
 * Fails a bundle whose entry and application module share a base name before it builds, because
 * each bundle entry point's file is named for its module alone, so the two would build to one file.
 */
function separateEntryFiles(cwd: string, entry: string, application: string | undefined) {
  const file = `${parse(entry).name}.js`;
  if (application !== undefined && `${parse(application).name}.js` === file) {
    throw new Error(
      `The entry ${shown(cwd, entry)} and the application module ${shown(cwd, application)} both build to ${file}, so rename one of them or name another module with --entry or --application.`,
    );
  }
}

/**
 * The output path a build writes: `--out`, else its default. A binary is one file, so a binary's
 * output that names an existing directory fails before anything builds, naming `--out`.
 */
function outputPath(
  cwd: string,
  paths: PackagePaths,
  target: BuildTarget,
  { name, out }: { name: () => string; out: string | undefined },
): string {
  const output = out === undefined ? defaultOutput(paths.out, target, name) : resolve(cwd, out);
  if (target.kind === 'compile' && statSync(output, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `${shown(cwd, output)} is a directory, and a binary is one file, so name the binary's file with --out.`,
    );
  }
  return output;
}

/**
 * Where a build writes when `--out` names nothing: a bundle's directory, `<out>/`, or a binary's
 * file, `<out>/<name>`, where `<out>` is `paths.out`, `dist` by convention.
 */
function defaultOutput(directory: string, target: BuildTarget, name: () => string): string {
  return target.kind === 'bundle' ? directory : join(directory, name());
}

/** Builds the package's application for one target, or prints its facts or define pair. */
export const buildApplication: ActionHandler<typeof buildCommand> = async ({
  host,
  onShutdown,
  options,
  out,
  passthrough,
  provided,
  signal,
}) => {
  if (options.facts && options.define) {
    throw optionError('define', '--facts and --define exclude each other, so pass one of them.');
  }
  if (options.application !== undefined && options.target?.kind !== 'bundle') {
    throw optionError(
      'application',
      '--application applies to a node or bun bundle, so pass --target node or --target bun with it.',
    );
  }
  if (options.repository !== undefined && !options.release) {
    throw optionError(
      'repository',
      '--repository applies to a --release build, so pass --release with it.',
    );
  }
  if (options.watch && options.build === 'distributed') {
    throw optionError(
      'build',
      '--watch builds development, so pass --watch or --build distributed.',
    );
  }
  await report({ out, passthrough, signal }, async () => {
    const { cwd } = host;
    const directory = packageDirectory(cwd);
    const manifest = readManifest(directory);
    const target = options.target ?? hostTarget(host);
    const facts = buildFacts({
      build: options.build ?? (options.watch ? 'development' : 'distributed'),
      manifest,
      name: options.name,
      release: options.release ? { repository: options.repository } : undefined,
      target,
    });
    if (options.facts) {
      return `${JSON.stringify(facts)}\n`;
    }
    if (options.define) {
      return `${definePair(facts)}\n`;
    }
    const paths = packagePaths(directory, provided.config);
    const entry = entryModule(cwd, paths, options.entry);
    const named = applicationModule(cwd, paths, target, options.application);
    // A module that is both the entry and the application module is bundled once, as the entry.
    const application = named === entry ? undefined : named;
    separateEntryFiles(cwd, entry, application);
    const output = outputPath(cwd, paths, target, {
      name: () => applicationName(manifest, options.name),
      out: options.out,
    });
    const plan = { application, directory, entry, facts, out: output, target };
    const run = { host, onShutdown, signal };
    if (options.watch) {
      await watch(plan, run);
      return '';
    }
    await build(plan, run);
    // A cancelled build undid what it wrote, so it reports nothing built.
    return signal.aborted ? '' : `Built ${shown(cwd, output)} for ${target.name}.\n`;
  });
};
