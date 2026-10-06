import { viewMediaType, viewShape } from './command-rules.js';
import { elided, quoteString, spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import {
  DeclarationError,
  defaultText,
  FatalError,
  notTextReason,
  quoted,
  reasonOf,
} from './errors.js';
import type { LoomError } from './errors.js';
import { partFinding, slotSite } from './facts.js';
import type { FactSite } from './facts.js';
import { checkIdentity } from './identity.js';
import {
  foreignValue,
  notAList,
  overrideKey,
  overrideTwice,
  twoPackageCopies,
} from './plugin-rules.js';
import { prototypeChain } from './prototypes.js';
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
 * What every failure view reads: the stderr view context, where the run was, and the hints the
 * installed plugins' `onFailure` hooks returned. `run()` and `invoke()` fill it where they catch the
 * failure, so no failure class carries these facts. `path` holds the canonical names routing
 * walked, `[]` before routing, and `hints` is `[]` when no hook contributed. `invokedBy` reads
 * `'name'` for a run `invoke()` started, where no command line exists, and `'argv'` otherwise.
 * `view` and `mediaType` are the run's selection when it failed: a middleware's assignment, else the
 * view `invoke()` started with, else the routed Command's default view, and the media type that
 * view declares. Neither is the graph.
 */
interface FailureViewContext extends ViewContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly hints: readonly string[];
  readonly invokedBy: 'argv' | 'name';
  /** The view the result would render through when the run failed, or `undefined` for none. */
  readonly view: string | undefined;
  /** The media type that view declares, or `undefined` when it declares none. */
  readonly mediaType: string | undefined;
}

/**
 * A failure class's view. A `View<Failure>` written against `ViewContext` is assignable to it,
 * because its function reads less of the context.
 */
interface FailureView<Failure extends LoomError> {
  render: (failure: Readonly<Failure>, context: FailureViewContext) => string;
  /** A failure view has one shape, as a view does. */
  row?: undefined;
}

/**
 * One stored view function, with the data type and the context erased. A registry holds one entry
 * per key and cannot carry a type parameter per entry, so `override(key, replacement)` is where the
 * replacement is typed against the key it answers: a failure class's view reads the failure view
 * context, and every other view reads the view context.
 */
