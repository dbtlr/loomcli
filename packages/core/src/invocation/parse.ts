import type { ArgumentSlot, BuiltCommand, BuiltGraph } from '../commands/command.js';
import {
  MisplacedOptionError,
  MissingValueError,
  RepeatedOptionError,
  UnexpectedArgumentError,
  UnexpectedValueError,
  UnknownCommandError,
  UnknownOptionError,
  unknownOptionBeforeArguments,
} from '../failures/errors.js';
import type { LoomError } from '../failures/errors.js';
import { emptyValues, isSupplied } from '../inputs/options.js';
import type { OptionValues, SpellingTable, TableSpelling } from '../inputs/options.js';
import type { InputDeclaration } from '../inputs/validation.js';

/**
 * Whether a word is an option word: `--` and at least one more character, or `-` and an ASCII
 * letter. Every other word is a plain word, so `-`, `-5`, and `-.5` are values or arguments. The
 * parser and `locate` read each word through this rule.
 */
function isOptionWord(word: string): boolean {
  return word.startsWith('--') ? word.length > 2 : /^-[A-Za-z]/u.test(word);
}

/** A word the grammar never consumes as a separate value: an option word or the bare `--`. */
function refusesValue(word: string): boolean {
  return word === '--' || isOptionWord(word);
}

/**
 * One occurrence an option word holds, read against one table before it touches a value. `lead`
 * marks a value the word itself carries, after `=` or a short value letter, and holds the part of
 * the word before it. `received` counts the words an arity option's occurrence took before it
 * ended short, and `refused` is the spelling of the option word that ended it.
 */
type Occurrence =
  | {
      kind: 'value';
      option: TableSpelling;
      spelling: string;
      /**
       * A string, an arity option's words, a Boolean's own value, or the `1` one occurrence of a
       * counted option adds.
       */
      value: string | string[] | boolean | number;
      lead?: string;
      /** A bare spelling of a string option with an implied value, which supplied that value. */
      implied?: true;
    }
  | { kind: 'unknown'; spelling: string }
  | { kind: 'misplaced'; spelling: string }
  | { kind: 'unexpected'; option: RefusingSpelling; spelling: string; value: string }
  | { kind: 'repeated'; option: TableSpelling; spelling: string }
  | {
      kind: 'missing';
      option: TableSpelling;
      spelling: string;
      received?: number;
      refused?: string;
    }
  | { kind: 'awaiting'; option: TableSpelling; spelling: string; received: number };

/**
 * A spelling that refuses a value in its own word: a Boolean or counted option, which takes none,
 * and an arity option, which takes its words separately.
 */
type RefusingSpelling = TableSpelling & ({ type: 'boolean' | 'count' } | { valueClass: 'arity' });

/** What one option word holds, in order, and how many later words its last occurrence took. */
interface WordReading {
  occurrences: readonly Occurrence[];
  taken: number;
}

/**
 * The words after the one being read, from `start` in `words`, which an occurrence may take as its
 * values. The reader indexes them in place, so reading one option word copies no word list.
 */
interface Following {
  start: number;
  words: readonly string[];
}

/** No words after the one being read, as for the last word `locate` reads. */
const noWords: Following = { start: 0, words: [] };

/** The word at one offset among the following words, or `undefined` past their end. */
function wordAt(following: Following, offset: number): string | undefined {
  return following.words[following.start + offset];
}

/**
 * What one option word is read against: a table, and the values earlier words supplied, so an
 * option that was supplied already is a repeat that ends the walk, unless a later occurrence is
 * never a repeat: a multiple option collects it, a counted option counts it, and a last-wins option
 * replaces its value.
 */
interface WordContext {
  table: SpellingTable;
  values: { globals: OptionValues; locals: OptionValues };
}

/** Whether an option collects every occurrence: a multiple string option. */
function collects(option: TableSpelling): boolean {
  return option.type === 'string' && option.multiple;
}

/**
 * Whether a later occurrence of an option is never a repeat: a multiple string option collects
 * each, a counted option counts each, and a last-wins option replaces its value with each.
 */
function recurs(option: TableSpelling): boolean {
  return (
    option.type === 'count' || (option.type === 'string' && (option.multiple || option.lastWins))
  );
}

/** Whether an occurrence of an option repeats one an earlier word supplied. */
function repeats(context: WordContext, option: TableSpelling): boolean {
  const values = option.global ? context.values.globals : context.values.locals;
  return !recurs(option) && isSupplied(values, option.name);
}

/**
 * What a spelling with nothing attached supplies, by its value class: a Boolean's own value, one
 * occurrence of a count, or a string option's implied value. A string option that takes the next
 * word has no value of its own, so it answers `undefined`.
 */
function bareValue(
  option: TableSpelling,
  spelling: string,
): (Occurrence & { kind: 'value' }) | undefined {
  switch (option.valueClass) {
    case 'arity': {
      return undefined;
    }
    case 'boolean': {
      return { kind: 'value', option, spelling, value: option.value };
    }
    case 'count': {
      return { kind: 'value', option, spelling, value: 1 };
    }
    case 'implied': {
      return { implied: true, kind: 'value', option, spelling, value: option.implied };
    }
    case 'separate': {
      return undefined;
    }
    default: {
      const exhaustive: never = option;
      return exhaustive;
    }
  }
}

