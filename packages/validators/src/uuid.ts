import { uuidIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';

const grouped = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u;

/** A UUID of any version in any letter case, read as lowercase so two spellings compare equal. */
function uuid(): Validator<string> {
  const issue = uuidIssue.issue({});
  return createValidator({
    inputSchema: { type: 'string', format: 'uuid' },
    parse: (raw): ParseResult<string> =>
      grouped.test(raw) ? { value: raw.toLowerCase() } : reject(issue),
  });
}

export { uuid };
