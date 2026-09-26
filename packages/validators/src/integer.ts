import {
  boundsSchema,
  boundsSentence,
  readBounds,
  withinBounds,
  withoutNegativeZero,
} from './bounds.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';

interface IntegerOptions {
  min?: number;
  max?: number;
}

const digits = /^-?[0-9]+$/u;

/** The safe integer a token spells in decimal digits, `-0` as `0`, or undefined when none. */
function readInteger(raw: string): number | undefined {
  if (!digits.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? withoutNegativeZero(value) : undefined;
}

/** A decimal whole number that is a safe integer within `min` and `max`, both inclusive. */
function integer(options?: IntegerOptions): Validator<number> {
  const bounds = readBounds(options, {
    accepts: Number.isSafeInteger,
    correction: 'Supply a whole number from -9007199254740991 through 9007199254740991.',
    factory: 'integer',
    requirement: 'a safe integer',
  });
  const sentence = boundsSentence('a whole number', bounds);
  return createValidator({
    inputSchema: boundsSchema('integer', bounds),
    parse: (raw): ParseResult<number> => {
      const value = readInteger(raw);
      return value !== undefined && withinBounds(value, bounds) ? { value } : reject(sentence);
    },
  });
}

export { integer, readInteger };
export type { IntegerOptions };
