/*
 * The four children: `generate` writes the set to a folder and records nothing; `install`,
 * `update`, and `uninstall` act on the set under the operator's home through the installed-files
 * module, recorded in the plugin's file `manpage.json`.
 */
import { statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { CommandGraph, Host } from '@loomcli/core';

import { isEmpty } from '../help/cells.js';
import {
  createDirectory,
  digestOf,
  errorCode,
  missingParents,
  observe,
  replaceFile,
} from '../installation/disk.js';
import { hasPendingRecord, install, readRecorded, uninstall } from '../installation/files.js';
import type { InstalledFile, InstallOutcome, Refusal } from '../installation/files.js';
import { refusals as homeRefusals } from '../skills/messages.js';
import { homeOf, recordDirectory } from '../skills/targets.js';
import { advice } from './advice.js';
import { lines, refusals } from './messages.js';
import type { WritingVerb } from './messages.js';
import { manPages } from './page.js';
import type { ManPage } from './page.js';

/** What a child reads from its action: the application, the run, and the lanes it writes. */
interface ChildRun {
  readonly graph: CommandGraph;
  readonly host: Host;
  readonly signal: AbortSignal;
  readonly info: (message: string) => Promise<void>;
  readonly print: (message: string) => Promise<void>;
  readonly success: (message: string) => Promise<void>;
  readonly warn: (message: string) => Promise<void>;
}

/** The plugin's file in the installation record, `manpage.json`. */
const plugin = 'manpage';

/** The permission bits of a folder the plugin creates and of a page it writes, whatever the umask. */
const folderMode = 0o755;
const pageMode = 0o644;

/** The folder under the home that `install` writes the set to. */
const homeFolder = ['.local', 'share', 'man', 'man1'];

/** The count a removed page adds to its folder's. */
const onePage = 1;
const noPages = 0;

/** The page files of the set in a folder, as the installed-files module writes them. */
function filesIn(folder: string, set: readonly ManPage[]): InstalledFile[] {
  return set.map(({ file, text }) => ({ content: text, mode: pageMode, path: join(folder, file) }));
}

/** What a path names, following links, or `undefined` when nothing is there or a parent is a file. */
function statOf(path: string): Stats | undefined {
  try {
    return statSync(path, { throwIfNoEntry: false });
  } catch (error) {
    if (errorCode(error) === 'ENOTDIR') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Whether a path names something other than a folder: the nearest of it and its parents that
 * exists, which is where the plugin would create the rest, is not a folder.
 */
function isNotFolder(path: string): boolean {
  let current = path;
  let found = statOf(current);
  while (found === undefined && dirname(current) !== current) {
    current = dirname(current);
    found = statOf(current);
  }
  return found !== undefined && !found.isDirectory();
}

/** The folder `--out` names, resolved against the working directory, which must be a folder when it exists. */
function outFolder(run: ChildRun, out: string): string {
  const folder = resolve(run.host.cwd, out);
  if (isNotFolder(folder)) {
    throw refusals.notFolder(run.graph.name, folder);
  }
  return folder;
}

/**
 * `generate`: the folder created with its missing parents when it is missing, then each page
 * written through a staging file and a rename, which replaces a file or a link of that name.
 */
async function generatePages(run: ChildRun, out: string): Promise<void> {
  const folder = outFolder(run, out);
  const pages = filesIn(folder, manPages(run.graph));
  for (const directory of missingParents(join(folder, plugin))) {
    createDirectory(directory, folderMode);
  }
  for (const page of pages) {
    replaceFile(page.path, page.content, { mode: pageMode });
  }
  await run.success(lines.wrote(pages.length, folder));
}

/** What a writing child reads: the record's directory and what the plugin's file records. */
interface Recorded {
  readonly record: string;
  readonly files: readonly { readonly path: string; readonly digest: string }[];
}

/** The record's directory and the plugin's file, or the refusal of either. */
function readRecord(run: ChildRun, verb: 'install' | 'uninstall'): Recorded {
  const name = run.graph.name;
  const record = recordDirectory(name, run.host);
  const read = readRecorded({ plugin, record });
  if (read.status === 'refused') {
    throw refusals.record(name, read.refused.path, verb);
  }
  return { files: read.files, record };
}

/**
 * Whether the recorded set is the set this run would write: the plugin's file is committed, it
 * records exactly the set's paths, and each page holds its recorded digest and the one it would.
 */
function isUnchanged(recorded: Recorded, wanted: readonly InstalledFile[]): boolean {
  if (hasPendingRecord({ plugin, record: recorded.record })) {
    return false;
  }
  const digests = new Map(recorded.files.map(({ digest, path }) => [path, digest]));
  return (
    digests.size === wanted.length &&
    wanted.every(({ content, path }) => {
      const seen = observe(path);
      const digest = digestOf(content);
      return seen.kind === 'file' && seen.digest === digest && digests.get(path) === digest;
    })
  );
}

/** States each refused page, then fails: nothing was written. */
async function refuse(
  run: ChildRun,
  verb: WritingVerb,
  refused: readonly Refusal[],
): Promise<never> {
  const name = run.graph.name;
  for (const { path, reason } of refused) {
    if (reason === 'damaged' || reason === 'unknown-format') {
      throw refusals.record(name, path, 'install');
    }
    await run.warn(
      reason === 'changed' ? lines.changed(name, path) : lines.notInstalled(name, path),
    );
  }
  throw refusals.inTheWay(name, verb);
}

/** States each recorded page the set no longer holds: removed when unchanged, left in place when changed. */
async function reportRemovals(
  run: ChildRun,
  { kept, removed }: { readonly kept: readonly string[]; readonly removed: readonly string[] },
): Promise<void> {
  for (const path of removed) {
    await run.info(lines.removed(path));
  }
  for (const path of kept) {
    await run.warn(lines.kept(run.graph.name, path));
  }
}

/** What a write of the set reads: the folder, the record, and the Command that writes. */
interface Writing {
  readonly folder: string;
  readonly recorded: Recorded;
  readonly verb: WritingVerb;
}

/** The module's install of the set, or the refusal of every page in the way. */
async function installed(
  run: ChildRun,
  { recorded, verb }: Writing,
  wanted: readonly InstalledFile[],
): Promise<Extract<InstallOutcome, { status: 'installed' }>> {
  const outcome = install({
    directoryMode: folderMode,
    files: wanted,
    plugin,
    record: recorded.record,
    signal: run.signal,
  });
  return outcome.status === 'refused' ? refuse(run, verb, outcome.refused) : outcome;
}

/** Writes the set into a folder through the module, or states it unchanged. */
async function writeSet(run: ChildRun, writing: Writing): Promise<void> {
  const { folder, recorded, verb } = writing;
  const wanted = filesIn(folder, manPages(run.graph));
  if (isUnchanged(recorded, wanted)) {
    await run.info(lines.unchanged(wanted.length, folder));
    return;
  }
  const outcome = await installed(run, writing, wanted);
  const written = verb === 'update' ? lines.updated : lines.installed;
  await run.success(written(wanted.length, folder));
  await reportRemovals(run, outcome);
}

/** The home `install` writes under: `HOME`, which must be an absolute path. */
function homeFor(run: ChildRun): string {
  const home = homeOf(run.host);
  if (home === undefined) {
    throw homeRefusals.home(run.graph.name, 'HOME');
  }
  return home;
}

/** States how to read the pages: `man <name>`, or the line that sets `MANPATH` when man will not find them. */
async function adviseOn(run: ChildRun, home: string): Promise<void> {
  const advised = advice(home, run.host.env);
  if (advised === undefined) {
    await run.info(lines.read(run.graph.name));
    return;
  }
  await run.warn(lines.advice(advised.folder));
  await run.print(advised.line);
}

/** `install`: the set under `<home>/.local/share/man/man1`, then the advice when man will not find it. */
async function installPages(run: ChildRun): Promise<void> {
  if (run.host.platform === 'win32') {
    throw refusals.windows(run.graph.name);
  }
  const home = homeFor(run);
  const recorded = readRecord(run, 'install');
  await writeSet(run, { folder: join(home, ...homeFolder), recorded, verb: 'install' });
  await adviseOn(run, home);
}

/** The folders the recorded pages sit in, in the order the record lists them. */
function foldersOf(files: readonly { readonly path: string }[]): string[] {
  return [...new Set(files.map(({ path }) => dirname(path)))];
}

/** `update`: the set into the folder that holds the recorded pages, which derives nothing from `HOME`. */
async function updatePages(run: ChildRun): Promise<void> {
  const name = run.graph.name;
  const recorded = run.host.platform === 'win32' ? undefined : readRecord(run, 'install');
  const [folder, ...others] = recorded === undefined ? [] : foldersOf(recorded.files);
  if (recorded === undefined || folder === undefined) {
    await run.success(lines.noneToUpdate(name));
    return;
  }
  if (!isEmpty(others)) {
    throw refusals.manyFolders(name, join(recorded.record, `${plugin}.json`));
  }
  await writeSet(run, { folder, recorded, verb: 'update' });
}

/** The count of removed pages in each folder, in the order the record lists them. */
function countsByFolder(removed: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of removed) {
    counts.set(dirname(path), (counts.get(dirname(path)) ?? noPages) + onePage);
  }
  return counts;
}

/** The module's uninstall: each unchanged recorded page removed, each changed one kept. */
function uninstalled(run: ChildRun): {
  readonly kept: readonly string[];
  readonly removed: readonly string[];
} {
  const { record } = readRecord(run, 'uninstall');
  const outcome = uninstall({ plugin, record, signal: run.signal });
  if (outcome.status === 'refused') {
    const [refused] = outcome.refused;
    throw refusals.record(run.graph.name, refused?.path ?? record, 'uninstall');
  }
  return outcome;
}

/** `uninstall`: the recorded pages removed or kept, and the plugin's file deleted. */
async function uninstallPages(run: ChildRun): Promise<void> {
  const outcome = run.host.platform === 'win32' ? { kept: [], removed: [] } : uninstalled(run);
  if (isEmpty(outcome.removed) && isEmpty(outcome.kept)) {
    await run.success(lines.noneToRemove(run.graph.name));
    return;
  }
  for (const [folder, count] of countsByFolder(outcome.removed)) {
    await run.success(lines.removedFrom(count, folder));
  }
  await reportRemovals(run, { kept: outcome.kept, removed: [] });
}

export type { ChildRun };
export { generatePages, installPages, uninstallPages, updatePages };
