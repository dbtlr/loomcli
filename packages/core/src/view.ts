import { DeclarationError, defaultText, FatalError, notTextReason, reasonOf } from './errors.js';
import type { LoomError } from './errors.js';
import { escapeText } from './style.js';
import type { RowView, View, ViewContext } from './types.js';

/** Phantom key. It brands a declared view and holds no runtime value. */
declare const declaredView: unique symbol;

/** Phantom key. It makes a declared view invariant in its data type and holds no runtime value. */
declare const invariant: unique symbol;

/** Phantom key. It brands a view override and holds no runtime value. */
declare const viewOverride: unique symbol;

/** The brand one declared view carries, as an extension value carries its own. */
interface DeclaredViewBrand {
  readonly [declaredView]: true;
}

/**
 * One declared view: the identity a diagnostic names it by, and the default view function an
 * override replaces. The witness makes `Data` invariant, so a declared view is never reassigned as
 * a declared view of another data type and a replacement that requires data the key does not carry
 * is a compile error.
 */
interface DeclaredView<Data> extends View<Data>, DeclaredViewBrand {
  readonly identity: string;
  readonly [invariant]: (data: Data) => Data;
}

/**
 * One declared row view: the same brand and witness a declared view carries, over the row type.
 * `override` keyed by it takes a row view, under the rules a declared view follows unchanged.
 */
interface DeclaredRowView<Row> extends RowView<Row>, DeclaredViewBrand {
  readonly identity: string;
  readonly [invariant]: (row: Row) => Row;
}

/**
 * The supertype a contribution list uses. It keeps the identity, the brand, and a view function of
 * either shape over `never`, and drops the invariance witness, because a list cannot carry one type
 * parameter per element and an invariant type has no common supertype across data types.
 */
type AnyDeclaredView = (View<never> | RowView<never>) &
  DeclaredViewBrand & { readonly identity: string };

/** A failure class as an override key, so `UsageError` and an application's subclass both fit. */
type FailureClass<Failure extends LoomError> = abstract new (...args: never[]) => Failure;

/**
 * One stored view function, with the data type erased. A registry holds one entry per key and
 * cannot carry a type parameter per entry, so `override(key, replacement)` is where the
 * replacement is typed against the key it answers.
 */
type ViewFunction = (data: never, context: ViewContext) => unknown;

/** One stored row function, with the row type erased for the same reason. */
type RowFunction = (row: never, index: number, context: ViewContext) => unknown;

/** One stored function that opens a sequence and reads the context alone. */
type HeadFunction = (context: ViewContext) => unknown;

/** One stored function that closes a sequence and reads its completed row count. */
type TailFunction = (count: number, context: ViewContext) => unknown;

/** One stored view value: the functions of whichever shape its author supplied. */
interface StoredView {
  render?: ViewFunction | undefined;
  row?: RowFunction | undefined;
  head?: HeadFunction | undefined;
  tail?: TailFunction | undefined;
}

/** Authored declarations register here, so a hand-built object with an identity is a bare view. */
const declarations = new WeakMap<object, AnyDeclaredView>();

/** The runtime value `view()` returns for a whole view. Its identity and function are public. */
class ViewDeclaration<Data> implements DeclaredView<Data> {
  declare readonly [declaredView]: true;
  declare readonly [invariant]: (data: Data) => Data;
  readonly identity: string;
  readonly render: (data: Readonly<Data>, context: ViewContext) => string;

  constructor(identity: string, definition: View<Data>) {
    this.identity = identity;
    this.render = definition.render;
    declarations.set(this, this);
    Object.freeze(this);
  }
}

/** The runtime value `view()` returns for a row view, which carries its three functions. */
class RowViewDeclaration<Row> implements DeclaredRowView<Row> {
  declare readonly [declaredView]: true;
  declare readonly [invariant]: (row: Row) => Row;
  readonly identity: string;
  readonly row: (row: Readonly<Row>, index: number, context: ViewContext) => string;
  readonly head?: (context: ViewContext) => string;
  readonly tail?: (count: number, context: ViewContext) => string;

