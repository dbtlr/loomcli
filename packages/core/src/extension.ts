import type { StandardSchemaV1 } from '@standard-schema/spec';

import { DeclarationError, reasonOf } from './errors.js';
import { isPlainObject } from './facts.js';
import type { ArgumentNode, CommandNode, OptionNode } from './inspect.js';

/** The three declaration kinds an extension can name, each with its own node in the graph. */
type ExtensionTarget = 'argument' | 'command' | 'option';

/**
 * The descriptor supertype a plugin's `extensions` list uses. It publishes the identity and the
 * target and erases both the schema and the factory call signature, because a schema-typed call
 * signature relates only by schema identity and a list cannot name one schema per element. A
 * descriptor is assignable to it; an extension value, which publishes its brand alone, is not.
 */
interface AnyExtension {
  readonly identity: string;
  readonly target: ExtensionTarget;
}

/** One carried value: the input its author supplied and the descriptor that produced it. */
interface CarriedValue {
  descriptor: AnyExtension;
  input: unknown;
}

/** Authored values register here, so the public brand publishes no state to reach or replace. */
const values = new WeakMap<object, CarriedValue>();

/**
 * The descriptor that produced each stored output, keyed by the frozen record a node publishes. It
 * lives beside the graph rather than on it, so a projection reads plain data while a typed read
 * still compares descriptors by reference.
 */
const owners = new WeakMap<object, ReadonlyMap<string, AnyExtension>>();

/** Phantom key. It brands an extension value with its target and holds no runtime value. */
declare const extensionTarget: unique symbol;

/**
 * The value one extension produces, branded with its target so a value on the wrong declaration is
 * a compile error. It publishes the brand alone, so a value is never mistaken for the descriptor
 * that produced it, and the input it carries stays private to this package.
 */
class ExtensionCarrier<Target extends ExtensionTarget> {
  declare readonly [extensionTarget]: (target: Target) => Target;

  constructor(record: CarriedValue) {
    values.set(this, record);
    Object.freeze(this);
  }
}

/** A branded extension value, keyed by its extension's identity and typed by its target. */
type ExtensionValue<Target extends ExtensionTarget> = Pick<
  ExtensionCarrier<Target>,
  typeof extensionTarget
>;

/**
 * A descriptor that is also a factory: calling it with the schema's input returns the branded value
 * a declaration carries. The schema is public so a typed read recovers the output type.
 */
interface Extension<
  Target extends ExtensionTarget = ExtensionTarget,
  Schema extends StandardSchemaV1 = StandardSchemaV1,
> extends AnyExtension {
  (input: StandardSchemaV1.InferInput<Schema>): ExtensionValue<Target>;
  readonly schema: Schema;
  readonly target: Target;
}

/**
 * One typed fact a plugin defines for one target. The descriptor is compared by reference wherever
 * it appears, so one identity means one descriptor and a duplicated package copy is visible.
 */
function extension<Target extends ExtensionTarget, Schema extends StandardSchemaV1>(
  identity: string,
  config: { schema: Schema; target: Target },
): Extension<Target, Schema> {
  // `Object.assign` returns the same function object, so the value carries the descriptor itself.
  function create(input: StandardSchemaV1.InferInput<Schema>): ExtensionValue<Target> {
    return new ExtensionCarrier<Target>({ descriptor, input });
  }
  const descriptor: Extension<Target, Schema> = Object.assign(create, {
    identity,
    schema: config.schema,
    target: config.target,
  });
  Object.freeze(descriptor);
  return descriptor;
}

/** The node kind one descriptor's target names, so a read against another kind cannot compile. */
type NodeFor<Target extends ExtensionTarget> = Target extends 'command'
  ? CommandNode
  : Target extends 'option'
    ? OptionNode
    : ArgumentNode;

/** Stored output is plain data the graph froze, so every read of it is read-only to any depth. */
type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

/**
 * The typed read of one extension value. It takes the node kind the descriptor targets, returns the
 * stored output or `undefined`, compares the descriptor by reference with the one that produced the
 * value, and runs no schema.
 */
