import {
  asSentence,
  DeclarationError,
  InternalError,
  LoomError,
  midSentence,
  quoted,
  reasonOf,
} from './errors.js';
import { partFinding } from './facts.js';
import type { FactSite } from './facts.js';
import { foreignValue, foreignValueCorrection } from './plugin-rules.js';
import { brokenTranslator, brokenTranslatorCorrection } from './rules.js';
import { ignoreRejection, isThenable } from './thenable.js';

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

/** One translation as core reads it back: the key's prototype, its name, and the typed call. */
interface TranslationRecord {
  /** The object a thrown value's prototype chain holds when the key's class constructed it. */
  prototype: unknown;
  /** The key's name, which a broken translator's diagnostic reports. */
  name: string;
  /**
   * The translator, typed at `translate()` against its key. It answers `undefined` without calling
   * the translator for a value its key does not claim as an instance.
   */
  offer: (thrown: object) => unknown;
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

/** How a diagnostic names one key class: its name, quoted and escaped, or what it is without one. */
function keyName(key: { readonly name: string }): string {
  return key.name === '' ? 'an anonymous class' : quoted(key.name);
}

/**
 * Whether a key claims a thrown value as its instance. A value whose chain cannot be read is not
 * claimed, so its translator is never called and is not blamed for the failed read.
 */
function claims<Thrown extends object>(thrown: object, key: ErrorClass<Thrown>): thrown is Thrown {
  try {
    return thrown instanceof key;
  } catch {
    return false;
  }
}

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
    name: keyName(key),
    offer: (thrown) => (claims(thrown, key) ? translator(thrown) : undefined),
    prototype,
  });
}

/**
 * One contributor's translations: how a diagnostic names it, and its records by key prototype,
 * each list in the order the contributor listed it.
 */
interface TranslationContributor {
  /** The contributor as a diagnostic's subject, such as `the Application` or `plugin "@acme/http"`. */
  subject: string;
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
 * fault marks.
 */
function readTranslations(
  site: FactSite,
  declared: readonly Translation[] | undefined,
): TranslationContributor {
  const sentence = site.subject;
  const byPrototype = new Map<unknown, TranslationRecord[]>();
  for (const record of translationRecords(site, declared)) {
    const listed = byPrototype.get(record.prototype) ?? [];
    listed.push(record);
    byPrototype.set(record.prototype, listed);
  }
  return {
    byPrototype,
    subject: midSentence(sentence),
  };
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

/** How a broken translator's diagnostic names a value that is not a failure. */
function returnedKind(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (isThenable(value)) {
    return 'a promise';
  }
  const kind = typeof value;
  return /^[aeiou]/u.test(kind) ? `an ${kind}` : `a ${kind}`;
}

/** Whether a translator's answer is a failure, read without letting a hostile value throw. */
function isFailure(value: unknown): value is LoomError {
  try {
    return value instanceof LoomError;
  } catch {
    return false;
  }
}

/** The defect of a broken translator under its rule, with the sentence and cause each shape gives. */
function brokenDefect(sentence: string, cause: unknown): InternalError {
  return new InternalError(brokenTranslator, {
    cause,
    correction: brokenTranslatorCorrection,
    sentence,
  });
}

/**
 * The defect of a translator that threw. Its cause is a new `AggregateError` that holds the
 * translator's throw and then the original throw, so neither is lost and neither is mutated. The
 * reason is read through `reasonOf`, which escapes it onto one line.
 */
function threwDefect(who: string, error: unknown, thrown: object): InternalError {
  const reason = reasonOf(error);
  const cause = new AggregateError(
    [error, thrown],
    'The translator threw while translating the original throw.',
  );
  return brokenDefect(`${who} threw: ${asSentence(reason)}`, cause);
}

/** The one translator call, whose throw or non-failure answer is the defect of that translator. */
function consult(
  contributor: TranslationContributor,
  record: TranslationRecord,
  thrown: object,
): LoomError | undefined {
  const who = `The translator ${contributor.subject} registered for ${record.name}`;
  let answer: unknown = undefined;
  try {
    answer = record.offer(thrown);
  } catch (error) {
    return threwDefect(who, error, thrown);
  }
  if (answer === undefined || isFailure(answer)) {
    return answer;
  }
  // A translator is synchronous, so a returned promise is ignored once its rejection is observed.
  if (isThenable(answer)) {
    ignoreRejection(answer);
  }
  return brokenDefect(`${who} returned ${returnedKind(answer)} instead of a failure.`, thrown);
}

/**
 * The failure the translators answer for one foreign throw, or `undefined` when the throw is never
 * offered or every translator passed. Resolution follows the override walk: each contributor in
 * order, the thrown value's chain walked in full at each, most derived first, and within one
 * class the list order. A broken translator ends the walk with its defect, so no later translator
 * hides it.
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
        const answer = consult(contributor, record, thrown);
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