type ViewFunction = (data: never, context: never) => unknown;

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
  readonly mediaType?: string;

  constructor(identity: string, definition: View<Data>, mediaType: string | undefined) {
    this.identity = identity;
    this.render = definition.render;
    if (mediaType !== undefined) {
      this.mediaType = mediaType;
    }
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
  readonly mediaType?: string;

  constructor(identity: string, definition: RowView<Row>, mediaType: string | undefined) {
    this.identity = identity;
    this.row = definition.row;
    if (definition.head) {
      this.head = definition.head;
    }
    if (definition.tail) {
      this.tail = definition.tail;
    }
    if (mediaType !== undefined) {
      this.mediaType = mediaType;
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
 * The media type one declared view states, read once, so a later write to the definition changes
 * nothing the declaration holds. Core holds no grammar of media types, so the one rule is that the
 * value is a string.
 */
function declaredMediaType(
  identity: string,
  definition: View<never> | RowView<never>,
): string | undefined {
  const mediaType: unknown = definition.mediaType;
  if (mediaType !== undefined && typeof mediaType !== 'string') {
    throw new DeclarationError(viewMediaType, {
      correction: 'Supply a media type such as "text/plain", or omit mediaType.',
      findings: [{ arguments: [identity, definition], call: 'view', mark: '1.mediaType' }],
      sentence: `View ${quoted(identity)} declares a media type that is not a string.`,
    });
  }
  return mediaType;
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
  checkIdentity('view', identity);
  const shape = shapeOf(definition);
  const findings = [{ arguments: [identity, definition], call: 'view', mark: '1' }];
  if (shape === 'both') {
    throw new DeclarationError(viewShape, {
      correction: 'Supply one of the two.',
      findings,
      sentence: `View ${quoted(identity)} carries render and row.`,
    });
  }
  if (shape === 'neither') {
    throw new DeclarationError(viewShape, {
      correction: 'Supply a view with render or a row view with row.',
      findings,
      sentence: `View ${quoted(identity)} carries neither render nor row.`,
    });
  }
  const mediaType = declaredMediaType(identity, definition);
  return typeof definition.row === 'function'
    ? new RowViewDeclaration<never>(identity, definition, mediaType)
    : new ViewDeclaration<never>(identity, definition, mediaType);
}

/**
 * What one override replaces: a declared view, a failure class read as its prototype, or a value
 * that is neither, which the list that holds it reports as its entry fault.
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

/** Every value an override can key on: a declared view of either shape or a failure class. */
type AnyOverrideKey = AnyDeclaredView | FailureClass<LoomError>;

/**
 * The replacement view one key takes, derived from the key alone. The declared-view branches come
 * first, so a declared view is never read as a failure class. Each check is wrapped in a tuple so a
 * union key is not split into a union of replacements that each answer only one of its members.
 */
type ReplacementView<Key> = [Key] extends [DeclaredView<infer Data>]
  ? View<Data>
  : [Key] extends [DeclaredRowView<infer Row>]
    ? RowView<Row>
    : [Key] extends [FailureClass<infer Failure>]
      ? FailureView<Failure>
      : never;

/**
 * One override pairing a key with a replacement view. The replacement's type is derived from the
 * key: under a declared view it is typed from the view's data, and under a failure class from the
 * class's instances, which is the typed path for a class-keyed list, because an array literal cannot
 * carry a different type parameter per element. One signature serves every key, so a mismatch
 * names the replacement's type against the one the key expects.
 */
function override<Key extends AnyOverrideKey>(
  key: Key,
  replacement: NoInfer<ReplacementView<Key>>,
): ViewOverride {
  // Every replacement a key derives is a stored view, so it widens here with no check.
  const supplied: StoredView = replacement;
  const stored: StoredView = {
    head: supplied.head,
    render: supplied.render,
    row: supplied.row,
    tail: supplied.tail,
  };
  const declared = declarations.get(key);
  if (declared) {
    return new OverrideDeclaration({ key: { kind: 'view', view: declared }, replacement: stored });
  }
  return new OverrideDeclaration({ key: failureKey(key), replacement: stored });
}

/**
 * The key one failure-class override answers. A class is a function whose `prototype` is the
 * object a thrown failure's chain holds, so anything else is no key at all and the list that holds
 * it reports it as its entry fault, rather than colliding with every other such value.
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

/**
 * How one contributor's diagnostics name it, whether its list may declare a view, and the call
 * that declared the list, `plugin(identity, …)` or `new Application(name, …)`, which a fault marks.
 */
interface ViewSubject {
  /** A plugin declares views beside its overrides; an application overrides alone. */
  declares: boolean;
  sentence: string;
  owner: { call: string; named: unknown };
}

/** The identity one build starts from, holding the views core itself declares. */
function viewIdentities(declared: readonly AnyDeclaredView[]): ViewIdentities {
  const identities: ViewIdentities = new Map();
  for (const value of declared) {
    registerIdentity(identities, value);
  }
  return identities;
}

/**
 * One identity means one declared view, wherever on the graph that view appears. `place` marks the
 * list entry that names the view, when one does.
 */
function registerIdentity(
  identities: ViewIdentities,
  declared: AnyDeclaredView,
  place?: Finding,
): void {
  const known = identities.get(declared.identity);
  if (known === undefined) {
    identities.set(declared.identity, declared);
    return;
  }
  if (known !== declared) {
    throw new DeclarationError(twoPackageCopies, {
      correction: 'Install one copy of the package that declares it.',
      findings:
        place === undefined ? [] : [{ ...place, note: `another ${quoted(declared.identity)}` }],
      sentence: `View ${quoted(declared.identity)} is declared by two distinct objects.`,
    });
  }
}

/** A name JavaScript source can spell as an identifier, which a finding prints a class key as. */
const identifier = /^[A-Za-z_$][\w$]*$/u;

/** How a finding prints an override's key: a failure class by its name, anything else elided. */
function keyCode(key: OverrideKey): string {
  return key.kind === 'failure' && identifier.test(key.name) ? key.name : elided;
}

/**
 * One list entry as a finding prints it: a declared view as the `view()` call that made it, an
 * override as its `override()` call, and any other value as it is.
 */
function entryCode(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null) {
    return entry;
  }
  const listed = declarations.get(entry);
  if (listed) {
    return spelled(`view(${quoteString(listed.identity)}, ${elided})`);
  }
  const record = overrides.get(entry);
  return record ? spelled(`override(${keyCode(record.key)}, ${elided})`) : entry;
}

/** Where one contributor's `views` list sits, with each entry printed as the call that made it. */
function listSite(subject: ViewSubject, declared: unknown): FactSite {
  const views = Array.isArray(declared) ? Array.from(declared, entryCode) : declared;
  return slotSite({ ...subject.owner, subject: subject.sentence }, 'views', views);
}

/** The fault of one list entry that is not a value this contributor's list may hold. */
function entryFault(subject: ViewSubject, place: Finding): DeclarationError {
  return subject.declares
    ? new DeclarationError(foreignValue, {
        correction:
          'Supply the value returned by view(identity, definition) or override(key, view).',
        findings: [place],
        sentence: `${subject.sentence} holds a value that is not a view.`,
      })
    : new DeclarationError(foreignValue, {
        correction: 'Supply the value returned by override(key, view).',
        findings: [place],
        sentence: `${subject.sentence} holds a value that is not a view override.`,
      });
}

/** A `views` slot holds a list, so anything else is the same declaration fault. */
function readContributions(subject: ViewSubject, declared: unknown): readonly unknown[] {
  if (declared === undefined) {
    return [];
  }
  if (!Array.isArray(declared)) {
    throw new DeclarationError(notAList, {
      correction: subject.declares
        ? 'Supply a list of declared views and override values.'
        : 'Supply a list of override values.',
      findings: [partFinding(listSite(subject, declared), [])],
      sentence: `${subject.sentence} declares views that are not an array.`,
    });
  }
  return declared;
}

/** One contributor's build in progress: what it is filling, and how its diagnostics name it. */
interface ViewBuild {
  contributions: ViewContributions;
  identities: ViewIdentities;
  subject: ViewSubject;
  /** The list the contributor declared, printed, which each fault marks an entry of. */
  site: FactSite;
  /** The entry that first overrode each key, so a second override marks both. */
  positions: Map<unknown, number>;
}

/**
 * The entry a key's first override sits at, recording this one's when it is the first. One key
 * answers to one override inside one contributor, so a second override marks both entries.
 */
function claimKey(build: ViewBuild, key: ValidKey, index: number): void {
  const slot = key.kind === 'failure' ? key.prototype : key.view;
  const first = build.positions.get(slot);
  if (first === undefined) {
    build.positions.set(slot, index);
    return;
  }
  const clause =
    key.kind === 'failure'
      ? `the view for ${quoted(key.name)}`
      : `view ${quoted(key.view.identity)}`;
  throw new DeclarationError(overrideTwice, {
    correction: 'Remove one override.',
    findings: [
      partFinding(build.site, [first], 'the first override'),
      partFinding(build.site, [index], 'the second override'),
    ],
    sentence: `${build.subject.sentence} overrides ${clause} twice.`,
  });
}

/** The keys an override answers to: a declared view or a failure class. */
type ValidKey = Exclude<OverrideKey, { kind: 'invalid' }>;

/**
 * One override recorded under the key it answers. The same key overridden by two contributors
 * resolves first-in-wins. A key that is neither a declared view nor a failure class is a fault of
 * the list that holds it, reported here rather than at the `override()` call.
 */
function recordOverride(
  build: ViewBuild,
  { key, replacement }: OverrideRecord,
  index: number,
): void {
  if (key.kind === 'invalid') {
    throw new DeclarationError(overrideKey, {
      correction:
        'Key the override on a value view(identity, definition) returned, or on a failure class.',
      findings: [partFinding(build.site, [index])],
      sentence: `${build.subject.sentence} overrides a key that is neither a declared view nor a failure class.`,
    });
  }
  claimKey(build, key, index);
  if (key.kind === 'failure') {
    build.contributions.failures.set(key.prototype, replacement);
    return;
  }
  // Naming a declared view as a key registers its identity, as listing the declaration does.
  registerIdentity(build.identities, key.view, partFinding(build.site, [index]));
  build.contributions.views.set(key.view, replacement);
}

/**
 * One entry of a contributor's list: a declared view, which only a plugin may list, or an
 * override. Any other value is the list's entry fault.
 */
function recordEntry(build: ViewBuild, entry: unknown, index: number): void {
  const { identities, site, subject } = build;
  const place = partFinding(site, [index]);
  const object = typeof entry === 'object' && entry !== null ? entry : undefined;
  const listed = object === undefined ? undefined : declarations.get(object);
  const record = object === undefined ? undefined : overrides.get(object);
  if (listed && subject.declares) {
    registerIdentity(identities, listed, place);
  } else if (record) {
    recordOverride(build, record, index);
  } else {
    throw entryFault(subject, place);
  }
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
  const site = listSite(subject, declared);
  const build: ViewBuild = { contributions, identities, positions: new Map(), site, subject };
  for (const [index, entry] of readContributions(subject, declared).entries()) {
    recordEntry(build, entry, index);
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
  // A stored view value therefore reads back with its data type and its context erased.
  // It holds because `override(key, replacement)` typed the replacement against its key's data.
  // Resolution reaches a stored value through that key alone.
  // A failure key is resolved by `describeFailure` alone, which passes the failure view context.
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
  // A failure core reports has a readable chain, so the empty fallback only keeps the walk total.
  const chain = prototypeChain(failure) ?? [];
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
 * The report of one failure: the text core writes, and whether a view produced it. A rendered
 * report says whether core's own default text answered, which for a defect is the generic defect
 * message. An unrendered report carries core's own text, which the plain fallback path writes
 * beside the diagnostic naming the view that could not answer, and what the view threw.
 */
type FailureReport =
  | { kind: 'rendered'; text: string; core: boolean }
  | { kind: 'unrendered'; text: string; reason: string; cause: unknown };

/**
 * Core's own default text for one failure, escaped unless it is the authored marked message of a
 * `FatalError`, with each hint on its own line under it as marked text it does not escape.
 */
function coreText(failure: LoomError, text: string, hints: readonly string[]): string {
  const sentence = failure instanceof FatalError ? text : escapeText(text);
  return `${sentence}${hints.map((hint) => `${hint}\n`).join('')}`;
}

/**
 * The text core writes for one failure. Resolution walks the registry as `resolveFailure` defines
 * it and falls to core's own default text, which opens a usage failure with the context's
 * application name and escapes the raw facts it interpolates. A `FatalError` keeps the authored
 * marked message it was given. The default text writes each hint on its own line under the
 * sentence, as marked text it does not escape; an override decides for itself. An unrendered report
 * carries the same default text without hints, which the plain fallback path writes.
 */
function describeFailure(
  registry: ViewRegistry,
  failure: LoomError,
  context: FailureViewContext,
): FailureReport {
  const text = defaultText(failure, context.application);
  const replacement = resolveFailure(registry, failure);
  if (!replacement) {
    return { core: true, kind: 'rendered', text: coreText(failure, text, context.hints) };
  }
  try {
    const rendered = callView(replacement, failure.name)(failure, context);
    return typeof rendered === 'string'
      ? { core: false, kind: 'rendered', text: rendered }
      : { cause: undefined, kind: 'unrendered', reason: notTextReason(rendered), text };
  } catch (error) {
    return { cause: error, kind: 'unrendered', reason: reasonOf(error), text };
  }
}

export type {
  AnyDeclaredView,
  AnyOverrideKey,
  DeclaredRowView,
  DeclaredView,
  DeclaredViewBrand,
  FailureClass,
  FailureReport,
  FailureView,
  FailureViewContext,
  ReplacementView,
  ResolvedRowView,
  ViewContribution,
  ViewContributions,
  ViewSubject,
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
