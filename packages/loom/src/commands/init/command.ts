import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { Command } from '@loomcli/core';
import { z } from 'zod';

import { changelogSkill } from '../../content/changelog-skill.js';
import { fragmentGuide } from '../../content/fragment-guide.js';
import { applicationModule, entryModule, newManifest } from '../../content/scaffold.js';
import type { ApplicationImport } from '../../content/scaffold.js';
import { checkApplication } from '../../helpers/application-check.js';
import type { ApplicationCheck } from '../../helpers/application-check.js';
import { readManifest, scaffoldName } from '../../helpers/build-facts.js';
import { loomVersion } from '../../helpers/loom-version.js';
import { driftWarning, hasDrifted, readManaged, renderManaged } from '../../helpers/managed.js';
import { nearestPackageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import {
  addMissingKeys,
  applicationIdentifier,
  isNewPackageName,
  scaffoldKeys,
} from '../../helpers/scaffold.js';

/** The pieces init writes, in the order it writes them. */
const pieces = ['package', 'application', 'entry', 'changes', 'skill'] as const;

type Piece = (typeof pieces)[number];

/**
 * One `--only` value. A multiple option validates each value as the string the operator typed, so
 * its validator must accept a string input, and the enum of pieces sits behind `z.string().pipe`.
 */
const pieceOption = z
  .string()
  .pipe(z.enum(pieces, { error: 'Use application, entry, package, changes, or skill.' }));

/** The application module and the entry, by their conventional paths in the package directory. */
const applicationPath = 'src/application.ts';
const entryPath = 'src/main.ts';

/**
 * Where one init run acts, and how it reports. Each line is written as the file or key lands, so a
 * failure later in the run follows the lines of what was already written. Every path a line names
 * is relative to the package directory, as `loom check` names a drifted managed file.
 */
interface Run {
  readonly directory: string;
  readonly force: boolean;
  readonly line: (text: string) => void;
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

/**
 * The package directory init acts on: the working directory when it is empty, so a new application
 * starts there whatever lies above it, else the nearest package directory.
 */
function initDirectory(cwd: string): { directory: string; fresh: boolean } {
  const directory = resolve(cwd);
  if (readdirSync(directory).length === 0) {
    return { directory, fresh: true };
  }
  const nearest = nearestPackageDirectory(directory);
  if (nearest === undefined) {
    throw new Error(
      `${cwd} is not empty and no package.json is at or above it, so run loom init in an empty directory or inside a package directory.`,
    );
  }
  return { directory: nearest, fresh: false };
}

/** Writes a file under the package directory, creating its directory. A failure names the file. */
function writeFile(run: Run, path: string, text: string) {
  const absolute = join(run.directory, path);
  try {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot write ${path}: ${reason}.`, { cause: error });
  }
}

/** Writes a file and the line that says so. */
function write(run: Run, path: string, text: string) {
  writeFile(run, path, text);
  run.line(`Wrote ${path}.`);
}

/**
 * Keeps a managed file current: writes it when it is missing, re-renders it while its checksum
 * matches, and warns about a drifted one, re-rendering it under `--force`. A file without a header
 * is the author's, so init never writes it.
 */
function writeManaged(run: Run, path: string, content: string) {
  const absolute = join(run.directory, path);
  const rendered = renderManaged(content);
  if (!existsSync(absolute)) {
    write(run, path, rendered);
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
  write(run, path, rendered);
}

/** Adds the scaffold's `package.json` keys the package lacks, one line for each key added. */
function writeKeys(run: Run) {
  const source = readFileSync(join(run.directory, 'package.json'), 'utf8');
  const name = scaffoldName(readManifest(run.directory));
  const { added, text } = addMissingKeys(source, scaffoldKeys(name, loomVersion));
  if (added.length > 0) {
    writeFile(run, 'package.json', text);
  }
  for (const key of added) {
    run.line(`Added ${key} to package.json.`);
  }
}

/**
 * How the entry imports an application module the author already holds, learned by loading it as
 * `loom check` does: the name it exports its one Application under, else its default export. A
 * module that could not be loaded, because core does not resolve, Bun is missing, or the module
 * throws, reads `unloaded` with the reason, and one that loads but exports no single Application
 * reads `unexported`.
 */
function authoredImport(run: Run, name: string): AuthoredImport {
  let checked: ApplicationCheck | undefined = undefined;
  try {
    checked = checkApplication({
      directory: run.directory,
      module: applicationPath,
      path: join(run.directory, applicationPath),
    });
  } catch (error) {
    return { kind: 'unloaded', reason: error instanceof Error ? error.message : String(error) };
  }
  const { result } = checked;
  if ('failure' in result) {
    return result.loaded ? { kind: 'unexported' } : { kind: 'unloaded', reason: result.failure };
  }
  const named = result.names.find((exported) => exported !== 'default');
  if (named !== undefined) {
    return { imported: { identifier: named, kind: 'named' }, kind: 'read' };
  }
  if (result.names.includes('default')) {
    return { imported: { identifier: applicationIdentifier(name), kind: 'default' }, kind: 'read' };
  }
  return { kind: 'unloaded', reason: result.faults.join('\n') };
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
 * Writes the entry when it is missing. It imports the Application by the scaffold's identifier
 * when init writes the application module too, and by what the module exports when the author
 * already holds one. An authored module init cannot read draws a warning and no entry.
 */
function writeEntry(run: Run, authored: boolean) {
  if (existsSync(join(run.directory, entryPath))) {
    return;
  }
  const name = scaffoldName(readManifest(run.directory));
  const scaffolded: AuthoredImport = {
    imported: { identifier: applicationIdentifier(name), kind: 'named' },
    kind: 'read',
  };
  const outcome = authored ? authoredImport(run, name) : scaffolded;
  if (outcome.kind === 'unloaded') {
    run.warn(
      `warning: ${entryPath} was not written because ${applicationPath} could not be loaded: ${reasonLine(outcome.reason)}. Install the package and run loom init again, or write the entry by hand.`,
    );
    return;
  }
  if (outcome.kind === 'unexported') {
    run.warn(
      `warning: ${entryPath} was not written because ${applicationPath} exports no Application loom can read. Write the entry by hand.`,
    );
    return;
  }
  write(run, entryPath, entryModule(outcome.imported));
}

/**
 * Starts a new application in an empty directory with its `package.json`, named for the directory,
 * before any piece, so the application's name always comes from `package.json`. A directory name
 * that npm or core would reject fails before anything is written.
 */
function writeNewManifest(run: Run) {
  const name = basename(run.directory);
  if (!isNewPackageName(name)) {
    throw new Error(
      `The directory name "${name}" is not a valid package name, so rename the directory or write a package.json with the name to use.`,
    );
  }
  write(run, 'package.json', newManifest(name));
}

/** One init run over the pieces it is limited to, all of them by default. */
function runInit(run: Omit<Run, 'directory'> & { cwd: string; only: readonly Piece[] }) {
  const { directory, fresh } = initDirectory(run.cwd);
  const context: Run = { directory, force: run.force, line: run.line, warn: run.warn };
  const selected = (piece: Piece) => run.only.length === 0 || run.only.includes(piece);
  if (fresh) {
    writeNewManifest(context);
  }
  const authored = existsSync(join(directory, applicationPath));
  if (selected('package')) {
    writeKeys(context);
  }
  if (selected('application') && !authored) {
    const name = scaffoldName(readManifest(directory));
    write(context, applicationPath, applicationModule(name, applicationIdentifier(name)));
  }
  if (selected('entry')) {
    writeEntry(context, authored);
  }
  if (selected('changes')) {
    writeManaged(context, '.changes/README.md', fragmentGuide);
  }
  if (selected('skill')) {
    writeManaged(context, '.agents/skills/loom-changelog/SKILL.md', changelogSkill);
  }
}

export const init = new Command('init', {
  description:
    'Scaffold a new application in an empty directory, or add the pieces a package lacks.',
})
  .option('only', {
    description: 'Write only this piece: application, entry, package, changes, or skill.',
    multiple: true,
    type: 'string',
    validate: pieceOption,
  })
  .option('force', {
    description: 'Re-render a managed file that was edited. Scaffold files are never overwritten.',
    type: 'boolean',
  })
  .action(async ({ host, options, out, passthrough }) => {
    await report(out, passthrough, () => {
      runInit({
        cwd: host.cwd,
        force: options.force,
        line: (text) => host.stdout.write(`${text}\n`),
        only: options.only,
        warn: (text) => host.stderr.write(`${text}\n`),
      });
      return '';
    });
  });
