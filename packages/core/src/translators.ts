import { asSentence, DeclarationError, InternalError, LoomError, reasonOf } from './errors.js';
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
  prototype: object;
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

/**
 * The prototype a class key carries, or `undefined` for a value that is not a class. A class is a
 * function whose `prototype` is the object its instances' chains hold, so an arrow function, a
 * bound function, and every non-function are no key at all.
 */
function keyPrototype(key: unknown): object | undefined {
  if (typeof key !== 'function' || !('prototype' in key)) {
    return undefined;
  }
  const prototype: unknown = key.prototype;
  return typeof prototype === 'object' && prototype !== null ? prototype : undefined;
}

/** How a diagnostic names one key class: its quoted name, or what it is when it has none. */
function keyName(key: object): string {
  const name: unknown = 'name' in key ? key.name : undefined;
  return typeof name === 'string' && name !== '' ? `"${name}"` : 'an anonymous class';
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
  const prototype = keyPrototype(key);
  if (prototype === undefined) {
    throw new DeclarationError(
      'translate() received a key that is not a class. Supply an error class, such as SyntaxError.',
    );
  }
  if (typeof translator !== 'function') {
    throw new DeclarationError(
      'translate() received a translator that is not a function. Supply a function that returns a failure or undefined.',
    );
  }
  return new TranslationDeclaration({
    name: keyName(key),
    offer: (thrown) => (thrown instanceof key ? translator(thrown) : undefined),
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
  byPrototype: ReadonlyMap<object, readonly TranslationRecord[]>;
}

/**
 * Every contributor in resolution order: the application's translations, then each installed
 * plugin's in installation order.
 */
type TranslatorRegistry = readonly TranslationContributor[];

/**
 * One contributor's `translators` list. `sentence` names the contributor at the start of a
 * sentence, `The Application` or `Plugin "@acme/http"`, and the slot is read defensively, because a
 * JavaScript author reaches it with any value.
 */
function readTranslations(sentence: string, declared: unknown): TranslationContributor {
  const byPrototype = new Map<object, TranslationRecord[]>();
  for (const record of translationRecords(sentence, declared)) {
    const listed = byPrototype.get(record.prototype) ?? [];
    listed.push(record);
    byPrototype.set(record.prototype, listed);
  }
  return {
    byPrototype,
    subject: `${sentence.slice(0, 1).toLowerCase()}${sentence.slice(1)}`,
  };
}

/** The record behind each entry of one `translators` slot, whose every other value is its fault. */
function translationRecords(sentence: string, declared: unknown): TranslationRecord[] {
  const fault = `${sentence} holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).`;
  if (declared !== undefined && !Array.isArray(declared)) {
    throw new DeclarationError(fault);
  }
  const list: readonly unknown[] = declared ?? [];
  return list.map((entry) => {
    const record = typeof entry === 'object' && entry !== null ? records.get(entry) : undefined;
    if (!record) {
      throw new DeclarationError(fault);
    }
    return record;
  });
}

/**
 * Every prototype in one thrown value's chain, most derived first, or `undefined` when the value is
 * never offered: a primitive, a value whose chain holds a failure class, and a value whose chain
 * cannot be read, such as a proxy whose trap throws. A value with a `null` prototype has an empty
 * chain, which no key matches.
 */
function offeredChain(thrown: object): object[] | undefined {
  const chain: object[] = [];
  try {
    let prototype: object | null = Reflect.getPrototypeOf(thrown);
    while (prototype !== null) {
      if (prototype === LoomError.prototype) {
        return undefined;
      }
      chain.push(prototype);
      prototype = Reflect.getPrototypeOf(prototype);
    }
  } catch {
    return undefined;
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
    return new InternalError(`${who} threw: ${asSentence(reasonOf(error))}`, error);
  }
  if (answer === undefined || isFailure(answer)) {
    return answer;
  }
  // A translator is synchronous, so a returned promise is ignored once its rejection is observed.
  if (isThenable(answer)) {
    ignoreRejection(answer);
  }
  return new InternalError(
    `${who} returned ${returnedKind(answer)} instead of a failure. Return a failure or undefined.`,
    thrown,
  );
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
  const chain = offeredChain(thrown) ?? [];
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
