import type { StandardSchemaV1 } from '@loomcli/core';

import type { BoundCodes } from './codes.js';
import { fault, readOptions } from './faults.js';

/** Inclusive bounds on a numeric factory, either or both absent. */
interface Bounds {
  min: number | undefined;
  max: number | undefined;
}

/** What a numeric factory requires of each bound, stated for its fault messages. */
interface BoundRule {
  factory: string;
  accepts: (value: number) => boolean;
  requirement: string;
  correction: string;
}

const zero = 0;

function boundOf(rule: BoundRule, name: 'min' | 'max', value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !rule.accepts(value)) {
    throw fault(`${rule.factory}() ${name} is not ${rule.requirement}. ${rule.correction}`);
  }
  return value;
}

/** Reads a numeric factory's `min` and `max`, and faults on a bad bound or `min` above `max`. */
function readBounds(options: unknown, rule: BoundRule): Bounds {
  const declared = readOptions(rule.factory, options);
  const min = boundOf(rule, 'min', declared.min);
  const max = boundOf(rule, 'max', declared.max);
  if (min !== undefined && max !== undefined && min > max) {
    throw fault(
      `${rule.factory}() min ${String(min)} is above max ${String(max)}. Supply a min at or below max.`,
    );
  }
  return { max, min };
}

function withinBounds(value: number, { max, min }: Bounds): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

/** The number a numeric token outputs, with `-0` read as `0`. */
function withoutNegativeZero(value: number): number {
  return value === zero ? zero : value;
}

/** The one issue for a numeric configuration, under the code for the bounds it declares. */
function boundsIssue(codes: BoundCodes, { max, min }: Bounds): StandardSchemaV1.Issue {
  if (min !== undefined && max !== undefined) {
    return codes.range.issue({ max, min });
  }
  if (min !== undefined) {
    return codes.min.issue({ min });
  }
  if (max !== undefined) {
    return codes.max.issue({ max });
  }
  return codes.unbounded.issue({});
}

/** The published schema for a numeric type, with each declared bound. */
function boundsSchema(type: 'integer' | 'number', { max, min }: Bounds) {
  return {
    type,
    ...(min === undefined ? {} : { minimum: min }),
    ...(max === undefined ? {} : { maximum: max }),
  };
}

export { boundsIssue, boundsSchema, readBounds, withinBounds, withoutNegativeZero };
export type { Bounds };
