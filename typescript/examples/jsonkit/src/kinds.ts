const SINGULAR = 1;

/** Member counts read as English, so one member never reports "1 items". */
function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === SINGULAR ? '' : 's'}`;
}

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
    return `array with ${count(value.length, 'item')}`;
  }
  if (isRecord(value)) {
    return `object with ${count(Object.keys(value).length, 'key')}`;
  }
  return typeof value;
}
