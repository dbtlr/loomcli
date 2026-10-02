/**
 * The verdict a declaring call reached on each part of a declaration it captured, so every later
 * rule reads that one verdict and never asks the part's prototype again.
 */
const verdicts = new WeakMap<object, boolean>();

/**
 * A structural value core reads as plain data: an object literal, and never a declaration that
 * carries state of its own. The options slots read it to reject a value that is not an options
 * object, and `snapshot` reads it to copy a declared value faithfully. A value a declaring call
 * already judged answers with that verdict.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return verdicts.get(value) ?? hasPlainPrototype(value);
}

/** Whether one object's prototype, read once, is `Object.prototype` or `null`. */
function hasPlainPrototype(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a declaring call reads one part of a declaration as plain data, decided once: the first
 * verdict is recorded, and `isPlainObject` answers with it for the same value from then on.
 */
function decidePlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const known = verdicts.get(value);
  if (known !== undefined) {
    return known;
  }
  const verdict = hasPlainPrototype(value);
  verdicts.set(value, verdict);
  return verdict;
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
  fillList(copy, list, (entry) => copied(entry, copies));
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

/** Defines one key as an own data property, so a key of `__proto__` is stored under that name. */
function defineEntry(target: object, key: number | string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * A copy of every own string key of one object, enumerable or not, each described once and read
 * once, in the order the object lists its keys. `entering` hears each key before it is read, so a
 * read that throws can name it. A symbol key is not copied, because no declaration declares one.
 */
function copyOwnKeys(
  declared: object,
  entering: (key: string) => void = () => undefined,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(declared)) {
    if (typeof key === 'string') {
      entering(key);
      if (Reflect.getOwnPropertyDescriptor(declared, key) !== undefined) {
        defineEntry(copy, key, Reflect.get(declared, key));
      }
    }
  }
  return copy;
}

/**
 * The copy of one part of a declaration that `decidePlain` judges plain, by `copyOwnKeys`. Any other
 * value is answered as it is, so the rule for its slot reports it.
 */
function shallowRecord(value: unknown): unknown {
  return decidePlain(value) ? copyOwnKeys(value) : value;
}

/**
 * Fills `copy` with what `convert` makes of each entry of `list`, read by its length once and then
 * index by index, so none of the list's own methods runs. A hole stays a hole.
 */
function fillList<Entry, Copied>(
  copy: Copied[],
  list: readonly Entry[],
  convert: (entry: Entry | undefined) => Copied,
): void {
  const { length } = list;
  for (let index = 0; index < length; index += 1) {
    if (Object.hasOwn(list, index)) {
      defineEntry(copy, index, convert(list[index]));
    }
  }
  copy.length = length;
}

/** A copy of one list's entries by `fillList`. Each entry is what its factory built, so it is kept. */
function copyList<Entry>(list: readonly Entry[]): Entry[] {
  const copy: Entry[] = [];
  fillList(copy, list, (entry) => entry);
  return copy;
}

/** The copy of a value that is a list, by `copyList`. Any other value is answered as it is. */
function shallowList(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  const list: readonly unknown[] = value;
  return copyList(list);
}

export {
  copyList,
  copyOwnKeys,
  decidePlain,
  isPlainObject,
  shallowList,
  shallowRecord,
  snapshot,
  snapshotRecord,
};
