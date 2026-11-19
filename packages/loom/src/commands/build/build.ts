import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';

import { InputError, isNpmPackageName, isPortableName, UsageError } from '@loomcli/core';
import type { ActionHandler } from '@loomcli/core';

import {
  applicationName,
  buildFacts,
  definePair,
  manifestOf,
  readManifest,
  scaffoldName,
} from '../../helpers/build-facts.js';
import type { Manifest } from '../../helpers/build-facts.js';
import { hostTarget, platformTarget } from '../../helpers/build-target.js';
import type { BuildTarget } from '../../helpers/build-target.js';
import { build, carriedFolder, watch } from '../../helpers/build.js';
import type { BuildPlan } from '../../helpers/build.js';
import { npmPlatforms, packagePaths } from '../../helpers/loom-config.js';
import type { LoomConfig, PackagePaths } from '../../helpers/loom-config.js';
import { parseManifest } from '../../helpers/manifest.js';
import { existingModule, shown } from '../../helpers/modules.js';
import { buildNpm, unownedFolder } from '../../helpers/npm-packages.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { relationOf } from '../../helpers/path-relation.js';
import { report } from '../../helpers/report.js';
import { readWorkingFile } from '../../helpers/repository.js';
import type { RunHost } from '../../helpers/run-host.js';
import { readSkillsDeclaration } from '../../helpers/skills-declaration.js';
import type { SkillsCarry } from '../../helpers/skills-declaration.js';
import type { buildCommand } from './command.js';
import {
  applicationNeedsBundle,
  built,
  carriedFolderOverlap,
  factsWithDefine,
  noNameField,
  npmDoesNotWatch,
  npmFactsPerPlatform,
  npmIsDistributed,
  npmFolderNotOwned,
  npmModeOff,
  npmOutOverlap,
  npmApplicationNameInvalid,
  npmPackageNameInvalid,
  optionLine,
  outputIsDirectory,
  repositoryNeedsRelease,
  sameEntryFile,
  skillsNotCalled,
  skillsNotLoaded,
  watchIsDevelopment,
} from './messages.js';

/** The option error one option draws from another it cannot be passed with, with exit code 2. */
function optionError(name: string, message: string): InputError {
  return new InputError(optionLine(name, message), [
    {
      input: { global: false, kind: 'option', name },
      issues: [{ message }],
      reason: 'invalid',
      spelling: `--${name}`,
    },
  ]);
}

/**
 * A `--target npm` in a package whose configuration file does not turn the launcher packages on,
 * which fails with exit code 2 before the build reads anything else, under ADR-0213.
 */
class NpmModeOffError extends UsageError {
  constructor() {
    super(npmModeOff);
    this.name = 'NpmModeOffError';
  }
}

/**
 * A `--target npm` output directory that is the package directory or holds it, which fails with
 * exit code 2 before the build compiles, under ADR-0213.
 */
class NpmOutOverlapError extends UsageError {
  constructor(out: string, relation: string, directory: string) {
    super(npmOutOverlap(out, relation, directory));
    this.name = 'NpmOutOverlapError';
  }
}

/**
 * A `--target npm` package whose `name` is outside npm's package name rule, which fails with exit
 * code 2 before the build compiles, under ADR-0213, because each package's folder is named for it.
 */
class NpmPackageNameError extends UsageError {
  constructor(name: string) {
    super(npmPackageNameInvalid(name));
    this.name = 'NpmPackageNameError';
  }
}

/**
 * A `--target npm` application name, from `--name` or the one `bin` key, that is not a portable
 * name, which fails with exit code 2 before the build compiles, because the binary's file name and
 * the launcher's bin entry are the name.
 */
class NpmApplicationNameError extends UsageError {
  constructor(name: string) {
    super(npmApplicationNameInvalid(name));
    this.name = 'NpmApplicationNameError';
  }
}

/**
 * The option errors of a `--target npm` build, which writes distributed release packages and
 * compiles one binary per platform, each with facts of its own.
 */
