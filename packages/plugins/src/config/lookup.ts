import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { escapeControlCharacters, InputError } from '@loomcli/core';
import type { ContextualStyle, Host, Out } from '@loomcli/core';

import { parseFile } from './formats.js';
import type { Clause, Reading } from './reading.js';

/**
 * The configuration plugin's lookup: the one file a run reads. `--config` names it, or else the
 * first of the pattern's candidates found in the working directory and then in the home
 * directory. A discovered file that cannot be used warns and counts as absent, and the named file
 * fails the run.
 */

/** One file the lookup reads: where it is, and how a label or a diagnostic shows it, escaped. */
interface ConfigFile {
  readonly path: string;
  readonly shown: string;
}

/** The file a run reads from, and the object its text holds. */
interface UsableFile {
  readonly file: ConfigFile;
  readonly object: Record<string, unknown>;
}

/** What decides the file one run reads. */
interface Lookup {
  /** The pattern's candidates, relative paths in the order the lookup tries them. */
  readonly candidates: readonly string[];
  readonly host: Host;
  /** The file `--config` named, which is the run's only file. */
  readonly named: string | undefined;
}

/** The channels a warning about a discovered file is written through. */
interface Channels {
  readonly out: Out;
  readonly style: ContextualStyle;
}

/** What the operator does about one clause: for the file `--config` named, and for a discovered file. */
interface Fix {
  readonly named: string;
  /** Absent for a clause a discovered file is silent about. */
  readonly discovered?: string;
}

/** The one table of fixes, so each sentence the plugin writes ends with its step. */
const fixes: Readonly<Record<Clause, Fix>> = {
  'could not be read.': {
    discovered: 'Make it readable, or remove it.',
    named: 'Supply a file this process can read.',
  },
  'does not exist.': { named: 'Supply the path of an existing file.' },
  'does not hold a JSON object.': {
    discovered: 'Write its settings as one JSON object, or remove it.',
    named: 'Write its settings as one JSON object.',
  },
  'does not hold a YAML mapping.': {
    discovered: 'Write its settings as one YAML mapping, or remove it.',
    named: 'Write its settings as one YAML mapping.',
  },
  'is not valid JSON.': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
  'is not valid TOML.': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
  'is not valid YAML.': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
};

/** Whether a failure means nothing is at the path, a missing directory or a file in its place included. */
function isAbsent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

/** One file at a path, shown with each control character escaped. */
function configFile(path: string, shown: string): ConfigFile {
  return { path, shown: escapeControlCharacters(shown) };
}

/**
 * The operator's home directory: `USERPROFILE` on a `win32` host and `HOME` on every other, or
 * `undefined` when that variable is unset, empty, or a relative path. The host's platform chooses
 * only the variable; the running process's path rules judge it.
 */
function homeDirectory(host: Host): string | undefined {
  const home = host.platform === 'win32' ? host.env.USERPROFILE : host.env.HOME;
  return home !== undefined && isAbsolute(home) ? home : undefined;
}

/**
 * The files one directory holds for each candidate, in candidate order. A file in the working
 * directory shows as the candidate names it, and one in the home directory as its full path.
 */
function candidateFiles(lookup: Lookup): ConfigFile[][] {
  const { candidates, host } = lookup;
  const working = candidates.map((candidate) =>
    configFile(resolve(host.cwd, candidate), candidate),
  );
  const home = homeDirectory(host);
  if (home === undefined || resolve(home) === resolve(host.cwd)) {
    return [working];
  }
  return [
    working,
    candidates.map((candidate) => {
      const path = resolve(home, candidate);
      return configFile(path, path);
    }),
  ];
}

/** Whether something is at a path. A failure other than absence counts as present, so a read reports it. */
async function isPresent(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    return !isAbsent(error);
  }
}

