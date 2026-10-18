import { expect } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/table-fit.mjs', import.meta.url);

/** One width a render reads: a terminal that wide, one that reports none, or a pipe. */
type Width = number | 'unreported' | null;

interface FitInput {
  readonly view: 'records' | 'table';
  readonly config: unknown;
  readonly rows: readonly unknown[];
  readonly widths: readonly Width[];
  readonly env?: Readonly<Record<string, string>>;
  readonly rendering?: {
    readonly color: 'always' | 'never';
    readonly hyperlinks?: 'always' | 'never';
    readonly modifiers: 'always' | 'never';
  };
  readonly stream?: boolean;
  readonly invoke?: boolean;
}

/** What the table-fit fixture printed to stdout for one input, after it exited cleanly. */
function render(input: FitInput): string {
  const result = invoke(fixture, [JSON.stringify(input)]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/** Lines joined as a view returns them, each ending with a newline. */
function lines(...each: string[]): string {
  return each.map((line) => `${line}\n`).join('');
}

/**
 * Text exactly `width` columns wide made of 4-letter words, with a final word of 4 or 5 letters,
 * so every unit `wrap` keeps whole is narrow and a column of it can shrink far.
 */
function filler(width: number, letter: string): string {
  const characters = Array.from({ length: width }, (_unused, index) =>
    index % 5 === 4 && index < width - 1 ? ' ' : letter,
  );
  return characters.join('');
}

export { filler, lines, render };
export type { Width };
