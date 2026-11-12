import { emailIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';

/** One domain label of the WHATWG rule: letters, digits, and hyphens, 1 through 63, no hyphen at an end. */
const label = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';

/** The part before the `@`: one or more letters, digits, and the punctuation the WHATWG rule lists. */
const localPart = "[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+";

/**
 * The WHATWG HTML standard's valid email address production, the rule browsers apply to
 * `<input type="email">`, which the validator publishes as it is.
 */
const emailPattern = String.raw`^${localPart}@${label}(?:\.${label})*$`;

const grammar = new RegExp(emailPattern, 'u');

/**
 * An email address under the WHATWG rule, output as written.
 *
 * @public
 */
function email(): Validator<string> {
  const issue = emailIssue.issue({});
  return createValidator({
    inputSchema: { type: 'string', pattern: emailPattern },
    parse: (raw): ParseResult<string> => (grammar.test(raw) ? { value: raw } : reject(issue)),
  });
}

export { email };