function refuseNpmOptions(options: {
  build: string | undefined;
  define: boolean | undefined;
  facts: boolean | undefined;
  watch: boolean | undefined;
}) {
  if (options.build === 'development') {
    throw optionError('build', npmIsDistributed);
  }
  if (options.watch) {
    throw optionError('watch', npmDoesNotWatch);
  }
  for (const option of ['facts', 'define'] as const) {
    if (options[option]) {
      throw optionError(option, npmFactsPerPlatform(option));
    }
  }
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
    throw new Error(sameEntryFile(shown(cwd, entry), shown(cwd, application), file));
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
    throw new Error(outputIsDirectory(shown(cwd, output)));
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

/**
 * The module whose `skills()` call names the skills folder: the bundle's application module, or for
 * a compile target the one `paths.application` names when it exists, since a binary compiles the
 * entry alone.
 */
function declaringModule(
  paths: PackagePaths,
  target: BuildTarget,
  application: string | undefined,
): string | undefined {
  if (target.kind === 'bundle') {
    return application;
  }
  return existsSync(paths.application) ? paths.application : undefined;
}

/**
 * A path's real path, through the nearest ancestor that exists, so a link on the way is seen. The
 * native call also answers each name in the case the file system holds it, so on a file system
 * that ignores case, such as macOS's, two spellings of one folder compare equal.
 */
function realThrough(path: string): string {
  const missing: string[] = [];
  let current = path;
  while (!existsSync(current) && dirname(current) !== current) {
    missing.unshift(basename(current));
    current = dirname(current);
  }
  return join(realpathSync.native(current), ...missing);
}

/**
 * Fails a bundle whose `loom-skills/` would be the skills folder, sit inside it, or hold it, before
 * it builds, because every bundle build removes or replaces that folder whole, a development one
 * included, and the build never writes into the source tree. Real paths are compared, so a link on
 * either side is seen.
 */
function separateCarriedFolder(cwd: string, plan: BuildPlan): void {
  if (plan.skills.kind !== 'read' || plan.target.kind !== 'bundle') {
    return;
  }
  const carried = join(plan.out, carriedFolder);
  const real = { carried: realThrough(carried), folder: realThrough(plan.skills.folder) };
  const relation = relationOf(real.carried, real.folder);
  if (relation !== undefined) {
    throw new Error(
      carriedFolderOverlap(shown(cwd, carried), relation, shown(cwd, plan.skills.folder)),
    );
  }
}

/**
 * Fails a `--target npm` build whose output directory is the package directory or holds it, with
 * code 2 before it compiles, because the build replaces each package's directory whole, and the
 * launcher's directory or a platform's could be the package directory. Real paths are compared, so
 * a link on either side is seen. An output inside the package directory, as `dist/npm` is, is
 * where the packages belong.
 */
function separateNpmOutput(cwd: string, out: string, directory: string): void {
  const relation = relationOf(realThrough(out), realThrough(directory));
  if (relation === 'is' || relation === 'holds') {
    throw new NpmOutOverlapError(shown(cwd, out), relation, shown(cwd, directory));
  }
}

/**
 * The application's name for the warning a build that read no declaration gives: its `bin` name
 * or `--name`, else the package name without its scope, else the package directory's name.
 */
function warningName(manifest: Manifest, option: string | undefined, directory: string): string {
  for (const read of [() => applicationName(manifest, option), () => scaffoldName(manifest)]) {
    try {
      return read();
    } catch {
      // A package that names no application here may name it the next way.
    }
  }
  return basename(directory);
}

/**
 * The warning of a bundle that holds the skills plugin while the build learned no folder: it could
 * not load the application module, or `skills()` did not run while it loaded.
 */
function uncarriedWarning(name: string, skills: SkillsCarry): string {
  return skills.kind === 'uncalled' ? skillsNotCalled(name) : skillsNotLoaded(name);
}

/** Reads what the build carries of the skills folder, in the run's own process. */
function skillsOf(
  run: RunHost,
  options: { cwd: string; directory: string; entry: string; module: string | undefined },
): Promise<SkillsCarry> {
  const { cwd, directory, entry, module } = options;
  return readSkillsDeclaration(run, {
    directory,
    entry,
    module,
    shown: module === undefined ? '' : shown(cwd, module),
  });
}

/** What a `--target npm` build reads from its run, beyond the package itself. */
interface NpmRequest {
  readonly config: LoomConfig;
  readonly cwd: string;
  readonly options: {
    readonly entry: string | undefined;
    readonly name: string | undefined;
    readonly out: string | undefined;
    readonly repository: string | undefined;
  };
  readonly run: RunHost;
}

/**
 * Writes the launcher package and a platform package per listed platform into `<out>/npm`, or the
 * directory `--out` names, under ADR-0213. Each binary is the one `loom build --release --target
 * bun-<platform>` compiles, whose release facts bake the launcher package's name as `npmPackage`.
 * It answers the directory it wrote, and the warning of a build that carried no skills folder.
 */
async function buildNpmPackages({ config, cwd, options, run }: NpmRequest) {
  const directory = packageDirectory(cwd);
  const source = readWorkingFile(directory, 'package.json');
  const raw = parseManifest(source, join(directory, 'package.json'));
  const manifest = manifestOf(source, join(directory, 'package.json'));
  const pkg = typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : undefined;
  if (pkg === undefined) {
    throw new Error(noNameField);
  }
  if (!isNpmPackageName(pkg)) {
    throw new NpmPackageNameError(pkg);
  }
  const appName = applicationName(manifest, options.name);
  if (!isPortableName(appName)) {
    throw new NpmApplicationNameError(appName);
  }
  const listed = new Set(config.npm?.platforms ?? npmPlatforms);
  const binaries = npmPlatforms
    .filter((platform) => listed.has(platform))
    .map((platform) => ({
      facts: buildFacts({
        build: 'distributed',
        manifest,
        name: options.name,
        release: { repository: options.repository },
        target: platformTarget(platform),
      }),
      platform,
    }));
  const version = binaries[0]?.facts.release?.version ?? '';
  const name = appName;
  const paths = packagePaths(directory, config);
  const entry = entryModule(cwd, paths, options.entry);
  const out = options.out === undefined ? join(paths.out, 'npm') : resolve(cwd, options.out);
  separateNpmOutput(cwd, out, directory);
  const unowned = unownedFolder(
    out,
    pkg,
    binaries.map(({ platform }) => platform),
  );
  if (unowned !== undefined) {
    throw new Error(npmFolderNotOwned(shown(cwd, unowned.path), unowned.name));
  }
  const module = existsSync(paths.application) ? paths.application : undefined;
  const skills = await skillsOf(run, { cwd, directory, entry, module });
  const plans = binaries.map(({ facts, platform }) => ({
    plan: {
      application: undefined,
      directory,
      entry,
      facts,
      out,
      skills,
      target: platformTarget(platform),
    },
    platform,
  }));
  const outcome = await buildNpm(
    { binaries: plans, directory, manifest: raw, name, out, pkg, version },
    run,
  );
  const warning = outcome.uncarriedSkillsPlugin
    ? uncarriedWarning(warningName(manifest, options.name, directory), skills)
    : undefined;
  return { out, warning };
}

/** Builds the package's application for one target, or prints its facts or define pair. */
export const buildApplication: ActionHandler<typeof buildCommand> = async ({
  host,
  onShutdown,
  options,
  out,
  provided,
  signal,
}) => {
  if (options.facts && options.define) {
    throw optionError('define', factsWithDefine);
  }
  if (options.application !== undefined && options.target?.kind !== 'bundle') {
    throw optionError('application', applicationNeedsBundle);
  }
  const npm = options.target?.kind === 'npm';
  if (options.repository !== undefined && !options.release && !npm) {
    throw optionError('repository', repositoryNeedsRelease);
  }
  if (npm) {
    refuseNpmOptions(options);
    if (provided.config.npm?.launcher !== true) {
      throw new NpmModeOffError();
    }
  }
  if (options.watch && options.build === 'distributed') {
    throw optionError('build', watchIsDevelopment);
  }
  await report({ out, signal }, async () => {
    const { cwd } = host;
    if (options.target?.kind === 'npm') {
      const run = { host, onShutdown, signal };
      const npmBuild = await buildNpmPackages({ config: provided.config, cwd, options, run });
      // A cancelled build undid what it wrote, so it reports nothing built.
      if (signal.aborted) {
        return '';
      }
      if (npmBuild.warning !== undefined) {
        await out.warn(npmBuild.warning);
      }
      return `${built(shown(cwd, npmBuild.out), 'npm')}\n`;
    }
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
    const run = { host, onShutdown, signal };
    const module = declaringModule(paths, target, application);
    const skills = await skillsOf(run, { cwd, directory, entry, module });
    const plan = { application, directory, entry, facts, out: output, skills, target };
    separateCarriedFolder(cwd, plan);
    if (options.watch) {
      await watch(plan, run);
      return '';
    }
    const outcome = await build(plan, run);
    // A cancelled build undid what it wrote, so it reports nothing built.
    if (signal.aborted) {
      return '';
    }
    if (outcome.uncarriedSkillsPlugin) {
      await out.warn(uncarriedWarning(warningName(manifest, options.name, directory), skills));
    }
    return `${built(shown(cwd, output), target.name)}\n`;
  });
};
