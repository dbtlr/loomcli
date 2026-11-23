import type { StandardSchemaV1 } from '@loomcli/core';

/** The longest list that joins with `or` alone. */
const pair = 2;

const first = 0;

/** The index of the last item, counted from the end. */
const last = -1;

/** A rejection: one issue with no path, carrying the configuration's code and one sentence. */
function reject(issue: StandardSchemaV1.Issue): StandardSchemaV1.FailureResult {
  return { issues: [issue] };
}

/** Joins items as a sentence lists them: `a`, `a or b`, or `a, b, or c`. */
function listing(items: readonly string[]): string {
  if (items.length <= pair) {
    return items.join(' or ');
  }
  return `${items.slice(first, last).join(', ')}, or ${items.at(last) ?? ''}`;
}

export { listing, reject };
