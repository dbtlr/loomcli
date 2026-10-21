import { DeclarationError, foreignFailure, LoomError } from './errors.js';
import { partFinding } from './facts.js';
import type { FactSite } from './facts.js';
import { foreignValue, foreignValueCorrection } from './plugin-rules.js';

/** Phantom key. It brands a translation and holds no runtime value. */
declare const translation: unique symbol;

/**
 * A class a translation is keyed on, such as `SyntaxError`. Its instance type is the type the
 * translator receives, so the function needs no narrowing of its own.
 */
type ErrorClass<Thrown extends object> = abstract new (...args: never[]) => Thrown;

/**
 * A function that turns one foreign throw into one of the author's failures, or answers
 * `undefined` to pass the throw on to the next translator.
 */
type Translator<Thrown extends object> = (error: Thrown) => LoomError | undefined;

/** One translation as core reads it back: the key's prototype and the typed call. */
interface TranslationRecord {
  /** The object a thrown value's prototype chain holds when the key's class constructed it. */
  prototype: unknown;
  /**
   * The translator, typed at `translate()` against its key. It answers `undefined` without calling
   * the translator for a value its key does not claim as an instance.
   */
  offer: (thrown: object) => LoomError | undefined;
}

/** Authored translations register here, so the public type publishes nothing to reach. */
const records = new WeakMap<object, TranslationRecord>();

/** The runtime value `translate()` returns. Its record lives in the registry above. */
class TranslationDeclaration {
  declare readonly [translation]: true;

  constructor(record: TranslationRecord) {
    records.set(this, record);
    Object.freeze(this);
  }
}

/** An opaque translation pairing one error class with the translator that answers it. */
type Translation = Pick<TranslationDeclaration, typeof translation>;

/**
 * Pairs an error class with the translator that turns its instances into a failure. The
 * translator receives the thrown instance typed from the class, and a `translators` list on the
 * Application or a plugin registers the pair.
 */
function translate<Thrown extends object>(
  key: ErrorClass<Thrown>,
  translator: Translator<Thrown>,
): Translation {
  const prototype: unknown = key.prototype;
  return new TranslationDeclaration({
    offer: (thrown) => (thrown instanceof key ? translator(thrown) : undefined),
    prototype,
  });
}

/** One contributor's translations: its records by key prototype, each list in listed order. */
interface TranslationContributor {
  byPrototype: ReadonlyMap<unknown, readonly TranslationRecord[]>;
}

/**
 * Every contributor in resolution order: the application's translations, then each installed
 * plugin's in installation order.
 */
type TranslatorRegistry = readonly TranslationContributor[];

/**
 * One contributor's `translators` list. `site` names the contributor at the start of a sentence,
 * `The Application` or `Plugin "@acme/http"`, and holds the call that declared the list, which a
 * foreign value's fault marks.
 */
function readTranslations(
  site: FactSite,
  declared: readonly Translation[] | undefined,
): TranslationContributor {
  const byPrototype = new Map<unknown, TranslationRecord[]>();
  for (const record of translationRecords(site, declared)) {
    const listed = byPrototype.get(record.prototype) ?? [];
    listed.push(record);
    byPrototype.set(record.prototype, listed);
  }
  return { byPrototype };
}

/**
 * The record behind each entry of one `translators` slot. A translation another installed copy of
 * `@loomcli/core` built misses this copy's registry.
 */
function translationRecords(
  site: FactSite,
  declared: readonly Translation[] | undefined,
): TranslationRecord[] {
  return (declared ?? []).map((entry, index) => {
    const record = records.get(entry);
    if (!record) {
      throw new DeclarationError(foreignValue, {
        correction: foreignValueCorrection,
        findings: [partFinding(site, [index])],
        sentence: `${site.subject} holds a translation another installed copy of @loomcli/core built.`,
      });
    }
    return record;
  });
}

/**
 * Every prototype in one thrown value's chain, most derived first, or none when the chain holds a
 * failure class, which core never offers to a translator. A value with a `null` prototype has an
 * empty chain, which no key matches.
 */
function offeredChain(thrown: object): object[] {
  const chain: object[] = [];
  for (
    let prototype = Reflect.getPrototypeOf(thrown);
    prototype !== null;
    prototype = Reflect.getPrototypeOf(prototype)
  ) {
    if (prototype === LoomError.prototype) {
      return [];
    }
    chain.push(prototype);
  }
  return chain;
}

/**
 * The one translator call. A translator that throws is a foreign throw from the author's code: its
 * defect carries that throw as its cause, and it is never offered to a translator again.
 */
function consult(record: TranslationRecord, thrown: object): LoomError | undefined {
  try {
    return record.offer(thrown);
  } catch (error) {
    return foreignFailure(error);
  }
}

/**
 * The failure the translators answer for one foreign throw, or `undefined` when the throw is never
 * offered or every translator passed. Resolution follows the override walk: each contributor in
 * order, the thrown value's chain walked in full at each, most derived first, and within one
 * class the list order. A translator that throws ends the walk with its defect, so no later
 * translator hides it.
 */
function translateThrow(registry: TranslatorRegistry, thrown: unknown): LoomError | undefined {
  if ((typeof thrown !== 'object' && typeof thrown !== 'function') || thrown === null) {
    return undefined;
  }
  // With no translation registered, the chain is never read.
  const chain = registry.some((contributor) => contributor.byPrototype.size > 0)
    ? offeredChain(thrown)
    : [];
  for (const contributor of registry) {
    for (const prototype of chain) {
      for (const record of contributor.byPrototype.get(prototype) ?? []) {
        const answer = consult(record, thrown);
        if (answer !== undefined) {
          return answer;
        }
      }
    }
  }
  return undefined;
}

export type { ErrorClass, TranslationContributor, Translation, Translator, TranslatorRegistry };
export { readTranslations, translate, translateThrow };
