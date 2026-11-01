import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { object, record, string, unknown } from 'valibot';

import { definePair } from './build-facts.js';
import type { BuildFacts } from './build-facts.js';
import type { BuildTarget } from './build-target.js';
import { superviseBun } from './bun.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { RunHost } from './run-host.js';
import type { SkillsCarry } from './skills-declaration.js';

/**
 * A child a signal ended reports a code above this one, 128 plus the signal's number. A watcher a
 * signal ended was stopped, which is no failure of the watch.
 */
const signalBase = 128;

/**
 * The argument that has Bun read the package's `bunfig.toml`, when the package holds one. Bun reads
 * only the `bunfig.toml` in its working directory, which for a build is a directory loom owns rather
 * than the package. `--config` takes its value after `=`, because a value after a space reads as an
 * entry.
 */
function configArguments(directory: string): string[] {
  const bunfig = join(directory, 'bunfig.toml');
  return existsSync(bunfig) ? [`--config=${bunfig}`] : [];
}

/** The folder a distributed artifact carries its skills in, beside its chunks or its program. */
const carriedFolder = 'loom-skills';

/** The format of `__LOOM_SKILLS__` this `loom` bakes, which the skills plugin at its version reads. */
const carriedFormat = 1;

/**
 * What the build bakes into `__LOOM_SKILLS__`: that it read nothing, that it found no folder, the
 * source folder for a development build, or each carried file's path and executable bit for a
 * distributed one, whose bytes sit in `loom-skills/`. A file's bytes never pass through the define,
 * whose one command-line argument a large skill would overflow.
 */
function skillsDefine(plan: BuildPlan): string {
  return `__LOOM_SKILLS__=${JSON.stringify(carriedValue(plan))}`;
}

/** The value of `__LOOM_SKILLS__` for a plan, before it is written as JSON. */
function carriedValue({ facts, skills }: BuildPlan) {
  if (skills.kind !== 'read') {
    return { format: carriedFormat, kind: skills.kind };
  }
  if (facts.build === 'development') {
    return { folder: skills.folder, format: carriedFormat, kind: 'source' };
  }
  return { format: carriedFormat, kind: 'carried', skills: skills.skills };
}

/** Whether a build carries a copy of the skills folder: a distributed build that read one. */
function carriesCopy(plan: BuildPlan): boolean {
  return plan.skills.kind === 'read' && plan.facts.build === 'distributed';
}

/**
 * The `bun build` arguments that write the plan's artifact to `out`, every path among them
 * absolute, since Bun runs outside the package, then `extra`. A bundle splits, so each plugin's
 * lazily loaded middleware stays in a chunk of its own, and its chunks are named as `Bun.build`
 * names them. Each bundle entry point is named for its module alone, whatever directory it lives
 * in, so the entry writes `main.js` beside `application.js`. A binary compiles the entry alone. The
 * release facts and the skills folder each pass through a define of their own.
 */
function bunArguments(plan: BuildPlan, out: string, extra: readonly string[] = []): string[] {
  const define = ['--define', definePair(plan.facts), '--define', skillsDefine(plan)];
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
      ...extra,
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
    ...extra,
  ];
}

/**
 * The environment Bun builds the plan under. A distributed build sets `NODE_ENV` to `production`,
 * so Bun resolves each dependency's production export and inlines `production` for
 * `process.env.NODE_ENV`, whatever the shell holds. A development build keeps the run's
 * environment, under which Bun resolves development exports unless `NODE_ENV` says otherwise.
 */
function bunEnvironment(plan: BuildPlan, env: Readonly<Record<string, string | undefined>>) {
  return plan.facts.build === 'distributed' ? { ...env, NODE_ENV: 'production' } : env;
}

/** Every file under a directory, by its path relative to that directory. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
}

/** The `.bun-build` files a compile has written into a directory, by name. */
function bunBuildFiles(directory: string): Set<string> {
  return new Set(readdirSync(directory).filter((name) => name.endsWith('.bun-build')));
}

/** The directory a plan's output lives in: a binary's parent directory, or a bundle's directory. */
function outputDirectory(plan: BuildPlan): string {
  return plan.target.kind === 'compile' ? dirname(plan.out) : plan.out;
}

/**
 * One build, every path absolute: the package directory, whose `bunfig.toml` Bun reads, the entry,
 * the application module a bundle carries as a second bundle entry point beside the entry, the
 * target, the output, a bundle's directory or a binary's file, the facts it bakes, and what it
 * learned of the skills folder.
 */
