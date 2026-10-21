import { variableNameSource } from '../variable-name.js';

interface MalformedAssignment {
  readonly name: string;
  readonly line: number;
}

interface ParsedValue {
  readonly value: string | undefined;
  readonly next: number;
}

interface ParsedAssignment extends ParsedValue {
  readonly name: string | undefined;
  readonly line: number;
}

interface ParsedFile {
  readonly values: Map<string, string>;
  readonly malformed: MalformedAssignment[];
}

const firstCharacter = 0;
const afterQuote = 1;
const nextLine = 1;
const characterWidth = 1;
const escapeWidth = 2;
const notFound = -1;

const escapes: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['"', '"'],
  ['\\', '\\'],
]);

function validTail(text: string): boolean {
  return /^[ \t]*(?:#[^\n]*)?$/u.test(text);
}

function quotedCharacter(text: string, offset: number) {
  const character = text.charAt(offset);
  const following = text.charAt(offset + characterWidth);
  return character === '\\' && following !== ''
    ? { value: escapes.get(following) ?? `\\${following}`, width: escapeWidth }
    : { value: character, width: characterWidth };
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

/** One physical line inside a double-quoted value, stopping only at an unescaped quote. */
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
  opening: { first: string; readLine: (text: string, from: number) => QuotedLine },
): ParsedValue {
  const { first, readLine } = opening;
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
    value:
      current.tail !== undefined && validTail(current.tail) ? value + current.value : undefined,
  };
}

function readValue(lines: readonly string[], line: number, text: string): ParsedValue {
  if (text.startsWith("'")) {
    return quoted(lines, line, { first: text, readLine: literalLine });
  }
  if (text.startsWith('"')) {
    return quoted(lines, line, { first: text, readLine: quotedLine });
  }
  const comment = /(?:^|[ \t])#/u.exec(text);
  const value = (comment === null ? text : text.slice(firstCharacter, comment.index)).replace(
    /[ \t]+$/u,
    '',
  );
  return { next: line + nextLine, value };
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
      ? { next: line + nextLine, value: undefined }
      : readValue(lines, line, assignment.groups?.value ?? '');
  return { ...parsed, line: line + nextLine, name: header?.groups?.name };
}

function recordAssignment(
  file: ParsedFile,
  parsed: ParsedAssignment,
  imports: (name: string) => boolean,
): void {
  const { line, name, value } = parsed;
  if (name !== undefined && imports(name)) {
    if (value === undefined || value.includes('\0')) {
      file.malformed.push({ line, name });
    } else {
      file.values.set(name, value);
    }
  }
}

/** The last valid assignment to each variable the plugin imports, with secret-free warning locations. */
export function parseDotenv(text: string, imports: (name: string) => boolean) {
  const file: ParsedFile = { malformed: [], values: new Map() };
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
  return { malformed: file.malformed, values: Object.fromEntries(file.values) };
}
