import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';

const grouped = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u;

/** A UUID of any version in any letter case, read as lowercase so two spellings compare equal. */
function uuid(): Validator<string> {
  return createValidator({
    inputSchema: { format: 'uuid', type: 'string' },
    parse: (raw): ParseResult<string> =>
      grouped.test(raw)
        ? { value: raw.toLowerCase() }
        : reject('Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.'),
  });
}

export { uuid };
