import type { StandardSchemaV1 } from '@standard-schema/spec';

import { asSentence, DeclarationError, reasonOf } from './errors.js';
import { isPlainObject } from './facts.js';
import type { ArgumentNode, CommandNode, OptionNode } from './inspect.js';
import type { AttachedCommand } from './types.js';

/** The three declaration kinds an extension can name, each with its own node in the graph. */
type ExtensionTarget = 'argument' | 'command' | 'option';

/**
 * The descriptor supertype a plugin's `extensions` list uses. It publishes the identity, the
 * target, and whether the extension collects, and erases both the schema and the factory call
 * signature, because a schema-typed call signature relates only by schema identity and a list
 * cannot name one schema per element. A descriptor is assignable to it; an extension value, which
 * publishes its brand alone, is not.
 */
interface AnyExtension {
  readonly identity: string;
  readonly target: ExtensionTarget;
  readonly collect: boolean;
}

/** What a value must show to be taken for a descriptor before its `collect` flag is checked. */
type DescriptorShape = Pick<AnyExtension, 'identity' | 'target'>;

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
 * a declaration carries. The schema is public so a typed read recovers the output type, and
 * `collect` says whether the values a declaration carries accumulate or replace each other.
 */
interface Extension<
  Target extends ExtensionTarget = ExtensionTarget,
  Schema extends StandardSchemaV1 = StandardSchemaV1,
  Collect extends boolean = false,
> extends AnyExtension {
  (input: StandardSchemaV1.InferInput<Schema>): ExtensionValue<Target>;
  readonly schema: Schema;
  readonly target: Target;
  readonly collect: Collect;
}

/**
 * One typed fact a plugin defines for one target. The descriptor is compared by reference wherever
 * it appears, so one identity means one descriptor and a duplicated package copy is visible. With
 * `collect: true` it is a collecting extension, whose values accumulate on a declaration in order.
 */
function extension<Target extends ExtensionTarget, Schema extends StandardSchemaV1>(
  identity: string,
  config: { schema: Schema; target: Target; collect?: false | undefined },
): Extension<Target, Schema>;
function extension<Target extends ExtensionTarget, Schema extends StandardSchemaV1>(
  identity: string,
  config: { schema: Schema; target: Target; collect: true },
): Extension<Target, Schema, true>;
function extension<Target extends ExtensionTarget, Schema extends StandardSchemaV1>(
  identity: string,
  config: { schema: Schema; target: Target; collect?: boolean | undefined },
): Extension<Target, Schema, boolean> {
  // `Object.assign` returns the same function object, so the value carries the descriptor itself.
  function create(input: StandardSchemaV1.InferInput<Schema>): ExtensionValue<Target> {
    return new ExtensionCarrier<Target>({ descriptor, input });
  }
  // An omitted or undefined `collect` publishes as false, and any other value as given.
  // Build then rejects a JavaScript author's value that is neither Boolean.
  const descriptor: Extension<Target, Schema, boolean> = Object.assign(create, {
    collect: config.collect === undefined ? false : config.collect,
    identity,
    schema: config.schema,
    target: config.target,
  });
  Object.freeze(descriptor);
  return descriptor;
}

/**
 * The node kind one descriptor's target names, so a read against another kind cannot compile. A
 * Command-target read also takes the value a lifecycle hook receives, which publishes the record
 * as it stands at that hook.
 */
type NodeFor<Target extends ExtensionTarget> = Target extends 'command'
  ? CommandNode | AttachedCommand
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
 * What one read answers, decided by the descriptor's own `collect` type: a collecting extension's
 * outputs as a read-only list, or an ordinary extension's output or nothing.
 */
type ExtensionRead<Schema extends StandardSchemaV1, Collect extends boolean> = Collect extends true
  ? readonly DeepReadonly<StandardSchemaV1.InferOutput<Schema>>[]
  : DeepReadonly<StandardSchemaV1.InferOutput<Schema>> | undefined;

/** The read of a collecting extension a declaration carries no value of, shared and frozen. */
const noValues: readonly never[] = Object.freeze([]);

/**
 * The typed read of one extension value. It takes the node kind the descriptor targets, returns the
 * stored output or `undefined`, compares the descriptor by reference with the one that produced the
 * value, and runs no schema. Through a collecting descriptor it returns every collected output in
 * collection order, and an empty list where the node carries none.
 */
