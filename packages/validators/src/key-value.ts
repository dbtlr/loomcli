import { keyValueIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault } from './faults.js';
import { reject } from './issues.js';
import { keyValueSeparator } from './rules.js';

interface KeyValueOptions {
  separator?: string;
}

/** A pair split at the first separator, both sides as written. */
interface KeyValuePair {
  key: string;
  value: string;
}

const defaultSeparator = '=';

const firstKeyCharacter = 1;

const start = 0;

const whitespace = /\s/u;

/** What is wrong with a separator, as its fault's sentence states it, or undefined when nothing is. */
function separatorProblem(separator: string): string | undefined {
  if (separator === '') {
    return 'is empty';
  }
  return whitespace.test(separator) ? 'holds whitespace' : undefined;
}

/** The `separator` a `keyValue()` call declares, nonempty and free of whitespace; a fault marks it. */
function separatorOf(options: KeyValueOptions | undefined): string {
  const separator = options?.separator ?? defaultSeparator;
  const problem = separatorProblem(separator);
  if (problem !== undefined) {
    throw fault(
      keyValueSeparator,
      { arguments: [options], factory: 'keyValue', mark: '0.separator' },
      {
        correction: 'Supply one character or more with no whitespace, such as "=" or ":".',
        sentence: `keyValue() separator ${problem}.`,
      },
    );
  }
  return separator;
}

/**
 * The separator as a pattern under the `u` flag: each regular-expression syntax character escaped
 * with a backslash. A hyphen is not one, and stays bare, because `u` refuses `\-` outside a class.
 */
function escaped(separator: string): string {
  return separator.replaceAll(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`);
}

/**
 * A key and a value joined by the separator, `=` unless the author names another, split at its
 * first occurrence. The key holds one character or more, and the value may be empty.
 */
function keyValue(options?: KeyValueOptions): Validator<KeyValuePair> {
  const separator = separatorOf(options);
  const issue = keyValueIssue.issue({ separator });
  return createValidator({
    // One character or more, line terminators included, then the separator.
    inputSchema: { type: 'string', pattern: String.raw`^[\s\S]+${escaped(separator)}` },
    parse: (raw): ParseResult<KeyValuePair> => {
      const at = raw.indexOf(separator);
      return at < firstKeyCharacter
        ? reject(issue)
        : { value: { key: raw.slice(start, at), value: raw.slice(at + separator.length) } };
    },
  });
}

export { keyValue };
export type { KeyValueOptions, KeyValuePair };
