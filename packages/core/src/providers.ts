import { DeclarationError, quoted } from './errors.js';
import { partFinding } from './facts.js';
import type { FactSite } from './facts.js';
import type { CommandGraph } from './inspect.js';
import type { Log } from './log.js';
import { foreignValue, foreignValueCorrection, providerNameTaken } from './plugin-rules.js';
import type { OnShutdown } from './signal-lane.js';
import type { ContextualStyle } from './style.js';
import type { Host, Out } from './types.js';

/** Phantom key. It carries a provider's value and globals types and holds no runtime value. */
declare const providerTypes: unique symbol;

/** How long a provided value lasts: one run, or the outermost run and every run nested in it. */
type Lifetime = 'ephemeral' | 'persistent';

/**
 * A value that hands an action a typed value under `provided`. Its declaration annotates this type,
 * which names the key, the value, the global options it reads, its lifetime, and the providers it
 * uses, and `provider()` checks the definition against it.
 */
interface Provider<
  Name extends string = string,
  Value = unknown,
  Globals = {},
  Life extends Lifetime = 'ephemeral',
  Uses extends readonly AnyProvider[] = [],
> {
  readonly name: Name;
  readonly lifetime: Life;
  readonly uses: Uses;
  /** Phantom key: it carries the value and globals types and holds no runtime value. */
  readonly [providerTypes]: { value: Value; globals: (value: Globals) => void };
}

/** Any provider, whatever it provides and reads. */
type AnyProvider = Provider<string, unknown, never, Lifetime, readonly AnyProvider[]>;

/** Any provider whose value lasts the outermost run. */
type PersistentProvider = Provider<string, unknown, never, 'persistent', readonly AnyProvider[]>;

/** The value a provider provides. */
type ValueOf<Declared extends AnyProvider> = Declared[typeof providerTypes]['value'];

/** The global options a provider reads. */
type GlobalsOf<Declared extends AnyProvider> = Declared[typeof providerTypes]['globals'] extends (
  value: infer Globals,
) => void
  ? Globals
  : never;

/** Each provider in a list mapped to its value under its name. */
type ProvidedValues<Uses extends readonly AnyProvider[]> = {
  readonly [Listed in Uses[number] as Listed['name']]: ValueOf<Listed>;
};

/**
 * Every provider a list reaches, the providers its members use included, whether the list is a
 * tuple or an array of declared providers. The walk stops at a member typed as any provider, which
 * states nothing further.
 */
type ProviderClosure<Uses extends readonly AnyProvider[]> = Uses[number] extends infer Member
  ? Member extends AnyProvider
    ? AnyProvider extends Member
      ? Member
      : Member | ProviderClosure<Member['uses']>
    : never
  : never;

/** Whether a type is a union of more than one member. */
type IsUnion<Member, Whole = Member> = Member extends unknown
  ? [Whole] extends [Member]
    ? false
    : true
  : never;

/** The names two different providers among a closure share. */
type SharedNames<Closure extends AnyProvider> = {
  [Name in Closure['name']]: true extends IsUnion<Extract<Closure, { name: Name }>> ? Name : never;
}[Closure['name']];

/**
 * A `uses` list as an opt-in accepts it: one whose closure holds no two different providers with one
 * name. One provider reached twice is one provider.
 */
type OptIn<Uses extends readonly AnyProvider[]> = Uses &
  ([SharedNames<ProviderClosure<Uses>>] extends [never]
    ? unknown
    : { readonly 'Two providers in this list share one name': SharedNames<ProviderClosure<Uses>> });

/** Each provider's globals as a parameter type, so a union of them reads back as an intersection. */
type GlobalsParameter<Closure> = Closure extends AnyProvider
  ? (key: GlobalsOf<Closure>) => void
  : never;

/** The global options every provider a list reaches reads, which the opting-in Command requires. */
type ProviderGlobals<Uses extends readonly AnyProvider[]> = [ProviderClosure<Uses>] extends [never]
  ? {}
  : GlobalsParameter<ProviderClosure<Uses>> extends (key: infer Globals) => void
    ? Globals
    : never;

