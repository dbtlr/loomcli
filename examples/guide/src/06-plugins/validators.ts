import { createValidator } from '@loomcli/validators';
import type { ParseResult } from '@loomcli/validators';

import { parseDistance, parsePace, parseTime } from './pace.js';
import type { Pace } from './pace.js';

/** A distance such as `10k`, `5mi`, `400m`, `half`, or `marathon`, which the action reads as metres. */
export const distance = createValidator({
  inputSchema: {
    pattern: String.raw`^(?:\d+(?:\.\d+)?(?:k|km|m|mi)|half|marathon)$`,
    type: 'string',
  },
  parse: (raw): ParseResult<number> => {
    const metres = parseDistance(raw);
    return metres === undefined
      ? {
          issues: [
            {
              message: 'Expected a distance, such as 10k, 5mi, 400m, half, or marathon.',
            },
          ],
        }
      : { value: metres };
  },
});

/** A time such as `25:30` or `1:45:00`, which the action reads as seconds. */
export const time = createValidator({
  inputSchema: { pattern: String.raw`^(?:\d+:[0-5]\d|\d+):[0-5]\d$`, type: 'string' },
  parse: (raw): ParseResult<number> => {
    const seconds = parseTime(raw);
    return seconds === undefined
      ? { issues: [{ message: 'Expected a time above zero as mm:ss or h:mm:ss, such as 25:30.' }] }
      : { value: seconds };
  },
});

/** A pace such as `5:00/km` or `8:03/mi`, which the action reads as a `Pace`. */
export const pace = createValidator({
  inputSchema: { pattern: String.raw`^(?:\d+:[0-5]\d|\d+):[0-5]\d ?/(?:km|mi)$`, type: 'string' },
  parse: (raw): ParseResult<Pace> => {
    const parsed = parsePace(raw);
    return parsed === undefined
      ? { issues: [{ message: 'Expected a time and a unit, such as 5:00/km or 8:03/mi.' }] }
      : { value: parsed };
  },
});
