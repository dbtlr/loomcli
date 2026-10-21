import { pipe, rawTransform, unknown } from 'valibot';

/**
 * A JSON object as `package.json` holds it, with every own key kept in its order. An array is not
 * one. Valibot's `record` skips the own keys `prototype`, `constructor`, and `__proto__`, so a
 * manifest read through it would lose a script or a dependency by one of those names; this schema
 * copies the entries itself, and a key named `__proto__` stays an ordinary data key.
 */
export const jsonObject = pipe(
  unknown(),
  rawTransform(({ addIssue, dataset, NEVER }) => {
    const { value } = dataset;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      addIssue({ message: 'Invalid type: Expected Object' });
      return NEVER;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]): [string, unknown] => [key, entry]),
    );
  }),
);

/** A JSON object whose every value is a string, with every own key kept, such as a dependency map. */
export const stringMap = pipe(
  jsonObject,
  rawTransform(({ addIssue, dataset, NEVER }) => {
    const entries: [string, string][] = [];
    let failed = false;
    for (const [key, value] of Object.entries(dataset.value)) {
      if (typeof value === 'string') {
        entries.push([key, value]);
      } else {
        // Every wrong value is an issue of its own, so the operator sees each key at once.
        failed = true;
        addIssue({
          message: `Invalid type: Expected string but received ${JSON.stringify(value)}`,
          path: [{ input: dataset.value, key, origin: 'value', type: 'object', value }],
        });
      }
    }
    return failed ? NEVER : Object.fromEntries(entries);
  }),
);