function readExtension<
  Target extends ExtensionTarget,
  Schema extends StandardSchemaV1,
  Collect extends boolean = false,
>(
  node: NodeFor<Target>,
  descriptor: Extension<Target, Schema, Collect>,
): ExtensionRead<Schema, Collect> {
  const record: Readonly<Record<string, unknown>> = node.extensions;
  const owner = owners.get(record)?.get(descriptor.identity);
  if (owner !== undefined && owner !== descriptor) {
    throw new DeclarationError(
      `Extension "${descriptor.identity}" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.`,
    );
  }
  // A collecting extension a declaration carries no value of reads as an empty list.
  const absent = descriptor.collect ? noValues : undefined;
  const stored: unknown = owner === undefined ? absent : record[descriptor.identity];
  // Last resort: no typed path exists.
  // The graph stores every output under a string identity, so the record reads back as `unknown`.
  // No key relates one entry to a descriptor's schema or to its runtime `collect` flag.
  // It holds because the reference test above proves this descriptor produced this entry.
  // Build stored exactly what its schema returned, a list when the descriptor collects.
  // `Collect` is the literal `extension()` published as `collect`, which registration enforces.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return stored as ExtensionRead<Schema, Collect>;
}

/** How a diagnostic names the declarations one target covers. */
const applies: Readonly<Record<ExtensionTarget, string>> = {
  argument: 'arguments',
  command: 'Commands',
  option: 'options',
};

/** How a diagnostic names the declarations one target covers, such as "Commands". */
function appliesTo(target: ExtensionTarget): string {
  return applies[target];
}

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

/**
 * Whether a value has a descriptor's shape: a callable object carrying an identity and a declared
 * target. Its `collect` flag is checked where a build registers it.
 */
function isDescriptor(value: unknown): value is DescriptorShape {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'identity' in value &&
    typeof value.identity === 'string' &&
    'target' in value &&
    (value.target === 'argument' || value.target === 'command' || value.target === 'option')
  );
}

/** Whether a descriptor carries the `collect` flag every descriptor publishes, as a Boolean. */
function hasCollectFlag(descriptor: DescriptorShape): descriptor is AnyExtension {
  return 'collect' in descriptor && typeof descriptor.collect === 'boolean';
}

/** Whether one registered descriptor collects, so its values accumulate instead of replacing. */
function collects(descriptor: AnyExtension): boolean {
  return descriptor.collect;
}

/**
 * The descriptor a registry holds for one identity once this one is admitted. One identity means
 * one descriptor, wherever on the graph that descriptor appears, and a descriptor is checked when
 * a build first meets it: its `collect` flag is `true` or `false`, which the factory always
 * publishes and a hand-built descriptor may not. It reads the registry and changes nothing.
 */
function admitDescriptor(
  descriptors: ReadonlyMap<string, AnyExtension>,
  descriptor: DescriptorShape,
): AnyExtension {
  const known = descriptors.get(descriptor.identity);
  if (known === undefined) {
    if (!hasCollectFlag(descriptor)) {
      throw new DeclarationError(
        `Extension "${descriptor.identity}" declares collect that is not a Boolean. Supply true or false, or build the descriptor with extension(identity, config).`,
      );
    }
    return descriptor;
  }
  if (known !== descriptor) {
    throw new DeclarationError(
      `Extension "${descriptor.identity}" is defined twice. Install one copy of the package that defines it.`,
    );
  }
  return known;
}

