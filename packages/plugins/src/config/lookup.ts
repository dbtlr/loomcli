import { lstat, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { escapeControlCharacters, InputError, nowrap } from '@loomcli/core';
import type { ContextualStyle, Host, Out } from '@loomcli/core';

import { homeOf } from '../application-folders.js';
import { parseFile } from './formats.js';
import { splitExtension } from './names.js';
import type { Position } from './position.js';
import type { Clause, Reading } from './reading.js';
import type { Reach } from './scopes.js';

/**
 * The configuration plugin's lookup: the one file a run reads. `--config` names it, or else the
 * variable does, or else the first of the pattern's candidates found in the scopes the author
 * chose: the project scope's walk from the start directory, then the user scope's home directory
 * and user folder. A file the variable names or the lookup discovers that cannot be used warns and
 * ends the lookup with no configuration, and the named file fails the run.
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
  /** The directory option's value, which replaces `host.cwd` as the walk's start. */
  readonly directory: string | undefined;
  /** The value of the author-named variable, empty or unset when it names nothing. */
  readonly fromVariable: string | undefined;
  readonly host: Host;
  /** The application's name, which the user folder and the notice use. */
  readonly app: string;
  /** Whether a lookup that finds no file says so. */
  readonly notice: boolean;
  /** The scopes the lookup reads and the markers that end its walk. */
  readonly reach: Reach;
  /** The file `--config` named, which is the run's only file. */
  readonly named: string | undefined;
  /** Whether `--no-config` asked the run to read no file. */
  readonly ignored: boolean;
  /**
   * How a problem names the `config` option: by its spelling, `--config`, or, in an invocation by
   * name, by its declared name, as core names an option there.
   */
  readonly invokedBy: 'argv' | 'name';
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

/** A reading that cannot be used: the clause that says why, and where the file breaks when known. */
type Unusable = Extract<Reading, { kind: 'unusable' }>;

/** A clause without its closing full stop, so the sentence can go on. */
function withoutStop(clause: Clause): string {
  return clause.replace(/\.$/u, '');
}

/** Where a file stops parsing, as the sentence names it, or nothing when the parser named no place. */
function where(at: Position | undefined): string {
  return at === undefined ? '' : ` at line ${at.line}, column ${at.column}`;
}

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
 * The candidates in one directory, in candidate order. A file the walk finds in the working
 * directory shows as the candidate names it, and every other file as its full path.
 */
function filesIn(
  directory: string,
  candidates: readonly string[],
  { host, walked }: { host: Host; walked: boolean },
): ConfigFile[] {
  const working = walked && directory === resolve(host.cwd);
  return candidates.map((candidate) => {
    const path = resolve(directory, candidate);
    return configFile(path, working ? candidate : path);
  });
}

/** Whether a directory is the home directory or inside it, compared as `node:path` resolves them. */
function isInside(directory: string, home: string): boolean {
  const path = relative(home, directory);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/**
 * The directories the walk may look in, nearest first: the start directory and each ancestor, up
 * to the directory below home when the start is inside it, and up to the root otherwise. The home
 * directory belongs to the user scope, so a start at home walks nowhere.
 */
function walkDirectories(start: string, home: string | undefined): string[] {
  const bound = home !== undefined && isInside(start, home) ? home : undefined;
  const directories: string[] = [];
  for (let directory = start; directory !== bound; directory = dirname(directory)) {
    directories.push(directory);
    if (dirname(directory) === directory) {
      break;
    }
  }
  return directories;
}

/** The extensions the user file may carry. */
const userExtensions = new Set(['json', 'jsonc', 'toml', 'yaml', 'yml']);

/**
 * The user file's candidates, `config.<ext>`: each of the pattern's candidates names one extension,
 * its own when the plugin reads it and `json` otherwise, and an extension named twice counts once.
 */
function userCandidates(candidates: readonly string[]): string[] {
  const extensions = candidates.map((candidate) => {
    const extension = splitExtension(candidate)?.extension ?? '';
    return userExtensions.has(extension) ? extension : 'json';
  });
  return [...new Set(extensions)].map((extension) => `config.${extension}`);
}

/**
 * The folder of the application's own files under the user's configuration folder:
 * `$XDG_CONFIG_HOME/<app>`, or `<home>/.config/<app>` when the variable is unset, empty, or
 * relative. None when there is neither.
 */
function userFolder(app: string, host: Host, home: string | undefined): string | undefined {
  const xdg = host.env.XDG_CONFIG_HOME;
  if (xdg !== undefined && isAbsolute(xdg)) {
    return join(xdg, app);
  }
  return home === undefined ? undefined : join(home, '.config', app);
}

/**
 * Whether something is at a path, through a symbolic link by default. A failure other than absence
 * counts as present, so a read reports it and a walk stops there.
 */
async function isPresent(path: string, look: typeof stat = stat): Promise<boolean> {
  try {
    await look(path);
    return true;
  } catch (error) {
    return !isAbsent(error);
  }
}

/** Whether a directory holds an entry of a marker's name: a file, a directory, or any symbolic link. */
async function holdsMarker(directory: string, markers: readonly string[]): Promise<boolean> {
  for (const marker of markers) {
    if (await isPresent(join(directory, marker), lstat)) {
      return true;
    }
  }
  return false;
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

/**
 * The failure a `--config` file that cannot be used raises: a usage failure on the option itself,
 * named by its spelling, or by its declared name in an invocation by name.
 */
function namedFailure(
  file: ConfigFile,
  { at, clause }: Unusable,
  invokedBy: Lookup['invokedBy'],
): InputError {
  const message = `File "${file.shown}" ${withoutStop(clause)}${where(at)}. ${fixes[clause].named}`;
  const spelling = invokedBy === 'name' ? 'config' : '--config';
  return new InputError(`Option "${spelling}": ${message}`, [
    {
      input: { global: true, kind: 'option', name: 'config' },
      issues: [{ message }],
      reason: 'invalid',
      spelling,
    },
  ]);
}

/**
 * The failure `--config` and `--no-config` together raise: a usage failure in the form core gives
 * an exclusive option group, since the two cannot both hold.
 */
function bothFailure(invokedBy: Lookup['invokedBy']): InputError {
  const names = ['config', 'no-config'];
  const spellings = names.map((name) => (invokedBy === 'name' ? name : `--${name}`));
  const members = spellings.map((spelling) => `"${spelling}"`).join(' and ');
  return new InputError(`Options ${members} cannot be used together. Supply only one of them.`, [
    {
      inputs: names.map((name) => ({ global: true, kind: 'option', name })),
      reason: 'exclusive',
      spellings,
      supplied: spellings,
    },
  ]);
}

/** The run under `--no-config`, which reads no file, and fails when `--config` names one too. */
function ignoredFile(lookup: Lookup): undefined {
  if (lookup.named !== undefined) {
    throw bothFailure(lookup.invokedBy);
  }
  return undefined;
}

/** The file `--config` named, which answers alone, resolved against the host's working directory. */
async function namedFile(named: string, lookup: Lookup): Promise<UsableFile> {
  const file = configFile(resolve(lookup.host.cwd, named), named);
  const reading = await read(file);
  if (reading.kind === 'unusable') {
    throw namedFailure(file, reading, lookup.invokedBy);
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
  const names = skipped.map((file) => nowrap(style.escape(file.shown))).join(', ');
  await out.warn(
    `Skipped ${names}: ${nowrap(style.escape(found.shown))} matches the same pattern first. Keep one of the files, and remove the others.`,
  );
}

/** How a step of the lookup ended: with a file, or with no configuration and no later step. */
type Outcome = { readonly kind: 'ended' } | { readonly kind: 'file'; readonly usable: UsableFile };

/** The warning text for a clause: the file's fault, and that the run then reads no configuration. */
function skippedSentence(shown: string, { at, clause }: Unusable, fix: string): string {
  return `Skipped ${shown}: the file ${withoutStop(clause)}${where(at)}, so this run reads no configuration. ${fix}`;
}

/**
 * A discovered file read once: its object, or the end of the lookup after one warning when it
 * cannot be used. One that does not exist is silent, and the lookup goes on.
 */
async function discoveredFile(file: ConfigFile, channels: Channels): Promise<Outcome | undefined> {
  const reading = await read(file);
  if (reading.kind === 'usable') {
    return { kind: 'file', usable: { file, object: reading.object } };
  }
  const fix = fixes[reading.clause].discovered;
  if (fix === undefined) {
    return undefined;
  }
  const shown = nowrap(channels.style.escape(file.shown));
  await channels.out.warn(skippedSentence(shown, reading, fix));
  return { kind: 'ended' };
}

/**
 * The outcome one directory gives, or `undefined` when it holds nothing. The first present
 * candidate is the file found there. Every later present one is skipped unread with one warning,
 * ahead of any warning about the found file.
 */
async function directoryFile(
  files: readonly ConfigFile[],
  channels: Channels,
): Promise<Outcome | undefined> {
  const [found, ...skipped] = await presentFiles(files);
  if (found === undefined) {
    return undefined;
  }
  await warnSkipped(found, skipped, channels);
  return discoveredFile(found, channels);
}

/** The file the variable names, read alone: a missing one ends the lookup silently. */
async function variableFile(value: string, lookup: Lookup, channels: Channels): Promise<Outcome> {
  const file = configFile(resolve(lookup.host.cwd, value), value);
  return (await discoveredFile(file, channels)) ?? { kind: 'ended' };
}

/** One directory a discovered step looks in, with the candidates it tries there, in order. */
interface Step {
  readonly directory: string;
  readonly candidates: readonly string[];
  /** Whether the walk looks here, so a file in the working directory shows as its candidate. */
  readonly walked: boolean;
}

/** The home directory as `node:path` resolves it, or none when the host has no absolute one. */
function resolvedHome(host: Host): string | undefined {
  const home = homeOf(host);
  return home === undefined ? undefined : resolve(home);
}

/** The directory the walk starts in: the directory option's value, or else `host.cwd`. */
function startDirectory(lookup: Lookup): string {
  return resolve(lookup.host.cwd, lookup.directory ?? '.');
}

/**
 * The project scope's steps: the walk's directories, nearest first, ending after a directory that
 * holds a root marker. The marker is checked after the directory is looked in.
 */
async function* projectSteps(lookup: Lookup, home: string | undefined): AsyncGenerator<Step> {
  const { candidates, reach } = lookup;
  for (const directory of walkDirectories(startDirectory(lookup), home)) {
    yield { candidates, directory, walked: true };
    if (await holdsMarker(directory, reach.markers)) {
      return;
    }
  }
}

/**
 * The user scope's steps: the home directory, then the user folder. The home file shows as its
 * candidate when it is in `host.cwd` and the start is inside home, as a walked file would.
 */
function userSteps(lookup: Lookup, home: string | undefined): Step[] {
  const steps: Step[] = [];
  if (home !== undefined) {
    const walked = isInside(startDirectory(lookup), home);
    steps.push({ candidates: lookup.candidates, directory: home, walked });
  }
  const user = userFolder(lookup.app, lookup.host, home);
  if (user !== undefined) {
    steps.push({ candidates: userCandidates(lookup.candidates), directory: user, walked: false });
  }
  return steps;
}

/** The steps the discovered files are looked for in, the project scope's before the user scope's. */
async function* searchSteps(lookup: Lookup): AsyncGenerator<Step> {
  const home = resolvedHome(lookup.host);
  if (lookup.reach.project) {
    yield* projectSteps(lookup, home);
  }
  if (lookup.reach.user) {
    yield* userSteps(lookup, home);
  }
}

/**
 * The step the notice names its file in: the start directory under the project scope, and the
 * home directory, or else the user folder, under the user scope alone. None when there is neither.
 */
function noticeStep(lookup: Lookup): Step | undefined {
  if (lookup.reach.project) {
    return { candidates: lookup.candidates, directory: startDirectory(lookup), walked: true };
  }
  const [first] = userSteps(lookup, resolvedHome(lookup.host));
  return first;
}

/** Writes the line that says no file was found, naming the first candidate where the lookup starts. */
async function announceNoFile(lookup: Lookup, { out, style }: Channels): Promise<void> {
  const step = noticeStep(lookup);
  const [first] =
    step === undefined
      ? []
      : filesIn(step.directory, step.candidates, { host: lookup.host, walked: step.walked });
  if (first !== undefined) {
    await out.info(
      `Found no configuration file. Create ${nowrap(style.escape(first.shown))} to configure ${lookup.app}.`,
    );
  }
}

/** The outcome of the first discovered step that holds a file, or `undefined` when none does. */
async function searched(lookup: Lookup, channels: Channels): Promise<Outcome | undefined> {
  for await (const step of searchSteps(lookup)) {
    const outcome = await directoryFile(
      filesIn(step.directory, step.candidates, { host: lookup.host, walked: step.walked }),
      channels,
    );
    if (outcome !== undefined) {
      return outcome;
    }
  }
  return undefined;
}

/**
 * The one file a run reads, or `undefined` when it finds none it can use. `--no-config` reads no
 * file and writes no notice, and with `--config` beside it fails the run. The named file answers
 * alone and fails the run when it cannot be used. Then the variable's file answers alone, and the
 * walk, the home directory, and the user folder answer in that order, each under its scope. A file
 * that cannot be used ends the lookup with a warning, and no later step answers in its place.
 */
async function findFile(lookup: Lookup, channels: Channels): Promise<UsableFile | undefined> {
  if (lookup.ignored) {
    return ignoredFile(lookup);
  }
  if (lookup.named !== undefined) {
    return namedFile(lookup.named, lookup);
  }
  const { fromVariable } = lookup;
  // The variable's file always ends the lookup, so only a search that finds nothing is noticed.
  const outcome =
    fromVariable === undefined || fromVariable === ''
      ? await searched(lookup, channels)
      : await variableFile(fromVariable, lookup, channels);
  if (outcome === undefined && lookup.notice) {
    await announceNoFile(lookup, channels);
  }
  return outcome?.kind === 'file' ? outcome.usable : undefined;
}

export { findFile };
export type { UsableFile };
