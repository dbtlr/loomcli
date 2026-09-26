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

/** The one sentence for a numeric configuration, each bound printed as JavaScript prints it. */
function boundsSentence(noun: string, { max, min }: Bounds): string {
  if (min !== undefined && max !== undefined) {
    return `Expected ${noun} from ${String(min)} through ${String(max)}.`;
  }
  if (min !== undefined) {
    return `Expected ${noun} of at least ${String(min)}.`;
  }
  if (max !== undefined) {
    return `Expected ${noun} of at most ${String(max)}.`;
  }
  return `Expected ${noun}.`;
}

/** The published schema for a numeric type, with each declared bound. */
function boundsSchema(type: 'integer' | 'number', { max, min }: Bounds) {
  return {
    type,
    ...(min === undefined ? {} : { minimum: min }),
    ...(max === undefined ? {} : { maximum: max }),
  };
}

export { boundsSchema, boundsSentence, readBounds, withinBounds, withoutNegativeZero };
export type { Bounds };
