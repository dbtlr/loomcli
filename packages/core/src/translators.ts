import { spelled } from './diagnostic-text.js';
import {
  asSentence,
  DeclarationError,
  InternalError,
  LoomError,
  quoted,
  reasonOf,
} from './errors.js';
import { partFinding } from './facts.js';
import type { FactSite } from './facts.js';
import { foreignValue, notAFunction, notAList, translationKey } from './plugin-rules.js';
import { isInstance, prototypeChain } from './prototypes.js';
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
 * bound function, and every non-function are no key at all. A key whose `prototype` cannot be
 * read, such as a proxy whose trap throws, is no key either.
 */
function keyPrototype(key: unknown): object | undefined {
  let prototype: unknown = undefined;
  try {
    if (typeof key !== 'function' || !('prototype' in key)) {
      return undefined;
    }
    prototype = key.prototype;
  } catch {
    return undefined;
  }
  return typeof prototype === 'object' && prototype !== null ? prototype : undefined;
}

/** A key's own name, or `undefined` when it has none that can be read. */
function nameOf(key: object): string | undefined {
  let name: unknown = undefined;
  try {
    name = 'name' in key ? key.name : undefined;
  } catch {
    name = undefined;
  }
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * How a diagnostic names one key class: its name, quoted and escaped, or what it is when it has no
 * name that can be read.
 */
function keyName(key: object): string {
  const name = nameOf(key);
  return name === undefined ? 'an anonymous class' : quoted(name);
}

/** A name JavaScript source can spell as an identifier, which a finding prints a class key as. */
const identifier = /^[A-Za-z_$][\w$]*$/u;

/**
 * The finding for one `translate()` call, marking the argument at `mark`. A class key prints as
 * its name, as its author wrote it, where any other function prints as an ellipsis.
 */
function translateFinding(key: unknown, translator: unknown, mark: string) {
  const name = typeof key === 'function' ? nameOf(key) : undefined;
  const code = name !== undefined && identifier.test(name) ? spelled(name) : key;
  return { arguments: [code, translator], call: 'translate', mark };
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
  // A key whose prototype's chain cannot be read, such as through a proxy whose trap throws, is no
  // Key either, so it is reported as a non-class before any failure-class check.
  const chain = prototype === undefined ? undefined : prototypeChain(prototype);
  if (prototype === undefined || chain === undefined) {
    throw new DeclarationError(translationKey, {
      correction: 'Supply an error class, such as SyntaxError.',
      findings: [translateFinding(key, translator, '0')],
      sentence: 'translate() received a key that is not a class.',
    });
  }
  // Core never offers a failure to translators, so a translation keyed on a failure class never runs.
  if (prototype === LoomError.prototype || chain.includes(LoomError.prototype)) {
    throw new DeclarationError(translationKey, {
      correction: 'Key the translation on the foreign class it replaces.',
      findings: [translateFinding(key, translator, '0')],
      sentence: 'translate() received a failure class as its key.',
    });
  }
  if (typeof translator !== 'function') {
    throw new DeclarationError(notAFunction, {
      correction: 'Supply a function that returns a failure or undefined.',
      findings: [translateFinding(key, translator, '1')],
      sentence: 'translate() received a translator that is not a function.',
    });
  }
  return new TranslationDeclaration({
    name: keyName(key),
    // A value whose chain cannot be read is no instance, so its translator is never blamed for it.
    offer: (thrown) => (isInstance(thrown, key) ? translator(thrown) : undefined),
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
 * One contributor's `translators` list. `site` names the contributor at the start of a sentence,
 * `The Application` or `Plugin "@acme/http"`, and holds the call that declared the list, which a
 * fault marks. The slot is read defensively, because a JavaScript author reaches it with any value.
 */
function readTranslations(site: FactSite, declared: unknown): TranslationContributor {
  const sentence = site.subject;
  const byPrototype = new Map<object, TranslationRecord[]>();
  for (const record of translationRecords(site, declared)) {
    const listed = byPrototype.get(record.prototype) ?? [];
    listed.push(record);
    byPrototype.set(record.prototype, listed);
  }
  return {
    byPrototype,
    subject: `${sentence.slice(0, 1).toLowerCase()}${sentence.slice(1)}`,
  };
}

/** The fix a `translators` slot's list fault and entry fault share. */
const translationSupply = 'translate(ErrorClass, translator)';

/** The record behind each entry of one `translators` slot, whose every other value is its fault. */
function translationRecords(site: FactSite, declared: unknown): TranslationRecord[] {
  if (declared !== undefined && !Array.isArray(declared)) {
    throw new DeclarationError(notAList, {
      correction: `Supply a list of values returned by ${translationSupply}.`,
      findings: [partFinding(site, [])],
      sentence: `${site.subject} declares translators that are not an array.`,
    });
  }
  const list: readonly unknown[] = declared ?? [];
  // Array.from visits a hole as undefined, where map would skip it and leave the hole in place.
  return Array.from(list, (entry, index) => {
    const record = typeof entry === 'object' && entry !== null ? records.get(entry) : undefined;
    if (!record) {
      throw new DeclarationError(foreignValue, {
        correction: `Supply the value returned by ${translationSupply}.`,
        findings: [partFinding(site, [index])],
        sentence: `${site.subject} holds a translator entry that is not a translation.`,
      });
    }
    return record;
  });
}

/**
 * Every prototype in one thrown value's chain, most derived first, or `undefined` when the value is
 * never offered: a value whose chain holds a failure class, and a value whose chain cannot be read,
 * such as a proxy whose trap throws, or whose chain repeats a link or never ends. A value with a
 * `null` prototype has an empty chain, which no key matches.
 */
function offeredChain(thrown: object): object[] | undefined {
  const chain = prototypeChain(thrown);
  return chain?.includes(LoomError.prototype) ? undefined : chain;
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
  if (answer === undefined || isInstance(answer, LoomError)) {
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
    ? (offeredChain(thrown) ?? [])
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
