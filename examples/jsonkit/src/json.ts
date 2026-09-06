const INDENT = 2;

/**
 * Every command prints its result here, so one document renders alike wherever it is printed.
 * Objects and arrays print indented; scalars have no members to indent, so they stay compact.
 */
export function formatJson(value: unknown): string {
  return JSON.stringify(value, undefined, INDENT);
}
