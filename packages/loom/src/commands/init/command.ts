import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { Command } from '@loomcli/core';
import { z } from 'zod';

import { readManifest, scaffoldName } from '../../helpers/build-facts.js';
import { loomVersion } from '../../helpers/loom-version.js';
import { driftWarning, hasDrifted, readManaged, renderManaged } from '../../helpers/managed.js';
import { nearestPackageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import { addMissingKeys, applicationIdentifier, scaffoldKeys } from '../../helpers/scaffold.js';
import { changelogSkill } from '../../templates/changelog-skill.js';
import { fragmentGuide } from '../../templates/fragment-guide.js';
import { applicationModule, entryModule, newManifest } from '../../templates/scaffold.js';

/** The pieces init writes, in the order it writes them. */
const pieces = ['package', 'application', 'entry', 'changes', 'skill'] as const;

type Piece = (typeof pieces)[number];

/** One `--only` value, read from the string the operator typed. */
const pieceOption = z
  .string()
  .pipe(z.enum(pieces, { error: 'Use application, entry, package, changes, or skill.' }));

/**
 * Where one init run acts, and what it says as it goes. Every path a line names is relative to the
 * package directory, as `loom check` names a drifted managed file.
 */
interface Run {
  readonly directory: string;
  readonly force: boolean;
  readonly lines: string[];
  readonly warnings: string[];
}

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

/** Writes a file, creating its directory, and records the line that says so. */
function write(run: Run, path: string, text: string) {
  const absolute = join(run.directory, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
  run.lines.push(`Wrote ${path}.`);
}

/** Writes a scaffold file only when it is missing, because an existing one is the author's. */
function writeScaffold(run: Run, path: string, text: () => string) {
  if (!existsSync(join(run.directory, path))) {
    write(run, path, text());
  }
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
    run.warnings.push(driftWarning(path));
    return;
  }
  write(run, path, rendered);
}

/** Adds the scaffold's `package.json` keys the package lacks, one line for each key added. */
function writeKeys(run: Run) {
  const path = join(run.directory, 'package.json');
  const source = readFileSync(path, 'utf8');
  const name = scaffoldName(readManifest(run.directory));
  const { added, text } = addMissingKeys(source, scaffoldKeys(name, loomVersion));
  if (added.length > 0) {
    writeFileSync(path, text);
  }
  for (const key of added) {
    run.lines.push(`Added ${key} to package.json.`);
  }
}

/** The application's name: from `package.json` when the package has one, else the directory's. */
function nameOf(directory: string) {
  return existsSync(join(directory, 'package.json'))
    ? scaffoldName(readManifest(directory))
    : basename(directory);
}

/**
 * One init run over the pieces it is limited to, all of them by default. It returns the lines for
 * stdout and the warnings for stderr.
 */
function runInit(cwd: string, only: readonly Piece[], force: boolean) {
  const { directory, fresh } = initDirectory(cwd);
  const run: Run = { directory, force, lines: [], warnings: [] };
  const selected = (piece: Piece) => only.length === 0 || only.includes(piece);
  if (selected('package')) {
    if (fresh) {
      write(run, 'package.json', newManifest(basename(directory)));
    }
    writeKeys(run);
  }
  if (selected('application')) {
    writeScaffold(run, 'src/application.ts', () => {
      const name = nameOf(directory);
      return applicationModule(name, applicationIdentifier(name));
    });
  }
  if (selected('entry')) {
    writeScaffold(run, 'src/main.ts', () => entryModule(applicationIdentifier(nameOf(directory))));
  }
  if (selected('changes')) {
    writeManaged(run, '.changes/README.md', fragmentGuide);
  }
  if (selected('skill')) {
    writeManaged(run, '.agents/skills/loom-changelog/SKILL.md', changelogSkill);
  }
  return run;
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
      const run = runInit(host.cwd, options.only, options.force);
      if (run.warnings.length > 0) {
        host.stderr.write(`${run.warnings.join('\n')}\n`);
      }
      return run.lines.map((line) => `${line}\n`).join('');
    });
  });
