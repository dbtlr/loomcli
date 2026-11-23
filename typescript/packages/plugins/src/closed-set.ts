/**
 * The closed set of values an input's published schema names, read one keyword at a time. This
 * module belongs to no subpath: help derives its accepted values from it and completion offers
 * them, and neither imports the other's modules. Each reader applies its own bound.
 */

/** One JSON Schema object as the graph publishes it: plain data read one keyword at a time. */
type Schema = Readonly<Record<string, unknown>>;

/**
 * Keywords that describe a schema without constraining the values it accepts, so a closed set
 * beside one still lists every value it accepts.
 */
const annotations: ReadonlySet<string> = new Set([
  '$comment',
  '$id',
  '$schema',
  'default',
  'deprecated',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);

/** Whether a value is a list of strings with no hole. */
function isStrings(value: unknown): value is readonly string[] {
  // Spreading reads a hole as the `undefined` it is, which `every` alone would skip.
  return Array.isArray(value) && [...value].every((entry: unknown) => typeof entry === 'string');
}

/** Whether a published value is one JSON Schema object, read as a record of its keywords. */
function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keywords that name a closed set of values at one level. */
type ClosedKeyword = 'anyOf' | 'const' | 'enum';

/** Whether a keyword names a closed set of values. */
function isClosedKeyword(keyword: string): keyword is ClosedKeyword {
  return keyword === 'anyOf' || keyword === 'const' || keyword === 'enum';
}

/**
 * The one closed-set keyword a level holds, when every other keyword beside it leaves each listed
 * value accepted: `type: 'string'` or an annotation. Two closed-set keywords at one level, or any
 * keyword that could narrow the set, answer `undefined`.
 */
function closedKeyword(schema: Schema): ClosedKeyword | undefined {
  const entries = Object.entries(schema);
  const shapes = entries.map(([keyword]) => keyword).filter(isClosedKeyword);
  const others = entries.filter(([keyword]) => !isClosedKeyword(keyword));
  const harmless = others.every(
    ([keyword, value]) => (keyword === 'type' && value === 'string') || annotations.has(keyword),
  );
  const [shape, second] = shapes;
  return harmless && second === undefined ? shape : undefined;
}

/** The values one `enum` or `const` level names, or `undefined` for any other level. */
function member(schema: Schema): readonly string[] | undefined {
  const keyword = closedKeyword(schema);
  if (keyword === 'enum') {
    return isStrings(schema.enum) ? schema.enum : undefined;
  }
  if (keyword === 'const') {
    return typeof schema.const === 'string' ? [schema.const] : undefined;
  }
  return undefined;
}

/** The values an `anyOf` names when every member is an `enum` or a `const`, flattened in order. */
function flattened(members: unknown): readonly string[] | undefined {
  if (!Array.isArray(members)) {
    return undefined;
  }
  // `Array.from` reads a hole as `undefined`, so a sparse `anyOf` derives nothing.
  const named = Array.from(members, (entry: unknown) =>
    isSchema(entry) ? member(entry) : undefined,
  );
  return named.every((values) => values !== undefined) ? named.flat() : undefined;
}

/**
 * The distinct values an input's schema names, in first-occurrence order: an `enum`, a `const`, or
 * an `anyOf` of those. A schema that names no closed set, a `null` schema included, answers
 * `undefined`. The set is whole; a reader that shows fewer values applies its own bound.
 */
function closedSet(schema: Schema | null): readonly string[] | undefined {
  if (schema === null) {
    return undefined;
  }
  const values = closedKeyword(schema) === 'anyOf' ? flattened(schema.anyOf) : member(schema);
  return values === undefined ? undefined : [...new Set(values)];
}

export type { Schema };
export { closedSet, isStrings };
