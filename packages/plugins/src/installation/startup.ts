/**
 * The startup-file reads and writes of the installed-files module. A startup file is the operator's,
 * so the module reads it as text in its own encoding, appends a line in place, and replaces or
 * removes only lines equal to a recorded one, keeping every other byte.
 */
import { appendFileSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { createNew, errorCode, permissionBits, replaceFile } from './disk.js';

/** The encodings the module reads: UTF-8 with or without its byte order mark. */
type StartupEncoding = 'utf8' | 'utf8-bom';

/** A startup file's text, its byte order mark excluded, and the encoding it was read in. */
interface StartupText {
  readonly encoding: StartupEncoding;
  readonly text: string;
}

/**
 * What a startup file is, read through any symbolic link: nothing, not a regular file, a file the
 * process may not read, a file in an encoding the module does not read, or its text.
 */
type StartupRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'not-file'; readonly reason: 'link' | 'directory' | 'special' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unknown-encoding' }
  | { readonly kind: 'text'; readonly content: StartupText };

/** UTF-8's byte order mark, which the module reads past and writes back. */
const utf8Mark = Buffer.from('efbbbf', 'hex');

/** The mode a startup file the module creates takes, whatever the umask. */
const createdMode = 0o644;

const lineFeed = '\n';
const carriageReturn = '\r';
const trailingCarriageReturn = /\r$/u;

/** Whether `bytes` starts with `mark`. */
function startsWith(bytes: Uint8Array, mark: Uint8Array): boolean {
  return mark.every((byte, index) => bytes[index] === byte);
}

/**
 * A startup file's bytes as UTF-8 text, past its byte order mark when it starts with one, or
 * `undefined` for bytes that are not valid UTF-8, as a file in another encoding is.
 */
function decode(bytes: Uint8Array): StartupText | undefined {
  const marked = startsWith(bytes, utf8Mark);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      marked ? bytes.subarray(utf8Mark.length) : bytes,
    );
    return { encoding: marked ? 'utf8-bom' : 'utf8', text };
  } catch {
    return undefined;
  }
}

/** A whole file's text as UTF-8, with the byte order mark first when the file was read with one. */
function encode(text: string, encoding: StartupEncoding): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  return encoding === 'utf8-bom' ? Buffer.concat([utf8Mark, bytes]) : bytes;
}

/** What `path` is, followed through a symbolic link, without reading its content. */
function startupKind(path: string): StartupRead | 'file' {
  const own = lstatSync(path, { throwIfNoEntry: false });
  if (own === undefined) {
    return { kind: 'absent' };
  }
  const stats = own.isSymbolicLink() ? statSync(path, { throwIfNoEntry: false }) : own;
  if (stats === undefined) {
    return { kind: 'not-file', reason: 'link' };
  }
  if (stats.isDirectory()) {
    return { kind: 'not-file', reason: 'directory' };
  }
  return stats.isFile() ? 'file' : { kind: 'not-file', reason: 'special' };
}

/** The runtime errors that say the process may not read a path. */
const deniedReads = new Set(['EACCES', 'EPERM']);

