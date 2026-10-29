import { DeclarationError, escapeControlCharacters } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import { configEmptyFile } from '../rules.js';

/**
 * The drop rule: validate the parsed file with the author's schema, remove the value at each issue's
 * path, and validate again until the file passes. Each round removes at least one value, so the
 * loop ends. The rule is the plugin contract's "Dropping values".
 */

/** One step of a path into the file: an object key, or an array item's index. */
type Step = string | number;

/** What one removal names: the value it removes and the first message the schema gave for it. */
interface Removal {
  readonly path: readonly Step[];
  readonly message: string;
}

/** What the loop reports once per removed value, so the caller writes its `-v` line. */
type Announce = (removal: Removal) => Promise<void>;

const nothing = 0;

/** The key a path segment names, which Standard Schema writes as a key or as `{ key }`. */
function keyOf(segment: PropertyKey | StandardSchemaV1.PathSegment): PropertyKey {
  return typeof segment === 'object' ? segment.key : segment;
}

/** The index a key names in an array, or `undefined` when it names none. */
function indexOf(key: PropertyKey): number | undefined {
  const index = typeof key === 'string' && /^\d+$/u.test(key) ? Number(key) : key;
  return typeof index === 'number' && Number.isInteger(index) && index >= nothing
    ? index
    : undefined;
}

/**
 * The steps below a node that lead to the value a path removes. A path that enters an array item is
 * cut at the item, so the whole item goes. A path that ends at a value the node does not hold stops
 * at the node, which then removes the nearest enclosing value it does hold.
 */
function stepsBelow(node: unknown, keys: readonly PropertyKey[]): Step[] {
  const [key, ...rest] = keys;
  if (key === undefined) {
    return [];
  }
  if (Array.isArray(node)) {
    const index = indexOf(key);
    return index !== undefined && index < node.length ? [index] : [];
  }
  const name = String(key);
  return isRecord(node) && Object.hasOwn(node, name) ? [name, ...stepsBelow(node[name], rest)] : [];
}

/** Whether two paths name the same value. */
function samePath(left: readonly Step[], right: readonly Step[]): boolean {
  return left.length === right.length && left.every((step, index) => step === right[index]);
}

/** Whether `inner` is inside `outer`, or the same value. */
function isWithin(inner: readonly Step[], outer: readonly Step[]): boolean {
  return samePath(inner.slice(nothing, outer.length), outer);
}

/**
 * The removals one round makes, one per distinct value, in the order the schema reported them. A
 * target inside a value the same round removes is skipped.
 */
function removalsOf(
  file: Record<string, unknown>,
  issues: readonly StandardSchemaV1.Issue[],
): Removal[] {
  const found: Removal[] = [];
  for (const issue of issues) {
    const path = stepsBelow(file, (issue.path ?? []).map(keyOf));
    if (!found.some((entry) => samePath(entry.path, path))) {
      found.push({ message: issue.message, path });
    }
  }
  return found.filter(
    (entry) => !found.some((other) => other !== entry && isWithin(entry.path, other.path)),
  );
}

/** A path as one key a set can hold. */
function pathKey(path: readonly Step[]): string {
  return JSON.stringify(path);
}

/** The node without every value whose path is in `doomed`, copying as it goes so no array index shifts under a removal. */
function pruned(node: unknown, path: readonly Step[], doomed: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => {
      const at = [...path, index];
      return doomed.has(pathKey(at)) ? [] : [pruned(item, at, doomed)];
    });
  }
  if (!isRecord(node)) {
    return node;
  }
  const kept = Object.entries(node).flatMap(([name, value]) => {
    const at = [...path, name];
    return doomed.has(pathKey(at)) ? [] : [[name, pruned(value, at, doomed)]];
  });
  return Object.fromEntries(kept);
}

/** The file with every removal of a round made. A removal with no steps leaves no key. */
function removeAll(
  file: Record<string, unknown>,
  removals: readonly Removal[],
): Record<string, unknown> {
  const doomed = new Set(removals.map((removal) => pathKey(removal.path)));
  const made = doomed.has(pathKey([])) ? {} : pruned(file, [], doomed);
  return isRecord(made) ? made : {};
}

/** The fault of a schema that still reports an issue for an empty file, which is the author's defect. */
function emptyFileFault(message: string | undefined): DeclarationError {
  const reason = escapeControlCharacters(message ?? 'The schema reported an issue.');
  const stop = /[.!?]$/u.test(reason) ? '' : '.';
  return new DeclarationError(configEmptyFile, {
    correction: 'Make every key optional, and keep every refinement true for an empty file.',
    sentence: `The configuration schema rejects an empty file: ${reason}${stop}`,
  });
}

/** What a passed file came to: the file after the drops, and the schema's output for it. */
interface Passed<Output> {
  readonly file: Record<string, unknown>;
  readonly output: Output;
}

/** The value a schema's own validate returned, as the output type its declaration names. */
function outputOf<Schema extends StandardSchemaV1>(
  value: unknown,
): StandardSchemaV1.InferOutput<Schema> {
  // Last resort: no typed path exists, because a generic schema's validate reads as its constraint's, which returns unknown.
  // It holds because the value is what this schema's own validate returned, and InferOutput<Schema> names that output.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value;
}

/**
 * Validates `parsed` and drops what the schema rejects until it passes. A round that finds the file
 * already empty and still rejected throws `@loomcli/plugins/config/empty-file`. The schema may
 * answer through a promise.
 */
async function dropUntilPasses<Schema extends StandardSchemaV1>(
  schema: Schema,
  file: Record<string, unknown>,
  announce: Announce,
): Promise<Passed<StandardSchemaV1.InferOutput<Schema>>> {
  const result = await schema['~standard'].validate(file);
  if (result.issues === undefined) {
    return { file, output: outputOf<Schema>(result.value) };
  }
  if (Object.keys(file).length === nothing) {
    throw emptyFileFault(result.issues[nothing]?.message);
  }
  const removals = removalsOf(file, result.issues);
  for (const removal of removals) {
    await announce(removal);
  }
  return dropUntilPasses(schema, removeAll(file, removals), announce);
}

export { dropUntilPasses };
export type { Announce, Passed, Removal, Step };