/** A declaration's globals with the globals its opt-ins read added, unchanged when it opts in to none. */
type WithProviderGlobals<Globals, Uses extends readonly AnyProvider[]> = Uses extends readonly []
  ? Globals
  : Globals & ProviderGlobals<Uses>;

/** What an opener receives: the validated globals it reads, its providers' values, and the run's tools. */
interface ProviderContext<Globals = {}, Provided = {}> {
  /** The validated global option values, frozen to every depth. */
  readonly options: Globals;
  /** The values of the providers this provider uses, each under its provider's name. */
  readonly provided: Provided;
  /** The frozen graph the run built, which `inspect()` returns. */
  readonly graph: CommandGraph;
  readonly host: Host;
  readonly log: Log;
  /** The channel a middleware receives, so an opener warns the operator or writes a line at `-v`. */
  readonly out: Out;
  /** The contextual style a configuration source receives, so an opener escapes raw data before it writes it. */
  readonly style: ContextualStyle;
  readonly signal: AbortSignal;
  readonly onShutdown: OnShutdown;
}

/**
 * The function a provider's module exports by default, typed from the provider's declaration. It
 * reads the declaration's members, so a provider whose name is a type parameter types it too.
 */
type Opener<Declared extends AnyProvider> = (
  context: ProviderContext<GlobalsOf<Declared>, ProvidedValues<Declared['uses']>>,
) => ValueOf<Declared> | Promise<ValueOf<Declared>>;

/** `lifetime` is required unless it is ephemeral, and `uses` unless the list is empty. */
type ProviderDefinition<Declared extends AnyProvider> = ('ephemeral' extends Declared['lifetime']
  ? { lifetime?: 'ephemeral' }
  : { lifetime: Declared['lifetime'] }) &
  (Declared['uses'] extends readonly []
    ? { uses?: readonly [] }
    : {
        uses: OptIn<Declared['uses']> &
          (Declared['lifetime'] extends 'persistent' ? readonly PersistentProvider[] : unknown);
      }) & {
    load: () => Promise<{ default: Opener<Declared> }>;
    close?: (value: ValueOf<Declared>) => void | PromiseLike<void>;
  };

/** What core keeps of one provider's definition, read where it builds and closes the value. */
interface DefinitionRecord {
  readonly load: () => unknown;
  /** The provider's `close`, a function by its type, read as one where core closes. */
  readonly close: unknown;
}

/** Every provider value `provider()` returned, keyed to the parts of its definition core calls. */
const definitions = new WeakMap<object, DefinitionRecord>();

/** A name two different providers hold, and the index of the listed entry through which the second is reached. */
interface NameClash {
  readonly index: number;
  readonly name: string;
}

/** The first name two different providers hold among those a list reaches, with where the second enters. */
function findNameClash(listed: readonly AnyProvider[]): NameClash | undefined {
  const names = new Set<string>();
  const seen = new Set<AnyProvider>();
  const clashIn = (reached: AnyProvider): string | undefined => {
    if (seen.has(reached)) {
      return undefined;
    }
    seen.add(reached);
    if (names.has(reached.name)) {
      return reached.name;
    }
    names.add(reached.name);
    return reached.uses.map(clashIn).find((name) => name !== undefined);
  };
  for (const [index, entry] of listed.entries()) {
    const name = clashIn(entry);
    if (name !== undefined) {
      return { index, name };
    }
  }
  return undefined;
}

/**
 * One `uses` list, frozen, each entry a provider this copy of `@loomcli/core` built. A provider
 * another installed copy built carries no definition this copy can read. No two different providers
 * the list reaches share a name, which the types miss when one generic factory returns both.
 */
