/*
 * Phrases: one sentence of a message module said with its values, its English text computed on
 * first read. Making a phrase runs no export, so a log call nothing hears reads nothing from it.
 */
import type { MessagePackage, MessagePackages } from './registry.js';

/**
 * The names of a module's exports a phrasebook may hold: its constants and its functions that
 * return a string.
 *
 * @public
 */
type SentenceNames<Module> = {
  [Name in keyof Module]: Module[Name] extends string | ((...values: never[]) => string)
    ? Name
    : never;
}[keyof Module];

/**
 * The values one sentence takes: a function's parameters, and none for a constant.
 *
 * @public
 */
type SentenceValues<Sentence> = Sentence extends (...values: infer Values) => string ? Values : [];

/**
 * A phrasebook's entry for one sentence: a string for a constant, and a function of the same
 * values for a function.
 *
 * @public
 */
type SentenceEntry<Sentence> = Sentence extends string
  ? string
  : Sentence extends (...values: infer Values) => string
    ? (...values: Values) => string
    : never;

/**
 * A sentence's values as a maker takes them: a phrase may stand where the export takes a string.
 *
 * @public
 */
type PhraseTuple<Values extends readonly unknown[]> = {
  [Index in keyof Values]: string extends Values[Index] ? Values[Index] | Phrase : Values[Index];
};

/**
 * The values a maker takes for one sentence.
 *
 * @public
 */
type PhraseValues<Sentence> = Sentence extends (...values: infer Values) => string
  ? PhraseTuple<Values>
  : [];

/**
 * Makes the phrases of one message module: an export's name and its values, checked against the
 * export.
 *
 * @public
 */
type PhraseMaker<Module> = <Name extends SentenceNames<Module> & string>(
  name: Name,
  ...values: PhraseValues<Module[Name]>
) => Phrase;

/**
 * Binds one package's message modules to the phrases they say.
 *
 * @public
 * @sealed
 */
interface PhraseSource<Package extends MessagePackage> {
  /** Binds one message module by its key and its own exports, checked against the registry. */
  module<Key extends keyof MessagePackages[Package] & string>(
    key: Key,
    sentences: MessagePackages[Package][Key],
  ): PhraseMaker<MessagePackages[Package][Key]>;
}

/** What one phrase holds: where its sentence lives, its English export, and its values. */
interface PhraseParts {
  readonly package: string;
  readonly module: string;
  readonly name: string;
  /** The English export: a string constant, or a function of the values that returns one. */
  readonly sentence: unknown;
  readonly values: readonly unknown[];
}

/** Makes one phrase; only this module and `phrases()` reach the class's private constructor. */
let makePhrase: (parts: PhraseParts) => Phrase = () => {
  throw new TypeError('Phrase is not initialized.');
};

/** Reads one phrase's parts, which the class keeps private. */
let readParts: (phrase: Phrase) => PhraseParts = () => {
  throw new TypeError('Phrase is not initialized.');
};

/**
 * One sentence said with its values: its English text, computed on first read, and where a
 * phrasebook finds the sentence. Core renders a phrase in the run's language where it renders text
 * for a person, and its English text everywhere else.
 *
 * @example
 * ```ts
 * import { InputError, phrases } from '@loomcli/core';
 *
 * import * as notes from './notes/messages.js';
 *
 * const say = phrases('notes').module('notes', notes);
 *
 * throw new InputError(say('emptyTitle'), []);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrases
 * @public
 * @sealed
 */
class Phrase {
  readonly #parts: PhraseParts;
  #text: string | undefined = undefined;

  static {
    makePhrase = (parts) => new Phrase(parts);
    readParts = (phrase) => phrase.#parts;
  }

  private constructor(parts: PhraseParts) {
    this.#parts = parts;
    Object.freeze(this);
  }

  /** The English text, computed on first read: what the English export returns for these values. */
  get text(): string {
    this.#text ??= sentenceText(this.#parts.sentence, this.#parts.values.map(englishValue));
    return this.#text;
  }

