import { DeclarationError, escapeControlCharacters, issuePhrase } from '@loomcli/core';
import type { Phrase, StandardSchemaV1 } from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import { configEmptyFile } from '../rules.js';

/**
 * The drop rule: validate the parsed file with the author's schema, remove the value at each issue's
 * path, and validate again until the file passes. Each round removes at least one value, so the
 * loop ends. The rule is the plugin contract's "Dropping values".
 */

/** One step of a path into the file: an object key, or an array item's index. */
type Step = string | number;

/**
 * What one removal names: the value it removes, the first issue the schema gave for it, and the
 * paths of the issues behind it. An issue's path reaches below the removed value where the drop
 * rule cuts the path, at an array item or at the nearest value the file holds.
 */
interface Removal {
  readonly path: readonly Step[];
  /** The first issue's sentence: its phrase while it carries one, and its `message` otherwise. */
  readonly sentence: string | Phrase;
  /** The path of the issue whose message the removal names. */
  readonly issuePath: readonly Step[];
  /** The path of every issue behind the removal: each issue whose value lies at or inside it. */
  readonly issuePaths: readonly (readonly Step[])[];
  /** `path` with each array item's index as its position in the file as read. */
  readonly readPath: readonly Step[];
  /** `issuePath` with each array item's index as its position in the file as read. */
  readonly readIssuePath: readonly Step[];
}

/**
 * What the loop reports once per removed value, with the file of the round that removes it, so the
 * caller writes its `-v` line or judges what the removal discards.
 */
type Announce = (removal: Removal, file: Readonly<Record<string, unknown>>) => Promise<void>;

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

/**
 * An issue's whole path as steps. An index into an array the file holds is an item's index, as
 * `stepsBelow` reads it, and every other key keeps its own form, so the path goes on past the
 * values the file holds.
 */
function issueSteps(node: unknown, keys: readonly PropertyKey[]): Step[] {
  const [key, ...rest] = keys;
  if (key === undefined) {
    return [];
  }
  const index = Array.isArray(node) ? indexOf(key) : undefined;
  if (Array.isArray(node) && index !== undefined) {
    return [index, ...issueSteps(node[index], rest)];
  }
  const step = typeof key === 'number' ? key : String(key);
  const next =
    isRecord(node) && typeof step === 'string' && Object.hasOwn(node, step)
      ? node[step]
      : undefined;
  return [step, ...issueSteps(next, rest)];
}

/** Whether two paths name the same value. */
function samePath(left: readonly Step[], right: readonly Step[]): boolean {
  return left.length === right.length && left.every((step, index) => step === right[index]);
}

/** Whether `inner` is inside `outer`, or the same value. */
function isWithin(inner: readonly Step[], outer: readonly Step[]): boolean {
  return samePath(inner.slice(nothing, outer.length), outer);
}

/** A removal before its paths are read back to the file as read. */
type Removed = Omit<Removal, 'readIssuePath' | 'readPath'>;

/** One distinct value a round removes, with the path of each issue that names it. */
interface Target {
  readonly path: readonly Step[];
  readonly sentence: string | Phrase;
  readonly issuePath: readonly Step[];
  readonly issuePaths: Step[][];
}

/**
 * The removals one round makes, one per distinct value, in the order the schema reported them. A
 * target inside a value the same round removes is skipped, and its issues join that removal's.
 */
function removalsOf(
  file: Record<string, unknown>,
  issues: readonly StandardSchemaV1.Issue[],
): Removed[] {
  const found: Target[] = [];
  for (const issue of issues) {
    const keys = (issue.path ?? []).map(keyOf);
    const path = stepsBelow(file, keys);
    const issuePath = issueSteps(file, keys);
    const target = found.find((entry) => samePath(entry.path, path));
    if (target === undefined) {
      found.push({
        issuePath,
        issuePaths: [issuePath],
        path,
        sentence: issuePhrase(issue) ?? issue.message,
      });
    } else {
      target.issuePaths.push(issuePath);
    }
  }
  return found
    .filter((entry) => !found.some((other) => other !== entry && isWithin(entry.path, other.path)))
    .map(({ issuePath, path, sentence }) => ({
      issuePath,
      issuePaths: found
        .filter((other) => isWithin(other.path, path))
        .flatMap((other) => other.issuePaths),
      path,
      sentence,
    }));
}

/**
 * A path with each array item's index as its position in the file as read, by `origins`. The walk
 * follows the path through the round's file, and a step past the values the file holds stays as it is.
 * An index at or past the end of an array that lost an item in an earlier round names no item of the
 * file as read, so the path ends at the array.
 */
function readPositions(file: unknown, path: readonly Step[], origins: Origins): Step[] {
  const [step, ...rest] = path;
  if (step === undefined) {
    return [];
  }
  if (Array.isArray(file) && typeof step === 'number') {
    const origin = origins.get(file);
    if (origin?.shortened === true && step >= file.length) {
      return [];
    }
    return [origin?.positions[step] ?? step, ...readPositions(file[step], rest, origins)];
  }
  const next =
    isRecord(file) && typeof step === 'string' && Object.hasOwn(file, step)
      ? file[step]
      : undefined;
  return [step, ...readPositions(next, rest, origins)];
}

/** The removal with its paths read back to the file as read. */
function locatedAt(removal: Removed, file: Record<string, unknown>, origins: Origins): Removal {
  return {
    ...removal,
    readIssuePath: readPositions(file, removal.issuePath, origins),
    readPath: readPositions(file, removal.path, origins),
  };
}

