import { DeclarationError } from '@loomcli/core';

import { oneOfIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';
import { oneOfValues } from './rules.js';

/** Faults on a value listed twice, marking both places it is listed. */
function checkDistinct(values: readonly string[]): void {
  const seen = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    const first = seen.get(value);
    if (first !== undefined) {
      const call = { arguments: [values], call: 'oneOf' };
      throw new DeclarationError(oneOfValues, {
        correction: 'List each value once.',
        findings: [
          { ...call, mark: `0.${String(first)}`, note: 'the first' },
          { ...call, mark: `0.${String(index)}`, note: 'the second' },
        ],
        sentence: `oneOf() lists ${JSON.stringify(value)} twice.`,
      });
    }
    seen.set(value, index);
  }
}

/** A token exactly equal to one of the declared values, typed as their union. */
function oneOf<const Values extends readonly [string, ...string[]]>(
  values: Values,
): Validator<Values[number]> {
  checkDistinct(values);
  const issue = oneOfIssue.issue({ values });
  return createValidator({
    inputSchema: { type: 'string', enum: values },
    parse: (raw): ParseResult<Values[number]> => {
      const match = values.find((value) => value === raw);
      return match === undefined ? reject(issue) : { value: match };
    },
  });
}

export { oneOf };