  constructor(identity: string, definition: RowView<Row>) {
    this.identity = identity;
    this.row = definition.row;
    if (definition.head) {
      this.head = definition.head;
    }
    if (definition.tail) {
      this.tail = definition.tail;
    }
    declarations.set(this, this);
    Object.freeze(this);
  }
}

/** Which of the two exclusive view functions one value carries, or that it carries the wrong set. */
type ViewShape = 'both' | 'neither' | 'render' | 'row';

/**
 * The shape one value names. The argument is read defensively, because every call that takes a view
 * is reachable from JavaScript and `null` is one such value.
 */
function shapeOf(value: { render?: unknown; row?: unknown } | null | undefined): ViewShape {
  const row = typeof value?.row === 'function';
  const render = typeof value?.render === 'function';
  if (row && render) {
    return 'both';
  }
  if (row) {
    return 'row';
  }
  return render ? 'render' : 'neither';
}

/**
 * One declared view of either shape: an identity and its default functions. The data type is
 * inferred from the function's first parameter when that parameter is an object type or a
 * `readonly` array, and is stated for a primitive or a union, because inference runs through
 * `Readonly<Data>`. The two shapes are told apart by the function present, and a definition that
 * carries both or neither is rejected here rather than guessed at.
 */
function view<Data>(identity: string, definition: View<Data>): DeclaredView<Data>;
function view<Row>(identity: string, definition: RowView<Row>): DeclaredRowView<Row>;
function view(identity: string, definition: View<never> | RowView<never>): AnyDeclaredView {
  const shape = shapeOf(definition);
  if (shape === 'both') {
    throw new DeclarationError(`View "${identity}" carries render and row. Supply one of the two.`);
  }
  if (shape === 'neither') {
    throw new DeclarationError(
      `View "${identity}" carries neither render nor row. Supply a view with render or a row view with row.`,
    );
  }
  return typeof definition.row === 'function'
    ? new RowViewDeclaration<never>(identity, definition)
    : new ViewDeclaration<never>(identity, definition);
}

/**
 * What one override replaces: a declared view, a failure class read as its prototype, or a value
 * that is neither, which build reports as the entry fault of the list that holds it.
 */
type OverrideKey =
  | { kind: 'view'; view: AnyDeclaredView }
  | { kind: 'failure'; name: string; prototype: object }
  | { kind: 'invalid' };

/** One override: the key it answers and the view value that supersedes the default. */
interface OverrideRecord {
  key: OverrideKey;
  replacement: StoredView;
}

/** Authored overrides register here, so the public type publishes nothing to reach. */
const overrides = new WeakMap<object, OverrideRecord>();

/** The runtime value `override()` returns. Its pair lives in the registry above. */
class OverrideDeclaration {
  declare readonly [viewOverride]: true;

  constructor(record: OverrideRecord) {
    overrides.set(this, record);
    Object.freeze(this);
  }
}

/** An opaque override pairing one key with the view function that replaces its default. */
type ViewOverride = Pick<OverrideDeclaration, typeof viewOverride>;

/** What a plugin's own list holds: the views it declares and the overrides it makes. */
type ViewContribution = AnyDeclaredView | ViewOverride;

/**
 * One override pairing a key with a replacement view. Under a declared view the replacement is
 * typed from the view's data; under a failure class it is typed from the class's instances, which
 * is the typed path for a class-keyed list, because an array literal cannot carry a different type
 * parameter per element.
 */
function override<Data>(key: DeclaredView<Data>, replacement: NoInfer<View<Data>>): ViewOverride;
function override<Row>(key: DeclaredRowView<Row>, replacement: NoInfer<RowView<Row>>): ViewOverride;
function override<Failure extends LoomError>(
  // The brand is excluded so a declared view never satisfies this overload's key.
  key: FailureClass<Failure> & { readonly [declaredView]?: never },
  replacement: NoInfer<View<Failure>>,
): ViewOverride;
function override(key: object, replacement: StoredView): ViewOverride {
  const stored: StoredView = {
    head: replacement.head,
    render: replacement.render,
    row: replacement.row,
    tail: replacement.tail,
  };
  const declared = declarations.get(key);
  if (declared) {
    return new OverrideDeclaration({ key: { kind: 'view', view: declared }, replacement: stored });
  }
  return new OverrideDeclaration({ key: failureKey(key), replacement: stored });
}