/**
 * A repeated occurrence supplies nothing, and a string option still takes the words its form names,
 * so the words after it read as they would have.
 */
function repeated(option: TableSpelling, spelling: string, taken: number): WordReading {
  return { occurrences: [{ kind: 'repeated', option, spelling }], taken };
}

/**
 * How many later words a repeated occurrence takes: none when its own word carries a value, the
 * next word for a string option that takes one, and an arity option's words up to its count or the
 * first word that refuses a value.
 */
function repeatTaken(option: TableSpelling, attached: boolean, following: Following): number {
  if (attached) {
    return 0;
  }
  if (option.valueClass === 'arity') {
    return arityWords(option.arity, following).length;
  }
  const next = wordAt(following, 0);
  return option.valueClass === 'separate' && next !== undefined && !refusesValue(next) ? 1 : 0;
}

/**
 * The words one arity occurrence takes: the following words up to its count, ending early at a
 * word the grammar never reads as a value or at the end of the line.
 */
function arityWords(arity: number, following: Following): string[] {
  const words: string[] = [];
  for (
    let next = wordAt(following, 0);
    words.length < arity;
    next = wordAt(following, words.length)
  ) {
    if (next === undefined || refusesValue(next)) {
      break;
    }
    words.push(next);
  }
  return words;
}

/**
 * The spelling an option word is named by when it ends an arity occurrence short: the part of a
 * long word before its first `=`, and the first letter of a short group, as an unknown option is
 * named, so a value attached to it never prints.
 */
function refusedSpelling(word: string): string {
  if (word.startsWith('--')) {
    const equals = word.indexOf('=');
    return equals === -1 ? word : word.slice(0, equals);
  }
  return word.slice(0, 2);
}

/**
 * An arity option's occurrence: its count of following words. The end of the line before the count
 * leaves it awaiting the rest, and a word that refuses a value is the missing value, which names
 * that word's spelling unless it is the bare `--`. Either way it takes the words it read.
 */
function arityValue(
  option: TableSpelling & { valueClass: 'arity' },
  spelling: string,
  following: Following,
): WordReading {
  const words = arityWords(option.arity, following);
  const taken = words.length;
  if (taken === option.arity) {
    return { occurrences: [{ kind: 'value', option, spelling, value: words }], taken };
  }
  const ended = wordAt(following, taken);
  if (ended === undefined) {
    return { occurrences: [{ kind: 'awaiting', option, received: taken, spelling }], taken };
  }
  const missing: Occurrence =
    ended === '--'
      ? { kind: 'missing', option, received: taken, spelling }
      : { kind: 'missing', option, received: taken, refused: refusedSpelling(ended), spelling };
  return { occurrences: [missing], taken };
}

/**
 * A string option whose value is in the following words: an arity option's count of them, or the
 * next word, unless the words ran out or it is a word the grammar never consumes as a value.
 */
function separateValue(option: TableSpelling, spelling: string, following: Following): WordReading {
  if (option.valueClass === 'arity') {
    return arityValue(option, spelling, following);
  }
  const next = wordAt(following, 0);
  if (next === undefined) {
    return { occurrences: [{ kind: 'awaiting', option, received: 0, spelling }], taken: 0 };
  }
  if (refusesValue(next)) {
    return { occurrences: [{ kind: 'missing', option, spelling }], taken: 0 };
  }
  return { occurrences: [{ kind: 'value', option, spelling, value: next }], taken: 1 };
}

/** A word that starts with `--`, split at its first `=` into the spelling and the value it carries. */
function readLong(context: WordContext, word: string, following: Following): WordReading {
  const equals = word.indexOf('=');
  const spelling = equals === -1 ? word : word.slice(0, equals);
  const inline = equals === -1 ? undefined : word.slice(equals + 1);
  const option = context.table.get(spelling);
  if (!option) {
    return { occurrences: [{ kind: 'unknown', spelling }], taken: 0 };
  }
  if (repeats(context, option)) {
    return repeated(option, spelling, repeatTaken(option, inline !== undefined, following));
  }
  return longValue({ inline, option, spelling }, following);
}

/**
 * The value a declared long spelling supplies: a Boolean's own value or one occurrence of a count,
 * neither of which takes `=`, or a string option's value after `=`, which an arity option refuses,
 * else its implied value, else the following words.
 */
function longValue(
  long: { inline: string | undefined; option: TableSpelling; spelling: string },
  following: Following,
): WordReading {
  const { inline, option, spelling } = long;
  if (inline === undefined) {
    const bare = bareValue(option, spelling);
    return bare ? { occurrences: [bare], taken: 0 } : separateValue(option, spelling, following);
  }
  const occurrence: Occurrence =
    option.type === 'string' && option.valueClass !== 'arity'
      ? { kind: 'value', lead: `${spelling}=`, option, spelling, value: inline }
      : { kind: 'unexpected', option, spelling, value: inline };
  return { occurrences: [occurrence], taken: 0 };
}

/**
 * One short group being walked: its word, its letters by code point, the word after it, and the
 * options its earlier letters set, which a later letter repeats.
 */
interface Group {
  context: WordContext;
  following: Following;
  letters: readonly string[];
  set: Set<string>;
  word: string;
}

