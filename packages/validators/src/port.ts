import { boundsSchema, withinBounds } from './bounds.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { readInteger } from './integer.js';
import { reject } from './issues.js';

const range = { max: 65_535, min: 1 };

/** A TCP or UDP port the operator names, 1 through 65535; port 0 is left to `integer()`. */
function port(): Validator<number> {
  return createValidator({
    inputSchema: boundsSchema('integer', range),
    parse: (raw): ParseResult<number> => {
      const value = readInteger(raw);
      return value !== undefined && withinBounds(value, range)
        ? { value }
        : reject('Expected a port number from 1 through 65535.');
    },
  });
}

export { port };