function readUses(
  site: FactSite,
  uses: readonly AnyProvider[] | undefined,
): readonly AnyProvider[] {
  const listed = [...(uses ?? [])];
  listed.forEach((entry, index) => {
    if (!definitions.has(entry)) {
      throw new DeclarationError(foreignValue, {
        correction: foreignValueCorrection,
        findings: [partFinding(site, [index])],
        sentence: `${site.subject} lists a provider another installed copy of @loomcli/core built.`,
      });
    }
  });
  const clash = findNameClash(listed);
  if (clash !== undefined) {
    throw new DeclarationError(providerNameTaken, {
      correction:
        'Give each provider its own name. A package that exports a provider prefixes its name with its own, such as "acmeToken", so it never meets another package\'s.',
      findings: [partFinding(site, [clash.index])],
      sentence: `${site.subject} reaches two different providers named ${quoted(clash.name)}.`,
    });
  }
  return Object.freeze(listed);
}

/**
 * The frozen value a provider declaration holds. The declaration's annotation states its types, so
 * the call checks the definition against them.
 */
function provider<const Declared extends AnyProvider>(
  name: Declared['name'],
  definition: ProviderDefinition<Declared>,
): Declared {
  const value = Object.freeze({
    lifetime: definition.lifetime ?? 'ephemeral',
    name,
    uses: readUses(
      {
        at: '1.uses',
        declaration: { arguments: [name, definition], call: 'provider' },
        subject: `Provider ${quoted(name)}`,
      },
      definition.uses,
    ),
  });
  definitions.set(value, { close: definition.close, load: definition.load });
  // Last resort: no typed path exists.
  // The annotation states the provider's type, and a type parameter is never provable from an object literal.
  // It holds because the value carries that type's name, lifetime, and uses, and its phantom key holds no runtime value.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as unknown as Declared;
}

/** The values core built in one run, keyed by the provider that built each. */
type BuiltValues = ReadonlyMap<AnyProvider, unknown>;

/** The values of the providers a list names, each under its provider's name. */
function providedRecord(
  uses: readonly AnyProvider[],
  values: BuiltValues,
): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(uses.map((listed) => [listed.name, values.get(listed)])));
}

/**
 * Reads the values core built for a `uses` list as the record that list provides. The binder is
 * made where the list is declared, from the list itself, so the list's type decides the record's.
 */
function providedBinder<Uses extends readonly AnyProvider[]>(
  uses: OptIn<Uses> | undefined,
): (values: BuiltValues) => ProvidedValues<Uses> {
  const listed: readonly AnyProvider[] = uses ?? [];
  // Last resort: no typed path exists.
  // An opener's value reaches core as unknown, so the record is keyed by name at run time.
  // It holds because the record holds this list's providers alone, each value under its provider's name.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (values) => providedRecord(listed, values) as ProvidedValues<Uses>;
}

/** What one run's openers read: the run's validated globals and its graph, host, log, out, style, signal, and onShutdown. */
interface OpenerScope {
  readonly options: Readonly<Record<string, unknown>>;
  /** The run's graph, built on its first read, so a run whose openers never read it builds none. */
  readonly graph: () => CommandGraph;
  readonly host: Host;
  readonly log: Log;
  readonly out: Out;
  readonly style: ContextualStyle;
  readonly signal: AbortSignal;
  readonly onShutdown: OnShutdown;
}

/** One value core built, with the provider that built it, kept until core closes it. */
interface BuiltValue {
  readonly provider: AnyProvider;
  readonly value: unknown;
}

/**
 * Every provider a list reaches, each after the providers it uses, in the order each list names
 * them, and each once.
 */
function buildOrder(uses: readonly AnyProvider[]): readonly AnyProvider[] {
  const order: AnyProvider[] = [];
  const seen = new Set<AnyProvider>();
  const visit = (reached: AnyProvider) => {
    if (seen.has(reached)) {
      return;
    }
    seen.add(reached);
    for (const used of reached.uses) {
      visit(used);
    }
    order.push(reached);
  };
  for (const listed of uses) {
    visit(listed);
  }
  return order;
}

