import { locate, readExtension } from '@loomcli/core';
import type {
  ArgumentNode,
  CommandGraph,
  CommandNode,
  OptionNode,
  WordPosition,
} from '@loomcli/core';

import { aliasSpellings } from '../aliases.js';
import { closedSet } from '../closed-set.js';
import { singleLine } from '../lines.js';
import { addsOccurrence, noOccurrence, oneOccurrence } from '../occurrences.js';
import { completionArgument, completionInput } from './extension.js';
import type { CompletionValueFacts } from './extension.js';

/**
 * Cobra's directive numbers, of which the answer writes five: `0` leaves the shell its default,
 * file names included, `1` reports an error, `4` turns file completion off, `8` filters file names
 * by the offered extensions, and `16` offers directories only.
 */
const shellDefault = 0;
const errorDirective = 1;
const filesOff = 4;
const filterExtensions = 8;
const directoriesOnly = 16;

type Directive =
  | typeof shellDefault
  | typeof errorDirective
  | typeof filesOff
  | typeof filterExtensions
  | typeof directoriesOnly;

/** One offered word and the display text shown beside it, if any. */
interface Offer {
  readonly word: string;
  readonly description?: string | undefined;
}

/** The offered words of one position and the directive the answer ends with. */
interface Offers {
  readonly offers: readonly Offer[];
  readonly directive: Directive;
}

/** Every control character and line separator: U+0000-U+001F, U+007F-U+009F, U+2028, U+2029. */
const control = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** Every such character in a text, for a replacement that visits each one. */
const controls = new RegExp(control.source, 'gu');

/** The marker Cobra's scripts read as help text rather than as a word. */
const activeHelpMarker = '_activeHelp_ ';

/**
 * Whether a shell inserts the word exactly as the graph holds it. A control character or line
 * separator would be cut or reinterpreted, a lone surrogate reaches the shell as U+FFFD, a word
 * starting with the ActiveHelp marker would print as help, and a word starting with `~` inserts
 * unescaped in Bash 3.2 and Fish and would expand when the line runs, so each is left out.
 */
function isExact(word: string): boolean {
  return (
    word !== '' &&
    !word.startsWith('~') &&
    !control.test(word) &&
    !/\p{Cs}/u.test(word) &&
    !word.startsWith(activeHelpMarker)
  );
}

/**
 * A description as display text: each line break read as a space, as help reads it, then every
 * control character removed.
 */
function displayText(description: string | undefined): string {
  return singleLine(description ?? '').replaceAll(controls, '');
}

/** Whether a member is offered: hidden and deprecated members route but are never listed. */
function isListed(member: { readonly hidden: boolean; readonly deprecated: string | undefined }) {
  return !member.hidden && member.deprecated === undefined;
}

/**
 * The words one listed member offers in its place: its own words when one starts with the prefix,
 * and otherwise each word of its visible aliases that does. A visible alias is offered only where
 * the canonical name does not match, so the menu never shows a name and its alias side by side.
 */
function inPlace(
  own: readonly string[],
  aliases: readonly string[],
  { description, prefix }: { readonly description: string | undefined; readonly prefix: string },
): Offer[] {
  const matching = own.some((word) => word.startsWith(prefix));
  return (matching ? own : aliases.filter((word) => word.startsWith(prefix))).map((word) => ({
    description,
    word,
  }));
}

/** The canonical names of a Command's listed children, or a child's visible alias in its place. */
function childOffers(command: CommandNode, prefix: string): Offer[] {
  return command.children
    .filter((child) => isListed(child))
    .flatMap((child) =>
      child.name === null
        ? []
        : inPlace([child.name], child.visibleAliases, { description: child.description, prefix }),
    );
}

/**
 * How many times the earlier words gave an option: a counted option's count, and for any other
 * option 1 when they supplied it, which is all a repeat is judged against.
 */
function given(option: OptionNode, position: Extract<WordPosition, { kind: 'option' }>): number {
  if (option.type === 'count') {
    return position.counts.get(option.name) ?? noOccurrence;
  }
  return position.supplied.includes(option.name) ? oneOccurrence : noOccurrence;
}

/**
 * The spellings of the options in scope that the word may still name: each long spelling, a
 * Boolean's negative spelling, and the short spelling when the word is exactly `-`, or, for an
 * option none of whose own spellings starts with the prefix, each spelling of its visible aliases
 * that does. An option the earlier words gave is left out under every spelling unless another
 * occurrence still adds anything.
 */
