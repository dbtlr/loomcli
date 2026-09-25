import { readExtension } from '@loomcli/core';
import type { ArgumentNode, OptionNode } from '@loomcli/core';

import { escapeControls } from '../encode.js';
import { terminator } from '../lines.js';
import { isStrings, oneLine } from './cells.js';
import { helpArgument, helpInput } from './extension.js';

/** One JSON Schema object as the graph publishes it: plain data read one keyword at a time. */
type Schema = Readonly<Record<string, unknown>>;

/** The most values a derived list names; a larger set is the author's to state with `accepts`. */
const maximumValues = 8;

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

/** Keywords that bound how many tokens a collection takes and never which values each may be. */
const counts: ReadonlySet<string> = new Set(['maxItems', 'minItems', 'uniqueItems']);

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

/** The values one level names: an `enum`, a `const`, or an `anyOf` of those, flattened in order. */
function closedSet(schema: Schema): readonly string[] | undefined {
  return closedKeyword(schema) === 'anyOf' ? flattened(schema.anyOf) : member(schema);
}

/**
 * The values a collection's `items` names, when the array level holds nothing else that could
 * narrow them: `type: 'array'`, `items`, an annotation, or a count keyword.
 */
function itemsSet(schema: Schema): readonly string[] | undefined {
  for (const [keyword, value] of Object.entries(schema)) {
    const allowed =
      keyword === 'items' ||
      (keyword === 'type' && value === 'array') ||
      annotations.has(keyword) ||
      counts.has(keyword);
    if (!allowed) {
      return undefined;
    }
  }
  return isSchema(schema.items) ? closedSet(schema.items) : undefined;
}

/**
 * One value as the list prints it: as written, or as its JSON string when it is empty or holds
 * whitespace, a comma, a double quote, a line terminator, or a control character. JSON escapes the
 * C0 controls; DEL and the C1 controls, which JSON leaves raw, print as their lowercase `\uXXXX`
 * escapes, and every line terminator prints escaped, so the row shows the exact value on one line.
 */
function listed(value: string): string {
  const plain = value !== '' && !/[\s,"\p{Cc}]/u.test(value) && !terminator.test(value);
  if (plain) {
    return value;
  }
  return oneLine(escapeControls(JSON.stringify(value)));
}

/**
 * The sentence help derives from an input's schema: `One of: a, b, c.` for a closed set of at most
 * eight distinct strings, read under `items` for a collection. Anything else derives nothing.
 */
function derived(schema: Schema | null, collection: boolean): string | undefined {
  if (schema === null) {
    return undefined;
  }
  const values = collection ? itemsSet(schema) : closedSet(schema);
  const distinct = [...new Set(values)];
  const [first] = distinct;
  if (first === undefined || distinct.length > maximumValues) {
    return undefined;
  }
  return `One of: ${distinct.map((value) => listed(value)).join(', ')}.`;
}

/**
 * The accepted-values sentence one option's row prints: its authored `accepts`, which always
 * wins, or the list derived from its schema. A Boolean option takes no value and prints none.
 */
function optionAccepts(option: OptionNode): string | undefined {
  if (option.type === 'boolean') {
    return undefined;
  }
  return readExtension(option, helpInput)?.accepts ?? derived(option.schema, option.multiple);
}

/** The accepted-values sentence one argument's row prints, authored or derived as an option's is. */
function argumentAccepts(argument: ArgumentNode): string | undefined {
  return (
    readExtension(argument, helpArgument)?.accepts ?? derived(argument.schema, argument.variadic)
  );
}

export { argumentAccepts, optionAccepts };
