import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { Command } from '@loomcli/core';
import { confirm, select } from '@loomcli/prompts';
import { createValidator } from '@loomcli/validators';

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
  scaffoldKeys,
} from '../../helpers/scaffold.js';
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

/** The pieces init writes, in the order it writes them. */
const pieces = [
  'package',
  'application',
  'entry',
  'tsconfig',
  'test',
  'lint',
  'changes',
  'skill',
  'install',
] as const;

type Piece = (typeof pieces)[number];

/** The pieces that read the application's name from `package.json`. */
const namedPieces: readonly Piece[] = ['package', 'application', 'entry', 'test', 'install'];

/**
 * A validator for one value of a string option out of a fixed set. A multiple option validates each
 * value as the string the operator typed, so the validator reads a string and publishes a plain
 * string, and the match against the values decides it.
 */
function choiceOption<const Value extends string>(values: readonly Value[], message: string) {
  return createValidator({
    inputSchema: { type: 'string' },
    parse: (raw) => {
      const match = values.find((each) => each === raw);
      return match === undefined ? { issues: [{ message }] } : { value: match };
    },
  });
}

/** One `--only` value. */
const pieceOption = choiceOption(
  pieces,
  'Use application, entry, tsconfig, test, lint, package, changes, skill, or install.',
);

/** One `--linter` value. */
const linterOption = choiceOption(linters, 'Use oxlint or eslint.');

/** One `--test-runner` value. */
const runnerOption = choiceOption(testRunners, 'Use bun or vitest.');

/** The application module, the entry, and the test, by their conventional paths in the package. */
const applicationPath = 'src/application.ts';
const entryPath = 'src/main.ts';
const testPath = 'src/application.test.ts';

/** The compiler configuration the `check` script's `tsc --noEmit` runs against. */
const typescriptConfigPath = 'tsconfig.json';

/** The installer script, and the mode init writes it with, so an operator can run it directly. */
const installerPath = 'install.sh';
const executableMode = 0o755;

/**
 * Where one init run acts, and how it reports. Each line is written as the file or key lands, so a
 * failure later in the run follows the lines of what was already written. Every path a line names
 * is relative to the package directory.
 */
interface Run extends RunHost {
  readonly directory: string;
  readonly force: boolean;
  readonly line: (text: string) => void;
  readonly tooling: Tooling;
  readonly warn: (text: string) => void;
}

/**
 * What init learned from an authored application module: how the entry imports its Application,
 * that the module could not be loaded and why, or that it loaded and exports no single Application.
 */
type AuthoredImport =
  | { readonly imported: ApplicationImport; readonly kind: 'read' }
  | { readonly kind: 'unloaded'; readonly reason: string }
  | { readonly kind: 'unexported' };

/** The package directory init acts on, and whether init starts a new application in it. */
interface Target {
  readonly directory: string;
  readonly fresh: boolean;
}

/** A directory init starts a new application in, which fails when npm or core would reject its name. */
function newPackageDirectory(directory: string): Target {
  const name = basename(directory);
  if (!isNewPackageName(name)) {
    throw new Error(
      `The directory name "${name}" is not a valid package name, so rename the directory or write a package.json with the name to use.`,
    );
  }
  return { directory, fresh: true };
}

/**
 * The package directory init acts on: the working directory when it is empty, so a new application
 * starts there whatever lies above it, else the nearest package directory, else `undefined` when
 * the directory is neither empty nor inside a package.
 */