/**
 * The key one failure-class override answers. A class is a function whose `prototype` is the
 * object a thrown failure's chain holds, so anything else is no key at all and build reports it as
 * the entry fault of the list that holds it, rather than colliding with every other such value.
 */
function failureKey(key: object): OverrideKey {
  if (typeof key !== 'function' || !('prototype' in key)) {
    return { kind: 'invalid' };
  }
  const prototype: unknown = key.prototype;
  if (typeof prototype !== 'object' || prototype === null) {
    return { kind: 'invalid' };
  }
  const name =
    'name' in key && typeof key.name === 'string' && key.name !== '' ? key.name : 'a failure class';
  return { kind: 'failure', name, prototype };
}

/** One contributor's overrides, read once per build and consulted in contributor order. */
interface ViewContributions {
  failures: Map<unknown, StoredView>;
  views: Map<AnyDeclaredView, StoredView>;
}

/**
 * Every contributor in resolution order: the application's overrides, then each installed plugin's
 * in installation order. The declaring view's own default answers when no contributor does.
 */
type ViewRegistry = readonly ViewContributions[];

/** The identities one build has met, so a second object under one identity is visible. */
type ViewIdentities = Map<string, AnyDeclaredView>;

/** How one contributor's diagnostics name it, and whether its list may declare a view. */
interface ViewSubject {
  /** A plugin declares views beside its overrides; an application overrides alone. */
  declares: boolean;
  sentence: string;
}

/** The identity register one build starts from, holding the views core itself declares. */
function viewIdentities(declared: readonly AnyDeclaredView[]): ViewIdentities {
  const identities: ViewIdentities = new Map();
  for (const value of declared) {
    registerIdentity(identities, value);
  }
  return identities;
}

/** One identity means one declared view, wherever on the graph that view appears. */
function registerIdentity(identities: ViewIdentities, declared: AnyDeclaredView): void {
  const known = identities.get(declared.identity);
  if (known === undefined) {
    identities.set(declared.identity, declared);
    return;
  }
  if (known !== declared) {
    throw new DeclarationError(
      `View "${declared.identity}" is declared by two distinct objects. Install one copy of the package that declares it.`,
    );
  }
}

/** The sentence one contributor's list reports for a value it cannot read. */
function entryFault(subject: ViewSubject): string {
  return subject.declares
    ? `${subject.sentence} holds a value that is not a view. Supply the value returned by view(identity, definition) or override(key, view).`
    : `${subject.sentence} holds a value that is not a view override. Supply the value returned by override(key, view).`;
}

/** A `views` slot holds a list, so anything else is the same declaration fault. */
function readContributions(subject: ViewSubject, declared: unknown): readonly unknown[] {
  if (declared === undefined) {
    return [];
  }
  if (!Array.isArray(declared)) {
    throw new DeclarationError(
      subject.declares
        ? `${subject.sentence} declares views that are not an array. Supply a list of declared views and override values.`
        : entryFault(subject),
    );
  }
  return declared;
}

/** The override one entry carries; anything else is a declaration fault of the slot. */
function overrideOf(subject: ViewSubject, entry: unknown): OverrideRecord {
  const record = typeof entry === 'object' && entry !== null ? overrides.get(entry) : undefined;
  if (!record) {
    throw new DeclarationError(entryFault(subject));
  }
  return record;
}

/** One contributor's build in progress: what it is filling, and how its diagnostics name it. */
interface ViewBuild {
  contributions: ViewContributions;
  identities: ViewIdentities;
  subject: ViewSubject;
}

