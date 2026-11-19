import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';

import { object, record, string, unknown } from 'valibot';

import { bunBuildFailed, watchExited } from '../commands/build/messages.js';
import { definePair } from './build-facts.js';
import type { BuildFacts } from './build-facts.js';
import type { BuildTarget } from './build-target.js';
import { superviseBun } from './bun.js';
import { parseJsonFile } from './manifest.js';
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

/**
 * The index a carried copy holds beside its skills, naming each skill's files and their executable
 * bits. A skill name holds no `.`, so no skill's folder takes the name.
 */
const carriedIndex = 'index.json';

/**
 * The format of `__LOOM_SKILLS__` and of a carried copy's index this `loom` writes, which the skills
 * plugin at its version reads.
 */
const carriedFormat = 1;

/**
 * What the build bakes into `__LOOM_SKILLS__`: that it read nothing, that it found no folder, the
 * source folder for a development build, or for a distributed one that it carried a copy in
 * `loom-skills/`, whose index names the files. Neither the files nor their names pass through the
 * define, whose one command-line argument a large folder would overflow.
 */
function skillsDefine(plan: BuildPlan): string {
  return `__LOOM_SKILLS__=${JSON.stringify(carriedValue(plan))}`;
}

/**
 * The value of `__LOOM_SKILLS__` for a plan, before it is written as JSON. A module whose load ran
 * no `skills()` call named no folder as it loaded, so its build carries `none`.
 */
function carriedValue({ facts, skills }: BuildPlan) {
  if (skills.kind === 'unread') {
    return { format: carriedFormat, kind: 'unread' };
  }
  if (skills.kind !== 'read') {
    return { format: carriedFormat, kind: 'none' };
  }
  if (facts.build === 'development') {
    return { folder: skills.folder, format: carriedFormat, kind: 'source' };
  }
  return { format: carriedFormat, kind: 'carried' };
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
  /**
   * The build read no declaration, or read one in which `skills()` did not run, and the bundle it
   * made holds the skills plugin.
   */
  readonly uncarriedSkillsPlugin: boolean;
}

/**
 * Copies the judged files of the skills the plan carries into `loom-skills/` under a directory,
 * links followed, so the copy holds each file's bytes whatever the source folder links to, and
 * writes the index that names each skill's files with their executable bits, because an embedded
 * file keeps no mode.
 */
function stageSkills(plan: BuildPlan, directory: string): void {
  if (plan.skills.kind !== 'read') {
    return;
  }
  const { folder, skills } = plan.skills;
  // A folder that holds no skill beside listed ones carries an index of none, which replaces the last.
  mkdirSync(join(directory, carriedFolder), { recursive: true });
  writeFileSync(
    join(directory, carriedFolder, carriedIndex),
    `${JSON.stringify({ format: carriedFormat, skills })}\n`,
  );
  for (const { files, name } of skills) {
    for (const { path } of files) {
      const parts = path.split('/');
      const target = join(directory, carriedFolder, name, ...parts);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(folder, name, ...parts), target);
    }
  }
}

/**
 * Has a node bundle's entry turn on Node's compile cache before the rest of the bundle loads, so an
 * operator's later runs skip compiling it. The cache applies only to modules loaded after it is
 * turned on, and an entry's static imports load before its body runs, so the entry Bun wrote moves,
 * unchanged, to a chunk named for its content, and the entry's file becomes a module that turns on
 * the cache and then imports that chunk. Bun's own output stays as Bun wrote it, so the entry still
 * reads as the main module. A shebang on the first line and the file's mode stay on the entry's
 * file. Node keeps the cache where it documents, and an operator turns it off or moves it through
 * Node's own variables. Bun running the bundle answers the call with a cache of its own in the same
 * place under the same variables, and a Node without the call skips it.
 */
