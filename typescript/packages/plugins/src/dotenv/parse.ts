import { variableNameSource } from '../variable-name.js';
import type { ValueQuote } from './expand.js';

interface MalformedAssignment {
  readonly name: string;
  readonly line: number;
}

/** A value as written: its text before any `$` or backslash is read, and how it was quoted. */
interface ParsedValue {
  readonly value: string | undefined;
  readonly quote: ValueQuote;
  readonly next: number;
}

/** One valid assignment, in file order, whose value the plugin has not yet expanded. */
interface DotenvAssignment {
  readonly name: string;
  readonly value: string;
  readonly quote: ValueQuote;
}

interface ParsedAssignment extends ParsedValue {
  readonly name: string | undefined;
  readonly line: number;
}

interface ParsedFile {
  readonly assignments: DotenvAssignment[];
  readonly malformed: MalformedAssignment[];
}

const firstCharacter = 0;
const afterQuote = 1;
const nextLine = 1;
const characterWidth = 1;
const escapeWidth = 2;
const notFound = -1;

function validTail(text: string): boolean {
  return /^[ \t]*(?:#[^\n]*)?$/u.test(text);
}

/** A backslash and the character after it stay together, so an escaped quote never ends a value. */
function quotedCharacter(text: string, offset: number) {
  const width =
    text.charAt(offset) === '\\' && text.charAt(offset + characterWidth) !== ''
      ? escapeWidth
      : characterWidth;
  return { value: text.slice(offset, offset + width), width };
}

/** One physical line of a quoted value: its text, and what follows the closing quote when it has one. */
interface QuotedLine {
  value: string;
  tail: string | undefined;
}

/** One physical line inside a single-quoted value, which keeps every character and stops at a quote. */
function literalLine(text: string, from: number): QuotedLine {
  const end = text.indexOf("'", from);
  return end === notFound
    ? { tail: undefined, value: text.slice(from) }
    : { tail: text.slice(end + afterQuote), value: text.slice(from, end) };
}

/**
 * One physical line inside a double-quoted value, stopping only at an unescaped quote. Its escapes
 * stay undecoded, because a `\$` and a `$` read differently.
 */
function quotedLine(text: string, from: number): QuotedLine {
  let value = '';
  for (let offset = from; offset < text.length;) {
    if (text.charAt(offset) === '"') {
      return { tail: text.slice(offset + afterQuote), value };
    }
    const character = quotedCharacter(text, offset);
    value += character.value;
    offset += character.width;
  }
  return { tail: undefined, value };
}

/**
 * A quoted value, which may span physical lines in either quote, as the dotenv package, Node's
 * `--env-file`, and Bun read it. Quoted regions are consumed even for names the plugin does not
 * import, so their contents never become assignments, and an unterminated quote consumes the rest
 * of the file.
 */
function quoted(
  lines: readonly string[],
  start: number,
  opening: {
    first: string;
    quote: ValueQuote;
    readLine: (text: string, from: number) => QuotedLine;
  },
): ParsedValue {
  const { first, quote, readLine } = opening;
  let value = '';
  let line = start;
  let current = readLine(first, afterQuote);
  while (current.tail === undefined && line + nextLine < lines.length) {
    value += `${current.value}\n`;
    line += nextLine;
    current = readLine(lines[line] ?? '', firstCharacter);
  }
  return {
    next: line + nextLine,
    quote,
    value:
      current.tail !== undefined && validTail(current.tail) ? value + current.value : undefined,
  };
}

function readValue(lines: readonly string[], line: number, text: string): ParsedValue {
  if (text.startsWith("'")) {
    return quoted(lines, line, { first: text, quote: 'single', readLine: literalLine });
  }
  if (text.startsWith('"')) {
    return quoted(lines, line, { first: text, quote: 'double', readLine: quotedLine });
  }
  const comment = text.indexOf('#');
  const value = (comment === notFound ? text : text.slice(firstCharacter, comment)).replace(
    /[ \t]+$/u,
    '',
  );
  return { next: line + nextLine, quote: 'unquoted', value };
}

/** An assignment's header: an optional `export`, the variable's name, and the rest of the line. */
const headerPattern = new RegExp(
  String.raw`^[ \t]*(?:export[ \t]+)?(?<name>${variableNameSource})(?=[ \t=]|$)(?<rest>[^\n]*)$`,
  'u',
);

function assignmentAt(lines: readonly string[], line: number): ParsedAssignment {
  const header = headerPattern.exec(lines[line] ?? '');
  const assignment = /^[ \t]*=[ \t]*(?<value>[^\n]*)$/u.exec(header?.groups?.rest ?? '');
  const parsed =
    assignment === null
      ? { next: line + nextLine, quote: 'unquoted' as const, value: undefined }
      : readValue(lines, line, assignment.groups?.value ?? '');
  return { ...parsed, line: line + nextLine, name: header?.groups?.name };
}

/** Every valid assignment is kept, because a reference reads names the plugin does not import. */
function recordAssignment(
  file: ParsedFile,
  parsed: ParsedAssignment,
  imports: (name: string) => boolean,
): void {
  const { line, name, quote, value } = parsed;
  if (name === undefined) {
    return;
  }
  if (value !== undefined && !value.includes('\0')) {
    file.assignments.push({ name, quote, value });
  } else if (imports(name)) {
    file.malformed.push({ line, name });
  }
}

/** A file's valid assignments in order, with secret-free warning locations for the malformed ones. */
export function parseDotenv(text: string, imports: (name: string) => boolean) {
  const file: ParsedFile = { assignments: [], malformed: [] };
  const lines = text
    .replace(/^\uFEFF/u, '')
    .replaceAll('\r\n', '\n')
    .split('\n');
  let line = firstCharacter;
  while (line < lines.length) {
    const parsed = assignmentAt(lines, line);
    recordAssignment(file, parsed, imports);
    line = parsed.next;
  }
  return file;
}

export type { DotenvAssignment };