/** What one letter of a group holds, and whether it ends the walk. */
interface LetterReading extends WordReading {
  ends: boolean;
}

/**
 * A Boolean letter is set, and a counted letter adds one, and the walk continues; a `=` after
 * either is a value it cannot take.
 */
function valuelessLetter(
  option: TableSpelling & { type: 'boolean' | 'count' },
  spelling: string,
  rest: string,
): LetterReading {
  const occurrence: Occurrence = rest.startsWith('=')
    ? { kind: 'unexpected', option, spelling, value: rest.slice(1) }
    : { kind: 'value', option, spelling, value: option.type === 'boolean' ? option.value : 1 };
  return { ends: occurrence.kind !== 'value', occurrences: [occurrence], taken: 0 };
}

/**
 * A value letter ends the group: the rest of the word is its value, with one leading `=` stripped,
 * which an arity letter refuses. When nothing remains, a letter with an implied value supplies it,
 * and any other takes the following words as its value.
 */
function valueLetter(
  group: Group,
  letter: { option: TableSpelling; spelling: string },
  rest: string,
): LetterReading {
  const { option, spelling } = letter;
  if (rest === '') {
    const bare = bareValue(option, spelling);
    return bare
      ? { ends: true, occurrences: [bare], taken: 0 }
      : { ends: true, ...separateValue(option, spelling, group.following) };
  }
  const value = rest.startsWith('=') ? rest.slice(1) : rest;
  if (option.valueClass === 'arity') {
    return { ends: true, occurrences: [{ kind: 'unexpected', option, spelling, value }], taken: 0 };
  }
  const lead = group.word.slice(0, group.word.length - value.length);
  return {
    ends: true,
    occurrences: [{ kind: 'value', lead, option, spelling, value }],
    taken: 0,
  };
}

/**
 * Whether a letter repeats an option an earlier letter of its group or an earlier word supplied. A
 * counted letter adds another occurrence instead, and so would a multiple or last-wins option's.
 */
function repeatsInGroup(group: Group, option: TableSpelling): boolean {
  return (group.set.has(option.name) && !recurs(option)) || repeats(group.context, option);
}

/** The letter at one index of a group, read against the group's table. */
function readLetter(group: Group, index: number): LetterReading {
  const spelling = `-${group.letters[index] ?? ''}`;
  const option = group.context.table.get(spelling);
  const rest = group.letters.slice(index + 1).join('');
  if (!option) {
    return { ends: true, occurrences: [{ kind: 'unknown', spelling }], taken: 0 };
  }
  if (repeatsInGroup(group, option)) {
    return {
      ends: true,
      ...repeated(option, spelling, repeatTaken(option, rest !== '', group.following)),
    };
  }
  group.set.add(option.name);
  return option.type === 'string'
    ? valueLetter(group, { option, spelling }, rest)
    : valuelessLetter(option, spelling, rest);
}

/**
 * A short group under the `getopt` rule, one code point per letter. The walk stops at a value
 * letter or at the first letter that faults, a repeated one included, so the characters after it
 * are never read as letters.
 */
function readGroup(context: WordContext, word: string, following: Following): WordReading {
  const letters = word.slice(1).match(/./gsu) ?? [];
  const group: Group = { context, following, letters, set: new Set(), word };
  const occurrences: Occurrence[] = [];
  for (const index of group.letters.keys()) {
    const letter = readLetter(group, index);
    occurrences.push(...letter.occurrences);
    if (letter.ends) {
      return { occurrences, taken: letter.taken };
    }
  }
  return { occurrences, taken: 0 };
}

/** One option word read against one table, with the words after it as its possible values. */
function readOptionWord(context: WordContext, word: string, following: Following): WordReading {
  return word.startsWith('--')
    ? readLong(context, word, following)
    : readGroup(context, word, following);
}

/**
 * The first structural fault in word order: a failure, or the position of the first positional no
 * slot accepts, which becomes a failure once every later positional is known. `at` is the order in
 * which the faulted occurrence was read, so a fault found later than it was read still ranks by it.
 */
type HeldFault = ({ error: LoomError } | { extra: number }) & { at: number };

/** An occurrence of a declared option: a value, or a fault its declaration found. */
type DeclaredOccurrence = Occurrence & { kind: 'missing' | 'repeated' | 'unexpected' | 'value' };

/**
 * An occurrence routing read against the own option of a Command that has children, with the
 * fault that declaration found, if any. It binds to the Command routing finally reaches, once
 * routing ends.
 */
interface PendingOccurrence {
  at: number;
  occurrence: DeclaredOccurrence;
}

/** Whether an occurrence is of a Command's own option, which routing holds back until it ends. */
function isOwnOccurrence(occurrence: Occurrence): occurrence is DeclaredOccurrence {
  return 'option' in occurrence && occurrence.kind !== 'awaiting' && !occurrence.option.global;
}

/**
 * A string option the last word left waiting for its value, with an arity option's count and the
 * words it took before the line ended.
 */
interface AwaitingValue {
  arity: number | undefined;
  global: boolean;
  name: string;
  received: number;
  spelling: string;
}