/** A regular file's bytes, or `undefined` when the process may not read it. */
function bytesOf(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if (deniedReads.has(String(errorCode(error)))) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Reads a startup file through any symbolic link: absent, not a file, one the process may not
 * read, an unknown encoding, or its text.
 */
function readStartup(path: string): StartupRead {
  const kind = startupKind(path);
  if (kind !== 'file') {
    return kind;
  }
  const bytes = bytesOf(path);
  if (bytes === undefined) {
    return { kind: 'unreadable' };
  }
  const content = decode(bytes);
  return content === undefined ? { kind: 'unknown-encoding' } : { content, kind: 'text' };
}

/** One line of a startup file and the line ending after it, empty for a last line with none. */
interface Segment {
  readonly content: string;
  readonly ending: string;
}

/**
 * The lines of some text, split at each line feed, with a carriage return right before the line
 * feed moved into the line ending.
 */
function segmentsOf(text: string): Segment[] {
  const pieces = text.split(lineFeed);
  const last = pieces.pop() ?? '';
  const segments = pieces.map((piece) =>
    piece.endsWith(carriageReturn)
      ? { content: piece.replace(trailingCarriageReturn, ''), ending: carriageReturn + lineFeed }
      : { content: piece, ending: lineFeed },
  );
  return last === '' ? segments : [...segments, { content: last, ending: '' }];
}

/** Whether some text holds `line`: one of its lines equals it exactly. */
function holdsLine(text: string, line: string): boolean {
  return segmentsOf(text).some((segment) => segment.content === line);
}

/** The text's own line ending: its first line break, or a line feed when it has none. */
function lineEndingOf(text: string): string {
  return segmentsOf(text).find((segment) => segment.ending !== '')?.ending ?? lineFeed;
}

/** What appending `line` to some text adds: a line break first when the text does not end with one. */
function appendix(text: string, line: string): string {
  const ending = lineEndingOf(text);
  const separator = text === '' || text.endsWith(lineFeed) ? '' : ending;
  return `${separator}${line}${ending}`;
}

/**
 * Appends `line` to an existing startup file in place, through any symbolic link, in the file's
 * own line ending, so the file keeps its owner, mode, links, and every other byte.
 */
function appendLine(path: string, content: StartupText, line: string): void {
  appendFileSync(path, appendix(content.text, line), 'utf8');
}

/**
 * Creates a missing startup file exclusively, holding `line` and a line feed as UTF-8 without a
 * byte order mark, with mode 644 whatever the umask.
 * Answers `false`, writing nothing, when the file exists by the time it is created.
 */
function createStartupFile(path: string, line: string): boolean {
  return createNew(path, Buffer.from(`${line}${lineFeed}`, 'utf8'), { mode: createdMode });
}

/** A recorded line's text and what takes its place, `null` to remove it with its line ending. */
interface LineEdit {
  readonly prior: string;
  readonly replacement: string | null;
}

/** The text with each line equal to the edit's prior text replaced where it stands, or removed. */
function edited(text: string, edit: LineEdit): string {
  return segmentsOf(text)
    .flatMap(({ content, ending }) => {
      if (content !== edit.prior) {
        return [content + ending];
      }
      return edit.replacement === null ? [] : [edit.replacement + ending];
    })
    .join('');
}

/**
 * The real path of `path` through every symbolic link, or `path` itself when nothing is there. Bun's
 * `realpathSync` opens the file on macOS, which a file the process may not read refuses, so a file
 * that is not a link resolves through its folder instead.
 */
function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') {
      return path;
    }
    if (code === 'EACCES' && !lstatSync(path).isSymbolicLink()) {
      return join(realpathSync(dirname(path)), basename(path));
    }
    throw error;
  }
}

/**
 * Replaces or removes each line equal to the recorded text by writing the startup file's real path
 * through a staging file and a rename, keeping every other byte, the byte order mark, and the permission
 * bits, so a symbolic link stays a link.
 */
function rewriteLines(path: string, content: StartupText, edit: LineEdit): void {
  const real = realPathOf(path);
  const mode = statSync(real).mode & permissionBits;
  replaceFile(real, encode(edited(content.text, edit), content.encoding), { mode });
}

/** What a plugin reads of a startup file before it lists a line: whether the module can read it, and whether it holds the line. */
type StartupFileState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'not-file' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unknown-encoding' }
  | { readonly kind: 'text'; readonly encoding: StartupEncoding; readonly holds: boolean };

/**
 * Reads a startup file, through any symbolic link, as the module reads it: nothing there, not a
 * regular file, one the process may not read, an encoding the module does not read, or its
 * encoding and whether it holds `line`.
 * The plugin judges from it, with whatever else it checks, whether it may change the file.
 */
function inspectStartupFile(path: string, line: string): StartupFileState {
  const read = readStartup(path);
  if (read.kind === 'not-file') {
    return { kind: 'not-file' };
  }
  if (read.kind !== 'text') {
    return read;
  }
  const { encoding, text } = read.content;
  return { encoding, holds: holdsLine(text, line), kind: 'text' };
}

export type { StartupEncoding, StartupFileState, StartupRead, StartupText };
export {
  appendLine,
  createStartupFile,
  holdsLine,
  inspectStartupFile,
  readStartup,
  realPathOf,
  rewriteLines,
};