/**
 * Imports one provider's module and calls its default export with the context its opener reads.
 * A module whose default export is not a function bypassed the types, so its call throws.
 */
async function openValue(
  opened: AnyProvider,
  scope: OpenerScope,
  values: BuiltValues,
): Promise<unknown> {
  const module: unknown = await definitions.get(opened)?.load();
  const opener =
    module !== null && typeof module === 'object' && 'default' in module
      ? module.default
      : undefined;
  if (typeof opener !== 'function') {
    throw new TypeError(`Provider "${opened.name}" loaded a module with no default opener.`);
  }
  const { graph, ...rest } = scope;
  const context = Object.freeze({
    ...rest,
    get graph() {
      return graph();
    },
    provided: providedRecord(opened.uses, values),
  });
  const value: unknown = await Reflect.apply(opener, undefined, [context]);
  return value;
}

/** The disposal method a value carries: `Symbol.asyncDispose`, else `Symbol.dispose`, else none. */
function disposerOf(value: unknown): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }
  if (Symbol.asyncDispose in value) {
    return value[Symbol.asyncDispose];
  }
  return Symbol.dispose in value ? value[Symbol.dispose] : undefined;
}

/** Closes one value through its provider's `close`, else the value's disposal method, if any. */
async function closeValue({ provider: closed, value }: BuiltValue): Promise<void> {
  const close = definitions.get(closed)?.close;
  if (typeof close === 'function') {
    await Reflect.apply(close, undefined, [value]);
    return;
  }
  const disposer = disposerOf(value);
  if (typeof disposer === 'function') {
    await Reflect.apply(disposer, value, []);
  }
}

/** What one close threw, or nothing when it settled. */
async function closeCaught(entry: BuiltValue): Promise<{ thrown: unknown } | undefined> {
  try {
    await closeValue(entry);
    return undefined;
  } catch (error) {
    return { thrown: error };
  }
}

/** Built values in reverse build order, so a value closes before the values it used. */
function latestFirst(built: readonly BuiltValue[]): readonly BuiltValue[] {
  const order: BuiltValue[] = [];
  for (const entry of built) {
    order.unshift(entry);
  }
  return order;
}

/** The sentence a close that throws logs when it cannot fail the run. */
const closeFailed = "A provider's close failed.";

/**
 * Closes values in reverse build order, each awaited before the next starts, and every one whatever
 * an earlier one did. The first throw is the answer when `fails` holds, so the run fails with it;
 * every other throw is an `error` log event naming the provider.
 */
async function closeValues(
  built: readonly BuiltValue[],
  log: Log,
  fails: boolean,
): Promise<{ thrown: unknown } | undefined> {
  let first: { thrown: unknown } | undefined = undefined;
  for (const entry of latestFirst(built)) {
    const caught = await closeCaught(entry);
    if (caught !== undefined && fails && first === undefined) {
      first = caught;
    } else if (caught !== undefined) {
      log.error(closeFailed, { error: caught.thrown, provider: entry.provider.name });
    }
  }
  return first;
}

/**
 * The persistent values of one outermost run: built the first time a run inside it needs one, shared
 * by every later run that needs it, and closed by the outermost run. A build in flight is shared by
 * every run that needs the value meanwhile, and a build that fails leaves nothing, so the next run
 * builds it again.
 */
class PersistentValues {
  readonly #building = new Map<AnyProvider, Promise<unknown>>();
  readonly #built: BuiltValue[] = [];
  /** The outermost run's opener scope, which every persistent opener reads. */
  readonly #scope: OpenerScope;

  constructor(scope: OpenerScope) {
    this.#scope = scope;
  }

  /** The value of one persistent provider, built now unless it is built or building. */
  obtain(needed: AnyProvider, values: BuiltValues): Promise<unknown> {
    const building = this.#building.get(needed);
    if (building !== undefined) {
      return building;
    }
    const opening = openValue(needed, this.#scope, values).then(
      (value) => {
        this.#built.push({ provider: needed, value });
        return value;
      },
      (error: unknown) => {
        this.#building.delete(needed);
        throw error;
      },
    );
    this.#building.set(needed, opening);
    return opening;
  }