/**
 * The state one reading carries from word to word, through routing and the routed Command's words
 * alike. `read` counts every occurrence and positional read so far, and `at` is the order of the one
 * being applied. `supplied` holds each option name with the order in which it was first supplied.
 * `globalFault` says a global option faulted, whether or not that fault is the one held, and
 * `faulted` names every option with an occurrence that faulted, held or not.
 */
interface ReadState {
  at: number;
  awaiting: AwaitingValue | undefined;
  command: BuiltCommand;
  /**
   * The word the operator typed to route into the Command reached, when the Command it left
   * declares arguments and no passthrough mode, so the word could have been that Command's argument.
   */
  escapable: string | undefined;
  fault: HeldFault | undefined;
  faulted: Set<string>;
  globalFault: boolean;
  /** The value each held-back Boolean option gives the reached Command's own entry, by its name. */
  heldBooleans: Map<string, boolean>;
  path: string[];
  pending: PendingOccurrence[];
  positionals: string[];
  read: number;
  /** Whether routing has ended, after which a Command's own option binds where it is read. */
  routed: boolean;
  supplied: { at: number; name: string }[];
  values: { globals: OptionValues; locals: OptionValues };
}

/** Stamps the next occurrence or positional with its order in the words. */
function stamp(state: ReadState): void {
  state.at = state.read;
  state.read += 1;
}

/** The unknown spelling's correction follows the routed Command's argument mode. */
function unknownOption(command: BuiltCommand, spelling: string): UnknownOptionError {
  return command.arguments.length > 0 && command.passthrough === undefined
    ? unknownOptionBeforeArguments(spelling)
    : new UnknownOptionError(spelling);
}

/** Holds a fault unless one read earlier is held already. */
function keep(state: ReadState, fault: HeldFault): void {
  if (state.fault === undefined || fault.at < state.fault.at) {
    state.fault = fault;
  }
}

/**
 * The visible Commands below one Command that declare a spelling, as paths from the root in
 * authoring order. A hidden or deprecated Command, and every Command below it, is left out, as a
 * listing leaves it out.
 */
function declarers(command: BuiltCommand, path: readonly string[], spelling: string): string[][] {
  const found: string[][] = [];
  for (const [name, child] of command.children) {
    const below = [...path, name];
    if (!child.hidden && child.deprecated === undefined) {
      if (child.table.has(spelling)) {
        found.push(below);
      }
      found.push(...declarers(child, below, spelling));
    }
  }
  return found;
}

/** The fault a spelling the routed Command's table does not hold reports. */
function unplaced(state: ReadState, spelling: string): LoomError {
  const commands = declarers(state.command, state.path, spelling);
  return commands.length > 0
    ? new MisplacedOptionError(spelling, commands)
    : unknownOption(state.command, spelling);
}

/** Holds a fault unless an earlier word already holds one, and notes a fault on a global option. */
function hold(state: ReadState, error: LoomError, global: boolean): false {
  keep(state, { at: state.at, error });
  state.globalFault ||= global;
  return false;
}

/**
 * Records one supplied value in the map its kind and its declaration decide: a count adds its
 * occurrence, and a bare spelling's implied value notes its position, so validation supplies the
 * prepared output there.
 */
function write(values: OptionValues, occurrence: Occurrence & { kind: 'value' }): void {
  const { option, value } = occurrence;
  const { name } = option;
  if (typeof value === 'boolean') {
    values.booleans.set(name, value);
  } else if (typeof value === 'number') {
    values.counts.set(name, (values.counts.get(name) ?? 0) + value);
  } else if (Array.isArray(value)) {
    writeTuple(values, option, value);
  } else {
    noteImplied(values, occurrence, writeString(values, option, value));
  }
}

/**
 * Notes the position a bare spelling's implied value took. A scalar's value replaces a last-wins
 * option's earlier one, so its note holds the last occurrence alone, and an explicit value clears it.
 */
function noteImplied(
  values: OptionValues,
  occurrence: Occurrence & { kind: 'value' },
  position: number,
): void {
  const { option } = occurrence;
  const earlier = collects(option) ? (values.implied.get(option.name) ?? []) : [];
  if (occurrence.implied) {
    values.implied.set(option.name, [...earlier, position]);
  } else if (earlier.length === 0) {
    values.implied.delete(option.name);
  }
}

/**
 * Records one arity occurrence's tuple: the one tuple a scalar holds, or the next of a multiple
 * option's list. The list belongs to this read, so a later occurrence appends to it, as
 * `writeString` appends a repeated word.
 */
function writeTuple(values: OptionValues, option: TableSpelling, words: readonly string[]): void {
  const tuples = collects(option) ? values.tuples.get(option.name) : undefined;
  if (tuples) {
    tuples.push([...words]);
  } else {
    values.tuples.set(option.name, [[...words]]);
  }
}

/**
 * Records one string value: the option's one value, or the next of a multiple option's list.
 * Answers the position the value took, `0` for a scalar and its index in the list otherwise.
 */
function writeString(values: OptionValues, option: TableSpelling, value: string): number {
  const { name } = option;
  if (!collects(option)) {
    values.strings.set(name, value);
    return 0;
  }
  const list = values.lists.get(name);
  if (list) {
    list.push(value);
    return list.length - 1;
  }
  values.lists.set(name, [value]);
  return 0;
}

/**
 * Lists one supplied option name at the order it was read in. A parent's own option binds after
 * routing, so it can join the list behind names read after it.
 */
