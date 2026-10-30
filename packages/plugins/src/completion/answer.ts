import type { CommandGraph, CommandNode, OptionNode, WordPosition } from '@loomcli/core';

import { closedSet } from '../closed-set.js';
import type { Schema } from '../closed-set.js';
import { singleLine } from '../lines.js';
import { addsOccurrence, noOccurrence, oneOccurrence } from '../occurrences.js';

/**
 * Cobra's directive numbers, of which the answer writes three: `0` leaves the shell its default,
 * file names included, `1` reports an error, and `4` turns file completion off.
 */
const shellDefault = 0;
const errorDirective = 1;
const filesOff = 4;

type Directive = typeof shellDefault | typeof errorDirective | typeof filesOff;

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

/** The canonical names of a Command's listed children. */
function childOffers(command: CommandNode): Offer[] {
  return command.children
    .filter((child) => isListed(child))
    .flatMap((child) =>
      child.name === null ? [] : [{ description: child.description, word: child.name }],
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
 * Boolean's negative spelling, and the short spelling when the word is exactly `-`. An option the
 * earlier words gave is left out unless another occurrence still adds anything.
 */
function optionOffers(
  graph: CommandGraph,
  position: Extract<WordPosition, { kind: 'option' }>,
): Offer[] {
  const scope = [...graph.globals, ...position.command.options];
  // A Boolean an earlier word gave as false claims no exclusive group, so it hides no sibling.
  const claimed = (name: string): boolean =>
    position.supplied.includes(name) && position.booleans.get(name) !== false;
  const excluded = new Set(
    position.command.optionGroups
      .filter((group) => group.kind === 'exclusive' && group.options.some(claimed))
      .flatMap((group) => group.options.filter((name) => !position.supplied.includes(name))),
  );
  return scope
    .filter((option) => isListed(option) && !excluded.has(option.name))
    .filter((option) => addsOccurrence(option, given(option, position)))
    .flatMap((option) => {
      const spellings = [
        option.long,
        ...(option.type === 'boolean' ? [option.negative] : []),
        ...(position.prefix === '-' ? [option.short] : []),
      ];
      return spellings.flatMap((word) =>
        word === null ? [] : [{ description: option.description, word }],
      );
    });
}

/** The values of an input's closed set as offered words, or the shell's default with none. */
function valueOffers(schema: Schema | null, lead: string, prefix: string): Offers {
  const values = closedSet(schema);
  if (values === undefined) {
    return { directive: shellDefault, offers: [] };
  }
  const offers = values
    .filter((value) => value !== '' && value.startsWith(prefix))
    .map((value) => ({ word: `${lead}${value}` }));
  return { directive: filesOff, offers };
}

/** What one position offers before the prefix filter and the exactness rule apply. */
function offersAt(graph: CommandGraph, position: WordPosition): Offers {
  switch (position.kind) {
    case 'command': {
      return { directive: filesOff, offers: childOffers(position.command) };
    }
    case 'option': {
      return { directive: filesOff, offers: optionOffers(graph, position) };
    }
    case 'value': {
      return valueOffers(position.option.schema, position.lead, position.prefix);
    }
    case 'argument': {
      return valueOffers(position.argument.schema, '', position.prefix);
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
 * that start with the typed prefix are offered.
 */
function answer(graph: CommandGraph, position: WordPosition): string {
  const { directive, offers } = offersAt(graph, position);
  const prefix = typedPrefix(position);
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
