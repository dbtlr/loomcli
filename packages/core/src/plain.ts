/**
 * A structural value core reads as plain data: an object literal, and never a declaration that
 * carries state of its own. The options slots read it to tell an options object from a value of
 * another kind, and `snapshot` reads it to copy a value faithfully.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A snapshot of one value. Arrays and plain objects are copied and frozen to any depth, so a
 * consumer cannot reach the source through the copy. A value that holds itself is copied with the
 * same cycle, because each source object is copied once and every path to it reaches that copy.
 * Primitives and library objects, such as a class instance or a `Date` a schema produced, are
 * reported as they are, because core cannot copy them meaningfully. Build reads it for a
 * converter's schema, and the chain for the request one middleware holds.
 */
function snapshot(value: unknown): unknown {
  return copied(value, new Map());
}

/** The snapshot of one plain object, under the record type the caller already established. */
function snapshotRecord(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return copiedRecord(value, new Map());
}

/** One value of a snapshot in progress. An object the walk reached already answers as it did then. */
function copied(value: unknown, copies: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (copies.has(value)) {
    return copies.get(value);
  }
  if (Array.isArray(value)) {
    return copiedList(value, copies);
  }
  if (isPlainObject(value)) {
    return copiedRecord(value, copies);
  }
  copies.set(value, value);
  return value;
}

/**
 * One array's copy. It joins `copies` before its entries are read, so an entry that leads back to
 * it reaches the copy, and it is frozen once it is filled. A hole stays a hole.
 */
function copiedList(list: readonly unknown[], copies: Map<object, unknown>): unknown {
  const copy: unknown[] = [];
  copies.set(list, copy);
  for (const [index, entry] of list.entries()) {
    if (Object.hasOwn(list, index)) {
      defineEntry(copy, index, copied(entry, copies));
    }
  }
  copy.length = list.length;
  return Object.freeze(copy);
}

/**
 * One plain object's copy on `Object.prototype`, filled and frozen as an array's copy is. Each key
 * is defined as an own data property, so a key of `__proto__` is stored under that name.
 */
function copiedRecord(
  record: Record<string, unknown>,
  copies: Map<object, unknown>,
): Readonly<Record<string, unknown>> {
  const copy: Record<string, unknown> = {};
  copies.set(record, copy);
  for (const [key, entry] of Object.entries(record)) {
    defineEntry(copy, key, copied(entry, copies));
  }
  return Object.freeze(copy);
}

/** Defines one key as an own data property, so a key of `__proto__` is stored under that name. */
function defineEntry(target: object, key: number | string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export { defineEntry, isPlainObject, snapshot, snapshotRecord };
