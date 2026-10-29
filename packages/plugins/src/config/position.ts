/**
 * A place in a file's text, as an editor shows it: its line and its column, each counted from 1.
 * A line ends at LF, at CRLF, or at a lone CR, and a column counts characters, one per code point,
 * so the place reads the same whichever parser found it and whichever runtime runs it.
 */
interface Position {
  readonly line: number;
  readonly column: number;
}

/** A line ending: CRLF, a lone CR, or LF. */
const lineEnding = /\r\n|\r|\n/u;

/** One character: a code point, so an emoji or an accented letter counts once. */
const anyCharacter = /./gsu;

/** Lines and columns count from 1, so the first character of a line is in column 1. */
const countedFrom = 1;

/** The offset of a text's first character. */
const textStart = 0;

/** The position of a UTF-16 offset in a text. */
function positionAt(text: string, offset: number): Position {
  const lines = text.slice(textStart, offset).split(lineEnding);
  const current = lines.pop() ?? '';
  const characters = (current.match(anyCharacter) ?? []).length;
  return { column: characters + countedFrom, line: lines.length + countedFrom };
}

export { countedFrom, positionAt, textStart };
export type { Position };
