import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeControlCharacters } from './controls.js';
import { valueCode } from './diagnostic-text.js';
import { DeclarationError } from './errors.js';
import { isInstance } from './prototypes.js';

/**
 * What a development build reads a defect's source through: the working directory, the roots a
 * frame may lie under, and a reader. The roots are `cwd` and the path it resolves to through
 * symbolic links, because a runtime names a module by its resolved path.
 */
interface SourceAccess {
  readonly cwd: string;
  readonly roots: readonly string[];
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

/** A frame's location, `file:line:column`, where the file may hold spaces and parentheses. */
const frameLocation = /^(?<file>.+):(?<line>\d+):(?<column>\d+)$/u;

/** Every line terminator a JavaScript engine counts, in a message, a stack, or a source file. */
const lineBreak = /\r\n|[\n\r\u2028\u2029]/u;

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

/**
 * What one cause says about itself on its heading line. A `DeclarationError` says its sentence,
 * because its message holds its whole diagnostic.
 */
function causeReason(cause: Error): string | undefined {
  return readText(cause, isInstance(cause, DeclarationError) ? 'sentence' : 'message');
}

/**
 * The part of a stack after its header. A runtime opens a stack with the error's name and message,
 * and a message can hold a line that reads as a frame, so the header is cut off whole: by its text
 * when the stack opens with it, and otherwise by as many lines as the message holds.
 */
function stackBody(cause: Error): string[] {
  const stack = readText(cause, 'stack') ?? '';
  const name = readText(cause, 'name') ?? 'Error';
  const message = readText(cause, 'message') ?? '';
  const header = message === '' ? name : `${name}: ${message}`;
  if (stack.startsWith(header)) {
    return stack.slice(header.length).split(lineBreak);
  }
  return stack.split(lineBreak).slice(message.split(lineBreak).length);
}

/** The frame lines of one cause's stack: each line after the header that opens with `at`, trimmed. */
function frameLines(cause: Error): string[] {
  return stackBody(cause)
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

/**
 * The location one frame line names: the text between the first ` (` and the closing parenthesis
 * when the line has both, and otherwise everything after `at` and an optional `async`.
 */
function frameText(line: string): string {
  const rest = line.replace(/^at (?:async )?/u, '');
  const open = rest.indexOf(' (');
  return open !== -1 && rest.endsWith(')') ? rest.slice(open + 2, -1) : rest;
}

/** One frame line's location, or `undefined` for a line that names none. */
function parseFrame(line: string): Frame | undefined {
  const groups = frameLocation.exec(frameText(line))?.groups;
  const file = groups?.file === undefined ? undefined : framePath(groups.file);
  if (file === undefined || groups?.line === undefined || groups.column === undefined) {
    return undefined;
  }
  return { column: Number(groups.column), file, line: Number(groups.line) };
}

/** A frame's file relative to one root, or `undefined` when the file does not lie under it. */
function within(file: string, root: string): string | undefined {
  const inside = relative(resolve(root), resolve(file));
  return inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)
    ? undefined
    : inside;
}

/**
 * A frame's file relative to the first root it lies under, when it may be read: an absolute path
 * whose normalized form lies under a root and outside any `node_modules` directory. A thrown
 * value's stack can be forged, so this is checked before any read, and the reader checks it again
 * past symbolic links. It answers `undefined` for a file that does not qualify.
 */
function qualified(file: string, roots: readonly string[]): string | undefined {
  if (!isAbsolute(file) || resolve(file).split(sep).includes('node_modules')) {
    return undefined;
  }
  for (const root of roots) {
    const inside = within(file, root);
    if (inside !== undefined) {
      return inside;
    }
  }
  return undefined;
}

/** A frame's location as the diagnostic prints it: relative to the working directory when under it. */
function locationText(frame: Frame, roots: readonly string[]): string {
  const file = qualified(frame.file, roots) ?? frame.file;
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
  const lines = text.split(lineBreak);
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
 * The errors an `AggregateError` holds, in order, read defensively, or none for any other Error. A
 * broken translator's defect holds the translator's throw and then the original throw this way.
 */
function heldErrors(cause: Error): readonly unknown[] {
  if (!isInstance(cause, AggregateError)) {
    return [];
  }
  const errors = readField(cause, 'errors');
  return Array.isArray(errors) ? errors : [];
}

/** Every frame one cause's stack names, in order, skipping a line that names no location. */
function framesOf(cause: Error): Frame[] {
  return frameLines(cause).flatMap((line) => parseFrame(line) ?? []);
}

/**
 * The author's source for a defect: the first frame that lies under the working directory and
 * outside `node_modules`, read from the outermost cause's stack, or, for an `AggregateError`, from
 * the stacks of the errors it holds in order and then its own, because what broke is what it
 * holds. A read that answers nothing, and stacks with no qualifying frame, leave the outermost
 * cause's first frame's location alone.
 */
function sourceSection(cause: Error, access: SourceAccess): string | undefined {
  const stacks = [...heldErrors(cause).filter((held) => isInstance(held, Error)), cause];
  const frame = stacks
    .flatMap((stack) => framesOf(stack))
    .find((candidate) => qualified(candidate.file, access.roots) !== undefined);
  if (frame === undefined) {
    const [located] = framesOf(cause);
    return located === undefined ? undefined : locationText(located, access.roots);
  }
  const text = readFile(access, frame.file);
  const lines = text === undefined ? undefined : excerpt(text, frame);
  const location = locationText(frame, access.roots);
  return lines === undefined ? location : `${location}\n\n${lines}`;
}

/** One cause as its name, its escaped message, or a declaration fault's sentence, and its frames. */
function causeLines(cause: Error): string[] {
  const name = readText(cause, 'name') ?? 'Error';
  const reason = causeReason(cause);
  const heading = reason === undefined || reason === '' ? name : `${name}: ${reason}`;
  return [
    escapeControlCharacters(heading),
    ...frameLines(cause).map((line) => `    ${escapeControlCharacters(line)}`),
  ];
}

/** The lines a cause chain has printed and the causes it has met, shared by every branch. */
interface ChainWalk {
  readonly lines: string[];
  readonly seen: Set<unknown>;
}

/**
 * One link of a cause chain under `prefix`, then each error it holds as an `AggregateError`, each
 * with its own chain under `Holds`. It answers the link's own cause, or `undefined` for a link that
 * is not an Error, which prints as a value.
 */
function appendLink(cause: unknown, prefix: string, walk: ChainWalk): unknown {
  walk.seen.add(cause);
  if (!isInstance(cause, Error)) {
    walk.lines.push(`${prefix}${valueCode(cause)}`);
    return undefined;
  }
  const [heading = '', ...frames] = causeLines(cause);
  walk.lines.push(`${prefix}${heading}`, ...frames);
  for (const held of heldErrors(cause)) {
    appendChain(held, 'Holds ', walk);
  }
  return readField(cause, 'cause');
}

/**
 * One chain from `first`, the first link under `opening` and each later one under `Caused by`,
 * following `cause` links until one is absent, repeats, or passes the limit.
 */
function appendChain(first: unknown, opening: string, walk: ChainWalk): void {
  let cause = first;
  let prefix = opening;
  while (cause !== undefined && !walk.seen.has(cause) && walk.seen.size < causeLimit) {
    cause = appendLink(cause, prefix, walk);
    prefix = 'Caused by ';
  }
}

/**
 * The cause chain: each cause's name and escaped message and its stack, and each error an
 * `AggregateError` holds, until the chain ends, repeats, or passes the limit.
 */
function causeChain(outermost: Error): string {
  const walk: ChainWalk = { lines: [], seen: new Set() };
  appendChain(outermost, '', walk);
  return walk.lines.join('\n');
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
  if (!isInstance(cause, Error)) {
    return [`Thrown value: ${valueCode(cause)}`];
  }
  const source = sourceSection(cause, access);
  return [...(source === undefined ? [] : [source]), causeChain(cause)];
}

export type { SourceAccess };
export { defectEvidence };
