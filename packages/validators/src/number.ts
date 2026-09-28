import {
  boundsIssue,
  boundsSchema,
  readBounds,
  withinBounds,
  withoutNegativeZero,
} from './bounds.js';
import { numberCodes } from './codes.js';
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
  const issue = boundsIssue(numberCodes, bounds);
  return createValidator({
    inputSchema: boundsSchema('number', bounds),
    parse: (raw): ParseResult<number> => {
      if (!decimal.test(raw)) {
        return reject(issue);
      }
      const value = withoutNegativeZero(Number(raw));
      return Number.isFinite(value) && withinBounds(value, bounds) ? { value } : reject(issue);
    },
  });
}

export { number };
export type { NumberOptions };