function note(state: ReadState, entry: { at: number; name: string }): void {
  const later = state.supplied.findIndex(({ at }) => at > entry.at);
  state.supplied.splice(later === -1 ? state.supplied.length : later, 0, entry);
}

/**
 * Lists the held-back options while routing is still open, each under the name the reached
 * Command's own entry gives its spelling, so a reader offers none of them again, and notes the value
 * a Boolean spelling gives that entry. A spelling that Command does not hold lists nothing.
 */
function noteHeld(state: ReadState): void {
  for (const { at, occurrence } of state.pending) {
    const entry = state.command.table.get(occurrence.spelling);
    if (entry && !state.supplied.some(({ name }) => name === entry.name)) {
      note(state, { at, name: entry.name });
      if (
        occurrence.kind === 'value' &&
        entry.valueClass === 'boolean' &&
        occurrence.option.valueClass === 'boolean'
      ) {
        state.heldBooleans.set(entry.name, entry.value);
      }
    }
  }
}

/** Writes one value an occurrence supplied. The reading already ended its walk at a repeat. */
function supply(state: ReadState, occurrence: Occurrence & { kind: 'value' }): boolean {
  const { option, spelling } = occurrence;
  const values = option.global ? state.values.globals : state.values.locals;
  if (!values.spellings.has(option.name)) {
    note(state, { at: state.at, name: option.name });
  }
  // A multiple, counted, or last-wins option reaches here on every occurrence.
  // Each one overwrites the spelling entry, so it records the last occurrence.
  values.spellings.set(option.name, spelling);
  write(values, occurrence);
  return true;
}

/**
 * The failure a spelling reports where the routed Command reads it: one its table lacks, or one it
 * declares with another value class than the parent's declaration routing read it by.
 */
function spellingFault(
  state: ReadState,
  occurrence: Occurrence & { kind: 'misplaced' | 'unknown' },
): LoomError {
  const { spelling } = occurrence;
  return occurrence.kind === 'unknown'
    ? unplaced(state, spelling)
    : new MisplacedOptionError(spelling, [[...state.path]]);
}

/** Applies one occurrence, and answers whether the word's next occurrence is read. */
function applyOccurrence(state: ReadState, occurrence: Occurrence): boolean {
  if (occurrence.kind === 'value') {
    return supply(state, occurrence);
  }
  if (occurrence.kind === 'unknown' || occurrence.kind === 'misplaced') {
    return hold(state, spellingFault(state, occurrence), false);
  }
  const { option, spelling } = occurrence;
  if (occurrence.kind === 'awaiting') {
    state.awaiting = {
      arity: option.valueClass === 'arity' ? option.arity : undefined,
      global: option.global,
      name: option.name,
      received: occurrence.received,
      spelling,
    };
    return false;
  }
  state.faulted.add(option.name);
  return hold(state, optionFault(occurrence), option.global);
}

/** The failure a faulted occurrence of a declared option reports. */
function optionFault(
  occurrence: Occurrence & { kind: 'missing' | 'repeated' | 'unexpected' },
): LoomError {
  const { option, spelling } = occurrence;
  if (occurrence.kind === 'unexpected') {
    const kind = option.type === 'string' ? 'arity' : option.type;
    return new UnexpectedValueError(spelling, occurrence.value, kind);
  }
  if (occurrence.kind === 'repeated') {
    return new RepeatedOptionError(spelling);
  }
  if (option.valueClass !== 'arity') {
    return new MissingValueError(spelling, 'attached');
  }
  const { received = 0, refused } = occurrence;
  return new MissingValueError(spelling, 'separate', { arity: option.arity, received, refused });
}

/** Whether two declarations of one spelling read words alike: one value class, one arity count. */
function sameClass(left: TableSpelling, right: TableSpelling): boolean {
  return left.valueClass === 'arity' && right.valueClass === 'arity'
    ? left.arity === right.arity
    : left.valueClass === right.valueClass;
}

/** Applies a word's occurrences in order, up to the first that faults. A faulted one supplies nothing. */
function apply(state: ReadState, reading: WordReading): void {
  for (const occurrence of reading.occurrences) {
    stamp(state);
    const held = !state.routed && isOwnOccurrence(occurrence);
    if (held) {
      state.pending.push({ at: state.at, occurrence });
    }
    if (held ? occurrence.kind !== 'value' : !applyOccurrence(state, occurrence)) {
      return;
    }
  }
}

/**
 * The occurrence routing read against a parent's own option, bound to the routed Command's
 * declaration of the same spelling. A Command without it reports the spelling as it reports any its
 * table lacks, and a declaration of another value class, another arity count included, is
 * misplaced, because the parent's declaration already decided which words were the value, and the
 * words are never read again. A declaration of the same class keeps the fault the parent's
 * declaration found, if any.
 */
function rebound(state: ReadState, pending: DeclaredOccurrence): Occurrence {
  const { spelling } = pending;
  const option = state.command.table.get(spelling);
  if (!option) {
    return { kind: 'unknown', spelling };
  }
  if (!sameClass(option, pending.option)) {
    return { kind: 'misplaced', spelling };
  }
  return pending.kind === 'value'
    ? boundValue(state, pending, option)
    : boundFault(pending, option);
}