/**
 * One override recorded under the key it answers. One key answers to one override inside one
 * contributor, so a second override for it is a declaration fault; the same key overridden by two
 * contributors resolves first-in-wins. A key that is neither a declared view nor a failure class
 * is the entry fault of the list that holds it, reported here rather than at the `override()` call.
 */
function recordOverride(build: ViewBuild, { key, replacement }: OverrideRecord): void {
  if (key.kind === 'invalid') {
    throw new DeclarationError(entryFault(build.subject));
  }
  if (key.kind === 'failure') {
    recordFailureOverride(build, key, replacement);
    return;
  }
  recordViewOverride(build, key.view, replacement);
}

/** One failure class answers to one override inside one contributor, keyed by its prototype. */
function recordFailureOverride(
  { contributions, subject }: ViewBuild,
  key: { name: string; prototype: object },
  replacement: StoredView,
): void {
  if (contributions.failures.has(key.prototype)) {
    throw new DeclarationError(
      `${subject.sentence} overrides the view for "${key.name}" twice. Remove one override.`,
    );
  }
  contributions.failures.set(key.prototype, replacement);
}

/** Naming a declared view as a key registers its identity, as listing the declaration does. */
function recordViewOverride(
  { contributions, identities, subject }: ViewBuild,
  key: AnyDeclaredView,
  replacement: StoredView,
): void {
  registerIdentity(identities, key);
  if (contributions.views.has(key)) {
    throw new DeclarationError(
      `${subject.sentence} overrides view "${key.identity}" twice. Remove one override.`,
    );
  }
  contributions.views.set(key, replacement);
}

/**
 * One contributor's own overrides, with the identity of every declared view it lists or names as a
 * key registered. Listing a declared view is what puts its identity on the graph; an application
 * lists overrides alone, so a declaration in its list is the same fault as any other value.
 */
function buildViews(
  subject: ViewSubject,
  declared: unknown,
  identities: ViewIdentities,
): ViewContributions {
  const contributions: ViewContributions = { failures: new Map(), views: new Map() };
  for (const entry of readContributions(subject, declared)) {
    const listed =
      typeof entry === 'object' && entry !== null ? declarations.get(entry) : undefined;
    if (listed && !subject.declares) {
      throw new DeclarationError(entryFault(subject));
    }
    if (listed) {
      registerIdentity(identities, listed);
    } else {
      recordOverride({ contributions, identities, subject }, overrideOf(subject, entry));
    }
  }
  return contributions;
}

/** One stored view value, read back over the data its own key carries. */
interface ResolvedView {
  render?: ((data: unknown, context: ViewContext) => unknown) | undefined;
  row?: ((row: unknown, index: number, context: ViewContext) => unknown) | undefined;
  head?: HeadFunction | undefined;
  tail?: TailFunction | undefined;
}

/** One stored view value, read back over the data its own key carries. */
function readStored(stored: StoredView): ResolvedView {
  // Last resort: no typed path exists.
  // A registry holds one entry per key and cannot carry a type parameter per entry.
  // A stored view value therefore reads back with its data type erased.
  // It holds because `override(key, replacement)` typed the replacement against its key's data.
  // Resolution reaches a stored value through that key alone.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return stored as ResolvedView;
}

/**
 * The stand-in for a function the stored shape does not carry. A JavaScript author's replacement
 * of the wrong shape reaches it, and the throw is the output-view fault of the write site.
 */
function missing(name: 'render' | 'row', key: string): () => never {
  return () => {
    throw new Error(`The replacement view for "${key}" supplies no ${name} function.`);
  };
}

/** One stored whole view, read back as the function the write site calls, named by its key. */
function callView(
  stored: StoredView,
  key: string,
): (data: unknown, context: ViewContext) => unknown {
  return readStored(stored).render ?? missing('render', key);
}

/** Every prototype in a failure's chain, most derived first, so one walk reads one contributor. */
function chainOf(failure: LoomError): unknown[] {
  const chain: unknown[] = [];
  let prototype: unknown = Object.getPrototypeOf(failure);
  while (prototype !== null) {
    chain.push(prototype);
    prototype = Object.getPrototypeOf(prototype);
  }
  return chain;
}

