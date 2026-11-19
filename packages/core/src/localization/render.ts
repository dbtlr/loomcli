/*
 * Where a phrase renders in the run's language: the first gathered phrasebook of its package that
 * holds its sentence, else its English export, each nested phrase rendered first.
 */
import { localeLanguage } from '../host/locale.js';
import { partsOf, Phrase, sentenceText } from './phrase.js';
import type { Localize } from './phrase.js';
import { phrasebookEntry } from './phrasebook.js';
import type { InstalledPhrasebooks, Phrasebook } from './phrasebook.js';

/**
 * One phrase rendered through `books`: the first of its package's phrasebooks that holds its
 * sentence, else its English export, called with each nested phrase rendered the same way. With
 * no phrasebook it is the phrase's English text.
 */
function rendered(phrase: Phrase, books: readonly Phrasebook[]): string {
  if (books.length === 0) {
    return phrase.text;
  }
  const parts = partsOf(phrase);
  const values = parts.values.map((value) =>
    value instanceof Phrase ? rendered(value, books) : value,
  );
  for (const book of books) {
    if (book.package === parts.package) {
      const entry = phrasebookEntry(book, parts.module, parts.name);
      if (entry !== undefined) {
        return sentenceText(entry, values);
      }
    }
  }
  return sentenceText(parts.sentence, values);
}

/**
 * Every phrasebook the installed plugins hold for one locale's language, in installation order and
 * each plugin's own list order.
 */
function gathered(
  plugins: readonly { readonly phrasebooks: InstalledPhrasebooks }[],
  locale: string | undefined,
): readonly Phrasebook[] {
  const language = localeLanguage(locale ?? 'en');
  return plugins.flatMap(({ phrasebooks }) => phrasebooks.get(language) ?? []);
}

/** The phrasebooks of a run whose plugins are not yet known: none, so phrases render English. */
function noPhrasebooks(): readonly Phrasebook[] {
  return [];
}

/**
 * The run's own `localize`: it gathers the run's phrasebooks on the first phrase it renders, and
 * renders English until the plugins are known.
 */
function runLocalizer(): {
  readonly localize: Localize;
  readonly use: (books: () => readonly Phrasebook[]) => void;
} {
  let gather: () => readonly Phrasebook[] = noPhrasebooks;
  let books: readonly Phrasebook[] | undefined = undefined;
  return {
    localize: (phrase) => {
      books ??= gather();
      return rendered(phrase, books);
    },
    use: (next) => {
      gather = next;
      books = undefined;
    },
  };
}

export { gathered, rendered, runLocalizer };
