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

interface NumberOptions {
  min?: number;
  max?: number;
}

const decimal = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

/** A finite decimal number, with an optional fraction and exponent, within `min` and `max`. */
function number(options?: NumberOptions): Validator<number> {
  const bounds = readBounds(options, {
    accepts: Number.isFinite,
    correction: 'Supply a finite number.',
    factory: 'number',
    requirement: 'a finite number',
  });
  const sentence = boundsSentence('a number', bounds);
  return createValidator({
    inputSchema: boundsSchema('number', bounds),
    parse: (raw): ParseResult<number> => {
      if (!decimal.test(raw)) {
        return reject(sentence);
      }
      const value = withoutNegativeZero(Number(raw));
      return Number.isFinite(value) && withinBounds(value, bounds) ? { value } : reject(sentence);
    },
  });
}

export { number };
export type { NumberOptions };