/**
 * The view function one declared view resolves to: the first contributor that overrides it, then
 * its own default. A bare view is never overridden, so it resolves to its own function.
 */
function resolveView<Data>(
  registry: ViewRegistry,
  value: View<Data>,
): (data: Data, context: ViewContext) => unknown {
  const declared = declarations.get(value);
  if (declared) {
    for (const contributor of registry) {
      const replacement = contributor.views.get(declared);
      if (replacement) {
        return callView(replacement, declared.identity);
      }
    }
  }
  return (data, context) => value.render(data, context);
}

/** The three functions one sequence writes through: `head`, `row` per item, and `tail`. */
interface ResolvedRowView<Row> {
  row: (row: Row, index: number, context: ViewContext) => unknown;
  head: HeadFunction | undefined;
  tail: TailFunction | undefined;
}

/**
 * The row functions one row view resolves to, by the walk `resolveView` defines. A replacement
 * supplies the whole shape, so an override that omits `head` drops the default's `head` with it.
 */
function resolveRowView<Row>(registry: ViewRegistry, value: RowView<Row>): ResolvedRowView<Row> {
  const declared = declarations.get(value);
  if (declared) {
    for (const contributor of registry) {
      const replacement = contributor.views.get(declared);
      if (replacement) {
        const resolved = readStored(replacement);
        const row = resolved.row ?? missing('row', declared.identity);
        return { head: resolved.head, row, tail: resolved.tail };
      }
    }
  }
  return { head: value.head, row: value.row, tail: value.tail };
}

/**
 * The override one failure resolves to, or nothing when core's own text answers it. The chain is
 * walked in full at each contributor before the next is consulted, so an application's override
 * for a base class beats a plugin's override for a subclass.
 */
function resolveFailure(registry: ViewRegistry, failure: LoomError): StoredView | undefined {
  const chain = chainOf(failure);
  for (const contributor of registry) {
    for (const prototype of chain) {
      const replacement = contributor.failures.get(prototype);
      if (replacement) {
        return replacement;
      }
    }
  }
  return undefined;
}

/**
 * The report of one failure: the text core writes, and whether a view produced it. An unrendered
 * report carries core's own text, which the plain fallback path writes beside the diagnostic
 * naming the view that could not answer.
 */
type FailureReport =
  | { kind: 'rendered'; text: string }
  | { kind: 'unrendered'; text: string; reason: string };

/**
 * The text core writes for one failure. Resolution walks the registry as `resolveFailure` defines
 * it and falls to core's own default text, which escapes the raw facts it interpolates. A
 * `FatalError` keeps the authored marked message it was given.
 */
function describeFailure(
  registry: ViewRegistry,
  failure: LoomError,
  context?: ViewContext,
): FailureReport {
  const replacement = resolveFailure(registry, failure);
  if (!replacement) {
    return {
      kind: 'rendered',
      text: failure instanceof FatalError ? defaultText(failure) : escapeText(defaultText(failure)),
    };
  }
  try {
    if (context === undefined) {
      throw new Error('Missing rendering context.');
    }
    const text = callView(replacement, failure.name)(failure, context);
    return typeof text === 'string'
      ? { kind: 'rendered', text }
      : { kind: 'unrendered', reason: notTextReason(text), text: defaultText(failure) };
  } catch (error) {
    return { kind: 'unrendered', reason: reasonOf(error), text: defaultText(failure) };
  }
}

export type {
  AnyDeclaredView,
  DeclaredRowView,
  DeclaredView,
  DeclaredViewBrand,
  FailureClass,
  FailureReport,
  ResolvedRowView,
  ViewContribution,
  ViewContributions,
  ViewIdentities,
  ViewOverride,
  ViewRegistry,
  ViewShape,
};
export {
  buildViews,
  describeFailure,
  override,
  resolveRowView,
  resolveView,
  shapeOf,
  view,
  viewIdentities,
};
