import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault } from './faults.js';
import { reject } from './issues.js';

const empty = 0;

/** The declared list as unknown items, after faulting on one that is not an array or is empty. */
function checkList(values: unknown): readonly unknown[] {
  if (!Array.isArray(values)) {
    throw fault('oneOf() values is not an array. Supply an array of strings.');
  }
  const items: readonly unknown[] = values;
  if (items.length === empty) {
    throw fault('oneOf() values is empty. List at least one value.');
  }
  return items;
}

/** Faults on a value that is not a string, is empty, or was listed earlier. */
function checkValue(item: unknown, seen: Set<string>): void {
  if (typeof item !== 'string') {
    throw fault('oneOf() lists a value that is not a string. List strings only.');
  }
  if (item === '') {
    throw fault('oneOf() lists an empty string. List nonempty values only.');
  }
  if (seen.has(item)) {
    throw fault(`oneOf() lists ${JSON.stringify(item)} twice. List each value once.`);
  }
  seen.add(item);
}

/** A token exactly equal to one of the declared values, typed as their union. */
function oneOf<const Values extends readonly [string, ...string[]]>(
  values: Values,
): Validator<Values[number]> {
  const seen = new Set<string>();
  for (const item of checkList(values)) {
    checkValue(item, seen);
  }
  const listed: readonly Values[number][] = [...values];
  const sentence = `Expected one of: ${listed.join(', ')}.`;
  return createValidator({
    inputSchema: { enum: [...listed], type: 'string' },
    parse: (raw): ParseResult<Values[number]> => {
      const match = listed.find((value) => value === raw);
      return match === undefined ? reject(sentence) : { value: match };
    },
  });
}

export { oneOf };
