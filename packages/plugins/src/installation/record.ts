/**
 * A first-party plugin's file in the installation record, `<plugin>.json`: the directories the
 * installed-files module created, each file it installed with its digest, each installed folder with
 * its per-file digests, each startup line by its startup file's path and its text, and each agent
 * registration by its name and command line. Only the module
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
 * An installed folder with the digests of its files; an earlier format or recovery can keep its path alone.
 */
interface RecordedFolder {
  readonly path: string;
  readonly files?: readonly FolderDigest[];
}

/** One installed file's relative path, content digest, and generated reference mark. */
interface FolderDigest {
  readonly path: string;
  readonly digest: string;
  readonly generated?: true;
}

/** A folder's prior and intended records during a swap; path denotes an earlier path-only record. */
interface PendingFolder extends RecordedFolder {
  readonly prior?: readonly FolderDigest[] | 'path' | null;
  readonly intended?: readonly FolderDigest[] | null;
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

/** A registration an agent holds, recorded by its name and the command line it starts. */
interface RecordedRegistration {
  readonly name: string;
  readonly command: readonly string[];
}

/**
 * A registration an install or uninstall under way touches: the command line recorded before,
 * `null` for none, and the one it will hold, `null` when the registration is being removed.
 */
interface PendingRegistration {
  readonly name: string;
  readonly prior: readonly string[] | null;
  readonly intended: readonly string[] | null;
}

/** What the module recorded once its work finished. */
interface Committed {
  readonly state: 'committed';
  readonly directories: readonly string[];
  readonly files: readonly CommittedFile[];
  readonly folders: readonly RecordedFolder[];
  readonly lines: readonly StartupLine[];
  readonly registrations: readonly RecordedRegistration[];
}

/** What the module was doing when it wrote the file: the work a later run recovers. */
interface Pending {
  readonly state: 'pending';
  readonly directories: readonly string[];
  readonly files: readonly PendingFile[];
  readonly folders: readonly PendingFolder[];
  readonly lines: readonly PendingLine[];
  readonly registrations: readonly PendingRegistration[];
}

type PluginFile = Committed | Pending;

/** What reading a plugin's file found: nothing, a file the module cannot read, or the file. */
type PluginFileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused'; readonly reason: 'damaged' | 'unknown-format' }
  | { readonly kind: 'read'; readonly file: PluginFile };

/** The count of folders or startup lines a plugin's file omits the member for. */
const none = 0;

/** The compatible format for records without folders. */
const knownFormat = 1;
/** The folder-digest format, read beside the compatible format. */
const folderFormat = 2;

/** The record of a plugin that has installed nothing. */
const nothingRecorded: Committed = {
  directories: [],
  files: [],
  folders: [],
  lines: [],
  registrations: [],
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

/** Reads a valid relative file path, digest, and optional generated mark. */
function folderDigestOf(value: unknown): FolderDigest | undefined {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    value.path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    !isDigest(value.digest) ||
    (value.generated !== undefined && value.generated !== true)
  ) {
    return undefined;
  }
  return {
    path: value.path,
    digest: value.digest,
    ...(value.generated === true ? { generated: true } : {}),
  };
}
function recordedFolderOf(value: unknown): RecordedFolder | undefined {
  if (!isRecord(value) || !isAbsolutePath(value.path)) {
    return undefined;
  }
  const files = value.files === undefined ? undefined : everyOf(value.files, folderDigestOf);
  if (value.files !== undefined && files === undefined) {
    return undefined;
  }
  return { path: value.path, ...(files === undefined ? {} : { files }) };
}
/** Reads both prior and intended records, rejecting a missing member. */
function pendingFolderOf(value: unknown): PendingFolder | undefined {
  if (!isRecord(value) || !isAbsolutePath(value.path)) {
    return undefined;
  }
  const prior =
    value.prior === null || value.prior === 'path'
      ? value.prior
      : everyOf(value.prior, folderDigestOf);
  const intended = value.intended === null ? null : everyOf(value.intended, folderDigestOf);
  return prior === undefined || intended === undefined
    ? undefined
    : { path: value.path, prior, intended };
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

/** A command line, a nonempty list of words, or `undefined` for anything else. */
function commandLineOf(value: unknown): readonly string[] | undefined {
  const words = everyOf(value, (word) => (typeof word === 'string' ? word : undefined));
  return words === undefined || words.length === none ? undefined : words;
}

/** A command line or `null`, as a pending registration holds one, or `undefined` for anything else. */
function commandLineOrNull(value: unknown): readonly string[] | null | undefined {
  return value === null ? null : commandLineOf(value);
}

function recordedRegistrationOf(value: unknown): RecordedRegistration | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '') {
    return undefined;
  }
  const command = commandLineOf(value.command);
  return command === undefined ? undefined : { command, name: value.name };
}