interface BuildPlan {
  readonly application: string | undefined;
  readonly directory: string;
  readonly entry: string;
  readonly facts: BuildFacts;
  readonly out: string;
  readonly skills: SkillsCarry;
  readonly target: BuildTarget;
}

/** What a finished build reports beside its output. */
interface BuildOutcome {
  /** The build read no declaration, and the bundle it made holds the skills plugin. */
  readonly uncarriedSkillsPlugin: boolean;
}

/**
 * Copies the judged files of the skills the plan carries into `loom-skills/` under a directory,
 * links followed, so the copy holds each file's bytes whatever the source folder links to.
 */
function stageSkills(plan: BuildPlan, directory: string): void {
  if (plan.skills.kind !== 'read') {
    return;
  }
  const { folder, skills } = plan.skills;
  for (const { files, name } of skills) {
    for (const { path } of files) {
      const parts = path.split('/');
      const target = join(directory, carriedFolder, name, ...parts);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(folder, name, ...parts), target);
    }
  }
}

/** The modules Bun's metafile lists, which is all the build reads of it. */
const metafile = object({ inputs: record(string(), unknown()) });

/** A module of the skills plugin, by its path inside the `@loomcli/plugins` package. */
const skillsPluginModule = /(?:^|\/)skills\/plugin\.[jt]s$/u;

/** The name of the package whose directory holds a path, read from its nearest `package.json`. */
function packageOf(path: string, names: Map<string, string | undefined>) {
  for (let current = dirname(path); ; current = dirname(current)) {
    const manifest = join(current, 'package.json');
    if (!names.has(current) && existsSync(manifest)) {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
      const name: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'name') : undefined;
      names.set(current, typeof name === 'string' ? name : undefined);
    }
    if (names.has(current)) {
      return { directory: current, name: names.get(current) };
    }
    if (dirname(current) === current) {
      return undefined;
    }
  }
}

/**
 * Whether the bundle holds the skills plugin, as the module list Bun's metafile gives shows: a
 * module at `skills/plugin` inside the `@loomcli/plugins` package, whichever copy the package
 * resolves. Each listed path is relative to Bun's working directory.
 */
function holdsSkillsPlugin(file: string, cwd: string): boolean {
  const { inputs } = parseOrThrow(metafile, JSON.parse(readFileSync(file, 'utf8')));
  const names = new Map<string, string | undefined>();
  return Object.keys(inputs).some((input) => {
    const path = resolve(cwd, input);
    const owner = packageOf(path, names);
    return (
      owner?.name === '@loomcli/plugins' &&
      skillsPluginModule.test(relative(owner.directory, path).split(sep).join('/'))
    );
  });
}

/**
 * Moves the files Bun wrote under `written` into place: a binary onto its path, and a bundle's
 * files into its directory, each replacing the file of the same name, and its `loom-skills/`, the
 * build's own folder, replacing the earlier one whole, so a skill the source dropped leaves it.
 */
function moveIntoPlace(plan: BuildPlan, written: string): void {
  if (plan.target.kind === 'compile') {
    renameSync(join(written, basename(plan.out)), plan.out);
    return;
  }
  const carried = `${carriedFolder}${sep}`;
  for (const file of filesUnder(written).filter((path) => !path.startsWith(carried))) {
    const target = join(plan.out, file);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(join(written, file), target);
  }
  if (carriesCopy(plan)) {
    rmSync(join(plan.out, carriedFolder), { force: true, recursive: true });
    renameSync(join(written, carriedFolder), join(plan.out, carriedFolder));
  }
}

/**
 * Removes the directories a build or a watch created, from the deepest, `directory`, up to the
 * topmost, `created`, as `mkdirSync` with `recursive` reports it, stopping at the first one that
 * holds anything, because another build running at once in the package may have written into it.
 */
