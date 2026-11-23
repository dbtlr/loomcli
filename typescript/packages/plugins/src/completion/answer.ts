import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode, WordPosition } from '@loomcli/core';

import { aliasSpellings } from '../aliases.js';
import { closedSet } from '../closed-set.js';
import { singleLine } from '../lines.js';
import { addsOccurrence, noOccurrence, oneOccurrence } from '../occurrences.js';
import { completionArgument, completionInput } from './extension.js';
import type { CompletionValueFacts } from './extension.js';
import type { NamedAnswer } from './named.js';

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

/** What an answer reads besides the position: the values its input's completer offered. */
interface Reading {
  readonly named: NamedAnswer | undefined;
}

/** One offered word and the display text shown beside it, if any. */
interface Offer {
  readonly word: string;
  readonly description?: string | undefined;
}

/**
 * The offered words of one position and the directive the answer ends with, and the lead of a value
 * attached to its option when the answer writes it as its first word.
 */
interface Offers {
  readonly offers: readonly Offer[];
  readonly directive: Directive;
  readonly lead?: string;
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

const noChildren = 0;

/** The Command a word names among a Command's children, by canonical name or any alias. */
function childNamed(command: CommandNode, word: string): CommandNode | undefined {
  return command.children.find(({ aliases, name }) => name === word || aliases.includes(word));
}

/**
 * The listed children of the Command a `commands` hint has reached: the words the argument holds so
 * far, as the parser read them into `typed`, name a path from the root, and an unknown word reaches
 * nothing. Hidden and deprecated Commands route, as `help` routes them, and are not offered.
 */
function reachedOffers(
  graph: CommandGraph,
  { held, prefix }: { held: readonly string[]; prefix: string },
): Offer[] {
  let reached: CommandNode | undefined = graph.root;
  for (const word of held) {
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
function hintOffers(
  hint: CompletionValueFacts | undefined,
  sources: { readonly commands: () => Offer[]; readonly named: () => Offers },
): Offers {
  if (hint === undefined || hint.files === true) {
    return { directive: shellDefault, offers: [] };
  }
  if (hint.values !== undefined) {
    return sources.named();
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
  return { directive: filesOff, offers: hint.commands === true ? sources.commands() : [] };
}

/**
 * What an input offers: the values of its closed set when its schema names one, which wins over
 * any hint, and otherwise what its hint offers.
 */
function valueOffers(
  position: Extract<WordPosition, { kind: 'argument' | 'command' | 'value' }>,
  graph: CommandGraph,
  reading: Reading,
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
  const hinted = hintOffers(hintOf(position), {
    commands: () =>
      position.kind === 'value' || position.argument === null
        ? []
        : reachedOffers(graph, {
            held: position.typed.arguments.get(position.argument.name) ?? [],
            prefix: position.prefix,
          }),
    named: () => namedOffers(lead, reading.named),
  });
  return leadsFiles(hinted.directive, { lead, prefix: position.prefix })
    ? { ...hinted, lead }
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
 * Whether the answer writes the lead of a value attached to its option as its first word, so the
 * script lists the file names for the rest of the word and inserts each behind the lead: under `8`
 * and `16` whenever there is a lead, and under `0` only when some of the value follows it. Under
 * `0` no other word starts with `-`, because a Command name never does. A script from before the
 * lead under `0` offers every word that starts with the typed word, so a lead that is the whole
 * word would be inserted as a value; one shorter than the word is never offered.
 */
function leadsFiles(
  directive: Directive,
  { lead, prefix }: { readonly lead: string; readonly prefix: string },
): boolean {
  if (lead === '') {
    return false;
  }
  return filtersFiles(directive) || (directive === shellDefault && prefix !== '');
}

/**
 * What the completer an input names offered, each word with the lead the typed word carries, as a
 * closed set's values have. An empty value is left out before the lead is added, as a closed set's
 * is, so the bare lead is never offered as a value. A completer that failed is an error, and one the
 * run never called offers nothing. A completer never asks for file names, so the directive turns
 * them off.
 */
function namedOffers(lead: string, named: NamedAnswer | undefined): Offers {
  if (named === undefined) {
    return { directive: filesOff, offers: [] };
  }
  if ('failed' in named) {
    return { directive: errorDirective, offers: [] };
  }
  return {
    directive: filesOff,
    offers: named.offers
      .filter(({ word }) => word !== '')
      .map(({ description, word }) => ({ description, word: `${lead}${word}` })),
  };
}

/**
 * The name of the completer the position's input names, when the input names one and its schema
 * names no closed set, which wins over any hint. The run calls that completer before it answers.
 */
function completerNameAt(position: WordPosition): string | undefined {
  if (position.kind !== 'argument' && position.kind !== 'command' && position.kind !== 'value') {
    return undefined;
  }
  const input = position.kind === 'value' ? position.option : position.argument;
  if (input === null || closedSet(input.schema) !== undefined) {
    return undefined;
  }
  return hintOf(position)?.values;
}

/**
 * The children's names, then what the position's other reading as the Command's first argument
 * offers. An argument that offers files leaves the shell its file names, which the directive says,
 * and one whose hint filters them does so only where no child's name starts with the prefix,
 * because a script that filters files lists no offered word. A completer that failed drops only its
 * own values where a child's name starts with the prefix, because every script discards an answer
 * that reports an error.
 */
function commandOffers(
  graph: CommandGraph,
  position: Extract<WordPosition, { kind: 'command' }>,
  reading: Reading,
): Offers {
  const children = childOffers(position.command, position.prefix);
  if (position.argument === null) {
    return { directive: filesOff, offers: children };
  }
  const values = valueOffers(position, graph, reading);
  const yields = filtersFiles(values.directive) || values.directive === errorDirective;
  if (yields && children.length !== noChildren) {
    return { directive: filesOff, offers: children };
  }
  return { directive: values.directive, offers: [...children, ...values.offers] };
}

/** What one position offers before the prefix filter and the exactness rule apply. */
function offersAt(graph: CommandGraph, position: WordPosition, reading: Reading): Offers {
  switch (position.kind) {
    case 'command': {
      return commandOffers(graph, position, reading);
    }
    case 'option': {
      return { directive: filesOff, offers: optionOffers(graph, position) };
    }
    case 'value':
    case 'argument': {
      return valueOffers(position, graph, reading);
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
 * The answer `__complete` writes for one located word, in Cobra's line protocol: the lead of an
 * attached value when the answer writes one, then one line per offered word in graph order with
 * repeats removed, then `:` and the directive. Only exact words that start with the typed prefix
 * are offered, except under directives `8` and `16`, whose words are the extensions the shell
 * filters file names by. `named` is what the completer the position's input names offered, which
 * the run called before it answered.
 */
function answerWith(graph: CommandGraph, position: WordPosition, reading: Reading): string {
  const { directive, lead = '', offers } = offersAt(graph, position, reading);
  const prefix = filtersFiles(directive) ? '' : typedPrefix(position);
  const seen = new Set<string>();
  const lines = offers.flatMap((offer) => {
    if (!offer.word.startsWith(prefix) || !isExact(offer.word) || seen.has(offer.word)) {
      return [];
    }
    seen.add(offer.word);
    return [line(offer)];
  });
  const first = lead === '' ? '' : line({ word: lead });
  return `${first}${lines.join('')}:${directive}\n`;
}

/** The answer for a position whose input names no completer. */
function answer(graph: CommandGraph, position: WordPosition): string {
  return answerWith(graph, position, { named: undefined });
}

export { answer, answerWith, completerNameAt };
