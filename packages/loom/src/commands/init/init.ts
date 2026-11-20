import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';

import type { ActionHandler } from '@loomcli/core';
import { confirm, select } from '@loomcli/prompts';

import { authoringSkill } from '../../content/authoring-skill.js';
import { changelogSkill } from '../../content/changelog-skill.js';
import { fragmentGuide } from '../../content/fragment-guide.js';
import { installerScript } from '../../content/installer-script.js';
import {
  applicationModule,
  applicationTest,
  entryModule,
  eslintConfig,
  newManifest,
  oxlintConfig,
  typescriptConfig,
} from '../../content/scaffold.js';
import type { ApplicationImport } from '../../content/scaffold.js';
import { readApplicationExports } from '../../helpers/application-exports.js';
import type { ApplicationExports } from '../../helpers/application-exports.js';
import {
  githubRepository,
  manifestOf,
  readManifest,
  scaffoldName,
} from '../../helpers/build-facts.js';
import { packagePaths } from '../../helpers/loom-config.js';
import type { LoomConfig, PostInstall } from '../../helpers/loom-config.js';
import { loomVersion, typescriptRange } from '../../helpers/loom-version.js';
import { driftWarning, hasDrifted, readManaged, renderManaged } from '../../helpers/managed.js';
import { parseManifest } from '../../helpers/manifest.js';
import { nearestPackageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import type { RunHost } from '../../helpers/run-host.js';
import {
  addMissingKeys,
  applicationIdentifier,
  declaredTypescript,
  existingRunner,
  isNewPackageName,
  isTypescriptAlias,
  moduleSpecifier,
  scaffoldKeys,
  scaffoldLayout,
} from '../../helpers/scaffold.js';
import type { ScaffoldLayout } from '../../helpers/scaffold.js';
import { systemErrorCode } from '../../helpers/system-error.js';
import {
  defaultTooling,
  existingLinter,
  hasLintConfig,
  lintConfigPath,
  linters,
  testRunners,
  toolRanges,
} from '../../helpers/tooling.js';
import type { Linter, TestRunner, Tooling } from '../../helpers/tooling.js';
import type { init, Piece } from './command.js';
import {
  addedKey,
  cannotRead,
  cannotRemove,
  cannotWrite,
  createPackageQuestion,
  fileInTheWay,
  installerWithoutRepository,
  invalidDirectoryName,
  linterQuestion,
  notEmptyWithoutPackage,
  plainTypescript,
  removedFile,
  staleSkillFile,
  testRunnerQuestion,
  unexportedApplication,
  unloadedApplication,
  unreadReason,
  wroteFile,
} from './messages.js';

/** The pieces that read the application's name from `package.json`. */
const namedPieces: readonly Piece[] = ['package', 'application', 'entry', 'test', 'install'];

/** The compiler configuration the `check` script's `tsc --noEmit` runs against. */
const typescriptConfigPath = 'tsconfig.json';

/** The changelog skill, where coding agents look for skills, whatever the configuration holds. */
const skillPath = '.agents/skills/loom-changelog/SKILL.md';

/** The folder of the authoring skill, where coding agents look for skills, whatever the configuration holds. */
const authoringSkillFolder = '.agents/skills/loom';

/** The mode init writes the installer script with, so an operator can run it directly. */
const executableMode = 0o755;

/**
 * Where one init run acts, and how it reports. Each line is written as the file or key lands, so a
 * failure later in the run follows the lines of what was already written. Every path a line names
 * is relative to the package directory, and `layout` places each file a key decides.
 */
interface Run extends RunHost {
  readonly directory: string;
  readonly force: boolean;
  readonly layout: ScaffoldLayout;
  readonly line: (text: string) => void;
  readonly tooling: Tooling;
  readonly warn: (text: string) => void;
}

/**
 * What init learned of the application module, once for the run. A module init writes in the run,
 * or one the package lacks, is read as the scaffold's. An authored one that loads reads as how the
 * entry imports its Application. Otherwise it could not be loaded and why, or it loaded and exports
 * no single Application.
 */
type ApplicationRead =
  | { readonly imported: ApplicationImport; readonly kind: 'scaffold' }
  | { readonly imported: ApplicationImport; readonly kind: 'read' }
  | { readonly kind: 'unloaded'; readonly reason: string }
  | { readonly kind: 'unexported' };

/**
 * The package directory init acts on, whether init starts a new application in it, where the run
 * writes each file a key decides, and the post-install declaration the installer script renders.
 */
interface Target {
  readonly directory: string;
  readonly fresh: boolean;
  readonly layout: ScaffoldLayout;
  readonly name: string | undefined;
  readonly postInstall: PostInstall | undefined;
}

/** Where init acts, before the configuration places its files. */
type Place = Omit<Target, 'layout' | 'name' | 'postInstall'>;

/** A directory init starts a new application in, which fails when npm or core would reject its name. */
function newPackageDirectory(directory: string): Place {
  const name = basename(directory);
  if (!isNewPackageName(name)) {
    throw new Error(invalidDirectoryName(name));
  }
  return { directory, fresh: true };
}

/**
 * The package directory init acts on: the working directory when it is empty, so a new application
 * starts there whatever lies above it, else the nearest package directory, else `undefined` when
 * the directory is neither empty nor inside a package.
 */
function initTarget(cwd: string): Place | undefined {
  const directory = resolve(cwd);
  if (readdirSync(directory).length === 0) {
    return newPackageDirectory(directory);
  }
  const nearest = nearestPackageDirectory(directory);
  return nearest === undefined ? undefined : { directory: nearest, fresh: false };
}

/** What a run's questions read from its action context, which `@loomcli/prompts` does not name. */
type QuestionContext = Parameters<typeof confirm>[0];

/**
 * The package directory a run acts on. A directory that is neither empty nor inside a package
 * becomes a new one only at a terminal, when the operator accepts the question; declined, off a
 * terminal, or under `--no-input`, init fails and names the command that creates a `package.json`.
 */
async function chosenPlace(context: QuestionContext, cwd: string): Promise<Place> {
  const target = initTarget(cwd);
  if (target !== undefined) {
    return target;
  }
  const refusal = new Error(notEmptyWithoutPackage(cwd));
  if (!context.interactive) {
    throw refusal;
  }
  const created = newPackageDirectory(resolve(cwd));
  const accepted = await confirm(context, {
    default: true,
    message: createPackageQuestion,
  });
  if (!accepted) {
    throw refusal;
  }
  return created;
}

/**
 * Checks the package's `package.json` before init asks or writes anything: it must be a JSON
 * object, and it must name the application when a piece the run writes reads the name.
 */
function checkManifest(target: Place, only: readonly Piece[]) {
  if (target.fresh) {
    return;
  }
  const manifest = readManifest(target.directory);
  if (namedPieces.some((piece) => isSelected(only, piece))) {
    scaffoldName(manifest);
  }
}

/** What a path is, or `undefined` when it is missing or cannot be read. */
function statOf(absolute: string) {
  try {
    return statSync(absolute, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

/**
 * The first path on the way to `path`, from the package directory, that exists and is not a
 * directory, or `undefined` when every path on the way is a directory, missing, or unreadable.
 */
function fileOnTheWay(run: Run, path: string): string | undefined {
  const parts = path.split('/').slice(0, -1);
  for (let index = 1; index <= parts.length; index += 1) {
    const on = parts.slice(0, index).join('/');
    const stats = statOf(join(run.directory, on));
    if (stats === undefined) {
      return undefined;
    }
    if (!stats.isDirectory()) {
      return on;
    }
  }
  return undefined;
}

/**
 * The sentence of a write that failed: the file on the way when a folder could not be made because
 * of it, else the cause the system error's code names.
 */
function writeFailure(run: Run, path: string, error: unknown): string {
  const code = systemErrorCode(error);
  const file = code === 'ENOTDIR' || code === 'EEXIST' ? fileOnTheWay(run, path) : undefined;
  return file === undefined ? cannotWrite(path, code) : fileInTheWay(path, file);
}

/**
 * Writes a file under the package directory, creating its directory, and sets its mode when one is
 * given, whether the file is new or rewritten. A failure names the file and the cause.
 */
function writeFile(run: Run, path: string, text: string, mode?: number) {
  const absolute = join(run.directory, path);
  try {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
    if (mode !== undefined) {
      chmodSync(absolute, mode);
    }
  } catch (error) {
    throw new Error(writeFailure(run, path, error), { cause: error });
  }
}

/** Reads a file under the package directory that init manages. A failure names the file and the cause. */
function readFile(run: Run, path: string): string {
  try {
    return readFileSync(join(run.directory, path), 'utf8');
  } catch (error) {
    throw new Error(cannotRead(path, systemErrorCode(error)), { cause: error });
  }
}

/** Writes a file and the line that says so. */
function write(run: Run, path: string, text: string, mode?: number) {
  writeFile(run, path, text, mode);
  run.line(wroteFile(path));
}

/**
 * Keeps a managed file current: writes it when it is missing, re-renders it while its checksum
 * matches, and warns about a drifted one, re-rendering it under `--force`. A file without a header
 * is the author's, so init never writes it. A mode, when given, applies on every write.
 */
function writeManaged(run: Run, path: string, content: string, mode?: number) {
  const absolute = join(run.directory, path);
  const rendered = renderManaged(content);
  if (!existsSync(absolute)) {
    write(run, path, rendered, mode);
    return;
  }
  const text = readFile(run, path);
  const file = readManaged(text);
  if (file === undefined || text.replaceAll('\r\n', '\n') === rendered) {
    return;
  }
  if (hasDrifted(file) && !run.force) {
    run.warn(driftWarning(path));
    return;
  }
  write(run, path, rendered, mode);
}

/**
 * Whether each folder from the package directory down to `folder` is a real directory, not a
 * symbolic link, so the sweep never reaches files outside the package through a link.
 */
function ownFolder(run: Run, folder: string): boolean {
  const parts = folder.split('/');
  return parts.every((_part, index) => {
    const stats = lstatSync(join(run.directory, ...parts.slice(0, index + 1)), {
      throwIfNoEntry: false,
    });
    return stats?.isDirectory() === true;
  });
}

/**
 * The Markdown files under the authoring skill's folder, as paths from the package directory, in
 * walk order, with symbolic links left out. A package that has no such folder, or reaches it through a
 * symbolic link, yields none.
 */
function authoringSkillFiles(run: Run, folder = authoringSkillFolder): string[] {
  if (!ownFolder(run, folder)) {
    return [];
  }
  return readdirSync(join(run.directory, folder), { withFileTypes: true })
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = posix.join(folder, entry.name);
      if (entry.isDirectory()) {
        return authoringSkillFiles(run, path);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    });
}

/** Removes a file init managed, and each directory the removal leaves empty below the skill folder. */
function removeManaged(run: Run, path: string) {
  try {
    rmSync(join(run.directory, path));
    for (
      let folder = posix.dirname(path);
      folder !== authoringSkillFolder && folder.startsWith(`${authoringSkillFolder}/`);
      folder = posix.dirname(folder)
    ) {
      if (readdirSync(join(run.directory, folder)).length > 0) {
        break;
      }
      rmdirSync(join(run.directory, folder));
    }
  } catch (error) {
    throw new Error(cannotRemove(path, systemErrorCode(error)), { cause: error });
  }
  run.line(removedFile(path));
}

/**
 * Removes the Markdown files of the authoring skill's folder that init wrote and the running loom
 * no longer renders. An unedited one goes, an edited one goes under `--force` and otherwise stays
 * with a warning, and a file without init's header is the author's and is never touched.
 */
function sweepStaleSkillFiles(run: Run, rendered: ReadonlySet<string>) {
  for (const path of authoringSkillFiles(run)) {
    const file = rendered.has(path) ? undefined : readManaged(readFile(run, path));
    if (file === undefined) {
      // Rendered by this run, or a file of the author's, which init never touches.
    } else if (hasDrifted(file) && !run.force) {
      run.warn(staleSkillFile(path));
    } else {
      removeManaged(run, path);
    }
  }
}

/**
 * Keeps the authoring skill current, one managed file for each file the running loom ships under
 * `.agents/skills/loom/`, then sweeps the files it no longer renders.
 */
function writeAuthoringSkill(run: Run) {
  const files = authoringSkill(loomVersion).map(({ content, path }) => ({
    content,
    path: posix.join(authoringSkillFolder, path),
  }));
  for (const { content, path } of files) {
    writeManaged(run, path, content);
  }
  sweepStaleSkillFiles(run, new Set(files.map(({ path }) => path)));
}

/**
 * Keeps the installer script current for the application's name, the package's GitHub repository,
 * and the configuration's release name and post-install declaration, through `writeManaged`. Each
 * write sets mode 755, and an unchanged script is left alone, mode and all. A package that names no GitHub
 * repository gets no script and a warning, so an author who sets `repository` gets the script on
 * the next run.
 */
function writeInstaller(run: Run, config: Pick<LoomConfig, 'name' | 'postInstall'>) {
  const manifest = readManifest(run.directory);
  const repository = githubRepository(manifest);
  if (repository === undefined) {
    run.warn(installerWithoutRepository(run.layout.installer));
    return;
  }
  writeManaged(
    run,
    run.layout.installer,
    installerScript(scaffoldName(manifest), repository, config.postInstall, config.name),
    executableMode,
  );
}

/** Where the side-by-side TypeScript install that typescript-eslint needs is described. */
const eslintPluginGuide = 'https://github.com/dbtlr/loomcli/blob/main/docs/libs/eslint-plugin.md';

/**
 * Warns when the linter is ESLint and the package already declares `typescript` as anything but
 * the TypeScript 6 compatibility alias. Init never overwrites a key, so the package keeps its
 * compiler, and typescript-eslint, which supports TypeScript below 6.1, fails on TypeScript 7
 * when `eslint .` runs.
 */
function warnPlainTypescript(run: Run, target: Place) {
  if (run.tooling.linter !== 'eslint' || target.fresh) {
    return;
  }
  const range = declaredTypescript(targetManifest(target));
  if (range === undefined || isTypescriptAlias(range)) {
    return;
  }
  run.warn(plainTypescript(range, toolRanges['@typescript/typescript6'], eslintPluginGuide));
}

/** Adds the scaffold's `package.json` keys the package lacks, one line for each key added. */
function writeKeys(run: Run) {
  const source = readFileSync(join(run.directory, 'package.json'), 'utf8');
  const name = scaffoldName(readManifest(run.directory));
  const { added, text } = addMissingKeys(
    source,
    scaffoldKeys(name, { loom: loomVersion, typescript: typescriptRange }, run.tooling, run.layout),
  );
  if (added.length > 0) {
    writeFile(run, 'package.json', text);
  }
  for (const key of added) {
    run.line(addedKey(key));
  }
}

/**
 * Why a read of the application module failed, for the warning: the sentence the read failed with,
 * which a system error does not have, so it gives the general reason with its code.
 */
function unloadedReason(error: unknown): string {
  const code = systemErrorCode(error);
  return error instanceof Error && code === undefined ? error.message : unreadReason(code);
}

/**
 * What an application module the author already holds gives, learned by loading it: the name the
 * entry and the test import its one Application under, else its default export. A module that
 * could not be loaded, because core does not resolve, Bun is missing, or the module throws, reads
 * `unloaded` with the reason, a declaration fault's Developer Diagnostic included, and one that
 * loads but exports no single Application reads `unexported`.
 */
async function authoredRead(run: Run, name: string): Promise<ApplicationRead> {
  let result: ApplicationExports | undefined = undefined;
  try {
    result = await readApplicationExports(run, {
      directory: run.directory,
      module: run.layout.application,
      path: join(run.directory, run.layout.application),
    });
  } catch (error) {
    // A cancelled read stops init where it is, with no warning and nothing more written.
    run.signal.throwIfAborted();
    return { kind: 'unloaded', reason: unloadedReason(error) };
  }
  if ('failure' in result) {
    return result.loaded ? { kind: 'unexported' } : { kind: 'unloaded', reason: result.failure };
  }
  const named = result.names.find((exported) => exported !== 'default');
  if (named !== undefined) {
    return { imported: { identifier: named, kind: 'named' }, kind: 'read' };
  }
  const identifier = applicationIdentifier(name);
  return { imported: { identifier, kind: 'default' }, kind: 'read' };
}

/**
 * The reason a module could not be loaded, as one sentence for a warning: its first line that is
 * not a Developer Diagnostic's banner, without a closing period.
 */
function reasonLine(reason: string) {
  const line = reason.split('\n').find((text) => text.trim() !== '' && !text.startsWith('-- '));
  return (line ?? unreadReason(undefined)).trim().replace(/\.$/u, '');
}

/**
 * The application module as the entry and the test read it, learned once
 * for the run and only when a file needs it: the scaffold's when init writes the application module
 * too or the package holds none, and what loading it found when the author already holds one.
 */
function applicationReader(run: Run, authored: boolean): () => Promise<ApplicationRead> {
  let outcome: ApplicationRead | undefined = undefined;
  return async () => {
    const name = scaffoldName(readManifest(run.directory));
    outcome ??= authored
      ? await authoredRead(run, name)
      : {
          imported: { identifier: applicationIdentifier(name), kind: 'named' },
          kind: 'scaffold',
        };
    return outcome;
  };
}

/**
 * The import a file writes for the Application, or `undefined` after a warning that the file was
 * not written. An authored application module init cannot read draws a warning and no file.
 */
function importedApplication(
  run: Run,
  file: { readonly noun: string; readonly path: string },
  outcome: ApplicationRead,
): ApplicationImport | undefined {
  if (outcome.kind === 'read' || outcome.kind === 'scaffold') {
    return outcome.imported;
  }
  const { noun, path } = file;
  const { application } = run.layout;
  if (outcome.kind === 'unloaded') {
    run.warn(unloadedApplication(path, application, reasonLine(outcome.reason), noun));
  } else {
    run.warn(unexportedApplication(path, application, noun));
  }
  return undefined;
}

/** Writes the entry when it is missing, importing the application module by its relative path. */
async function writeEntry(run: Run, reading: () => Promise<ApplicationRead>) {
  const { application, entry } = run.layout;
  if (existsSync(join(run.directory, entry))) {
    return;
  }
  const imported = importedApplication(run, { noun: 'entry', path: entry }, await reading());
  if (imported !== undefined) {
    write(run, entry, entryModule(imported, moduleSpecifier(entry, application)));
  }
}

/**
 * Writes the test of the assembly check when it is missing, for the run's test runner, importing
 * the application module by its relative path.
 */
async function writeTest(run: Run, reading: () => Promise<ApplicationRead>) {
  const { application, test } = run.layout;
  if (existsSync(join(run.directory, test))) {
    return;
  }
  const imported = importedApplication(run, { noun: 'test', path: test }, await reading());
  if (imported !== undefined) {
    const specifier = moduleSpecifier(test, application);
    write(run, test, applicationTest(run.tooling.runner, imported, specifier));
  }
}

/** Writes the lint configuration of the run's linter when the package holds none for it. */
function writeLint(run: Run) {
  const { linter } = run.tooling;
  if (!hasLintConfig(run.directory, linter)) {
    const text = linter === 'oxlint' ? oxlintConfig : eslintConfig(run.layout.source);
    write(run, lintConfigPath(linter), text);
  }
}

/**
 * Starts a new application in an empty directory with its `package.json`, named for the directory,
 * before any piece, so the application's name always comes from `package.json`.
 */
function writeNewManifest(run: Run) {
  write(run, 'package.json', newManifest(basename(run.directory)));
}

/** Whether a run over `only` writes the piece: every piece is written when `only` is empty. */
function isSelected(only: readonly Piece[], piece: Piece) {
  return only.length === 0 || only.includes(piece);
}

/** The `package.json` text a run starts from: the new manifest in a new package directory. */
function manifestSource({ directory, fresh }: Place) {
  return fresh
    ? newManifest(basename(directory))
    : readFileSync(join(directory, 'package.json'), 'utf8');
}

/** The `package.json` object a run starts from. */
function targetManifest(target: Place) {
  return parseManifest(manifestSource(target), join(target.directory, 'package.json'));
}

/**
 * What a package already settles about its tooling, which init follows without asking: the linter
 * of a lint configuration file, which a directory that gains its `package.json` may already hold,
 * and the runner a dependency field declares, vitest or Bun's types.
 */
function existingTooling(target: Place): Partial<Tooling> {
  const linter = existingLinter(target.directory);
  const runner = existingRunner(targetManifest(target));
  return {
    ...(linter === undefined ? {} : { linter }),
    ...(runner === undefined ? {} : { runner }),
  };
}

/**
 * Whether the `package.json` keys init adds differ between two toolings, which is when the `check`
 * script or a development dependency depends on the answer.
 */
function keysDiffer(target: Target, first: Tooling, second: Tooling) {
  const source = manifestSource(target);
  const name = scaffoldName(manifestOf(source, join(target.directory, 'package.json')));
  const versions = { loom: loomVersion, typescript: typescriptRange };
  const textFor = (tooling: Tooling) =>
    addMissingKeys(source, scaffoldKeys(name, versions, tooling, target.layout)).text;
  return textFor(first) !== textFor(second);
}

/**
 * Which tooling questions init needs to ask: one for each choice that the files and keys init will
 * write depend on. The lint configuration depends on the linter and the test on the runner, and the
 * `package.json` keys depend on both while they are missing.
 */
function neededQuestions(
  target: Target,
  only: readonly Piece[],
): { linter: boolean; runner: boolean } {
  const selected = (piece: Piece) => isSelected(only, piece);
  const keysMatter = selected('package');
  const { linter, runner } = defaultTooling;
  return {
    linter:
      selected('lint') ||
      (keysMatter && keysDiffer(target, defaultTooling, { linter: 'eslint', runner })),
    runner:
      (selected('test') && !existsSync(join(target.directory, target.layout.test))) ||
      (keysMatter && keysDiffer(target, defaultTooling, { linter, runner: 'vitest' })),
  };
}

/** One init run over the pieces it is limited to, all of them by default. */
async function runInit(
  run: Omit<Run, 'directory' | 'layout'> & { only: readonly Piece[]; target: Target },
) {
  const { directory, fresh, layout } = run.target;
  const context: Run = {
    directory,
    force: run.force,
    host: run.host,
    layout,
    line: run.line,
    onShutdown: run.onShutdown,
    signal: run.signal,
    tooling: run.tooling,
    warn: run.warn,
  };
  const selected = (piece: Piece) => isSelected(run.only, piece);
  if (fresh) {
    writeNewManifest(context);
  }
  const authored = existsSync(join(directory, layout.application));
  const reading = applicationReader(context, authored);
  if (selected('package') || selected('lint')) {
    warnPlainTypescript(context, run.target);
  }
  if (selected('package')) {
    writeKeys(context);
  }
  if (selected('application') && !authored) {
    const name = scaffoldName(readManifest(directory));
    write(context, layout.application, applicationModule(name, applicationIdentifier(name)));
  }
  if (selected('entry')) {
    await writeEntry(context, reading);
  }
  if (selected('tsconfig') && !existsSync(join(directory, typescriptConfigPath))) {
    write(context, typescriptConfigPath, typescriptConfig(layout.source));
  }
  if (selected('test')) {
    await writeTest(context, reading);
  }
  if (selected('lint')) {
    writeLint(context);
  }
  if (selected('changes')) {
    writeManaged(context, layout.guide, fragmentGuide(layout));
  }
  if (selected('skill')) {
    writeManaged(context, skillPath, changelogSkill(layout));
    writeAuthoringSkill(context);
  }
  if (selected('install')) {
    writeInstaller(context, run.target);
  }
}

/**
 * Scaffolds a new application in an empty directory, or adds the pieces a package lacks, asking at
 * a terminal for the tooling nothing else decides.
 */
export const initPackage: ActionHandler<typeof init> = async (context) => {
  const { host, onShutdown, options, out, provided, signal, supplied } = context;
  await report({ out, signal }, async () => {
    const place = await chosenPlace(context, host.cwd);
    checkManifest(place, options.only);
    // A new application uses every convention: the file the lookup finds describes the package above it.
    const config = place.fresh ? {} : provided.config;
    const target = {
      ...place,
      layout: scaffoldLayout(place.directory, packagePaths(place.directory, config)),
      name: config.name,
      postInstall: config.postInstall,
    };
    const existing = existingTooling(target);
    const needed = neededQuestions(target, options.only);
    // Precedence: a supplied option, the package's own setting, a terminal question, the default.
    let linter: Linter = options.linter;
    if (supplied.options.linter === undefined && existing.linter !== undefined) {
      linter = existing.linter;
    } else if (needed.linter && context.interactive) {
      linter = await select(context, {
        choices: linters,
        message: linterQuestion,
        option: 'linter',
        skipIfSupplied: true,
      });
    }
    let runner: TestRunner = options['test-runner'];
    if (supplied.options['test-runner'] === undefined && existing.runner !== undefined) {
      runner = existing.runner;
    } else if (needed.runner && context.interactive) {
      runner = await select(context, {
        choices: testRunners,
        message: testRunnerQuestion,
        option: 'test-runner',
        skipIfSupplied: true,
      });
    }
    await runInit({
      force: options.force,
      host,
      line: (text) => host.stdout.write(`${text}\n`),
      onShutdown,
      only: options.only,
      signal,
      target,
      tooling: { linter, runner },
      warn: (text) => host.stderr.write(`${text}\n`),
    });
    return '';
  });
};
