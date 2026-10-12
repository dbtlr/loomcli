/**
 * A first-party plugin's file in the installation record, `<plugin>.json`: the directories the
 * installed-files module created and each file it installed with its digest. Only the module reads
 * or writes it, and it replaces the file whole, through a staging file and a rename.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { isRecord } from '../plain-data.js';
import { replaceFile } from './disk.js';

/** A recorded file and the digest the module wrote to it. */
interface CommittedFile {
  readonly path: string;
  readonly digest: string;
}

/**
 * A file an install or uninstall under way touches: the digest it held before, `null` when it
 * held nothing, and the one it will hold, `null` when the file is being removed.
 */
interface PendingFile {
  readonly path: string;
  readonly prior: string | null;
  readonly intended: string | null;
}

/** What the module recorded once its work finished. */
interface Committed {
  readonly state: 'committed';
  readonly directories: readonly string[];
  readonly files: readonly CommittedFile[];
}

/** What the module was doing when it wrote the file: the work a later run recovers. */
interface Pending {
  readonly state: 'pending';
  readonly directories: readonly string[];
  readonly files: readonly PendingFile[];
}

type PluginFile = Committed | Pending;

/** What reading a plugin's file found: nothing, a file the module cannot read, or the file. */
type PluginFileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused'; readonly reason: 'damaged' | 'unknown-format' }
  | { readonly kind: 'read'; readonly file: PluginFile };

/** The one format the module reads and writes. */
const knownFormat = 1;

/** The record of a plugin that has installed nothing. */
const nothingRecorded: Committed = { directories: [], files: [], state: 'committed' };

/** A SHA-256 digest as the record spells it: `sha256:` and 64 lowercase hexadecimal digits. */
const sha256Digest = /^sha256:[\da-f]{64}$/u;

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && sha256Digest.test(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value);
}

/** The path of a plugin's file in the record directory. */
function pluginFilePath(record: string, plugin: string): string {
  return join(record, `${plugin}.json`);
}

/** The entries of an array whose every member `read` accepts, or `undefined` for anything else. */
function everyOf<Entry>(
  value: unknown,
  read: (member: unknown) => Entry | undefined,
): readonly Entry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries: Entry[] = [];
  for (const member of value) {
    const entry = read(member);
    if (entry === undefined) {
      return undefined;
    }
    entries.push(entry);
  }
  return entries;
}

function committedFileOf(value: unknown): CommittedFile | undefined {
  if (!isRecord(value) || !isAbsolutePath(value.path) || !isDigest(value.digest)) {
    return undefined;
  }
  return { digest: value.digest, path: value.path };
}

/** A digest or `null`, as a pending entry holds one, or `undefined` for anything else. */
function digestOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return isDigest(value) ? value : undefined;
}

function pendingFileOf(value: unknown): PendingFile | undefined {
  if (!isRecord(value) || !isAbsolutePath(value.path)) {
    return undefined;
  }
  const prior = digestOrNull(value.prior);
  const intended = digestOrNull(value.intended);
  return prior === undefined || intended === undefined
    ? undefined
    : { intended, path: value.path, prior };
}

/** The plugin's file one parsed value holds, or `undefined` when it is not that shape. */
function pluginFileOf(value: Record<string, unknown>): PluginFile | undefined {
  const directories = everyOf(value.directories, (member) =>
    isAbsolutePath(member) ? member : undefined,
  );
  if (directories === undefined) {
    return undefined;
  }
  if (value.state === 'committed') {
    const files = everyOf(value.files, committedFileOf);
    return files === undefined ? undefined : { directories, files, state: 'committed' };
  }
  if (value.state === 'pending') {
    const files = everyOf(value.files, pendingFileOf);
    return files === undefined ? undefined : { directories, files, state: 'pending' };
  }
  return undefined;
}

/** The plugin's file's text, or `undefined` when there is none. A failed read throws. */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/** Parsed JSON, or `undefined` for text that is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads a plugin's file: missing, refused as damaged or of an unknown format, or read. */
function readPluginFile(path: string): PluginFileRead {
  const text = readText(path);
  if (text === undefined) {
    return { kind: 'missing' };
  }
  const value = parsed(text);
  if (!isRecord(value)) {
    return { kind: 'refused', reason: 'damaged' };
  }
  if (value.format !== knownFormat) {
    return { kind: 'refused', reason: 'unknown-format' };
  }
  const file = pluginFileOf(value);
  return file === undefined ? { kind: 'refused', reason: 'damaged' } : { file, kind: 'read' };
}

/** The plugin's file as one line of JSON, its members in the contract's order. */
function serialize(file: PluginFile): string {
  const files =
    file.state === 'committed'
      ? file.files.map(({ path, digest }) => ({ path, digest }))
      : file.files.map(({ path, prior, intended }) => ({ path, prior, intended }));
  const { state, directories } = file;
  return `${JSON.stringify({ format: knownFormat, state, directories, files })}\n`;
}

/** Replaces the plugin's file whole, creating the record directory when it is missing. */
function writePluginFile(path: string, file: PluginFile): void {
  mkdirSync(dirname(path), { recursive: true });
  replaceFile(path, serialize(file));
}

export type { Committed, CommittedFile, Pending, PendingFile, PluginFile };
export { nothingRecorded, pluginFilePath, readPluginFile, writePluginFile };
