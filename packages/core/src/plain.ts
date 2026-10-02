/**
 * The verdict the declaring call under way reached on each part of a declaration it captured, so
 * every later rule of that call reads that one verdict and never asks the part's prototype again.
 * No call is under way outside `declaring`, so a run and every later call judge afresh.
 */
let verdicts: WeakMap<object, boolean> | undefined = undefined;

/**
 * Runs one declaring call with verdicts of its own, dropped when it returns or throws. A call made
 * inside another, such as a `plugin()` a getter makes, is part of the outer read and shares them.
 */
function declaring<Result>(call: () => Result): Result {
  if (verdicts !== undefined) {
    return call();
  }
  verdicts = new WeakMap();
  try {
    return call();
  } finally {
    verdicts = undefined;
  }
}

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
  return verdicts?.get(value) ?? hasPlainPrototype(value);
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
  const known = verdicts?.get(value);
  if (known !== undefined) {
    return known;
  }
  const verdict = hasPlainPrototype(value);
  verdicts?.set(value, verdict);
  return verdict;
}

/**
 * A snapshot of one value. Arrays and plain objects are copied and frozen to any depth, so a
 * consumer cannot reach the source through the copy. A value that holds itself is copied with the
 * same cycle, because each source container is copied once and every path to it reaches that copy.
 * Primitives and library objects, such as a class instance or a `Date` a schema produced, are
 * reported as they are, because core cannot copy them meaningfully. Build reads it for a
 * converter's schema, and the chain for the request one middleware holds.
 */
function snapshot(value: unknown): unknown {
  return copied(value, copying(Number.POSITIVE_INFINITY), 1);
}

/** The snapshot of one plain object, under the record type the caller already established. */
function snapshotRecord(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return copiedRecord(value, copying(Number.POSITIVE_INFINITY), 1);
}

/**
 * The snapshot `snapshot` takes, of a value whose paths may hold at most `levels` arrays and plain
 * objects, the value itself included. A path ends at a container it already passed through, so a
 * cycle counts each of its containers once. A longer path throws `NestedTooDeepError` before the walk
 * goes deeper than `levels`, so neither the walk nor any later reader of the copy overflows the
 * call stack. A declaring call reads it for a declared default.
 */
function boundedSnapshot(value: unknown, levels: number): unknown {
  return copied(value, copying(levels), 1);
}

/** What `boundedSnapshot` throws for a value with a path longer than its limit. */
class NestedTooDeepError extends Error {
  override name = 'NestedTooDeepError';
}

/** One snapshot in progress. */
interface Copying {
  /** The copy of every container reached. */
  readonly copies: Map<object, unknown>;
  /** How many containers the longest path from each filled container holds, itself included. */
  readonly heights: Map<object, number>;
  /** The most containers any path may hold. */
  readonly levels: number;
}

/** A snapshot about to start, whose paths may hold at most `levels` containers. */
function copying(levels: number): Copying {
  return { copies: new Map(), heights: new Map(), levels };
}

/** One value of a snapshot in progress, reached at `level`, where the value itself is level 1. */
function copied(value: unknown, walk: Copying, level: number): unknown {
  if (Array.isArray(value)) {
    return copiedList(value, walk, level);
  }
  if (isPlainObject(value)) {
    return copiedRecord(value, walk, level);
  }
  return value;
}

/**
 * How many containers the longest path from one entry holds, once the walk has copied the entry of
 * a container reached at `level`. A container the walk filled counts every container below it,
 * even one it reached first by a shorter path. A container still being filled is a cycle, whose
 * path ends there, and any other value holds none.
 */
function heightOf(entry: unknown, walk: Copying, level: number): number {
  const height = typeof entry === 'object' && entry !== null ? (walk.heights.get(entry) ?? 0) : 0;
  if (level + height > walk.levels) {
    throw new NestedTooDeepError();
  }
  return height;
}

/**
 * The copier of each entry of one container reached at `level`, which counts how many containers
 * the longest path from that container holds, itself included.
 */
function entryCopier(walk: Copying, level: number) {
  let height = 1;
  return {
    copy: (entry: unknown): unknown => {
      const copy = copied(entry, walk, level + 1);
      height = Math.max(height, heightOf(entry, walk, level) + 1);
      return copy;
    },
    height: (): number => height,
  };
}

/**
 * Starts the copy of one container reached at `level`, past the limit or not, and answers the copy
 * the walk already holds for it, if any.
 */
function knownCopy(container: object, walk: Copying, level: number): unknown {
  const known = walk.copies.get(container);
  if (known === undefined && level > walk.levels) {
    throw new NestedTooDeepError();
  }
  return known;
}

/**
 * One array's copy. It joins `copies` before its entries are read, so an entry that leads back to
 * it reaches the copy, and it is frozen once it is filled. A hole stays a hole.
 */
function copiedList(list: readonly unknown[], walk: Copying, level: number): unknown {
  const known = knownCopy(list, walk, level);
  if (known !== undefined) {
    return known;
  }
  const copy: unknown[] = [];
  walk.copies.set(list, copy);
  const entries = entryCopier(walk, level);
  fillList(copy, list, entries.copy);
  walk.heights.set(list, entries.height());
  return Object.freeze(copy);
}

/**
 * One plain object's copy on `Object.prototype`, filled and frozen as an array's copy is. Each key
 * is defined as an own data property, so a key of `__proto__` is stored under that name.
 */
function copiedRecord(
  record: Record<string, unknown>,
  walk: Copying,
  level: number,
): Readonly<Record<string, unknown>> {
  const known = knownCopy(record, walk, level);
  if (isPlainObject(known)) {
    return known;
  }
  const copy: Record<string, unknown> = {};
  walk.copies.set(record, copy);
  const entries = entryCopier(walk, level);
  for (const [key, entry] of Object.entries(record)) {
    defineEntry(copy, key, entries.copy(entry));
  }
  walk.heights.set(record, entries.height());
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
  boundedSnapshot,
  copyList,
  copyOwnKeys,
  decidePlain,
  declaring,
  isPlainObject,
  NestedTooDeepError,
  shallowList,
  shallowRecord,
  snapshot,
  snapshotRecord,
};