function readExtension<Target extends ExtensionTarget, Schema extends StandardSchemaV1>(
  node: NodeFor<Target>,
  descriptor: Extension<Target, Schema>,
): DeepReadonly<StandardSchemaV1.InferOutput<Schema>> | undefined {
  const record: Readonly<Record<string, unknown>> = node.extensions;
  const owner = owners.get(record)?.get(descriptor.identity);
  if (owner === undefined) {
    return undefined;
  }
  if (owner !== descriptor) {
    throw new DeclarationError(
      `Extension "${descriptor.identity}" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.`,
    );
  }
  // Last resort: no typed path exists. The graph stores every output under a string identity, so
  // The record reads back as `unknown` and no key relates one entry to a descriptor's schema.
  // It holds because the reference test above proves this descriptor produced this output, and
  // Build stored exactly what that descriptor's own schema returned.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return record[descriptor.identity] as DeepReadonly<StandardSchemaV1.InferOutput<Schema>>;
}

/** How a diagnostic names the declarations one target covers. */
const applies: Readonly<Record<ExtensionTarget, string>> = {
  argument: 'arguments',
  command: 'Commands',
  option: 'options',
};

/** One value of a plain-data walk: the frozen copy, or nothing when the shape is rejected. */
type PlainResult = { data: unknown } | undefined;

/** One container the walk is copying: what it reads from, and what it has finished so far. */
interface Frame {
  /** Each child value this container contributes, with the key its copy is stored under. */
  children: readonly { key: string; value: unknown }[];
  /** The finished children, which the copy is built from once every child is done. */
  entries: [string, unknown][];
  /** How many children the walk has finished. */
  index: number;
  isArray: boolean;
  /** The key this container itself occupies in the container above, empty at the root. */
  key: string;
  source: object;
}

/**
 * The children one container contributes, or nothing when its own shape is not plain data. An
 * accessor, a symbol key, and a non-enumerable own property are not plain data, and an `undefined`
 * property value is absence, so it is dropped rather than stored. An array contributes its items,
 * the way it reads back.
 */
function childrenOf(source: object): { key: string; value: unknown }[] | undefined {
  if (Array.isArray(source)) {
    // `Array.from` reads a hole as the `undefined` it is, which the walk rejects like any other
    // Value that is not plain data.
    return Array.from(source, (value: unknown, index) => ({ key: String(index), value }));
  }
  if (!isPlainObject(source) || Object.getOwnPropertySymbols(source).length > 0) {
    return undefined;
  }
  const children: { key: string; value: unknown }[] = [];
  for (const key of Object.getOwnPropertyNames(source)) {
    const property = Object.getOwnPropertyDescriptor(source, key);
    if (!property || !('value' in property) || !property.enumerable) {
      return undefined;
    }
    if (property.value !== undefined) {
      children.push({ key, value: property.value });
    }
  }
  return children;
}

/** What the walk found at one value: a copied leaf, a container to open, or a rejected shape. */
type Opened = { data: unknown; kind: 'leaf' } | { frame: Frame; kind: 'frame' } | undefined;

/**
 * One value the walk reached. A primitive is copied where it is read, and a container answers with
 * the frame the walk fills. `ancestors` holds the containers on the path to this value, so a value
 * that is one of them is a cycle.
 */
function openValue(value: unknown, key: string, ancestors: ReadonlySet<object>): Opened {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { data: value, kind: 'leaf' };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { data: value, kind: 'leaf' } : undefined;
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    return undefined;
  }
  const children = childrenOf(value);
  if (!children) {
    return undefined;
  }
  const isArray = Array.isArray(value);
  return { frame: { children, entries: [], index: 0, isArray, key, source: value }, kind: 'frame' };
}

/**
 * The frozen copy one finished container contributes. `Object.fromEntries` defines every key as an
 * own data property, so an output key of `__proto__` is stored under that name and the copy keeps
 * `Object.prototype`.
 */
function closeFrame(frame: Frame): unknown {
  return Object.freeze(
    frame.isArray ? frame.entries.map(([, value]) => value) : Object.fromEntries(frame.entries),
  );
}

/**
 * Whether a produced output is the plain data a node can freeze and every projection can read:
 * strings, finite numbers, Booleans, null, arrays, and objects whose prototype is `Object.prototype`
 * or null, to any depth and without cycles. It answers with the frozen copy, because the walk that
 * proves the shape is the walk that builds it. The walk holds its own stack, so a deep output is
 * bounded by the heap and never by the call stack. A declared default's snapshot answers a different
 * question: it keeps a library object as it is, where an extension output holding one is rejected.
 */