function cacheEntry(plan: BuildPlan, written: string): void {
  const entry = join(written, `${parse(plan.entry).name}.js`);
  const code = readFileSync(entry, 'utf8');
  const chunk = `chunk-${createHash('sha256').update(code).digest('hex').slice(0, 8)}.js`;
  renameSync(entry, join(written, chunk));
  const shebang = /^#!.*\n/u.exec(code)?.[0] ?? '';
  writeFileSync(
    entry,
    `${shebang}import module from 'node:module';\n\nmodule.enableCompileCache?.();\nawait import('./${chunk}');\n`,
  );
  // The entry keeps the mode Bun gave it, so an entry with a shebang still runs as a program.
  chmodSync(entry, statSync(join(written, chunk)).mode);
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
      const parsed = parseJsonFile(readFileSync(manifest, 'utf8'), manifest);
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
 * files into its directory, each replacing the file of the same name. A bundle's `loom-skills/` is
 * the build's own folder, so the earlier one is removed whole, and the new copy, when the build
 * carries one, takes its place, so a skill the source dropped, a folder the declaration stopped
 * naming, and a development build after a distributed one leave no stale copy.
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
  rmSync(join(plan.out, carriedFolder), { force: true, recursive: true });
  if (carriesCopy(plan)) {
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
      // A directory that holds anything refuses removal in the same call.
      // So a build running beside this one that fills it at any moment keeps it. One already gone is no longer ours to remove.
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
 * Runs Bun for the plan in `staging`, its working directory, writing the artifact to `out`, and
 * answers whether the artifact holds the skills plugin while the build carried no folder for it, or
 * `undefined` once the run is cancelled. A distributed binary's copy of the skills folder is staged
 * in Bun's working directory and embedded with `--asset`, and a bundle's beside its chunks. A build
 * that read no declaration, or one in which `skills()` did not run, asks Bun for its metafile there,
 * to learn whether the artifact holds the skills plugin. A Bun that fails fails the build with its
 * report.
 */
async function bunWrite(
  plan: BuildPlan,
  staging: string,
  out: string,
  run: RunHost,
): Promise<BuildOutcome | undefined> {
  const compiles = plan.target.kind === 'compile';
  const extra: string[] = [];
  if (carriesCopy(plan)) {
    stageSkills(plan, compiles ? staging : out);
    // Bun embeds the folder at its path relative to its working directory, beside the program.
    extra.push(...(compiles ? ['--asset', carriedFolder] : []));
  }
  const listed = join(staging, 'metafile.json');
  const unnamed = plan.skills.kind === 'unread' || plan.skills.kind === 'uncalled';
  extra.push(...(unnamed ? [`--metafile=${listed}`] : []));
  const result = await superviseBun(
    bunArguments(plan, out, extra),
    staging,
    'collect',
    run,
    bunEnvironment(plan, run.host.env),
  );
  if (run.signal.aborted) {
    return undefined;
  }
  if (result.code !== 0) {
    throw new Error(bunBuildFailed(result.output.trim()));
  }
  return { uncarriedSkillsPlugin: existsSync(listed) && holdsSkillsPlugin(listed, staging) };
}

/**
 * Runs `work` in a temporary directory inside `outDirectory`, which it creates when it is missing,
 * and answers what `work` answers. Work that fails, or answers `undefined` because the run was
 * cancelled, is undone: the temporary directory is removed, and so is each output directory it
 * created that nothing else has filled, so earlier output and the work of a build running beside it
 * stay as they were. A shutdown that ends before the work does undoes it synchronously. The
 * temporary directory is removed whatever happens.
 */
async function staged<Result>(
  outDirectory: string,
  run: RunHost,
  work: (staging: string) => Promise<Result | undefined>,
): Promise<Result | undefined> {
  const created = mkdirSync(outDirectory, { recursive: true });
  const staging = mkdtempSync(join(outDirectory, '.loom-build-'));
  const undo = () => {
    rmSync(staging, { force: true, recursive: true });
    removeCreatedDirectories(outDirectory, created);
  };
  const removeUndo = run.onShutdown(undo);
  try {
    const result = await work(staging);
    if (result === undefined) {
      undo();
    }
    return result;
  } catch (error) {
    undo();
    throw error;
  } finally {
    removeUndo();
    rmSync(staging, { force: true, recursive: true });
  }
}

/**
 * Builds the plan's artifact into a temporary directory beside the output, on the same file
 * system, and moves each file it wrote into place only once the whole build succeeded, replacing
 * the file of the same name. Bun runs in that temporary directory, so the temporary file a binary's
 * compile writes into Bun's working directory lands there too, and builds that run at once in one
 * package never share one. Bun writes its output into `out/` there, and only that moves. A node
 * bundle's entry then turns on Node's compile cache. A failed or cancelled build is undone as
 * `staged` undoes it, so earlier output and every file the build does not write stay as they were.
 * The moves are synchronous, so a signal that arrives during them is handled once they complete,
 * and output is never partly replaced.
 */
async function build(plan: BuildPlan, run: RunHost): Promise<BuildOutcome> {
  const outcome = await staged(outputDirectory(plan), run, async (staging) => {
    const written = join(staging, 'out');
    const out = plan.target.kind === 'compile' ? join(written, basename(plan.out)) : written;
    const wrote = await bunWrite(plan, staging, out, run);
    if (wrote === undefined) {
      return undefined;
    }
    if (plan.target.kind === 'bundle' && plan.target.name === 'node') {
      cacheEntry(plan, written);
    }
    moveIntoPlace(plan, written);
    return wrote;
  });
  return outcome ?? { uncarriedSkillsPlugin: false };
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
    throw new Error(watchExited(result.code));
  }
}

export type { BuildOutcome, BuildPlan };
export { build, bunWrite, carriedFolder, removeCreatedDirectories, staged, watch };
