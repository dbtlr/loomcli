import { positionAt, scanJson } from '@loom/json';

/** Where a JSON text first breaks, and what JSON needs at that point. */
interface JsonFault {
  readonly column: number;
  readonly expected: string;
  readonly line: number;
}

/**
 * Where a JSON text first breaks, as the line and column an editor shows, both counted from 1, with
 * the column in characters; `undefined` for valid JSON. The runtime's own parse error is not
 * portable, because Bun's message names no position, so a reader that reports the place finds it
 * with the shared strict scanner and its position rule.
 */
function jsonFault(text: string): JsonFault | undefined {
  const scan = scanJson(text, 'strict');
  if (!('offset' in scan)) {
    return undefined;
  }
  const { column, line } = positionAt(text, scan.offset);
  return { column, expected: scan.expected, line };
}

export { jsonFault };
export type { JsonFault };
