import { DeclarationError, readExtension } from '@loomcli/core';
import type {
  CommandGraph,
  CommandNode,
  GraphBuiltHook,
  OptionNode,
  StandardSchemaV1,
} from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import { configLinkPath, configLinkType } from '../rules.js';
import { configInput } from './extension.js';

/**
 * The graph judgment of the configuration plugin: an option linked to a path the schema cannot hold
 * is a build fault, where the schema publishes its shape through Standard JSON Schema. The walk
 * reads the shape by the contract's keywords alone, and a schema without a converter, a converter
 * that throws, an open object, and a path through an array get no check.
 */

type Shape = Record<string, unknown>;

const noMembers = 0;

/** The kind of value an option takes, by its type: the JSON types a shape may hold for it. */
const takenTypes = {
  boolean: new Set(['boolean']),
  count: new Set(['integer', 'number']),
  multiple: new Set(['array']),
  string: new Set(['integer', 'number', 'string']),
};

/** The shape one schema publishes for its input, or `undefined` when it publishes none. */
function inputShape(schema: StandardSchemaV1): Shape | undefined {
  const props: object = schema['~standard'];
  if (!('jsonSchema' in props)) {
    return undefined;
  }
  const converter: unknown = props.jsonSchema;
  if (!isRecord(converter) || typeof converter.input !== 'function') {
    return undefined;
  }
  try {
    const shape: unknown = converter.input({ target: 'draft-2020-12' });
    return isRecord(shape) ? shape : undefined;
  } catch {
    return undefined;
  }
}

/** The reference a `$ref` names inside the shape's own `$defs`, or the shape itself for `#`. */
function referenced(root: Shape, reference: string): Shape | undefined {
  if (reference === '#') {
    return root;
  }
  const prefix = '#/$defs/';
  const defs = root.$defs;
  if (!reference.startsWith(prefix) || !isRecord(defs)) {
    return undefined;
  }
  const found = defs[reference.slice(prefix.length)];
  return isRecord(found) ? found : undefined;
}

/**
 * The shapes a node stands for, once `$ref`s into the shape's `$defs` are followed and `allOf`,
 * `anyOf`, and `oneOf` are flattened into their members. A cycle is entered once.
 */
function leavesOf(node: unknown, root: Shape, seen = new Set<Shape>()): Shape[] {
  const shape: Shape = isRecord(node) ? node : {};
  if (seen.has(shape)) {
    return [];
  }
  seen.add(shape);
  const reference = shape.$ref;
  const followed = typeof reference === 'string' ? referenced(root, reference) : undefined;
  if (followed !== undefined) {
    return leavesOf(followed, root, seen);
  }
  const members = ['allOf', 'anyOf', 'oneOf'].flatMap((keyword) => {
    const list = shape[keyword];
    return Array.isArray(list) ? list.flatMap((member) => leavesOf(member, root, seen)) : [];
  });
  return members.length > noMembers ? members : [shape];
}

/** Whether a shape is open: `additionalProperties` or `patternProperties` with a value other than `false`. */
function isOpen(shape: Shape): boolean {
  return ['additionalProperties', 'patternProperties'].some(
    (keyword) => keyword in shape && shape[keyword] !== false,
  );
}

/** Whether a shape names no keyword at all, so it takes any value. */
function isAny(shape: Shape): boolean {
  return Object.keys(shape).every((keyword) => keyword === 'description' || keyword === 'title');
}

/** Whether a shape describes an array. */
function isArrayShape(shape: Shape): boolean {
  return shape.type === 'array' || 'items' in shape || 'prefixItems' in shape;
}

/** What one segment came to over the shapes at a node. */
type Step = { kind: 'held'; next: Shape[] } | { kind: 'unchecked' } | { kind: 'missing' };

/** The shapes a key leads to, or whether the shape leaves the key unchecked or does not hold it. */
function stepInto(leaves: readonly Shape[], key: string, root: Shape): Step {
  const next: Shape[] = [];
  for (const leaf of leaves) {
    const properties = leaf.properties;
    if (isArrayShape(leaf) || isAny(leaf)) {
      return { kind: 'unchecked' };
    }
    if (isRecord(properties) && Object.hasOwn(properties, key)) {
      next.push(...leavesOf(properties[key], root));
    } else if (isOpen(leaf)) {
      return { kind: 'unchecked' };
    }
  }
  return next.length === noMembers ? { kind: 'missing' } : { kind: 'held', next };
}

/** The JSON type of a value a `const` or `enum` names. */
function typeOfValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

/** The JSON types a shape names through `const`, `enum`, or `type`, or `undefined` when it names none. */
function typesOf(shape: Shape): string[] | undefined {
  if ('const' in shape) {
    return [typeOfValue(shape.const)];
  }
  if (Array.isArray(shape.enum)) {
    return shape.enum.map(typeOfValue);
  }
  if (typeof shape.type === 'string') {
    return [shape.type];
  }
  if (Array.isArray(shape.type)) {
    return shape.type.filter((entry) => typeof entry === 'string');
  }
  return undefined;
}