function optionOffers(
  graph: CommandGraph,
  position: Extract<WordPosition, { kind: 'option' }>,
): Offer[] {
  const scope = [...graph.globals, ...position.command.options];
  // A Boolean an earlier word gave its absent value claims no exclusive group, so it hides no sibling.
  const absent = new Map(
    position.command.options.flatMap((option): [string, boolean][] =>
      option.type === 'boolean' ? [[option.name, option.polarity === 'negative']] : [],
    ),
  );
  const claimed = (name: string): boolean => {
    const value = position.booleans.get(name);
    return position.supplied.includes(name) && (value === undefined || value !== absent.get(name));
  };
  const excluded = new Set(
    position.command.optionGroups.flatMap((group) =>
      group.kind === 'exclusive' && group.options.some(claimed)
        ? group.options.filter((name) => !position.supplied.includes(name))
        : [],
    ),
  );
  return scope
    .filter((option) => isListed(option) && !excluded.has(option.name))
    .filter((option) => addsOccurrence(option, given(option, position)))
    .flatMap((option) => {
      const spellings = [
        option.long,
        ...(option.type === 'boolean' ? [option.negative] : []),
        ...(position.prefix === '-' ? [option.short] : []),
      ].filter((word) => word !== null);
      const aliases = option.visibleAliases.flatMap((alias) => aliasSpellings(option, alias));
      return inPlace(spellings, aliases, {
        description: option.description,
        prefix: position.prefix,
      });
    });
}

/** Slice bounds: from the first word, up to the word before the last, and one word further. */
const fromStart = 0;
const beforeLast = -1;
const nextWord = 1;
const noChildren = 0;

/** The Command a word names among a Command's children, by canonical name or any alias. */
function childNamed(command: CommandNode, word: string): CommandNode | undefined {
  return command.children.find(({ aliases, name }) => name === word || aliases.includes(word));
}

/**
 * The words the earlier part of the line gave one argument: each earlier word that, read as the
 * last word of the line up to it, fills that argument. An option and its value are other positions,
 * so they are not among them.
 */
function argumentWords(
  graph: CommandGraph,
  words: readonly string[],
  argument: ArgumentNode,
): string[] {
  return words.slice(fromStart, beforeLast).filter((_word, index) => {
    const at = locate(graph, words.slice(fromStart, index + nextWord));
    return (at.kind === 'argument' || at.kind === 'command') && at.argument === argument;
  });
}

/**
 * The listed children of the Command a `commands` hint has reached: the words the argument holds so
 * far name a path from the root, and an unknown word reaches nothing. Hidden and deprecated
 * Commands route, as `help` routes them, and are not offered.
 */
function reachedOffers(
  graph: CommandGraph,
  { argument, prefix, words }: { argument: ArgumentNode; prefix: string; words: readonly string[] },
): Offer[] {
  let reached: CommandNode | undefined = graph.root;
  for (const word of argumentWords(graph, words, argument)) {
    reached = childNamed(reached, word);
    if (reached === undefined) {
      return [];
    }
  }
  return childOffers(reached, prefix);
}

/** The hint an input's extension holds, if it carries one. */
function hintOf(position: WordPosition): CompletionValueFacts | undefined {
  if (position.kind === 'value') {
    return readExtension(position.option, completionInput);
  }
  if (position.kind === 'argument' || position.kind === 'command') {
    return position.argument === null
      ? undefined
      : readExtension(position.argument, completionArgument);
  }
  return undefined;
}

/**
 * What a hint offers where the input's schema names no closed set. A file name hint offers no word:
 * `files` leaves the shell its default, `directories` asks it for directories only, `none` turns
 * file completion off, and `extensions` offers the extensions themselves, which the shell reads as
 * the filter and not as words to insert.
 */
function hintOffers(hint: CompletionValueFacts | undefined, commands: () => Offer[]): Offers {
  if (hint === undefined || hint.files === true) {
    return { directive: shellDefault, offers: [] };
  }
  if (hint.extensions !== undefined) {
    return {
      directive: filterExtensions,
      offers: hint.extensions.map((word) => ({ word })),
    };
  }
  if (hint.directories === true) {
    return { directive: directoriesOnly, offers: [] };
  }
  return { directive: filesOff, offers: hint.commands === true ? commands() : [] };
}

