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

/**
 * The options of `number()`: inclusive bounds.
 *
 * @public
 */
interface NumberOptions {
  /** The least accepted value, inclusive. */
  min?: number;
  /** The greatest accepted value, inclusive. */
  max?: number;
}

const decimal = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

/**
 * A finite decimal number, with an optional fraction and exponent, within `min` and `max`.
 *
 * @example
 * ```ts
 * import { number } from '@loomcli/validators';
 *
 * const ratio = number({ min: 0, max: 1 });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#number
 *
 * @public
 */
function number(options?: NumberOptions): Validator<number> {
  const bounds = readBounds('number', options);
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