/** The file's text as UTF-8, or the clause that says why it could not be read. */
async function readText(path: string): Promise<{ text: string } | { clause: Clause }> {
  try {
    return { text: await readFile(path, 'utf8') };
  } catch (error) {
    return { clause: isAbsent(error) ? 'does not exist.' : 'could not be read.' };
  }
}

/** Reads one file once and answers with its object or the clause that says why it is skipped. */
async function read(file: ConfigFile): Promise<Reading> {
  const text = await readText(file.path);
  return 'clause' in text
    ? { clause: text.clause, kind: 'unusable' }
    : parseFile(file.path, text.text);
}

/** The failure a `--config` file that cannot be used raises: a usage failure on the option itself. */
function namedFailure(file: ConfigFile, clause: Clause): InputError {
  const message = `File "${file.shown}" ${clause} ${fixes[clause].named}`;
  return new InputError(`Option "--config": ${message}`, [
    {
      input: { global: true, kind: 'option', name: 'config' },
      issues: [{ message }],
      reason: 'invalid',
      spelling: '--config',
    },
  ]);
}

/** The file `--config` named, which answers alone, resolved against the host's working directory. */
async function namedFile(named: string, host: Host): Promise<UsableFile> {
  const file = configFile(resolve(host.cwd, named), named);
  const reading = await read(file);
  if (reading.kind === 'unusable') {
    throw namedFailure(file, reading.clause);
  }
  return { file, object: reading.object };
}

/** The candidates something is at, in candidate order, each checked without reading it. */
async function presentFiles(files: readonly ConfigFile[]): Promise<ConfigFile[]> {
  const present: ConfigFile[] = [];
  for (const file of files) {
    if (await isPresent(file.path)) {
      present.push(file);
    }
  }
  return present;
}

/** The one warning about the later present candidates a directory skips unread, when there are any. */
async function warnSkipped(
  found: ConfigFile,
  skipped: readonly ConfigFile[],
  { out, style }: Channels,
): Promise<void> {
  const [first] = skipped;
  if (first === undefined) {
    return;
  }
  const names = skipped.map((file) => style.escape(file.shown)).join(', ');
  await out.warn(
    `Skipped ${names}: ${style.escape(found.shown)} matches the same pattern first. Keep one of the files, and remove the others.`,
  );
}

/**
 * A discovered file read once: its object, or `undefined` after one warning when it cannot be
 * used. One that does not exist is silent.
 */
async function discoveredFile(
  file: ConfigFile,
  { out, style }: Channels,
): Promise<UsableFile | undefined> {
  const reading = await read(file);
  if (reading.kind === 'usable') {
    return { file, object: reading.object };
  }
  const fix = fixes[reading.clause].discovered;
  if (fix !== undefined) {
    await out.warn(`Skipped ${style.escape(file.shown)}: the file ${reading.clause} ${fix}`);
  }
  return undefined;
}

/**
 * The file one directory answers with, or `undefined` when it holds none it can use. The first
 * present candidate is the file found there. Every later present one is skipped unread with one
 * warning, ahead of any warning about the found file, and a found file that cannot be used warns
 * once and counts as absent.
 */
async function directoryFile(
  files: readonly ConfigFile[],
  channels: Channels,
): Promise<UsableFile | undefined> {
  const [found, ...skipped] = await presentFiles(files);
  if (found === undefined) {
    return undefined;
  }
  await warnSkipped(found, skipped, channels);
  return discoveredFile(found, channels);
}

/**
 * The one file a run reads, or `undefined` when it finds none it can use. The named file answers
 * alone and fails the run when it cannot be used; otherwise the working directory answers first and
 * the home directory after it.
 */
async function findFile(lookup: Lookup, channels: Channels): Promise<UsableFile | undefined> {
  if (lookup.named !== undefined) {
    return namedFile(lookup.named, lookup.host);
  }
  for (const files of candidateFiles(lookup)) {
    const usable = await directoryFile(files, channels);
    if (usable !== undefined) {
      return usable;
    }
  }
  return undefined;
}

export { findFile };
export type { UsableFile };
