/*
 * Phrasebooks: one package's sentences in one language, made by `phrasebook()` and checked against
 * the package's member of `MessagePackages` where they are made, and the rule a plugin's
 * `phrasebooks` map keeps.
 */
import type { FactSite } from '../diagnostics/facts.js';
import { partFinding } from '../diagnostics/facts.js';
import { DeclarationError } from '../failures/errors.js';
import { quoted } from '../failures/wording.js';
import { foreignValue, foreignValueCorrection, phrasebookLanguage } from '../plugins/rules.js';
import type { SentenceEntry, SentenceNames } from './phrase.js';
import type { MessagePackage, MessagePackages } from './registry.js';

/**
 * The sentences a phrasebook of one package may hold: per message module, per export, each
 * optional. A constant takes a string, and a function a function of the same values that returns a
 * string.
 *
 * @public
 */
type PhrasebookSentences<Package extends MessagePackage> = {
  readonly [Module in keyof MessagePackages[Package]]?: {
    readonly [Name in SentenceNames<MessagePackages[Package][Module]>]?: SentenceEntry<
      MessagePackages[Package][Module][Name]
    >;
  };
};

/** Makes one phrasebook; only this module reaches the class's private constructor. */
let makePhrasebook: (packageName: MessagePackage, sentences: object) => Phrasebook = () => {
  throw new TypeError('Phrasebook is not initialized.');
};

/** Reads one phrasebook's sentences, which the class keeps private. */
let sentencesOf: (book: Phrasebook) => object = () => {
  throw new TypeError('Phrasebook is not initialized.');
};

/**
 * One package's sentences in one language, which `phrasebook()` makes and the localization plugin
 * installs. Its private member makes it nominal, so an object shaped like one is not one.
 *
 * @example
 * ```ts
 * import { phrasebook } from '@loomcli/core';
 * import type { Phrasebook } from '@loomcli/core';
 *
 * export const coreDe: Phrasebook = phrasebook('@loomcli/core', {
 *   failures: { genericDefect: 'Etwas ist schiefgelaufen.' },
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrasebooks
 * @public
 * @sealed
 */
class Phrasebook {
  /** The package whose sentences the phrasebook holds. */
  readonly package: MessagePackage;
  readonly #sentences: object;

  static {
    makePhrasebook = (packageName, sentences) => new Phrasebook(packageName, sentences);
    sentencesOf = (book) => book.#sentences;
  }

  private constructor(packageName: MessagePackage, sentences: object) {
    this.package = packageName;
    this.#sentences = sentences;
    Object.freeze(this);
  }
}

/**
 * Makes one package's phrasebook in one language, checked against the package's message modules:
 * a misspelled package, module, or sentence, a parameter of the wrong type, or a function where the
 * export is a constant fails to compile. Every entry is optional; a sentence it leaves out renders
 * in English.
 *
 * @example
 * ```ts
 * import { escapeControlCharacters, phrasebook } from '@loomcli/core';
 *
 * export const coreDe = phrasebook('@loomcli/core', {
 *   failures: {
 *     genericDefect: 'Etwas ist schiefgelaufen.',
 *     unknownOption: (spelling) => `Unbekannte Option „${escapeControlCharacters(spelling)}“.`,
 *   },
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrasebooks
 * @public
 */
function phrasebook<Package extends MessagePackage>(
  packageName: Package,
  sentences: PhrasebookSentences<Package>,
): Phrasebook {
  return makePhrasebook(packageName, sentences);
}

/**
 * The entry a phrasebook holds for one sentence, or `undefined` when it holds none. An entry the
 * author's code left `undefined` is no entry.
 */
function phrasebookEntry(book: Phrasebook, module: string, name: string): unknown {
  const entries: unknown = Reflect.get(sentencesOf(book), module);
  return typeof entries === 'object' && entries !== null && Object.hasOwn(entries, name)
    ? Reflect.get(entries, name)
    : undefined;
}

/** A plugin's phrasebooks, by the language each list serves. */
type InstalledPhrasebooks = ReadonlyMap<string, readonly Phrasebook[]>;

/** A canonical language subtag: two or three lowercase ASCII letters `Intl` keeps as they are. */
function canonicalLanguage(key: string): string | undefined {
  if (!/^[a-z]{2,3}$/u.test(key)) {
    return undefined;
  }
  try {
    return Intl.getCanonicalLocales(key)[0];
  } catch {
    return undefined;
  }
}

/** The sentence of a key that names no canonical language, naming the canonical one where `Intl` has one. */
function languageSentence(subject: string, key: string): string {
  let canonical: string | undefined = undefined;
  try {
    canonical = Intl.getCanonicalLocales(key)[0];
  } catch {
    canonical = undefined;
  }
  const language = canonical?.split('-')[0];
  const suggestion =
    language !== undefined && language !== key && /^[a-z]{2,3}$/u.test(language)
      ? ` Write ${quoted(language)}.`
      : '';
  return `${subject} installs phrasebooks under ${quoted(key)}, which is not a canonical language subtag.${suggestion}`;
}

/**
 * One plugin's `phrasebooks` map, read where `plugin()` reads the definition: each key a canonical
 * language subtag, and each entry a phrasebook this copy of core made.
 */
function readPhrasebooks(site: FactSite, declared: unknown): InstalledPhrasebooks {
  const installed = new Map<string, readonly Phrasebook[]>();
  if (typeof declared !== 'object' || declared === null) {
    return installed;
  }
  for (const key of Object.keys(declared)) {
    const list: unknown = Reflect.get(declared, key);
    if (canonicalLanguage(key) !== key) {
      throw new DeclarationError(phrasebookLanguage, {
        correction:
          'Key each list by a language subtag of two or three lowercase letters, such as "de" or "fil".',
        findings: [partFinding(site, [key])],
        sentence: languageSentence(site.subject, key),
      });
    }
    const books: readonly unknown[] = Array.isArray(list) ? [...list] : [];
    installed.set(
      key,
      Object.freeze(
        books.map((book, index) => {
          if (!(book instanceof Phrasebook)) {
            throw new DeclarationError(foreignValue, {
              correction: foreignValueCorrection,
              findings: [partFinding(site, [key, index])],
              sentence: `${site.subject} installs a phrasebook another installed copy of @loomcli/core built.`,
            });
          }
          return book;
        }),
      ),
    );
  }
  return installed;
}

export type { InstalledPhrasebooks, PhrasebookSentences };
export { Phrasebook, phrasebook, phrasebookEntry, readPhrasebooks };
