import { expect } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/pack-views.mjs', import.meta.url);

interface PackInput {
  readonly view: 'box' | 'heading' | 'list' | 'prose' | 'rule';
  readonly config?: unknown;
  readonly data: unknown;
  /** One render per entry: a number is a terminal that wide, and null is a pipe. */
  readonly widths: readonly (number | null)[];
  readonly build?: 'development' | 'distributed';
  readonly theme?: boolean;
  readonly declared?: boolean;
  readonly invoke?: boolean;
  readonly rendering?: {
    readonly color: 'always' | 'never';
    readonly hyperlinks?: 'always' | 'never';
    readonly modifiers: 'always' | 'never';
  };
}

/** How the pack-views fixture exited for one input, with everything it printed. */
function run(input: PackInput): ReturnType<typeof invoke> {
  return invoke(fixture, [JSON.stringify(input)]);
}

/**
 * Splits the widths into runs of one kind, terminal or pipe, in order.
 * Core captures `isTTY` once per run, so a pipe render needs a process of its own.
 */
function destinations(widths: readonly (number | null)[]): (number | null)[][] {
  const groups: (number | null)[][] = [];
  for (const width of widths) {
    const last = groups.at(-1);
    if (last !== undefined && (last[0] === null) === (width === null)) {
      last.push(width);
    } else {
      groups.push([width]);
    }
  }
  return groups;
}

/**
 * What the pack-views fixture printed to stdout for one input, after it exited cleanly.
 * Terminal renders and pipe renders run in separate processes, joined by the fixture's separator.
 */
function render(input: PackInput): string {
  return destinations(input.widths)
    .map((widths) => {
      const result = run({ ...input, widths });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      return result.stdout;
    })
    .join('--\n');
}

export { render, run };
