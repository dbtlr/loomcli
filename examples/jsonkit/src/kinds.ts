/** JSON objects are the only values with named members, so every command tests them the same way. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One wording for every JSON kind, shared by the summary and the keys diagnostic. */
export function describeKind(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `array with ${value.length} items`;
  }
  if (isRecord(value)) {
    return `object with ${Object.keys(value).length} keys`;
  }
  return typeof value;
}
