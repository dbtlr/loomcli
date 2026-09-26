import type { StandardSchemaV1 } from '@loomcli/core';

/** The longest list that joins with `or` alone. */
const pair = 2;

const first = 0;

/** The index of the last item, counted from the end. */
const last = -1;

/** A rejection: one issue with no path and no code, carrying the configuration's one sentence. */
function reject(message: string): StandardSchemaV1.FailureResult {
  return { issues: [{ message }] };
}

/** Joins items as a sentence lists them: `a`, `a or b`, or `a, b, or c`. */
function listing(items: readonly string[]): string {
  if (items.length <= pair) {
    return items.join(' or ');
  }
  return `${items.slice(first, last).join(', ')}, or ${items.at(last) ?? ''}`;
}

export { listing, reject };