function plainData(value: unknown): PlainResult {
  const ancestors = new Set<object>();
  const opened = openValue(value, '', ancestors);
  if (!opened) {
    return undefined;
  }
  if (opened.kind === 'leaf') {
    return { data: opened.data };
  }
  const stack: Frame[] = [opened.frame];
  ancestors.add(opened.frame.source);
  for (;;) {
    const frame = stack.at(-1);
    if (!frame) {
      return undefined;
    }
    const child = frame.children[frame.index];
    if (child) {
      const next = openValue(child.value, child.key, ancestors);
      if (!next) {
        return undefined;
      }
      if (next.kind === 'leaf') {
        frame.entries.push([child.key, next.data]);
        frame.index += 1;
      } else {
        stack.push(next.frame);
        ancestors.add(next.frame.source);
      }
    } else {
      stack.pop();
      ancestors.delete(frame.source);
      const data = closeFrame(frame);
      const parent = stack.at(-1);
      if (!parent) {
        return { data };
      }
      parent.entries.push([frame.key, data]);
      parent.index += 1;
    }
  }
}

/** The declaration one `extensions` slot belongs to, as its own diagnostics name it. */
interface ExtensionSubject {
  /** The subject after a preposition, such as `on Command "get"`. */
  phrase: string;
  /** The subject at the start of a sentence, such as `Command "get"`. */
  sentence: string;
}

/** Every descriptor one build has met, so a second descriptor under one identity is visible. */
type DescriptorRegistry = Map<string, AnyExtension>;

/**
 * The record each declaration published during one build, keyed by the declaration itself. The
 * records live here rather than on the declaration, because one build's outputs belong to that
 * build alone and inspection reads them back with the nodes it renders.
 */
type ExtensionRecords = Map<object, Readonly<Record<string, unknown>>>;

/** Whether a value is a descriptor: a callable object carrying an identity and a declared target. */
function isDescriptor(value: unknown): value is AnyExtension {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'identity' in value &&
    typeof value.identity === 'string' &&
    'target' in value &&
    (value.target === 'argument' || value.target === 'command' || value.target === 'option')
  );
}

/** One identity means one descriptor, wherever on the graph that descriptor appears. */
function registerDescriptor(descriptors: DescriptorRegistry, descriptor: AnyExtension): void {
  const known = descriptors.get(descriptor.identity);
  if (known === undefined) {
    descriptors.set(descriptor.identity, descriptor);
    return;
  }
  if (known !== descriptor) {
    throw new DeclarationError(
      `Extension "${descriptor.identity}" is defined twice. Install one copy of the package that defines it.`,
    );
  }
}

/** Whether a value answers the Standard Schema v1 contract this build calls synchronously. */
function isSchema(value: unknown): value is StandardSchemaV1 {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  const standard: unknown = '~standard' in value ? value['~standard'] : undefined;
  return (
    standard !== null &&
    typeof standard === 'object' &&
    'validate' in standard &&
    typeof standard.validate === 'function'
  );
}

/**
 * One schema message as a sentence of its own. A schema author writes the message with or without a
 * full stop, so the diagnostic supplies one only where the message carries none.
 */
function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/** The message one rejected value reports, with the placeholder a silent schema earns. */
function issueText(issues: unknown): string {
  const first: unknown = Array.isArray(issues) ? issues[0] : undefined;
  if (first !== null && typeof first === 'object' && 'message' in first) {
    const { message } = first;
    if (typeof message === 'string') {
      return message;
    }
  }
  // The sentence the caller composes ends the diagnostic, so this text carries no full stop.
  return 'The schema rejected this value without an explanation';
}

/**
 * Whether one schema answered with a promise. A thenable object and a promise from another realm
 * are as unwaitable here as a native one, so the test is the contract and not the class.
 */
function isThenable(value: object): boolean {
  return 'then' in value && typeof value.then === 'function';
}

/** The schema one descriptor answers with, which a JavaScript author can leave out. */
function schemaOf(subject: ExtensionSubject, descriptor: AnyExtension): StandardSchemaV1 {
  const schema: unknown = 'schema' in descriptor ? descriptor.schema : undefined;
  if (!isSchema(schema)) {
    throw new DeclarationError(
      `${subject.sentence} holds extension "${descriptor.identity}", which declares no schema. Supply a Standard Schema v1 object that answers synchronously.`,
    );
  }
  return schema;
}