/** The kind of value an option takes. */
function takenBy(option: OptionNode): keyof typeof takenTypes {
  if (option.type === 'boolean' || option.type === 'count') {
    return option.type;
  }
  return option.multiple ? 'multiple' : 'string';
}

/** The words that say what a JSON type holds. */
const holds: Readonly<Record<string, string>> = {
  array: 'an array',
  boolean: 'a Boolean',
  integer: 'a number',
  null: 'null',
  number: 'a number',
  object: 'an object',
  string: 'a string',
};

/** What a path's shapes hold, in words, for the sentence. */
function describe(leaves: readonly Shape[]): string {
  const names = leaves.flatMap((leaf) => typesOf(leaf) ?? []).map((type) => holds[type] ?? type);
  return [...new Set(names)].join(' or ');
}

/** How the diagnostic names an option, as the graph records it. */
function subjectOf(option: OptionNode, node: CommandNode | undefined): string {
  if (node === undefined) {
    return `Global option "${option.name}"`;
  }
  return node.name === null
    ? `The root Command option "${option.name}"`
    : `Command "${node.path.join(' ')}" option "${option.name}"`;
}

/** An option that carries the binding, with where it was declared. */
interface Linked {
  readonly option: OptionNode;
  readonly node: CommandNode | undefined;
  readonly path: string;
}

/** Every option in the graph that carries `configInput`, the globals first and then each Command's own. */
function linkedOptions(graph: CommandGraph): Linked[] {
  const linked: Linked[] = [];
  const visit = (option: OptionNode, node: CommandNode | undefined) => {
    const binding = readExtension(option, configInput);
    if (binding !== undefined) {
      linked.push({ node, option, path: binding.path });
    }
  };
  const walk = (node: CommandNode) => {
    node.options.forEach((option) => visit(option, node));
    node.children.forEach(walk);
  };
  graph.globals.forEach((option) => visit(option, undefined));
  walk(graph.root);
  return linked;
}

/** The shapes a link's path leads to, or `unchecked` when the shape cannot judge the path, or the first key it does not hold. */
type Reached = { kind: 'reached'; leaves: Shape[] } | { kind: 'unchecked' } | { kind: 'missing' };

/** Follows a link's keys through the shape. */
function reach(path: string, shape: Shape): Reached {
  let leaves = leavesOf(shape, shape);
  for (const key of path.split('.')) {
    const step = stepInto(leaves, key, shape);
    if (step.kind !== 'held') {
      return step;
    }
    leaves = step.next;
  }
  return { kind: 'reached', leaves };
}

/** Whether any shape a path leads to holds a value the option takes. */
function isTaken(leaves: readonly Shape[], option: OptionNode): boolean {
  const accepted = takenTypes[takenBy(option)];
  return leaves.some((leaf) => {
    const types = typesOf(leaf);
    return types === undefined || types.some((type) => accepted.has(type));
  });
}

/** The fault for one linked option, or `undefined` when the shape accepts the link or cannot judge it. */
function faultOf(link: Linked, shape: Shape): DeclarationError | undefined {
  const reached = reach(link.path, shape);
  if (reached.kind === 'unchecked') {
    return undefined;
  }
  const subject = subjectOf(link.option, link.node);
  const findings = [{ arguments: [{ path: link.path }], call: 'configInput', mark: '0.path' }];
  if (reached.kind === 'missing') {
    return new DeclarationError(configLinkPath, {
      correction: 'Link a path the schema describes, or add the key to the schema.',
      findings,
      sentence: `${subject} links to ${link.path}, which the configuration schema does not hold.`,
    });
  }
  return isTaken(reached.leaves, link.option)
    ? undefined
    : new DeclarationError(configLinkType, {
        correction:
          'Link a key that holds a value the option takes: a string or a number for a string option, a Boolean for a Boolean option, a whole number for a counted option, or an array for a multiple option.',
        findings,
        sentence: `${subject} links to ${link.path}, which holds ${describe(reached.leaves)}.`,
      });
}

/**
 * The `onGraphBuilt` hook for one schema. It converts the schema once, only when an option carries
 * the binding, and throws the first fault it finds.
 */
export function judgeLinks(schema: StandardSchemaV1): GraphBuiltHook {
  return (graph) => {
    const linked = linkedOptions(graph);
    const [first] = linked;
    const shape = first === undefined ? undefined : inputShape(schema);
    if (shape === undefined) {
      return undefined;
    }
    for (const link of linked) {
      const fault = faultOf(link, shape);
      if (fault !== undefined) {
        throw fault;
      }
    }
    return undefined;
  };
}
