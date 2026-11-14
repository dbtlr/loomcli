import { isRecord } from '../plain-data.js';
import type { Origins, Step } from './drop.js';
import { isAny, isArrayShape, leavesOf, stepInto } from './links.js';
import type { Shape } from './links.js';

/**
 * The unknown-key walk: the keys the file holds that a closed object of the published JSON Schema
 * does not list. It judges each key as the link check judges a link's key, through `stepInto`, and
 * it enters each array item. The rule is the plugin contract's "Naming unknown keys".
 */

/** Where the walk stands: the shapes the position stands for, and the path to it. */
interface Position {
  readonly leaves: readonly Shape[];
  readonly path: readonly Step[];
}

/** What one walk carries: the schema's root for `$ref`s, the origins of array items, and the paths found. */
interface Walk {
  readonly root: Shape;
  readonly origins: Origins;
  readonly found: Step[][];
  /** The objects and arrays above the value being walked, so a value inside itself is entered once. */
  readonly ancestors: Set<object>;
}

/**
 * The shapes an item stands for, or `undefined` when the shapes take any item. A shape that
 * describes an array gives the item its `prefixItems` entry at the item's index, or else its
 * `items`.
 */
function itemShapes(leaves: readonly Shape[], index: number, root: Shape): Shape[] | undefined {
  const entries = leaves.filter(isArrayShape).map((leaf) => {
    const prefix = leaf.prefixItems;
    return Array.isArray(prefix) && index < prefix.length ? prefix[index] : leaf.items;
  });
  return entries.every(isRecord) ? entries.flatMap((entry) => leavesOf(entry, root)) : undefined;
}

/** Walks an array the file holds. */
function walkList(items: readonly unknown[], { leaves, path }: Position, walk: Walk) {
  if (leaves.some(isAny) || !leaves.some(isArrayShape)) {
    return;
  }
  const origins = walk.origins.get(items);
  items.forEach((item, position) => {
    const index = origins?.[position] ?? position;
    const shapes = itemShapes(leaves, index, walk.root);
    if (shapes !== undefined) {
      walkValue(item, { leaves: shapes, path: [...path, index] }, walk);
    }
  });
}

/** Walks an object the file holds, naming each key no shape lists. */
function walkObject(object: Record<string, unknown>, { leaves, path }: Position, walk: Walk) {
  for (const [key, value] of Object.entries(object)) {
    const step = stepInto(leaves, key, walk.root);
    if (step.kind === 'missing') {
      walk.found.push([...path, key]);
    } else if (step.kind === 'held') {
      walkValue(value, { leaves: step.next, path: [...path, key] }, walk);
    }
  }
}

/** Walks one value of the file against the shapes its position stands for. */
function walkValue(value: unknown, position: Position, walk: Walk) {
  if (typeof value !== 'object' || value === null || walk.ancestors.has(value)) {
    return;
  }
  walk.ancestors.add(value);
  if (Array.isArray(value)) {
    walkList(value, position, walk);
  } else if (isRecord(value)) {
    walkObject(value, position, walk);
  }
  walk.ancestors.delete(value);
}

/**
 * The path of each unknown key of `file` under the published JSON Schema `schema`, in the order the
 * file lists its keys, depth first. An array item's index is its position in the file as read, by
 * `origins`.
 */
export function unknownKeys(
  file: Record<string, unknown>,
  schema: Shape,
  origins: Origins,
): Step[][] {
  const walk: Walk = { ancestors: new Set(), found: [], origins, root: schema };
  walkValue(file, { leaves: leavesOf(schema, schema), path: [] }, walk);
  return walk.found;
}