/**
 * A fault routing held back, bound to the routed Command's declaration of the same class, which
 * keeps it. A value attached to a spelling that refuses one reaches here only with a Boolean,
 * counted, or arity option, because a class mismatch is misplaced before this binds; the misplaced
 * branch exists only so the bound occurrence stays typed, and no invocation reaches it.
 */
function boundFault(
  pending: DeclaredOccurrence & { kind: 'missing' | 'repeated' | 'unexpected' },
  option: TableSpelling,
): Occurrence {
  if (pending.kind !== 'unexpected') {
    return { ...pending, option };
  }
  return option.type !== 'string' || option.valueClass === 'arity'
    ? { ...pending, option }
    : { kind: 'misplaced', spelling: pending.spelling };
}

/** A value routing held back, bound to the routed Command's declaration of the same class. */
function boundValue(
  state: ReadState,
  pending: Occurrence & { kind: 'value' },
  option: TableSpelling,
): Occurrence {
  const { spelling } = pending;
  if (repeats({ table: state.command.table, values: state.values }, option)) {
    return { kind: 'repeated', option, spelling };
  }
  // The bound declaration decides what a spelling with nothing attached supplies.
  // That is a Boolean's own value, one occurrence of a count, or its own implied value.
  // A value in the next word or attached is the word the parent's declaration read.
  const bare = pending.lead === undefined ? bareValue(option, spelling) : undefined;
  return { ...pending, option, value: bare?.value ?? pending.value };
}

/** Binds each occurrence routing read against a parent's own option to the Command it reached. */
function bindPending(state: ReadState): void {
  for (const { at, occurrence } of state.pending) {
    state.at = at;
    applyOccurrence(state, rebound(state, occurrence));
  }
  state.pending = [];
}

/**
 * The names a routing failure offers: the canonical names of the visible, current children, in
 * authoring order. A candidate list is a listing, so a hidden or a deprecated child is absent from
 * it, as completion leaves them out, and a parent whose children are all hidden or deprecated
 * offers none. A deprecated child typed in full still routes.
 */
function candidatesOf(command: BuiltCommand): string[] {
  return [...command.children]
    .filter(([, child]) => !child.hidden && child.deprecated === undefined)
    .map(([name]) => name);
}

/**
 * The slot at a word position, stopping at a variadic that accepts every later word.
 * Trailing arguments bind separately from the end; locate always offers the variadic.
 */
function argumentSlot(slots: readonly ArgumentSlot[], position: number): ArgumentSlot | undefined {
  const variadic = slots.findIndex((slot) => slot.variadic);
  return variadic !== -1 && position >= variadic ? slots[variadic] : slots[position];
}

/**
 * Whether routing reads a Command's own options: it has children, a group included. Its own
 * declaration says whether the next word is that option's value, so a plain word after the option
 * is its value, a child's name, or, on a Command that declares arguments, its first argument. An
 * option read here binds to the Command routing finally reaches.
 */
function readsOwnOptions(command: BuiltCommand): boolean {
  return command.children.size > 0;
}

/** One reading of one word list: the graph it reads against, and who hears each routed name. */
interface Routing {
  graph: BuiltGraph;
  walked: ((path: readonly string[]) => void) | undefined;
  words: readonly string[];
}

/**
 * An option word under routing, read against the global options, and at a Command with children
 * against its whole table, whose own options bind once routing ends. A walk that meets
 * a spelling those options do not declare ends routing at the Command reached, which reads the word
 * again against its own table. Answers how many words it read, and `0` where routing ends.
 */
function routeOption(routing: Routing, state: ReadState, index: number): number {
  const { graph, words } = routing;
  const { command } = state;
  const table = readsOwnOptions(command) ? command.table : graph.globals.table;
  const context = { table, values: state.values };
  const following = { start: index + 1, words };
  const reading = readOptionWord(context, words[index] ?? '', following);
  if (reading.occurrences.some((occurrence) => occurrence.kind === 'unknown')) {
    return 0;
  }
  apply(state, reading);
  return 1 + reading.taken;
}

/**
 * A plain word under routing that is exactly a child's name or alias descends, and an unknown child
 * is the one fault raised here. A plain word that names no child ends routing as the first argument
 * of a Command that declares arguments, and so does any plain word under a Command with no
 * children. `walked` hears the path as each name routes, so an unknown Command leaves its caller
 * holding the partial path.
 */
function descend(routing: Routing, state: ReadState, word: string): number {
  const { command } = state;
  const child = command.routes.get(word);
  if (!child) {
    return endAtWord(command, word);
  }
  // An alias routes like the canonical name, and the path it walks reports that name alone.
  state.escapable =
    command.arguments.length > 0 && command.passthrough === undefined ? word : undefined;
  state.command = child.command;
  state.path.push(child.name);
  routing.walked?.(Object.freeze([...state.path]));
  return 1;
}

/**
 * Where a plain word names no child, routing ends at it, unless the Command has children and
 * declares no argument for the word to fill: that is the unknown-command error.
 */
function endAtWord(command: BuiltCommand, word: string): number {
  if (command.children.size === 0 || command.arguments.length > 0) {
    return 0;
  }
  throw new UnknownCommandError(word, candidatesOf(command));
}