/** The result one schema answered with, or the rejection its own throw is. */
function validated(
  subject: ExtensionSubject,
  carried: CarriedValue,
  schema: StandardSchemaV1,
): unknown {
  try {
    return schema['~standard'].validate(carried.input);
  } catch (error) {
    // A schema that throws rejected the value the only way it could, so it reads as a rejection.
    throw new DeclarationError(
      `${subject.sentence} holds an invalid "${carried.descriptor.identity}" value: ${sentence(reasonOf(error))} Correct the value.`,
    );
  }
}

/** Validates one carried value and answers the plain-data output the node stores under it. */
function validateValue(subject: ExtensionSubject, carried: CarriedValue): unknown {
  const { identity } = carried.descriptor;
  const result: unknown = validated(subject, carried, schemaOf(subject, carried.descriptor));
  if (result === null || typeof result !== 'object' || isThenable(result)) {
    throw new DeclarationError(
      `Extension "${identity}" validates asynchronously. Supply a schema that answers synchronously.`,
    );
  }
  const issues: unknown = 'issues' in result ? result.issues : undefined;
  if (issues !== undefined) {
    throw new DeclarationError(
      `${subject.sentence} holds an invalid "${identity}" value: ${sentence(issueText(issues))} Correct the value.`,
    );
  }
  const output = plainData('value' in result ? result.value : undefined);
  if (!output) {
    throw new DeclarationError(
      `Extension "${identity}" produced a value that is not plain data ${subject.phrase}. Return strings, numbers, booleans, null, arrays, and plain objects.`,
    );
  }
  return output.data;
}

/** An `extensions` slot holds a list of values, so anything else is the same declaration fault. */
function readList(subject: ExtensionSubject, declared: unknown): readonly unknown[] {
  if (declared === undefined) {
    return [];
  }
  if (!Array.isArray(declared)) {
    throw new DeclarationError(
      `${subject.sentence} holds a value that is not an extension value. Supply the value returned by calling an extension.`,
    );
  }
  return declared;
}

/** The value one entry carries, under the rules its own slot's target sets. */
function carriedValue(
  subject: ExtensionSubject,
  target: ExtensionTarget,
  entry: unknown,
): CarriedValue {
  const carried = typeof entry === 'object' && entry !== null ? values.get(entry) : undefined;
  if (!carried) {
    throw new DeclarationError(
      `${subject.sentence} holds a value that is not an extension value. Supply the value returned by calling an extension.`,
    );
  }
  if (carried.descriptor.target !== target) {
    throw new DeclarationError(
      `${subject.sentence} holds extension "${carried.descriptor.identity}", which applies to ${applies[carried.descriptor.target]}. Supply an extension that applies to ${applies[target]}.`,
    );
  }
  return carried;
}

/** Everything one `extensions` slot needs to answer: whose it is, and what it may carry. */
interface ExtensionSlot {
  declared: unknown;
  descriptors: DescriptorRegistry;
  subject: ExtensionSubject;
  target: ExtensionTarget;
}

/**
 * The frozen record one declaration publishes: each carried value validated once, synchronously,
 * and stored under its extension's identity. The descriptors that produced them are recorded beside
 * the record, so a typed read compares by reference without the graph carrying a reference.
 */
function buildExtensions(slot: ExtensionSlot): Readonly<Record<string, unknown>> {
  const { subject } = slot;
  const stored: [string, unknown][] = [];
  const defined = new Map<string, AnyExtension>();
  for (const entry of readList(subject, slot.declared)) {
    const carried = carriedValue(subject, slot.target, entry);
    const { descriptor } = carried;
    registerDescriptor(slot.descriptors, descriptor);
    if (defined.has(descriptor.identity)) {
      throw new DeclarationError(
        `${subject.sentence} holds extension "${descriptor.identity}" twice. Supply one value.`,
      );
    }
    defined.set(descriptor.identity, descriptor);
    stored.push([descriptor.identity, validateValue(subject, carried)]);
  }
  // `Object.fromEntries` defines each identity as an own data property, so an identity of
  // `__proto__` is a key of the record and the record keeps `Object.prototype`.
  const frozen = Object.freeze(Object.fromEntries(stored));
  owners.set(frozen, defined);
  return frozen;
}

export type {
  AnyExtension,
  DeepReadonly,
  DescriptorRegistry,
  Extension,
  ExtensionRecords,
  ExtensionSubject,
  ExtensionTarget,
  ExtensionValue,
};
export { buildExtensions, extension, isDescriptor, readExtension, registerDescriptor };
