/**
 * The text rules the configuration plugin shares with the toolchain: the one JSON scanner and the
 * one position rule of the private JSON package. The pack's build inlines that package into
 * this module, so the types here are written out and no built declaration names it.
 */
import {
  countedFrom as sharedCountedFrom,
  positionAt as sharedPositionAt,
  scanJson as sharedScanJson,
  textStart as sharedTextStart,
} from '@loom/json';

/**
 * A place in a file's text, as an editor shows it: its line and its column, each counted from 1.
 * A line ends at LF, at CRLF, or at a lone CR, and a column counts characters, one per code point,
 * so the place reads the same whichever parser found it and whichever runtime runs it.
 */
interface Position {
  /** The line, counted from 1. */
  readonly line: number;
  /** The column, counted from 1. */
  readonly column: number;
}

/** What the scan of a JSON file found: the text `JSON.parse` reads, or the offset where it breaks. */
type Scan = { readonly json: string } | { readonly offset: number };

/** Lines and columns count from 1, so the first character of a line is in column 1. */
const countedFrom = sharedCountedFrom;

/** The offset of a text's first character. */
const textStart = sharedTextStart;

/** The position of a UTF-16 offset in a text. */
function positionAt(text: string, offset: number): Position {
  return sharedPositionAt(text, offset);
}

/**
 * The scan of a JSON file, which accepts comments and a comma after the last item of an object or
 * an array, as tsconfig reads its files.
 */
function scanJson(text: string): Scan {
  return sharedScanJson(text, 'comments');
}

export { countedFrom, positionAt, scanJson, textStart };
export type { Position, Scan };