/** One word routing reads: how many words it took, or `0` where routing ends. */
function routeWord(routing: Routing, state: ReadState, index: number): number {
  const word = routing.words[index];
  if (word === undefined || word === '--') {
    return 0;
  }
  return isOptionWord(word) ? routeOption(routing, state, index) : descend(routing, state, word);
}

/**
 * Routing: the words before the first bare `--`, read from the root against the global options and
 * the own options of each Command with children it passes. Answers the index of the first word it
 * did not read.
 */
function route(routing: Routing, state: ReadState): number {
  let index = 0;
  for (
    let read = routeWord(routing, state, index);
    read > 0;
    read = routeWord(routing, state, index)
  ) {
    index += read;
  }
  return index;
}

/** One plain word after routing: the routed Command's next positional, even one that names a child. */
function positional(state: ReadState, word: string): void {
  stamp(state);
  state.positionals.push(word);
  const position = state.positionals.length - 1;
  if (!argumentSlot(state.command.arguments, position)) {
    keep(state, { at: state.at, extra: position });
  }
}

/** One word of the routed Command, read against its table. Answers how many later words it took. */
function readCommandWord(state: ReadState, word: string, following: Following): number {
  if (!isOptionWord(word)) {
    positional(state, word);
    return 0;
  }
  const context = { table: state.command.table, values: state.values };
  const reading = readOptionWord(context, word, following);
  apply(state, reading);
  return reading.taken;
}

/** Delimited words bypass option parsing; only a declared mode retains them as a tail. */
function readTail(state: ReadState, words: string[]): string[] {
  if (state.command.passthrough !== undefined) {
    return words;
  }
  for (const word of words) {
    positional(state, word);
  }
  return [];
}

/** The routed Command's words, with delimited words read according to its mode. */
function readCommandWords(
  routing: Routing,
  state: ReadState,
  start: number,
): { delimited: boolean; passthrough: string[] } {
  const { words } = routing;
  for (let index = start; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--') {
      return { delimited: true, passthrough: readTail(state, words.slice(index + 1)) };
    }
    index += readCommandWord(state, word, { start: index + 1, words });
  }
  return { delimited: false, passthrough: [] };
}

/** Every word the reading of one word list found, which may stop short of a complete invocation. */
interface WordsRead {
  awaiting: AwaitingValue | undefined;
  command: BuiltCommand;
  /** Whether the routed Command read a word, so no later plain word names a child. */
  committed: boolean;
  delimited: boolean;
  escapable: string | undefined;
  fault: HeldFault | undefined;
  faulted: ReadonlySet<string>;
  globalFault: boolean;
  /** The value each Boolean option routing still holds unbound gives the reached Command's entry. */
  heldBooleans: ReadonlyMap<string, boolean>;
  passthrough: string[];
  path: string[];
  positionals: string[];
  /** How many occurrences and positionals were read, the order a fault at the end ranks by. */
  read: number;
  supplied: readonly string[];
  values: { globals: OptionValues; locals: OptionValues };
}

/**
 * How one word list is read: who hears each routed name, and whether the list is the earlier words
 * of an unfinished invocation, as `locate` reads them. A word after such a list may continue
 * routing, so routing has not ended where the list runs out at a Command with children, and a
 * parent's own option stays unbound.
 */
interface ReadOptions {
  partial?: boolean;
  walked?: (path: readonly string[]) => void;
}

/**
 * Whether routing ended where the words did: they stopped it, the list is complete, no later word
 * can continue routing, or a parent's own option already faulted, which binding reports wherever
 * routing ends.
 */
function routingEnded(
  state: ReadState,
  start: number,
  read: { partial: boolean | undefined; words: readonly string[] },
): boolean {
  return (
    start < read.words.length ||
    read.partial !== true ||
    state.command.children.size === 0 ||
    state.pending.some(({ occurrence }) => occurrence.kind !== 'value')
  );
}

/**
 * Reads a word list through routing, against the global options and the own options of each
 * Command with children it passes through, binds those own options to the Command
 * routing reached once routing has ended, and then reads that Command's own words, up to the first
 * bare `--`, against the one table it holds.
 * Parsing continues past a fault, so every global option is found wherever it sits, and only the
 * first fault in word order is held. Only an unknown Command throws.
 */
function readWords(
  graph: BuiltGraph,
  words: readonly string[],
  options: ReadOptions = {},
): WordsRead {
  const { partial, walked } = options;
  const routing: Routing = { graph, walked, words };
  const state: ReadState = {
    at: 0,
    awaiting: undefined,
    command: graph.root,
    escapable: undefined,
    fault: undefined,
    faulted: new Set(),
    globalFault: false,
    heldBooleans: new Map(),
    path: [],
    pending: [],
    positionals: [],
    read: 0,
    routed: false,
    supplied: [],
    values: { globals: emptyValues(), locals: emptyValues() },
  };
  const start = route(routing, state);
  if (routingEnded(state, start, { partial, words })) {
    state.routed = true;
    bindPending(state);
  } else {
    noteHeld(state);
  }
  const tail = readCommandWords(routing, state, start);
  return {
    ...state,
    ...tail,
    committed: start < words.length && words[start] !== '--',
    supplied: state.supplied.map(({ name }) => name),
  };
}