/**
 * What an input offers: the values of its closed set when its schema names one, which wins over
 * any hint, and otherwise what its hint offers.
 */
function valueOffers(
  position: Extract<WordPosition, { kind: 'argument' | 'command' | 'value' }>,
  graph: CommandGraph,
  words: readonly string[],
): Offers {
  const lead = position.kind === 'value' ? position.lead : '';
  const input = position.kind === 'value' ? position.option : position.argument;
  const values = input === null ? undefined : closedSet(input.schema);
  if (values !== undefined) {
    const offers = values
      .filter((value) => value !== '' && value.startsWith(position.prefix))
      .map((value) => ({ word: `${lead}${value}` }));
    return { directive: filesOff, offers };
  }
  const hinted = hintOffers(hintOf(position), () =>
    position.kind === 'value' || position.argument === null
      ? []
      : reachedOffers(graph, { argument: position.argument, prefix: position.prefix, words }),
  );
  return filtersFiles(hinted.directive) && lead !== ''
    ? { directive: hinted.directive, offers: [{ word: lead }, ...hinted.offers] }
    : hinted;
}

/**
 * Whether a directive has the script list the file names itself: `8` by extension and `16`
 * directories only. Under either, a first word that starts with `-` is the lead of a value attached
 * to its option, such as `--config=`, `-c`, or `-vc`, which no extension starts with.
 */
function filtersFiles(directive: Directive): boolean {
  return directive === filterExtensions || directive === directoriesOnly;
}

/**
 * The children's names, then what the position's other reading as the Command's first argument
 * offers. An argument that offers files leaves the shell its file names, which the directive says,
 * and one whose hint filters them does so only where no child's name starts with the prefix,
 * because a script that filters files lists no offered word.
 */
function commandOffers(
  graph: CommandGraph,
  position: Extract<WordPosition, { kind: 'command' }>,
  words: readonly string[],
): Offers {
  const children = childOffers(position.command, position.prefix);
  if (position.argument === null) {
    return { directive: filesOff, offers: children };
  }
  const values = valueOffers(position, graph, words);
  if (filtersFiles(values.directive) && children.length !== noChildren) {
    return { directive: filesOff, offers: children };
  }
  return { directive: values.directive, offers: [...children, ...values.offers] };
}

/** What one position offers before the prefix filter and the exactness rule apply. */
function offersAt(graph: CommandGraph, position: WordPosition, words: readonly string[]): Offers {
  switch (position.kind) {
    case 'command': {
      return commandOffers(graph, position, words);
    }
    case 'option': {
      return { directive: filesOff, offers: optionOffers(graph, position) };
    }
    case 'value':
    case 'argument': {
      return valueOffers(position, graph, words);
    }
    case 'passthrough': {
      return { directive: shellDefault, offers: [] };
    }
    default: {
      // The word sits nowhere the grammar reads, so the answer reports an error.
      return { directive: errorDirective, offers: [] };
    }
  }
}

/** The part of the word being completed, which every offered word must start with. */
function typedPrefix(position: WordPosition): string {
  if (position.kind === 'none') {
    return '';
  }
  return position.kind === 'value' ? `${position.lead}${position.prefix}` : position.prefix;
}

/** One answer line: the word, then a tab and the description when display text is left. */
function line(offer: Offer): string {
  const text = displayText(offer.description);
  return text === '' ? `${offer.word}\n` : `${offer.word}\t${text}\n`;
}

/**
 * The answer `__complete` writes for one located word, in Cobra's line protocol: one line per
 * offered word in graph order with repeats removed, then `:` and the directive. Only exact words
 * that start with the typed prefix are offered, except under directives `8` and `16`, whose words
 * are the lead of an attached value and the extensions the shell filters file names by. `words` are the words the position was located from,
 * which a `commands` hint reads for the words its argument already holds.
 */
function answer(
  graph: CommandGraph,
  position: WordPosition,
  words: readonly string[] = [],
): string {
  const { directive, offers } = offersAt(graph, position, words);
  const prefix = filtersFiles(directive) ? '' : typedPrefix(position);
  const seen = new Set<string>();
  const lines = offers.flatMap((offer) => {
    if (!offer.word.startsWith(prefix) || !isExact(offer.word) || seen.has(offer.word)) {
      return [];
    }
    seen.add(offer.word);
    return [line(offer)];
  });
  return `${lines.join('')}:${directive}\n`;
}

export { answer };