function removeCreatedDirectories(directory: string, created: string | undefined): void {
  if (created === undefined) {
    return;
  }
  for (let current = directory; ; current = dirname(current)) {
    try {
      rmdirSync(current);
    } catch (error) {
      // A directory that holds anything refuses removal in the same call, so a build running beside
      // This one that fills it at any moment keeps it. One already gone is no longer ours to remove.
      if (
        error instanceof Error &&
        'code' in error &&
        ['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code))
      ) {
        return;
      }
      throw error;
    }
    if (current === created || dirname(current) === current) {
      return;
    }
  }
}

/**
 * Builds the plan's artifact into a temporary directory beside the output, on the same file
 * system, and moves each file it wrote into place only once the whole build succeeded, replacing
 * the file of the same name. Bun runs in that temporary directory, so the temporary file a binary's
 * compile writes into Bun's working directory lands there too, and builds that run at once in one
 * package never share one. Bun writes its output into `out/` there, and only that moves; a
 * distributed binary's copy of the skills folder is staged in Bun's working directory beside it and
 * embedded with `--asset`, and a bundle's beside its chunks. A build that read no declaration asks
 * Bun for its metafile there, to learn whether the bundle holds the skills plugin. A failed build
 * removes the temporary directory and each output directory it created that nothing else has
 * filled, so earlier output, every file the build does not write, and the work of a build running
 * beside it stay as they were. A cancelled run stops Bun and undoes the build as a failure does,
 * and a shutdown that ends before that undoes it synchronously. The moves are synchronous, so a
 * signal that arrives during them is handled once they complete, and output is never partly
 * replaced.
 */
async function build(plan: BuildPlan, run: RunHost): Promise<BuildOutcome> {
  const outDirectory = outputDirectory(plan);
  const created = mkdirSync(outDirectory, { recursive: true });
  const staging = mkdtempSync(join(outDirectory, '.loom-build-'));
  const undo = () => {
    rmSync(staging, { force: true, recursive: true });
    removeCreatedDirectories(outDirectory, created);
  };
  const removeUndo = run.onShutdown(undo);
  try {
    const written = join(staging, 'out');
    const compiles = plan.target.kind === 'compile';
    const out = compiles ? join(written, basename(plan.out)) : written;
    const extra: string[] = [];
    if (carriesCopy(plan)) {
      stageSkills(plan, compiles ? staging : written);
      // Bun embeds the folder at its path relative to its working directory, beside the program.
      extra.push(...(compiles ? ['--asset', carriedFolder] : []));
    }
    const listed = join(staging, 'metafile.json');
    extra.push(...(plan.skills.kind === 'unread' ? [`--metafile=${listed}`] : []));
    const result = await superviseBun(
      bunArguments(plan, out, extra),
      staging,
      'collect',
      run,
      bunEnvironment(plan, run.host.env),
    );
    if (run.signal.aborted) {
      undo();
      return { uncarriedSkillsPlugin: false };
    }
    if (result.code !== 0) {
      throw new Error(
        `${result.output.trim()}\n\nBun could not build the application, so no output changed.`,
      );
    }
    const uncarriedSkillsPlugin = existsSync(listed) && holdsSkillsPlugin(listed, staging);
    moveIntoPlace(plan, written);
    return { uncarriedSkillsPlugin };
  } catch (error) {
    undo();
    throw error;
  } finally {
    removeUndo();
    rmSync(staging, { force: true, recursive: true });
  }
}

/**
 * Runs `bun build --watch` for the plan, writing straight to the output as Bun writes, until it is
 * stopped. Bun runs in the package directory, because it follows a source file that an atomic save
 * or a checkout replaces only under its working directory. A binary's compile writes a temporary
 * file into that directory, so when a compile target's watch ends the `.bun-build` files that were
 * not there before it began are removed. A bundle's watch writes none and removes none. Either way,
 * each output directory the watch created that nothing has filled is removed. A build never writes
 * a `.bun-build` file there, because it runs Bun in its own temporary directory. A cancelled run
 * stops Bun and the watch removes what it left, synchronously at a shutdown's end when that comes
 * first. A watcher Bun ends with a failure fails the command, and one a signal ended was stopped.
 */
async function watch(plan: BuildPlan, run: RunHost): Promise<void> {
  const outDirectory = outputDirectory(plan);
  const created = mkdirSync(outDirectory, { recursive: true });
  const compiles = plan.target.kind === 'compile';
  const earlier = compiles ? bunBuildFiles(plan.directory) : new Set<string>();
  const tidy = () => {
    const left = compiles ? bunBuildFiles(plan.directory) : new Set<string>();
    for (const name of left) {
      if (!earlier.has(name)) {
        rmSync(join(plan.directory, name), { force: true });
      }
    }
    removeCreatedDirectories(outDirectory, created);
  };
  const removeTidy = run.onShutdown(tidy);
  const result = await superviseBun(
    [...bunArguments(plan, plan.out), '--watch'],
    plan.directory,
    'inherit',
    run,
  ).finally(() => {
    removeTidy();
    tidy();
  });
  if (result.code !== 0 && result.code <= signalBase && !run.signal.aborted) {
    throw new Error(`bun build --watch exited with ${result.code}.`);
  }
}

export type { BuildOutcome, BuildPlan };
export { build, carriedFolder, removeCreatedDirectories, watch };
