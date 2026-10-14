/**
 * A first-party plugin's file in the installation record, `<plugin>.json`: the directories the
 * installed-files module created, each file it installed with its digest, each installed folder by
 * its path alone, and each startup line by its startup file's path and its text. Only the module
 * reads or writes it, and it replaces the file whole, through a staging file and a rename.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { isRecord } from '../plain-data.js';
import { errorCode, replaceFile } from './disk.js';

/** A recorded file and the digest the module wrote to it. */
interface CommittedFile {
  readonly path: string;
  readonly digest: string;
}

/**
 * An installed folder, recorded by its path alone: the plugin owns it whole, so no digest says what
 * is inside. A pending file lists the folders an install under way writes or removes the same way.
 */
interface RecordedFolder {
  readonly path: string;
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

/**
 * A startup line, recorded by its startup file's path and its text, never the file's digest,
 * because the startup file is the operator's.
 */
interface StartupLine {
  readonly path: string;
  readonly line: string;
}

/**
 * A startup line an install or uninstall under way touches: the text recorded before, `null` for
 * none, and the text it will hold, `null` when the line is being removed.
 */
interface PendingLine {
  readonly path: string;
  readonly prior: string | null;
  readonly intended: string | null;
}

/** What the module recorded once its work finished. */
interface Committed {
  readonly state: 'committed';
  readonly directories: readonly string[];
  readonly files: readonly CommittedFile[];
  readonly folders: readonly RecordedFolder[];
  readonly lines: readonly StartupLine[];
}

/** What the module was doing when it wrote the file: the work a later run recovers. */
interface Pending {
  readonly state: 'pending';
  readonly directories: readonly string[];
  readonly files: readonly PendingFile[];
  readonly folders: readonly RecordedFolder[];
  readonly lines: readonly PendingLine[];
}

type PluginFile = Committed | Pending;

/** What reading a plugin's file found: nothing, a file the module cannot read, or the file. */
type PluginFileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused'; readonly reason: 'damaged' | 'unknown-format' }
  | { readonly kind: 'read'; readonly file: PluginFile };

/** The count of folders or startup lines a plugin's file omits the member for. */
const none = 0;

/** The one format the module reads and writes. */
const knownFormat = 1;

/** The record of a plugin that has installed nothing. */
const nothingRecorded: Committed = {
  directories: [],
  files: [],
  folders: [],
  lines: [],
  state: 'committed',
};

/** A SHA-256 digest as the record spells it: `sha256:` and 64 lowercase hexadecimal digits. */
const sha256Digest = /^sha256:[\da-f]{64}$/u;

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && sha256Digest.test(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value);
}

/** A line break, which no startup line holds. */
const lineBreak = /[\n\r]/u;

/** Whether a value is a startup line's text: one line, not empty, with no line break. */
function isLineText(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !lineBreak.test(value);
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

function recordedFolderOf(value: unknown): RecordedFolder | undefined {
  return isRecord(value) && isAbsolutePath(value.path) ? { path: value.path } : undefined;
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

function startupLineOf(value: unknown): StartupLine | undefined {
  if (!isRecord(value) || !isAbsolutePath(value.path) || !isLineText(value.line)) {
    return undefined;
  }
  return { line: value.line, path: value.path };
}

/** A line's text or `null`, as a pending startup line holds one, or `undefined` for anything else. */
function lineOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return isLineText(value) ? value : undefined;
}

function pendingLineOf(value: unknown): PendingLine | undefined {
  if (!isRecord(value) || !isAbsolutePath(value.path)) {
    return undefined;
  }
  const prior = lineOrNull(value.prior);
  const intended = lineOrNull(value.intended);
  return prior === undefined || intended === undefined
    ? undefined
    : { intended, path: value.path, prior };
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

/** The entries of a member a plugin's file may omit, none when it does, or `undefined` when malformed. */
function optionalOf<Entry>(
  value: unknown,
  read: (member: unknown) => Entry | undefined,
): readonly Entry[] | undefined {
  return value === undefined ? [] : everyOf(value, read);
}

/** The plugin's file one parsed value holds, or `undefined` when it is not that shape. */
function pluginFileOf(value: Record<string, unknown>): PluginFile | undefined {
  const directories = everyOf(value.directories, (member) =>
    isAbsolutePath(member) ? member : undefined,
  );
  const folders = optionalOf(value.folders, recordedFolderOf);
  if (directories === undefined || folders === undefined) {
    return undefined;
  }
  return recordedEntriesOf(value, { directories, folders });
}

/**
 * The plugin's file with its files and startup lines read by its state, or `undefined` for a state,
 * files, or lines not that shape.
 */
function recordedEntriesOf(
  value: Record<string, unknown>,
  rest: { directories: readonly string[]; folders: readonly RecordedFolder[] },
): PluginFile | undefined {
  if (value.state === 'committed') {
    const files = everyOf(value.files, committedFileOf);
    const lines = optionalOf(value.lines, startupLineOf);
    return files === undefined || lines === undefined
      ? undefined
      : { ...rest, files, lines, state: 'committed' };
  }
  if (value.state === 'pending') {
    const files = everyOf(value.files, pendingFileOf);
    const lines = optionalOf(value.lines, pendingLineOf);
    return files === undefined || lines === undefined
      ? undefined
      : { ...rest, files, lines, state: 'pending' };
  }
  return undefined;
}

/** The plugin's file's text, or `undefined` when there is none. A failed read throws. */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
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

/** The files and startup lines of a plugin's file, each entry's members in the contract's order. */
function entryMembers(file: PluginFile): { files: object[]; lines: object[] } {
  if (file.state === 'committed') {
    return {
      files: file.files.map(({ path, digest }) => ({ path, digest })),
      lines: file.lines.map(({ path, line }) => ({ path, line })),
    };
  }
  return {
    files: file.files.map(({ path, prior, intended }) => ({ path, prior, intended })),
    lines: file.lines.map(({ path, prior, intended }) => ({ path, prior, intended })),
  };
}

/**
 * The plugin's file as one line of JSON, its members in the contract's order, then `folders` and
 * `lines`, each only when it lists any.
 */
function serialize(file: PluginFile): string {
  const { files, lines } = entryMembers(file);
  const { state, directories } = file;
  const folders = file.folders.map(({ path }) => ({ path }));
  const members = {
    format: knownFormat,
    state,
    directories,
    files,
    ...(folders.length === none ? {} : { folders }),
    ...(lines.length === none ? {} : { lines }),
  };
  return `${JSON.stringify(members)}\n`;
}

/** Replaces the plugin's file whole, creating the record directory when it is missing. */
function writePluginFile(path: string, file: PluginFile): void {
  mkdirSync(dirname(path), { recursive: true });
  replaceFile(path, serialize(file));
}

export type {
  Committed,
  CommittedFile,
  Pending,
  PendingFile,
  PendingLine,
  PluginFile,
  RecordedFolder,
  StartupLine,
};
export { isLineText, nothingRecorded, pluginFilePath, readPluginFile, writePluginFile };
