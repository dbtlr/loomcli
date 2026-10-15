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

/** Single quotes end on their physical line, so a missing quote cannot consume another assignment. */
function singleQuoted(text: string, line: number): ParsedValue {
  const end = text.indexOf("'", afterQuote);
  return {
    next: line + nextLine,
    value:
      end !== notFound && validTail(text.slice(end + afterQuote))
        ? text.slice(afterQuote, end)
        : undefined,
  };
}

function quotedCharacter(text: string, offset: number) {
  const character = text.charAt(offset);
  const following = text.charAt(offset + characterWidth);
  return character === '\\' && following !== ''
    ? { value: escapes.get(following) ?? `\\${following}`, width: escapeWidth }
    : { value: character, width: characterWidth };
}

/** One physical line inside a double-quoted value, stopping only at an unescaped quote. */
function quotedLine(text: string, from: number): { value: string; tail: string | undefined } {
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

/** Consume quoted regions even for unlisted names, so their contents never become assignments. */
function doubleQuoted(lines: readonly string[], start: number, first: string): ParsedValue {
  let value = '';
  let line = start;
  let current = quotedLine(first, afterQuote);
  while (current.tail === undefined && line + nextLine < lines.length) {
    value += `${current.value}\n`;
    line += nextLine;
    current = quotedLine(lines[line] ?? '', firstCharacter);
  }
  return {
    next: line + nextLine,
    value:
      current.tail !== undefined && validTail(current.tail) ? value + current.value : undefined,
  };
}

function readValue(lines: readonly string[], line: number, text: string): ParsedValue {
  if (text.startsWith("'")) {
    return singleQuoted(text, line);
  }
  if (text.startsWith('"')) {
    return doubleQuoted(lines, line, text);
  }
  const comment = /(?:^|[ \t])#/u.exec(text);
  const value = (comment === null ? text : text.slice(firstCharacter, comment.index)).replace(
    /[ \t]+$/u,
    '',
  );
  return { next: line + nextLine, value };
}

function assignmentAt(lines: readonly string[], line: number): ParsedAssignment {
  const header =
    /^[ \t]*(?:export[ \t]+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)(?=[ \t=]|$)(?<rest>[^\n]*)$/u.exec(
      lines[line] ?? '',
    );
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
  variables: ReadonlySet<string>,
): void {
  const { line, name, value } = parsed;
  if (name !== undefined && variables.has(name)) {
    if (value === undefined || value.includes('\0')) {
      file.malformed.push({ line, name });
    } else {
      file.values.set(name, value);
    }
  }
}

/** The last valid assignment to each allowlisted variable, with secret-free warning locations. */
export function parseDotenv(text: string, variables: ReadonlySet<string>) {
  const file: ParsedFile = { malformed: [], values: new Map() };
  const lines = text
    .replace(/^\uFEFF/u, '')
    .replaceAll('\r\n', '\n')
    .split('\n');
  let line = firstCharacter;
  while (line < lines.length) {
    const parsed = assignmentAt(lines, line);
    recordAssignment(file, parsed, variables);
    line = parsed.next;
  }
  return { malformed: file.malformed, values: Object.fromEntries(file.values) };
}