function pendingRegistrationOf(value: unknown): PendingRegistration | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '') {
    return undefined;
  }
  const prior = commandLineOrNull(value.prior);
  const intended = commandLineOrNull(value.intended);
  return prior === undefined || intended === undefined
    ? undefined
    : { intended, name: value.name, prior };
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
  const folders = optionalOf(
    value.folders,
    value.format === folderFormat && value.state === 'pending' ? pendingFolderOf : recordedFolderOf,
  );
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
  rest: { directories: readonly string[]; folders: readonly PendingFolder[] },
): PluginFile | undefined {
  if (value.state === 'committed') {
    return committedEntriesOf(value, rest);
  }
  return value.state === 'pending' ? pendingEntriesOf(value, rest) : undefined;
}

/** The committed plugin's file, or `undefined` for files, lines, or registrations not that shape. */
function committedEntriesOf(
  value: Record<string, unknown>,
  rest: { directories: readonly string[]; folders: readonly PendingFolder[] },
): Committed | undefined {
  const files = everyOf(value.files, committedFileOf);
  const lines = optionalOf(value.lines, startupLineOf);
  const registrations = optionalOf(value.registrations, recordedRegistrationOf);
  return files === undefined || lines === undefined || registrations === undefined
    ? undefined
    : { ...rest, files, lines, registrations, state: 'committed' };
}

/** The pending plugin's file, or `undefined` for files, lines, or registrations not that shape. */
function pendingEntriesOf(
  value: Record<string, unknown>,
  rest: { directories: readonly string[]; folders: readonly PendingFolder[] },
): Pending | undefined {
  const files = everyOf(value.files, pendingFileOf);
  const lines = optionalOf(value.lines, pendingLineOf);
  const registrations = optionalOf(value.registrations, pendingRegistrationOf);
  return files === undefined || lines === undefined || registrations === undefined
    ? undefined
    : { ...rest, files, lines, registrations, state: 'pending' };
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
  if (value.format !== knownFormat && value.format !== folderFormat) {
    return { kind: 'refused', reason: 'unknown-format' };
  }
  const file = pluginFileOf(value);
  return file === undefined ? { kind: 'refused', reason: 'damaged' } : { file, kind: 'read' };
}

/** The files, startup lines, and registrations of a plugin's file, each entry's members in the contract's order. */
function entryMembers(file: PluginFile): {
  files: object[];
  lines: object[];
  registrations: object[];
} {
  if (file.state === 'committed') {
    return {
      files: file.files.map(({ path, digest }) => ({ path, digest })),
      lines: file.lines.map(({ path, line }) => ({ path, line })),
      registrations: file.registrations.map(({ name, command }) => ({ name, command })),
    };
  }
  return {
    files: file.files.map(({ path, prior, intended }) => ({ path, prior, intended })),
    lines: file.lines.map(({ path, prior, intended }) => ({ path, prior, intended })),
    registrations: file.registrations.map(({ name, prior, intended }) => ({
      name,
      prior,
      intended,
    })),
  };
}

/** Every folder file in the specified path, digest, generated member order. */
function folderMembers(files: readonly FolderDigest[]): object[] {
  return files.map(({ path, digest, generated }) => ({
    path,
    digest,
    ...(generated === true ? { generated } : {}),
  }));
}

/** The plugin's file as one JSON line, omitting empty optional collections. */
function serialize(file: PluginFile): string {
  const { files, lines, registrations } = entryMembers(file);
  const { state, directories } = file;
  const folders =
    file.state === 'committed'
      ? file.folders.map(({ path, files: held }) => ({
          path,
          ...(held === undefined ? {} : { files: folderMembers(held) }),
        }))
      : file.folders.map(({ path, prior, intended }) => ({
          path,
          prior:
            prior === null || prior === undefined || prior === 'path'
              ? prior
              : folderMembers(prior),
          intended:
            intended === null || intended === undefined ? intended : folderMembers(intended),
        }));
  const members = {
    format: folders.length === none ? knownFormat : folderFormat,
    state,
    directories,
    files,
    ...(folders.length === none ? {} : { folders }),
    ...(lines.length === none ? {} : { lines }),
    ...(registrations.length === none ? {} : { registrations }),
  };
  return `${JSON.stringify(members)}\n`;
}

/** Replaces the plugin's file whole, creating the record directory when it is missing. */
function writePluginFile(path: string, file: PluginFile): void {
  mkdirSync(dirname(path), { recursive: true });
  replaceFile(path, serialize(file));
}

export type {
  FolderDigest,
  PendingFolder,
  Committed,
  CommittedFile,
  Pending,
  PendingFile,
  PendingLine,
  PendingRegistration,
  PluginFile,
  RecordedFolder,
  RecordedRegistration,
  StartupLine,
};
export { isLineText, nothingRecorded, pluginFilePath, readPluginFile, writePluginFile };