/** The value each argument slot received, keyed by the declaration it fills. */
type BoundArguments = ReadonlyMap<InputDeclaration, string | string[]>;

/**
 * One complete invocation, read through routing and the routed Command's table, or lowered from
 * the values an invocation by name supplied.
 */
interface ParsedInvocation {
  /** What each argument slot received; an omitted argument binds nothing. */
  args: BoundArguments;
  command: BuiltCommand;
  /**
   * The word the operator typed to route into `command`, when it could also have been the parent's
   * argument. An invocation by name has no typed word, so it is `undefined` there.
   */
  escapable: string | undefined;
  /**
   * The declared names of the options an invocation by name excludes: the input-source stage reads
   * nothing for them. Argv words leave it empty.
   */
  excluded: ReadonlySet<string>;
  /** The first structural fault in word order, which core holds to the dispatch boundary. */
  fault: LoomError | undefined;
  /**
   * Every option, global or local, with an occurrence that faulted, whether or not its fault is the
   * one held. Such an option is absent from a middleware's `ownOptions`.
   */
  faulted: ReadonlySet<string>;
  /** Whether a global option faulted, which leaves every middleware's `options` `null`. */
  globalFault: boolean;
  passthrough: string[];
  path: readonly string[];
  /**
   * Each input an invocation by name gave a value no token spells, with the one issue that says
   * what the input takes. Validation reports each as a rejected value; argv words leave it empty.
   */
  unlowered: ReadonlyMap<InputDeclaration, string>;
  values: { globals: OptionValues; locals: OptionValues };
}

/** One positional word bound to its slot: a variadic slot collects it, any other holds it. */
function bindWord(
  values: Map<InputDeclaration, string | string[]>,
  slot: ArgumentSlot,
  word: string,
): void {
  const bound = values.get(slot.input);
  if (!slot.variadic) {
    values.set(slot.input, word);
  } else if (Array.isArray(bound)) {
    bound.push(word);
  } else {
    values.set(slot.input, [word]);
  }
}

/** Reserve required arguments after a variadic from the end before binding the prefix. */
function bindTrailingArguments(
  values: Map<InputDeclaration, string | string[]>,
  slots: readonly ArgumentSlot[],
  words: { positionals: readonly string[]; variadic: number },
): number {
  const { positionals, variadic } = words;
  let end = positionals.length;
  if (variadic === -1) {
    return end;
  }
  for (let index = slots.length - 1; index > variadic && end > 0; index -= 1) {
    const slot = slots[index];
    const word = positionals[--end];
    if (slot && word !== undefined) {
      bindWord(values, slot, word);
    }
  }
  return end;
}

/**
 * The words each positional slot received. Parsing already held the first positional no slot
 * accepts, so every positional here has a slot. An omitted required argument binds nothing and
 * reports as a missing input in the validation phase, so omission has one class whether the input
 * is an argument or an option. An empty variadic tail binds nothing, so validation reads it as
 * `[]` or reports the omission.
 */
function bindArguments(command: BuiltCommand, positionals: readonly string[]): BoundArguments {
  const values = new Map<InputDeclaration, string | string[]>();
  const slots = command.arguments;
  const variadic = slots.findIndex((slot) => slot.variadic);
  const end = bindTrailingArguments(values, slots, { positionals, variadic });
  for (let position = 0; position < end; position += 1) {
    const slot = argumentSlot(slots, position);
    const word = positionals[position];
    if (slot && word !== undefined) {
      bindWord(values, slot, word);
    }
  }
  return values;
}

/** The failure a held fault reports once every word is read. */
function heldFailure(read: WordsRead, fault: HeldFault): LoomError {
  return 'error' in fault
    ? fault.error
    : new UnexpectedArgumentError(
        read.path,
        read.command.arguments.length,
        read.positionals.slice(fault.extra),
      );
}

/** The missing value of a string option the end of the words left waiting, by its count. */
function awaitedFailure(awaiting: AwaitingValue): MissingValueError {
  const { arity, received, spelling } = awaiting;
  return arity === undefined
    ? new MissingValueError(spelling)
    : new MissingValueError(spelling, 'separate', { arity, received });
}

/**
 * Parses a complete invocation, where a string option still waiting for its value at the end of
 * the words is a missing value.
 */
function parseInvocation(
  graph: BuiltGraph,
  argv: readonly string[],
  walked: (path: readonly string[]) => void,
): ParsedInvocation {
  const read = readWords(graph, argv, { walked });
  const { awaiting, command, passthrough, path, positionals, values } = read;
  const missing = awaiting && { at: read.read, error: awaitedFailure(awaiting) };
  const fault = read.fault ?? missing;
  return {
    args: bindArguments(command, positionals),
    command,
    escapable: read.escapable,
    excluded: new Set(),
    fault: fault && heldFailure(read, fault),
    faulted: awaiting ? new Set([...read.faulted, awaiting.name]) : read.faulted,
    globalFault: read.globalFault || awaiting?.global === true,
    passthrough,
    path,
    unlowered: new Map(),
    values,
  };
}

export type { AwaitingValue, BoundArguments, Occurrence, ParsedInvocation, WordsRead };
export {
  argumentSlot,
  candidatesOf,
  isOptionWord,
  noWords,
  parseInvocation,
  readOptionWord,
  readWords,
  refusesValue,
  write,
};
