/**
 * A structural value core reads as plain data: an object literal, and never a declaration that
 * carries state of its own. The options slots read it to reject a value that is not an options
 * object, and `snapshot` reads it to copy a declared value faithfully.
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
 * same cycle, because each source container is copied once and every path to it reaches that copy.
 * Primitives and library objects, such as a class instance or a `Date` a schema produced, are
 * reported as they are, because core cannot copy them meaningfully. A declaring call reads it for
 * a declared default, build for a converter's schema, and the chain for the request one middleware
 * holds.
 */
function snapshot(value: unknown): unknown {
  return copied(value, new Map());
}

/** The snapshot of one plain object, under the record type the caller already established. */
function snapshotRecord(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return copiedRecord(value, new Map());
}

/** One value of a snapshot in progress. `copies` holds the copy of every container reached. */
function copied(value: unknown, copies: Map<object, unknown>): unknown {
  if (Array.isArray(value)) {
    return copiedList(value, copies);
  }
  if (isPlainObject(value)) {
    return copiedRecord(value, copies);
  }
  return value;
}

/**
 * One array's copy. It joins `copies` before its entries are read, so an entry that leads back to
 * it reaches the copy, and it is frozen once it is filled. A hole stays a hole.
 */
function copiedList(list: readonly unknown[], copies: Map<object, unknown>): unknown {
  const known = copies.get(list);
  if (known !== undefined) {
    return known;
  }
  const copy: unknown[] = [];
  copies.set(list, copy);
  // `forEach` skips a hole, and the length set after it keeps a trailing one.
  list.forEach((entry: unknown, index) => {
    copy[index] = copied(entry, copies);
  });
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
  const known = copies.get(record);
  if (isPlainObject(known)) {
    return known;
  }
  const copy: Record<string, unknown> = {};
  copies.set(record, copy);
  for (const [key, entry] of Object.entries(record)) {
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: copied(entry, copies),
      writable: true,
    });
  }
  return Object.freeze(copy);
}

export { isPlainObject, snapshot, snapshotRecord };