  /** The English text, so a phrase inside JSON, such as a nested log field's value, writes English. */
  toJSON(): string {
    return this.text;
  }
}

/** Renders one phrase as text for a person. */
type Localize = (phrase: Phrase) => string;

/** A phrase's English text, which every machine-read surface, and every run without a phrasebook, says. */
const english: Localize = (phrase) => phrase.text;

/** One phrase's parts: where its sentence lives, its English export, and its values. */
function partsOf(phrase: Phrase): PhraseParts {
  return readParts(phrase);
}

/** One value as an English export receives it: a nested phrase's English text, or the value. */
function englishValue(value: unknown): unknown {
  return value instanceof Phrase ? value.text : value;
}

/**
 * The text one sentence says for its values: a constant as written, or a function called with
 * them. A function's answer is read as text, because a phrasebook entry is the author's code.
 */
function sentenceText(sentence: unknown, values: readonly unknown[]): string {
  if (typeof sentence !== 'function') {
    return String(sentence);
  }
  const said: unknown = Reflect.apply(sentence, undefined, values);
  return typeof said === 'string' ? said : String(said);
}

/** One export of a module, read by name, or `undefined` for a module that holds none. */
function exportOf(sentences: unknown, name: string): unknown {
  return typeof sentences === 'object' && sentences !== null
    ? Reflect.get(sentences, name)
    : undefined;
}

/**
 * The phrases one package says, bound module by module: the source's `module` binds one message
 * module by its key and its own exports, and returns a maker that checks each export's name and
 * values.
 *
 * @example
 * ```ts
 * import { phrases } from '@loomcli/core';
 *
 * import * as notes from './notes/messages.js';
 *
 * const say = phrases('notes').module('notes', notes);
 * const saved = say('savedNote', 'groceries');
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrases
 * @public
 */
function phrases<Package extends MessagePackage>(packageName: Package): PhraseSource<Package> {
  return Object.freeze({
    module:
      <Key extends keyof MessagePackages[Package] & string>(
        key: Key,
        sentences: MessagePackages[Package][Key],
      ): PhraseMaker<MessagePackages[Package][Key]> =>
      (name: string, ...values: readonly unknown[]): Phrase =>
        makePhrase({
          module: key,
          name,
          package: packageName,
          sentence: exportOf(sentences, name),
          values: Object.freeze([...values]),
        }),
  });
}

/**
 * A copy of a phrase with the first of its values that is `from`, the same phrase or an equal
 * string, replaced by `to`, or `undefined` when no value is `from`. Neither is checked against the
 * values the phrase's export takes, so a hook that swaps the issue inside an input's line for its
 * own fix keeps core's subject and position.
 *
 * @example
 * ```ts
 * import { failureLines, issuePhrase, replaceValue } from '@loomcli/core';
 * import type { InputError, Phrase, StandardSchemaV1 } from '@loomcli/core';
 *
 * declare const failure: InputError;
 * declare const issue: StandardSchemaV1.Issue;
 * declare const fix: Phrase;
 *
 * const [line] = failureLines(failure) ?? [];
 * const fixed =
 *   line === undefined || typeof line === 'string'
 *     ? undefined
 *     : replaceValue(line, issuePhrase(issue) ?? issue.message, fix);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrases
 * @public
 */
function replaceValue(
  phrase: Phrase,
  from: string | Phrase,
  to: string | Phrase,
): Phrase | undefined {
  const parts = partsOf(phrase);
  const index = parts.values.indexOf(from);
  if (index === -1) {
    return undefined;
  }
  return makePhrase({
    ...parts,
    values: Object.freeze(parts.values.map((value, at) => (at === index ? to : value))),
  });
}

export type {
  Localize,
  PhraseMaker,
  PhraseParts,
  PhraseSource,
  PhraseTuple,
  PhraseValues,
  SentenceEntry,
  SentenceNames,
  SentenceValues,
};
export { english, Phrase, partsOf, phrases, replaceValue, sentenceText };
