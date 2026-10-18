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

/** What the pack-views fixture printed to stdout for one input, after it exited cleanly. */
function render(input: PackInput): string {
  const result = run(input);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

export { render, run };
