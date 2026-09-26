/** Whether a value is a plain object: an object literal or one made with a null prototype. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyValue(value: unknown, freeze: boolean): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    const copy = items.map((item) => copyValue(item, freeze));
    return freeze ? Object.freeze(copy) : copy;
  }
  return isPlainObject(value) ? copyRecord(value, freeze) : value;
}

/**
 * A deep copy of plain JSON-like data, so neither the author nor a reader can change the original.
 * Arrays and plain objects are copied, frozen when asked, and every other value is kept as it is.
 */
function copyRecord(
  record: Readonly<Record<string, unknown>>,
  freeze: boolean,
): Record<string, unknown> {
  const copy = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, copyValue(value, freeze)]),
  );
  return freeze ? Object.freeze(copy) : copy;
}

export { copyRecord, isPlainObject };
