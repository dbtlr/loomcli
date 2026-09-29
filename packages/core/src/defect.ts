import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeControlCharacters } from './controls.js';
import { valueCode } from './diagnostic-text.js';

/** What a development build reads a defect's source through: the working directory and a reader. */
interface SourceAccess {
  readonly cwd: string;
  readonly readSource: ((path: string, cwd: string) => string | undefined) | undefined;
}

/** How many causes a chain prints before it stops, so a chain a getter grows cannot run forever. */
const causeLimit = 8;

/** How many lines a source excerpt shows on each side of the failing line. */
const context = 2;

/** One stack frame's location: the file, and its line and column, both counted from 1. */
interface Frame {
  file: string;
  line: number;
  column: number;
}

/** A frame line's trailing location, `file:line:column`, with or without parentheses. */
const frameLocation = /(?:\(|\s)(?<file>(?:file:\/\/)?[^\s()]+?):(?<line>\d+):(?<column>\d+)\)?$/u;

/** A value read through a property, or `undefined` when reading it throws. */
function readField(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

/** A field that must be a string, read defensively. */
function readText(value: object, key: string): string | undefined {
  const field = readField(value, key);
  return typeof field === 'string' ? field : undefined;
}

/** Whether a value is an Error, read defensively, because a proxy's prototype trap can throw. */
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/** The frame lines of one stack: each line that opens with `at`, trimmed. */
function frameLines(stack: string | undefined): string[] {
  return (stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '));
}

/** The file a frame names as a path, converting a `file:` URL, or `undefined` for one that fails. */
function framePath(file: string): string | undefined {
  if (!file.startsWith('file:')) {
    return file;
  }
  try {
    return fileURLToPath(file);
  } catch {
    return undefined;
  }
}

/** One frame line's location, or `undefined` for a line that names none. */
function parseFrame(line: string): Frame | undefined {
  const groups = frameLocation.exec(line)?.groups;
  const file = groups?.file === undefined ? undefined : framePath(groups.file);
  if (file === undefined || groups?.line === undefined || groups.column === undefined) {
    return undefined;
  }
  return { column: Number(groups.column), file, line: Number(groups.line) };
}

/**
 * Whether a frame's file may be read: an absolute path whose normalized form lies under the
 * working directory and outside any `node_modules` directory. A thrown value's stack can be forged,
 * so this is checked before any read, and the reader checks it again past symbolic links.
 */
function qualifies(file: string, cwd: string): boolean {
  if (!isAbsolute(file)) {
    return false;
  }
  const normalized = resolve(file);
  const within = relative(resolve(cwd), normalized);
  return (
    within !== '' &&
    within !== '..' &&
    !within.startsWith(`..${sep}`) &&
    !isAbsolute(within) &&
    !normalized.split(sep).includes('node_modules')
  );
}

/** A frame's location as the diagnostic prints it: relative to the working directory when under it. */
function locationText(frame: Frame, cwd: string): string {
  const file = qualifies(frame.file, cwd)
    ? relative(resolve(cwd), resolve(frame.file))
    : frame.file;
  return escapeControlCharacters(`${file}:${String(frame.line)}:${String(frame.column)}`);
}

/** The source one reader answers for a file, or `undefined` when it answers none or throws. */
function readFile(access: SourceAccess, file: string): string | undefined {
  try {
    const text: unknown = access.readSource?.(resolve(file), access.cwd);
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One numbered source line, marked when it is the failing line, with a caret under the frame's
 * column below it. A tab reads as one space, so the caret stays under the column the frame names.
 */
function numberedLine(source: string, number: number, frame: Frame & { digits: number }): string[] {
  const text = escapeControlCharacters(source.replaceAll('\t', ' '));
  const failing = number === frame.line;
  const line =
    `${failing ? '>' : ' '} ${String(number).padStart(frame.digits)} | ${text}`.trimEnd();
  if (!failing) {
    return [line];
  }
  return [line, `  ${' '.repeat(frame.digits)} | ${' '.repeat(Math.max(0, frame.column - 1))}^`];
}

/** The lines around one frame, numbered, with the failing line marked, or none past the file's end. */
function excerpt(text: string, frame: Frame): string | undefined {
  // A JavaScript engine counts every line terminator, so a frame's line number counts them all.
  const lines = text.split(/\r\n|[\n\r\u2028\u2029]/u);
  if (frame.line < 1 || frame.line > lines.length) {
    return undefined;
  }
  const first = Math.max(1, frame.line - context);
  const shown = lines.slice(first - 1, Math.min(lines.length, frame.line + context));
  const digits = String(first + shown.length - 1).length;
  return shown
    .flatMap((source, offset) => numberedLine(source, first + offset, { ...frame, digits }))
    .join('\n');
}

/**
 * The author's source for a defect: the first frame of the outermost cause's stack that lies under
 * the working directory and outside `node_modules`, with its lines around it. A read that answers
 * nothing, and a stack with no qualifying frame, leave a frame's location alone.
 */
function sourceSection(cause: Error, access: SourceAccess): string | undefined {
  const frames = frameLines(readText(cause, 'stack')).flatMap((line) => parseFrame(line) ?? []);
  const frame = frames.find((candidate) => qualifies(candidate.file, access.cwd));
  if (frame === undefined) {
    const [located] = frames;
    return located === undefined ? undefined : locationText(located, access.cwd);
  }
  const text = readFile(access, frame.file);
  const lines = text === undefined ? undefined : excerpt(text, frame);
  const location = locationText(frame, access.cwd);
  return lines === undefined ? location : `${location}\n\n${lines}`;
}

/** One cause as its name, its escaped message, and its stack's frames. */
function causeLines(cause: Error): string[] {
  const name = readText(cause, 'name') ?? 'Error';
  const message = readText(cause, 'message');
  const heading = message === undefined || message === '' ? name : `${name}: ${message}`;
  return [
    escapeControlCharacters(heading),
    ...frameLines(readText(cause, 'stack')).map((line) => `    ${escapeControlCharacters(line)}`),
  ];
}

/**
 * The cause chain: each cause's name and escaped message and its stack, following `cause` links
 * until one is absent, repeats, or passes the limit. A link that is not an Error prints as a value.
 */
function causeChain(outermost: Error): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let cause: unknown = outermost;
  while (cause !== undefined && !seen.has(cause) && seen.size < causeLimit) {
    seen.add(cause);
    const [heading = '', ...frames] = isError(cause) ? causeLines(cause) : [valueCode(cause)];
    lines.push(`${seen.size === 1 ? '' : 'Caused by '}${heading}`, ...frames);
    cause = isError(cause) ? readField(cause, 'cause') : undefined;
  }
  return lines.join('\n');
}

/**
 * A defect's findings in a development build: the author's source around the failing frame, read
 * only here, and the cause chain. A thrown value that is not an Error prints as a value, and a
 * defect with no cause shows none.
 */
function defectEvidence(cause: unknown, access: SourceAccess): string[] {
  if (cause === undefined) {
    return [];
  }
  if (!isError(cause)) {
    return [`Thrown value: ${valueCode(cause)}`];
  }
  const source = sourceSection(cause, access);
  return [...(source === undefined ? [] : [source]), causeChain(cause)];
}

export type { SourceAccess };
export { defectEvidence };