/** A path as one key a set can hold. */
function pathKey(path: readonly Step[]): string {
  return JSON.stringify(path);
}

/**
 * What one pruning holds: the paths it removes, and the copy in progress of each node on the path
 * being copied, keyed by the original, so a node that is its own ancestor reuses that copy. `origins`
 * records, for each array copy, the position every kept item held in the file as read, across rounds,
 * and whether any round removed one of its items.
 */
interface Pruning {
  readonly doomed: ReadonlySet<string>;
  readonly ancestors: Map<object, unknown>;
  readonly origins: Origins;
}

/**
 * Where an array the drop rule copied came from: the position in the file as read of each item it
 * keeps, and whether a round removed any of its items.
 */
interface Origin {
  readonly positions: readonly number[];
  readonly shortened: boolean;
}

/** The origin of each array the drop rule copied. */
type Origins = WeakMap<readonly unknown[], Origin>;

/** The array copied without the items a removal names, each pruned at its own path. */
function prunedList(node: readonly unknown[], path: readonly Step[], pruning: Pruning): unknown[] {
  const copy: unknown[] = [];
  const kept: number[] = [];
  const before = pruning.origins.get(node);
  pruning.ancestors.set(node, copy);
  node.forEach((item, index) => {
    const at = [...path, index];
    if (!pruning.doomed.has(pathKey(at))) {
      copy.push(prunedNode(item, at, pruning));
      kept.push(before?.positions[index] ?? index);
    }
  });
  pruning.ancestors.delete(node);
  pruning.origins.set(copy, {
    positions: kept,
    shortened: kept.length < node.length || before?.shortened === true,
  });
  return copy;
}

/** One kept key as an own data property, so a key named __proto__ stays data. */
function ownData(value: unknown): PropertyDescriptor {
  return { configurable: true, enumerable: true, value, writable: true };
}

/** The record copied without the keys a removal names, each pruned at its own path. */
function prunedRecord(
  node: Record<string, unknown>,
  path: readonly Step[],
  pruning: Pruning,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  pruning.ancestors.set(node, copy);
  const kept = Object.entries(node).flatMap(([name, value]) => {
    const at = [...path, name];
    return pruning.doomed.has(pathKey(at)) ? [] : [[name, ownData(prunedNode(value, at, pruning))]];
  });
  pruning.ancestors.delete(node);
  return Object.defineProperties(copy, Object.fromEntries(kept));
}

/**
 * The node without every value the pruning removes, copying as it goes so no array index shifts
 * under a removal. Each path gets its own copy, so a value two YAML aliases share loses a value
 * only at the path an issue named. A node that is its own ancestor reuses that ancestor's copy, so
 * a cyclic value keeps its cycle and the copy ends.
 */
function prunedNode(node: unknown, path: readonly Step[], pruning: Pruning): unknown {
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  if (pruning.ancestors.has(node)) {
    return pruning.ancestors.get(node);
  }
  if (Array.isArray(node)) {
    return prunedList(node, path, pruning);
  }
  return isRecord(node) ? prunedRecord(node, path, pruning) : node;
}

/** The file with every removal of a round made. A removal with no steps leaves no key. */
function removeAll(
  file: Record<string, unknown>,
  removals: readonly Removed[],
  origins: Origins,
): Record<string, unknown> {
  const doomed = new Set(removals.map((removal) => pathKey(removal.path)));
  const made = doomed.has(pathKey([]))
    ? {}
    : prunedNode(file, [], { ancestors: new Map(), doomed, origins });
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
  /** The position in the file as read of each array item the file still holds. */
  readonly origins: Origins;
}

/** The value a schema's own validate returned, as the output type its declaration names. */
function outputOf<Schema extends StandardSchemaV1>(
  value: unknown,
): StandardSchemaV1.InferOutput<Schema> {
  return value;
}

/** What the rounds share: the callback that names each removal, and the origins of array items. */
interface Rounds {
  readonly announce: Announce;
  readonly origins: Origins;
}

/** One round: validate the file, and remove what the schema rejects until it passes. */
async function dropRound<Schema extends StandardSchemaV1>(
  schema: Schema,
  file: Record<string, unknown>,
  rounds: Rounds,
): Promise<Passed<StandardSchemaV1.InferOutput<Schema>>> {
  const result = await schema['~standard'].validate(file);
  if (result.issues === undefined) {
    return { file, origins: rounds.origins, output: outputOf<Schema>(result.value) };
  }
  if (Object.keys(file).length === nothing) {
    throw emptyFileFault(result.issues[nothing]?.message);
  }
  const removals = removalsOf(file, result.issues);
  for (const removal of removals) {
    await rounds.announce(locatedAt(removal, file, rounds.origins), file);
  }
  return dropRound(schema, removeAll(file, removals, rounds.origins), rounds);
}

/**
 * Validates `parsed` and drops what the schema rejects until it passes. A round that finds the file
 * already empty and still rejected throws `@loomcli/plugins/config/empty-file`. The schema may
 * answer through a promise.
 */
function dropUntilPasses<Schema extends StandardSchemaV1>(
  schema: Schema,
  file: Record<string, unknown>,
  announce: Announce,
): Promise<Passed<StandardSchemaV1.InferOutput<Schema>>> {
  return dropRound(schema, file, { announce, origins: new WeakMap() });
}

export { dropUntilPasses };
export type { Announce, Origins, Passed, Removal, Step };
