import type { StandardSchemaV1 } from '@loomcli/core';

import type { BoundCodes } from './codes.js';
import { fault } from './faults.js';
import type { FactoryCall } from './faults.js';
import { boundsOrder, boundValue } from './rules.js';

/** Inclusive bounds on a numeric factory, either or both absent. */
interface Bounds {
  min: number | undefined;
  max: number | undefined;
}

/** The bounds a numeric factory declares. */
interface BoundOptions {
  min?: number;
  max?: number;
}

const zero = 0;

/**
 * One bound a numeric factory declares. It is finite, because the published schema holds a number
 * and JSON has no infinity; a fault marks the bound.
 */
function boundOf(call: FactoryCall, name: 'min' | 'max', value: number | undefined) {
  if (value !== undefined && !Number.isFinite(value)) {
    throw fault(
      boundValue,
      { ...call, mark: `0.${name}` },
      {
        correction: 'Supply a finite number.',
        sentence: `${call.factory}() ${name} is not a finite number.`,
      },
    );
  }
  return value;
}

/** Reads a numeric factory's `min` and `max`, and faults on a bound that is not finite or `min` above `max`. */
function readBounds(factory: string, options: BoundOptions | undefined): Bounds {
  const call = { arguments: [options], factory };
  const min = boundOf(call, 'min', options?.min);
  const max = boundOf(call, 'max', options?.max);
  if (min !== undefined && max !== undefined && min > max) {
    throw fault(
      boundsOrder,
      { ...call, mark: '0.min' },
      {
        correction: 'Supply a min at or below max.',
        sentence: `${factory}() min ${String(min)} is above max ${String(max)}.`,
      },
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

/** Bounds a factory declares as spellings in its own grammar, such as `'30s'` or `'10GiB'`. */
interface SpelledBoundOptions {
  min?: string;
  max?: string;
}

/** How a factory whose bounds are spelled in its own grammar reads them, prints them, and names one. */
interface SpelledGrammar {
  /** The value a spelling stands for, or `undefined` for one the factory itself would reject. */
  readonly read: (spelling: string) => number | undefined;
  /** The spelling a value prints as in a fault's sentence. */
  readonly format: (value: number) => string;
  /** The value's kind with its article, such as `a duration`. */
  readonly noun: string;
  /** Two quoted examples for the correction, such as `"30s" or "2h30m"`. */
  readonly examples: string;
}

/**
 * Reads the `min` and `max` of a factory whose bounds are spelled in its own grammar, and faults on
 * a bound the factory would reject or a `min` above `max`.
 */
function readSpelledBounds(
  factory: string,
  options: SpelledBoundOptions | undefined,
  grammar: SpelledGrammar,
): Bounds {
  const call = { arguments: [options], factory };
  const spelled = (name: 'min' | 'max', spelling: string | undefined) => {
    if (spelling === undefined) {
      return undefined;
    }
    const value = grammar.read(spelling);
    if (value === undefined) {
      throw fault(
        boundValue,
        { ...call, mark: `0.${name}` },
        {
          correction: `Supply ${grammar.noun} such as ${grammar.examples}.`,
          sentence: `${factory}() ${name} is not ${grammar.noun}.`,
        },
      );
    }
    return value;
  };
  const min = spelled('min', options?.min);
  const max = spelled('max', options?.max);
  if (min !== undefined && max !== undefined && min > max) {
    throw fault(
      boundsOrder,
      { ...call, mark: '0.min' },
      {
        correction: 'Supply a min at or below max.',
        sentence: `${factory}() min ${grammar.format(min)} is above max ${grammar.format(max)}.`,
      },
    );
  }
  return { max, min };
}

/** The published schema for a numeric type, with each declared bound. */
function boundsSchema(type: 'integer' | 'number', { max, min }: Bounds) {
  return {
    type,
    ...(min === undefined ? {} : { minimum: min }),
    ...(max === undefined ? {} : { maximum: max }),
  };
}

export {
  boundsIssue,
  boundsSchema,
  readBounds,
  readSpelledBounds,
  withinBounds,
  withoutNegativeZero,
};
export type { BoundOptions, Bounds, SpelledBoundOptions };