  /** Closes every persistent value once each build in flight has settled. */
  async close(log: Log, fails: boolean): Promise<{ thrown: unknown } | undefined> {
    await Promise.allSettled(this.#building.values());
    this.#building.clear();
    return closeValues(this.#built.splice(0), log, fails);
  }
}

/** How one run's build ended: the values it built, or a cancellation that stopped it. */
type BuildOutcome =
  | { readonly kind: 'built'; readonly values: BuiltValues }
  | { readonly kind: 'cancelled'; readonly rejected: { readonly thrown: unknown } | undefined };

/** A build the run's cancellation stopped before an opener rejected. */
const stopped: BuildOutcome = Object.freeze({ kind: 'cancelled', rejected: undefined });

/**
 * The values of one run: the ephemeral values it builds and closes, and the persistent values of
 * its outermost run, which it builds into and closes only when it is the outermost run.
 */
class RunValues {
  readonly #ephemeral: BuiltValue[] = [];
  readonly #outermost: boolean;
  readonly #persistent: PersistentValues;
  readonly #scope: OpenerScope;

  constructor(scope: OpenerScope, persistent: PersistentValues, outermost: boolean) {
    this.#scope = scope;
    this.#persistent = persistent;
    this.#outermost = outermost;
  }

  /**
   * Builds what a list reaches, one value at a time, dependencies first, reusing each persistent
   * value the outermost run already holds. When the run's signal aborts, the opener in flight
   * settles and nothing further is built. A throw on a live run rejects; the caller closes.
   */
  async build(uses: readonly AnyProvider[]): Promise<BuildOutcome> {
    const values = new Map<AnyProvider, unknown>();
    for (const needed of buildOrder(uses)) {
      const outcome = await this.#buildOne(needed, values);
      if (outcome !== undefined) {
        return outcome;
      }
    }
    return this.#scope.signal.aborted ? stopped : { kind: 'built', values };
  }

  /**
   * Closes the run's ephemeral values, then, on the outermost run, its persistent ones. `fails`
   * holds when the run had otherwise succeeded, so the first throw is the run's failure.
   */
  async close(fails: boolean): Promise<{ thrown: unknown } | undefined> {
    const { log } = this.#scope;
    const ephemeral = await closeValues(this.#ephemeral.splice(0), log, fails);
    if (!this.#outermost) {
      return ephemeral;
    }
    const persistent = await this.#persistent.close(log, fails && ephemeral === undefined);
    return ephemeral ?? persistent;
  }

  /** Builds one value into `values`, or answers the cancellation that stops the build. */
  async #buildOne(
    needed: AnyProvider,
    values: Map<AnyProvider, unknown>,
  ): Promise<BuildOutcome | undefined> {
    const { signal } = this.#scope;
    if (signal.aborted) {
      return stopped;
    }
    try {
      values.set(needed, await this.#open(needed, values));
      return undefined;
    } catch (error) {
      if (signal.aborted) {
        return { kind: 'cancelled', rejected: { thrown: error } };
      }
      throw error;
    }
  }

  async #open(needed: AnyProvider, values: BuiltValues): Promise<unknown> {
    if (needed.lifetime === 'persistent') {
      return this.#persistent.obtain(needed, values);
    }
    const value = await openValue(needed, this.#scope, values);
    this.#ephemeral.push({ provider: needed, value });
    return value;
  }
}

export type {
  AnyProvider,
  BuildOutcome,
  BuiltValues,
  Lifetime,
  Opener,
  OpenerScope,
  OptIn,
  ProvidedValues,
  Provider,
  ProviderContext,
  ProviderDefinition,
  ProviderGlobals,
  WithProviderGlobals,
  providerTypes,
};
export { PersistentValues, RunValues, provider, providedBinder, readUses };