function initTarget(cwd: string): Target | undefined {
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
async function chosenTarget(context: QuestionContext, cwd: string) {
  const target = initTarget(cwd);
  if (target !== undefined) {
    return target;
  }
  const refusal = new Error(
    `${cwd} is not empty and no package.json is at or above it, so create one with npm init -y, or your package manager's equivalent, and run loom init again.`,
  );
  if (!context.interactive) {
    throw refusal;
  }
  const created = newPackageDirectory(resolve(cwd));
  const accepted = await confirm(context, {
    default: true,
    message: 'No package.json is here or above it. Create one in this directory?',
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
function checkManifest(target: Target, only: readonly Piece[]) {
  if (target.fresh) {
    return;
  }
  const manifest = readManifest(target.directory);
  if (namedPieces.some((piece) => isSelected(only, piece))) {
    scaffoldName(manifest);
  }
}

/**
 * Writes a file under the package directory, creating its directory, and sets its mode when one is
 * given, whether the file is new or rewritten. A failure names the file.
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
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot write ${path}: ${reason}.`, { cause: error });
  }
}

/** Writes a file and the line that says so. */
function write(run: Run, path: string, text: string, mode?: number) {
  writeFile(run, path, text, mode);
  run.line(`Wrote ${path}.`);
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
  const text = readFileSync(absolute, 'utf8');
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
 * Keeps the installer script current for the application's name and the package's GitHub
 * repository, through `writeManaged`. Each write sets mode 755, and an unchanged script is left
 * alone, mode and all. A package that names no GitHub repository gets no script and a warning, so
 * an author who sets `repository` gets the script on the next run.
 */
function writeInstaller(run: Run) {
  const manifest = readManifest(run.directory);
  const repository = githubRepository(manifest);
  if (repository === undefined) {
    run.warn(
      `warning: ${installerPath} was not written because package.json names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom init again.`,
    );
    return;
  }
  writeManaged(
    run,
    installerPath,
    installerScript(scaffoldName(manifest), repository),
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
function warnPlainTypescript(run: Run, target: Target) {
  if (run.tooling.linter !== 'eslint' || target.fresh) {
    return;
  }
  const range = declaredTypescript(targetManifest(target));
  if (range === undefined || isTypescriptAlias(range)) {
    return;
  }
  run.warn(
    `warning: package.json declares typescript as ${range}, and typescript-eslint supports TypeScript below 6.1, so eslint . fails on TypeScript 7. Set typescript to npm:@typescript/typescript6@${toolRanges['@typescript/typescript6']} and add @typescript/native as npm:typescript@${range}, which keeps tsc on your compiler. See ${eslintPluginGuide}.`,
  );
}

/** Adds the scaffold's `package.json` keys the package lacks, one line for each key added. */
function writeKeys(run: Run) {
  const source = readFileSync(join(run.directory, 'package.json'), 'utf8');
  const name = scaffoldName(readManifest(run.directory));
  const { added, text } = addMissingKeys(
    source,
    scaffoldKeys(name, { loom: loomVersion, typescript: typescriptRange }, run.tooling),
  );
  if (added.length > 0) {
    writeFile(run, 'package.json', text);
  }
  for (const key of added) {
    run.line(`Added ${key} to package.json.`);
  }
}

/**
 * How the entry and the test import an application module the author already holds, learned by
 * loading it: the name it exports its one Application under, else its default export. A module that
 * could not be loaded, because core does not resolve, Bun is missing, or the module throws, reads
 * `unloaded` with the reason, and one that loads but exports no single Application reads
 * `unexported`.
 */
async function authoredImport(run: Run, name: string): Promise<AuthoredImport> {
  let result: ApplicationExports | undefined = undefined;
  try {
    result = await readApplicationExports(run, {
      directory: run.directory,
      module: applicationPath,
      path: join(run.directory, applicationPath),
    });
  } catch (error) {
    // A cancelled read stops init where it is, with no warning and nothing more written.
    run.signal.throwIfAborted();
    return { kind: 'unloaded', reason: error instanceof Error ? error.message : String(error) };
  }
  if ('failure' in result) {
    return result.loaded ? { kind: 'unexported' } : { kind: 'unloaded', reason: result.failure };
  }
  const named = result.names.find((exported) => exported !== 'default');
  if (named !== undefined) {
    return { imported: { identifier: named, kind: 'named' }, kind: 'read' };
  }
  return { imported: { identifier: applicationIdentifier(name), kind: 'default' }, kind: 'read' };
}

/**
 * The reason a module could not be loaded, as one sentence for a warning: its first line that is
 * not a Developer Diagnostic's banner, without a closing period.
 */
function reasonLine(reason: string) {
  const line = reason.split('\n').find((text) => text.trim() !== '' && !text.startsWith('-- '));
  return (line ?? 'it could not be read').trim().replace(/\.$/u, '');
}

/**
 * How the entry and the test import the Application, learned once for the run and only when a file
 * needs it: the scaffold's identifier when init writes the application module too, and what the
 * module exports when the author already holds one.
 */
function applicationImporter(run: Run, authored: boolean): () => Promise<AuthoredImport> {
  let outcome: AuthoredImport | undefined = undefined;
  return async () => {
    const name = scaffoldName(readManifest(run.directory));
    outcome ??= authored
      ? await authoredImport(run, name)
      : {
          imported: { identifier: applicationIdentifier(name), kind: 'named' },
          kind: 'read',
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
  outcome: AuthoredImport,
): ApplicationImport | undefined {
  if (outcome.kind === 'read') {
    return outcome.imported;
  }
  const { noun, path } = file;
  if (outcome.kind === 'unloaded') {
    run.warn(
      `warning: ${path} was not written because ${applicationPath} could not be loaded: ${reasonLine(outcome.reason)}. Install the package and run loom init again, or write the ${noun} by hand.`,
    );
  } else {
    run.warn(
      `warning: ${path} was not written because ${applicationPath} exports no Application loom can read. Write the ${noun} by hand.`,
    );
  }
  return undefined;
}

/** Writes the entry when it is missing. */
async function writeEntry(run: Run, importing: () => Promise<AuthoredImport>) {
  if (existsSync(join(run.directory, entryPath))) {
    return;
  }
  const imported = importedApplication(run, { noun: 'entry', path: entryPath }, await importing());
  if (imported !== undefined) {
    write(run, entryPath, entryModule(imported));
  }
}

/** Writes the test of the assembly check when it is missing, for the run's test runner. */
async function writeTest(run: Run, importing: () => Promise<AuthoredImport>) {
  if (existsSync(join(run.directory, testPath))) {
    return;
  }
  const imported = importedApplication(run, { noun: 'test', path: testPath }, await importing());
  if (imported !== undefined) {
    write(run, testPath, applicationTest(run.tooling.runner, imported));
  }
}

/** Writes the lint configuration of the run's linter when the package holds none for it. */
function writeLint(run: Run) {
  const { linter } = run.tooling;
  if (!hasLintConfig(run.directory, linter)) {
    write(run, lintConfigPath(linter), linter === 'oxlint' ? oxlintConfig : eslintConfig);
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
function manifestSource({ directory, fresh }: Target) {
  return fresh
    ? newManifest(basename(directory))
    : readFileSync(join(directory, 'package.json'), 'utf8');
}

/** The `package.json` object a run starts from. */
function targetManifest(target: Target) {
  return parseManifest(manifestSource(target), join(target.directory, 'package.json'));
}

/**
 * What a package already settles about its tooling, which init follows without asking: the linter
 * of a lint configuration file, which a directory that gains its `package.json` may already hold,
 * and the runner a dependency field declares, vitest or Bun's types.
 */
function existingTooling(target: Target): Partial<Tooling> {
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
    addMissingKeys(source, scaffoldKeys(name, versions, tooling)).text;
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
      (selected('test') && !existsSync(join(target.directory, testPath))) ||
      (keysMatter && keysDiffer(target, defaultTooling, { linter, runner: 'vitest' })),
  };
}

/** One init run over the pieces it is limited to, all of them by default. */
async function runInit(run: Omit<Run, 'directory'> & { only: readonly Piece[]; target: Target }) {
  const { directory, fresh } = run.target;
  const context: Run = {
    directory,
    force: run.force,
    host: run.host,
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
  const authored = existsSync(join(directory, applicationPath));
  const importing = applicationImporter(context, authored);
  if (selected('package') || selected('lint')) {
    warnPlainTypescript(context, run.target);
  }
  if (selected('package')) {
    writeKeys(context);
  }
  if (selected('application') && !authored) {
    const name = scaffoldName(readManifest(directory));
    write(context, applicationPath, applicationModule(name, applicationIdentifier(name)));
  }
  if (selected('entry')) {
    await writeEntry(context, importing);
  }
  if (selected('tsconfig') && !existsSync(join(directory, typescriptConfigPath))) {
    write(context, typescriptConfigPath, typescriptConfig);
  }
  if (selected('test')) {
    await writeTest(context, importing);
  }
  if (selected('lint')) {
    writeLint(context);
  }
  if (selected('changes')) {
    writeManaged(context, '.changes/README.md', fragmentGuide);
  }
  if (selected('skill')) {
    writeManaged(context, '.agents/skills/loom-changelog/SKILL.md', changelogSkill);
  }
  if (selected('install')) {
    writeInstaller(context);
  }
}

export const init = new Command('init', {
  description:
    'Scaffold a new application in an empty directory, or add the pieces a package lacks.',
})
  .option('only', {
    description:
      'Write only this piece: application, entry, tsconfig, test, lint, package, changes, skill, or install.',
    multiple: true,
    type: 'string',
    validate: pieceOption,
  })
  .option('linter', {
    default: defaultTooling.linter,
    description:
      'Wire this linter: oxlint or eslint. A lint configuration the package holds decides it, and at a terminal init asks when nothing does.',
    type: 'string',
    validate: linterOption,
  })
  .option('test-runner', {
    default: defaultTooling.runner,
    description:
      'Wire this test runner: bun or vitest. A package that declares vitest or @types/bun uses that runner, and at a terminal init asks when nothing decides.',
    type: 'string',
    validate: runnerOption,
  })
  .option('force', {
    description: 'Re-render a managed file that was edited. Scaffold files are never overwritten.',
    type: 'boolean',
  })
  .action(async (context) => {
    const { host, onShutdown, options, out, passthrough, signal, supplied } = context;
    await report({ out, passthrough, signal }, async () => {
      const target = await chosenTarget(context, host.cwd);
      checkManifest(target, options.only);
      const existing = existingTooling(target);
      const needed = neededQuestions(target, options.only);
      // Precedence: a supplied option, the package's own setting, a terminal question, the default.
      let linter: Linter = options.linter;
      if (supplied.options.linter === undefined && existing.linter !== undefined) {
        linter = existing.linter;
      } else if (needed.linter && context.interactive) {
        linter = await select(context, {
          choices: linters,
          message: 'Which linter should the scaffold use?',
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
          message: 'Which test runner should the scaffold use?',
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
  });