/** Admits one descriptor and records it, so a later descriptor of its identity is compared to it. */
function registerDescriptor(descriptors: DescriptorRegistry, descriptor: DescriptorShape): void {
  const admitted = admitDescriptor(descriptors, descriptor);
  descriptors.set(admitted.identity, admitted);
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
      `${subject.sentence} holds an invalid "${carried.descriptor.identity}" value: ${asSentence(reasonOf(error))} Correct the value.`,
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
      `${subject.sentence} holds an invalid "${identity}" value: ${asSentence(issueText(issues))} Correct the value.`,
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

/** One carried value, validated against its descriptor's schema and ready to store. */
interface ValidatedValue {
  descriptor: AnyExtension;
  output: unknown;
}

/**
 * One layer's values, each validated once, synchronously, in authoring order. A layer holds at
 * most one value of an extension, collecting or not, so a second one is a declaration fault.
 */
function validateLayer(slot: ExtensionSlot): readonly ValidatedValue[] {
  const { subject } = slot;
  const layer: ValidatedValue[] = [];
  const seen = new Set<string>();
  // The layer's descriptors register together once every value is valid.
  // A rejected layer, such as a hook's `extend()` call the hook catches, leaves the registry as it was.
  const staged = new Map(slot.descriptors);
  for (const entry of readList(subject, slot.declared)) {
    const carried = carriedValue(subject, slot.target, entry);
    const { descriptor } = carried;
    registerDescriptor(staged, descriptor);
    if (seen.has(descriptor.identity)) {
      throw new DeclarationError(
        `${subject.sentence} holds extension "${descriptor.identity}" twice. Supply one value.`,
      );
    }
    seen.add(descriptor.identity);
    layer.push({ descriptor, output: validateValue(subject, carried) });
  }
  for (const [identity, descriptor] of staged) {
    slot.descriptors.set(identity, descriptor);
  }
  return layer;
}

/**
 * The values one declaration has validated so far, by identity in the order each first appeared:
 * an ordinary extension's latest output alone, and a collecting extension's every output in
 * collection order. A store is never changed; adding a layer answers a new one.
 */
interface ExtensionStore {
  readonly entries: ReadonlyMap<
    string,
    { readonly descriptor: AnyExtension; readonly outputs: readonly unknown[] }
  >;
}

/**
 * The record each store published, so a store a hook left unchanged publishes the same record on
 * every read and build does no second walk of it.
 */
const published = new WeakMap<ExtensionStore, Readonly<Record<string, unknown>>>();

/** The store of a declaration that carries no value yet. */
const emptyStore: ExtensionStore = { entries: new Map() };

/**
 * The store with one more validated layer. An ordinary value replaces the earlier one in place, so
 * a key keeps its first position, and a collecting value joins the values before it.
 */
function extendStore(store: ExtensionStore, layer: readonly ValidatedValue[]): ExtensionStore {
  const entries = new Map(store.entries);
  for (const { descriptor, output } of layer) {
    const earlier = entries.get(descriptor.identity)?.outputs ?? [];
    const outputs = collects(descriptor) ? [...earlier, output] : [output];
    entries.set(descriptor.identity, { descriptor, outputs });
  }
  return { entries };
}

/**
 * The frozen record a store publishes: each ordinary extension's output, and each collecting
 * extension's frozen list of outputs, under its identity. The descriptors that produced them are
 * recorded beside the record, so a typed read compares by reference without the graph carrying a
 * reference.
 */
function publishStore(store: ExtensionStore): Readonly<Record<string, unknown>> {
  const cached = published.get(store);
  if (cached) {
    return cached;
  }
  const stored: [string, unknown][] = [];
  const defined = new Map<string, AnyExtension>();
  for (const [identity, { descriptor, outputs }] of store.entries) {
    stored.push([identity, collects(descriptor) ? Object.freeze([...outputs]) : outputs[0]]);
    defined.set(identity, descriptor);
  }
  // `Object.fromEntries` defines each identity as an own data property, so an identity of
  // `__proto__` is a key of the record and the record keeps `Object.prototype`.
  const frozen = Object.freeze(Object.fromEntries(stored));
  owners.set(frozen, defined);
  published.set(store, frozen);
  return frozen;
}

/** The frozen record of one `extensions` slot, which is one layer. */
function buildExtensions(slot: ExtensionSlot): Readonly<Record<string, unknown>> {
  return publishStore(extendStore(emptyStore, validateLayer(slot)));
}

/** A Command's author layers, validated in authoring order into the store its hooks extend. */
function storeCommandLayers(
  slot: Omit<ExtensionSlot, 'declared' | 'target'> & { layers: readonly unknown[] },
): ExtensionStore {
  let store = emptyStore;
  for (const declared of slot.layers) {
    store = extendStore(store, validateLayer({ ...slot, declared, target: 'command' }));
  }
  return store;
}

export type {
  AnyExtension,
  DeepReadonly,
  DescriptorRegistry,
  Extension,
  ExtensionRecords,
  ExtensionStore,
  ExtensionSubject,
  ExtensionTarget,
  ExtensionValue,
};
export {
  appliesTo,
  buildExtensions,
  extendStore,
  extension,
  isDescriptor,
  publishStore,
  readExtension,
  registerDescriptor,
  storeCommandLayers,
  validateLayer,
};
