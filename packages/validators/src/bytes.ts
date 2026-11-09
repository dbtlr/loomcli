import { boundsIssue, readSpelledBounds, withinBounds } from './bounds.js';
import type { SpelledBoundOptions } from './bounds.js';
import { bytesPattern, formatBytes, readBytes } from './bytes-grammar.js';
import { bytesCodes } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';

/** Inclusive bounds, each a size spelled in the operator's grammar, such as `1MB` or `10GiB`. */
type BytesOptions = SpelledBoundOptions;

const factory = 'bytes';

/**
 * A size in the operator's grammar, output as a whole number of bytes within `min` and `max`, both
 * inclusive. A bare number counts bytes; `kB` through `PB` are powers of 1000 and `KiB` through
 * `PiB`, or `Ki` through `Pi`, are powers of 1024, under IEC 80000-13.
 */
function bytes(options?: BytesOptions): Validator<number> {
  const bounds = readSpelledBounds(factory, options, {
    examples: '"1MB" or "10GiB"',
    format: formatBytes,
    noun: 'a size',
    read: readBytes,
  });
  const issue = boundsIssue(bytesCodes, bounds);
  return createValidator({
    inputSchema: { type: 'string', pattern: bytesPattern },
    parse: (raw): ParseResult<number> => {
      const value = readBytes(raw);
      return value !== undefined && withinBounds(value, bounds) ? { value } : reject(issue);
    },
  });
}

export { bytes };
export type { BytesOptions };
