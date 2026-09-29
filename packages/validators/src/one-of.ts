import { DeclarationError } from '@loomcli/core';

import { oneOfIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault } from './faults.js';
import { reject } from './issues.js';
import { oneOfValues } from './rules.js';

const empty = 0;

/** A fault of the list `oneOf()` received, marking the list or one of its values. */
function listFault(values: unknown, mark: string, parts: { sentence: string; correction: string }) {
  return fault(oneOfValues, { arguments: [values], factory: 'oneOf', mark }, parts);
}

/** The declared list as unknown items, after faulting on one that is not an array or is empty. */
function checkList(values: unknown): readonly unknown[] {
  if (!Array.isArray(values)) {
    throw listFault(values, '0', {
      correction: 'Supply an array of strings.',
      sentence: 'oneOf() values is not an array.',
    });
  }
  const items: readonly unknown[] = values;
  if (items.length === empty) {
    throw listFault(values, '0', {
      correction: 'List at least one value.',
      sentence: 'oneOf() values is empty.',
    });
  }
  return items;
}

/**
 * Faults on a value that is not a string, is empty, or was listed earlier. `seen` holds the
 * position of each value listed so far, so a repeat marks both.
 */
function checkValue(listed: readonly unknown[], index: number, seen: Map<string, number>): void {
  const item = listed[index];
  if (typeof item !== 'string') {
    throw listFault(listed, `0.${String(index)}`, {
      correction: 'List strings only.',
      sentence: 'oneOf() lists a value that is not a string.',
    });
  }
  if (item === '') {
    throw listFault(listed, `0.${String(index)}`, {
      correction: 'List nonempty values only.',
      sentence: 'oneOf() lists an empty string.',
    });
  }
  const first = seen.get(item);
  if (first !== undefined) {
    const call = { arguments: [listed], call: 'oneOf' };
    throw new DeclarationError(oneOfValues, {
      correction: 'List each value once.',
      findings: [
        { ...call, mark: `0.${String(first)}`, note: 'the first' },
        { ...call, mark: `0.${String(index)}`, note: 'the second' },
      ],
      sentence: `oneOf() lists ${JSON.stringify(item)} twice.`,
    });
  }
  seen.set(item, index);
}

/** A token exactly equal to one of the declared values, typed as their union. */
function oneOf<const Values extends readonly [string, ...string[]]>(
  values: Values,
): Validator<Values[number]> {
  checkList(values);
  // The copy is what the validator keeps, so the checks read the copy and not the caller's list.
  const listed: readonly Values[number][] = [...values];
  const seen = new Map<string, number>();
  for (const index of listed.keys()) {
    checkValue(listed, index, seen);
  }
  const issue = oneOfIssue.issue({ values: listed });
  return createValidator({
    inputSchema: { type: 'string', enum: [...listed] },
    parse: (raw): ParseResult<Values[number]> => {
      const match = listed.find((value) => value === raw);
      return match === undefined ? reject(issue) : { value: match };
    },
  });
}

export { oneOf };
