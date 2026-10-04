import type { ArgumentSlot, BuiltCommand, BuiltGraph } from './command.js';
import {
  MisplacedOptionError,
  MissingValueError,
  RepeatedOptionError,
  UnexpectedArgumentError,
  UnexpectedValueError,
  UnknownCommandError,
  UnknownOptionError,
} from './errors.js';
import type { LoomError } from './errors.js';
import { emptyValues, isSupplied } from './options.js';
import type { OptionValues, SpellingTable, TableSpelling } from './options.js';

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
 * the word before it.
 */
type Occurrence =
  | {
      kind: 'value';
      option: TableSpelling;
      spelling: string;
      value: string | boolean;
      lead?: string;
    }
  | { kind: 'unknown'; spelling: string }
  | { kind: 'misplaced'; spelling: string }
  | { kind: 'unexpected'; option: TableSpelling; spelling: string; value: string }
  | { kind: 'repeated'; option: TableSpelling; spelling: string }
  | { kind: 'missing'; option: TableSpelling; spelling: string }
  | { kind: 'awaiting'; option: TableSpelling; spelling: string };

/** What one option word holds, in order, and whether its last occurrence took the next word. */
interface WordReading {
  occurrences: readonly Occurrence[];
  takesNext: boolean;
}

/**
 * What one option word is read against: a table, and the values earlier words supplied, so an
 * option that does not collect and was supplied already is a repeat that ends the walk.
 */
interface WordContext {
  table: SpellingTable;
  values: { globals: OptionValues; locals: OptionValues };
}

/** Whether an option collects every occurrence: a multiple string option. */
function collects(option: TableSpelling): boolean {
  return option.type === 'string' && option.multiple;
}

/** Whether an occurrence of an option repeats one an earlier word supplied. */
function repeats(context: WordContext, option: TableSpelling): boolean {
  const values = option.global ? context.values.globals : context.values.locals;
  return !collects(option) && isSupplied(values, option.name);
}

/**
 * A repeated occurrence supplies nothing, and a string option still takes the value its form
 * names, so the words after it read as they would have.
 */
function repeated(option: TableSpelling, spelling: string, takesNext: boolean): WordReading {
  return { occurrences: [{ kind: 'repeated', option, spelling }], takesNext };
}

/** Whether a string option with no value in its own word takes the next word as its value. */
function takesSeparate(next: string | undefined): boolean {
  return next !== undefined && !refusesValue(next);
}

/**
 * A string option whose value is the next word: that word, unless the words ran out or it is a word
 * the grammar never consumes as a value.
 */
function separateValue(
  option: TableSpelling,
  spelling: string,
  next: string | undefined,
): WordReading {
  if (next === undefined) {
    return { occurrences: [{ kind: 'awaiting', option, spelling }], takesNext: false };
  }
  if (refusesValue(next)) {
    return { occurrences: [{ kind: 'missing', option, spelling }], takesNext: false };
  }
  return { occurrences: [{ kind: 'value', option, spelling, value: next }], takesNext: true };
}

/** A word that starts with `--`, split at its first `=` into the spelling and the value it carries. */
function readLong(context: WordContext, word: string, next: string | undefined): WordReading {
  const equals = word.indexOf('=');
  const spelling = equals === -1 ? word : word.slice(0, equals);
  const inline = equals === -1 ? undefined : word.slice(equals + 1);
  const option = context.table.get(spelling);
  if (!option) {
    return { occurrences: [{ kind: 'unknown', spelling }], takesNext: false };
  }
  if (repeats(context, option)) {
    const separate = option.type === 'string' && inline === undefined && takesSeparate(next);
    return repeated(option, spelling, separate);
  }
  return longValue({ inline, option, spelling }, next);
}

/**
 * The value a declared long spelling supplies: a Boolean's own value, which takes no `=`, or a
 * string option's value after `=` or in the next word.
 */
function longValue(
  long: { inline: string | undefined; option: TableSpelling; spelling: string },
  next: string | undefined,
): WordReading {
  const { inline, option, spelling } = long;
  if (inline === undefined) {
    return option.type === 'boolean'
      ? {
          occurrences: [{ kind: 'value', option, spelling, value: option.value }],
          takesNext: false,
        }
      : separateValue(option, spelling, next);
  }
  const occurrence: Occurrence =
    option.type === 'boolean'
      ? { kind: 'unexpected', option, spelling, value: inline }
      : { kind: 'value', lead: `${spelling}=`, option, spelling, value: inline };
  return { occurrences: [occurrence], takesNext: false };
}

/**
 * One short group being walked: its word, its letters by code point, the word after it, and the
 * options its earlier letters set, which a later letter repeats.
 */
interface Group {
  context: WordContext;
  letters: readonly string[];
  next: string | undefined;
  set: Set<string>;
  word: string;
}

/** What one letter of a group holds, and whether it ends the walk. */
interface LetterReading extends WordReading {
  ends: boolean;
}

/** A Boolean letter is set and the walk continues; a `=` after it is a value it cannot take. */
function booleanLetter(
  option: TableSpelling & { type: 'boolean' },
  spelling: string,
  rest: string,
): LetterReading {
  const occurrence: Occurrence = rest.startsWith('=')
    ? { kind: 'unexpected', option, spelling, value: rest.slice(1) }
    : { kind: 'value', option, spelling, value: option.value };
  return { ends: occurrence.kind !== 'value', occurrences: [occurrence], takesNext: false };
}

/**
 * A value letter ends the group: the rest of the word is its value, with one leading `=` stripped,
 * or the next word is its value when nothing remains.
 */
function valueLetter(
  group: Group,
  letter: { option: TableSpelling; spelling: string },
  rest: string,
): LetterReading {
  const { option, spelling } = letter;
  if (rest === '') {
    return { ends: true, ...separateValue(option, spelling, group.next) };
  }
  const value = rest.startsWith('=') ? rest.slice(1) : rest;
  const lead = group.word.slice(0, group.word.length - value.length);
  return {
    ends: true,
    occurrences: [{ kind: 'value', lead, option, spelling, value }],
    takesNext: false,
  };
}

/** The letter at one index of a group, read against the group's table. */
function readLetter(group: Group, index: number): LetterReading {
  const spelling = `-${group.letters[index] ?? ''}`;
  const option = group.context.table.get(spelling);
  const rest = group.letters.slice(index + 1).join('');
  if (!option) {
    return { ends: true, occurrences: [{ kind: 'unknown', spelling }], takesNext: false };
  }
  if (group.set.has(option.name) || repeats(group.context, option)) {
    const takesNext = option.type === 'string' && rest === '' && takesSeparate(group.next);
    return { ends: true, ...repeated(option, spelling, takesNext) };
  }
  group.set.add(option.name);
  return option.type === 'boolean'
    ? booleanLetter(option, spelling, rest)
    : valueLetter(group, { option, spelling }, rest);
}

/**
 * A short group under the `getopt` rule, one code point per letter. The walk stops at a value
 * letter or at the first letter that faults, a repeated one included, so the characters after it
 * are never read as letters.
 */
function readGroup(context: WordContext, word: string, next: string | undefined): WordReading {
  const letters = word.slice(1).match(/./gsu) ?? [];
  const group: Group = { context, letters, next, set: new Set(), word };
  const occurrences: Occurrence[] = [];
  for (const index of group.letters.keys()) {
    const letter = readLetter(group, index);
    occurrences.push(...letter.occurrences);
    if (letter.ends) {
      return { occurrences, takesNext: letter.takesNext };
    }
  }
  return { occurrences, takesNext: false };
}

/** One option word read against one table, with the word after it as its possible value. */
function readOptionWord(context: WordContext, word: string, next: string | undefined): WordReading {
  return word.startsWith('--') ? readLong(context, word, next) : readGroup(context, word, next);
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
 * An occurrence routing read against the own option of a Command that has an action and children,
 * with the fault that declaration found, if any. It binds to the Command routing finally reaches,
 * once routing ends.
 */
interface PendingOccurrence {
  at: number;
  occurrence: DeclaredOccurrence;
}

/** Whether an occurrence is of a Command's own option, which routing holds back until it ends. */
function isOwnOccurrence(occurrence: Occurrence): occurrence is DeclaredOccurrence {
  return 'option' in occurrence && occurrence.kind !== 'awaiting' && !occurrence.option.global;
}

/** A string option the last word left waiting for its value. */
interface AwaitingValue {
  global: boolean;
  name: string;
  spelling: string;
}

/**
 * The state one reading carries from word to word, through routing and the routed Command's words
 * alike. `read` counts every occurrence and positional read so far, and `at` is the order of the one
 * being applied. `supplied` holds each option name with the order in which it was first supplied.
 * `globalFault` says a global option faulted, whether or not that fault is the one held.
 */
interface ReadState {
  at: number;
  awaiting: AwaitingValue | undefined;
  command: BuiltCommand;
  fault: HeldFault | undefined;
  globalFault: boolean;
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
    : new UnknownOptionError(spelling);
}

/** Holds a fault unless an earlier word already holds one, and notes a fault on a global option. */
function hold(state: ReadState, error: LoomError, global: boolean): false {
  keep(state, { at: state.at, error });
  state.globalFault ||= global;
  return false;
}

/** Records one supplied value in the map its kind and its declaration decide. */
function write(values: OptionValues, option: TableSpelling, value: string | boolean): void {
  const { name } = option;
  const list = values.lists.get(name);
  if (typeof value === 'boolean') {
    values.booleans.set(name, value);
  } else if (!collects(option)) {
    values.strings.set(name, value);
  } else if (list) {
    list.push(value);
  } else {
    values.lists.set(name, [value]);
  }
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
 * Command's own entry gives its spelling, so a reader offers none of them again. A spelling that
 * Command does not hold lists nothing.
 */
function noteHeld(state: ReadState): void {
  for (const { at, occurrence } of state.pending) {
    const entry = state.command.table.get(occurrence.spelling);
    if (entry && !state.supplied.some(({ name }) => name === entry.name)) {
      note(state, { at, name: entry.name });
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
  // A collecting option records its last occurrence, because each one overwrites the entry.
  values.spellings.set(option.name, spelling);
  write(values, option, occurrence.value);
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
    state.awaiting = { global: option.global, name: option.name, spelling };
    return false;
  }
  return hold(state, optionFault(occurrence), option.global);
}

/** The failure a faulted occurrence of a declared option reports. */
function optionFault(
  occurrence: Occurrence & { kind: 'missing' | 'repeated' | 'unexpected' },
): LoomError {
  const { spelling } = occurrence;
  if (occurrence.kind === 'unexpected') {
    return new UnexpectedValueError(spelling, occurrence.value);
  }
  return occurrence.kind === 'repeated'
    ? new RepeatedOptionError(spelling)
    : new MissingValueError(spelling, 'attached');
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
 * table lacks, and a declaration of another value class is misplaced, because the parent's
 * declaration already decided whether the next word was the value, and the words are never read
 * again. A declaration of the same class keeps the fault the parent's declaration found, if any.
 */
function rebound(state: ReadState, pending: DeclaredOccurrence): Occurrence {
  const { spelling } = pending;
  const option = state.command.table.get(spelling);
  if (!option) {
    return { kind: 'unknown', spelling };
  }
  if (option.type !== pending.option.type) {
    return { kind: 'misplaced', spelling };
  }
  return pending.kind === 'value' ? boundValue(state, pending, option) : { ...pending, option };
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
  const value = option.type === 'boolean' ? option.value : pending.value;
  return { ...pending, option, value };
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
 * The slot the positional at one index fills: the slot at that index, else a variadic last slot,
 * which accepts every later positional, else none. Binding and `locate` read positions through it.
 */
function argumentSlot(slots: readonly ArgumentSlot[], position: number): ArgumentSlot | undefined {
  const last = slots.at(-1);
  return slots[position] ?? (last?.variadic ? last : undefined);
}

/**
 * Whether routing reads a Command's own options: it has an action and children. A Command with
 * children takes no arguments, so a plain word after its own option can only name a child, and its
 * own declaration says whether the next word is that option's value.
 */
function readsOwnOptions(command: BuiltCommand): boolean {
  return command.dispatch !== undefined && command.children.size > 0;
}

/** One reading of one word list: the graph it reads against, and who hears each routed name. */
interface Routing {
  graph: BuiltGraph;
  walked: ((path: readonly string[]) => void) | undefined;
  words: readonly string[];
}

/**
 * An option word under routing, read against the global options, and at a Command with an action
 * and children against its whole table, whose own options bind once routing ends. A walk that meets
 * a spelling those options do not declare ends routing at the Command reached, which reads the word
 * again against its own table. Answers how many words it read, and `0` where routing ends.
 */
function routeOption(routing: Routing, state: ReadState, index: number): number {
  const { graph, words } = routing;
  const { command } = state;
  const table = readsOwnOptions(command) ? command.table : graph.globals.table;
  const context = { table, values: state.values };
  const reading = readOptionWord(context, words[index] ?? '', words[index + 1]);
  if (reading.occurrences.some((occurrence) => occurrence.kind === 'unknown')) {
    return 0;
  }
  apply(state, reading);
  return reading.takesNext ? 2 : 1;
}

/**
 * A plain word under routing names a child or an alias and descends, and an unknown child is the
 * one fault raised here. Under a Command with no children it ends routing as that Command's first
 * argument. `walked` hears the path as each name routes, so an unknown Command leaves its caller
 * holding the partial path.
 */
function descend(routing: Routing, state: ReadState, word: string): number {
  const { command } = state;
  if (command.children.size === 0) {
    return 0;
  }
  const child = command.routes.get(word);
  if (!child) {
    throw new UnknownCommandError(word, candidatesOf(command));
  }
  // An alias routes like the canonical name, and the path it walks reports that name alone.
  state.command = child.command;
  state.path.push(child.name);
  routing.walked?.(Object.freeze([...state.path]));
  return 1;
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
 * Routing: the words before the first bare `--`, read from the root against the global options
 * alone. Answers the index of the first word it did not read.
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
function readCommandWord(state: ReadState, word: string, next: string | undefined): number {
  if (!isOptionWord(word)) {
    positional(state, word);
    return 0;
  }
  const reading = readOptionWord({ table: state.command.table, values: state.values }, word, next);
  apply(state, reading);
  return reading.takesNext ? 1 : 0;
}

/** The routed Command's words from where routing ended, up to the first bare `--`. */
function readCommandWords(
  routing: Routing,
  state: ReadState,
  start: number,
): { delimited: boolean; passthrough: string[] } {
  const { words } = routing;
  for (let index = start; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--') {
      return { delimited: true, passthrough: words.slice(index + 1) };
    }
    index += readCommandWord(state, word, words[index + 1]);
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
  fault: HeldFault | undefined;
  globalFault: boolean;
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
 * Command with an action and children it passes through, binds those own options to the Command
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
    fault: undefined,
    globalFault: false,
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

/** One complete invocation, read through routing and the routed Command's table. */
interface ParsedInvocation {
  command: BuiltCommand;
  /** The first structural fault in word order, which core holds to the dispatch boundary. */
  fault: LoomError | undefined;
  /** Whether a global option faulted, which leaves every middleware's `options` `null`. */
  globalFault: boolean;
  passthrough: string[];
  path: readonly string[];
  positionals: string[];
  values: { globals: OptionValues; locals: OptionValues };
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
  const missing = awaiting && { at: read.read, error: new MissingValueError(awaiting.spelling) };
  const fault = read.fault ?? missing;
  return {
    command,
    fault: fault && heldFailure(read, fault),
    globalFault: read.globalFault || awaiting?.global === true,
    passthrough,
    path,
    positionals,
    values,
  };
}

export type { AwaitingValue, ParsedInvocation, WordsRead };
export {
  argumentSlot,
  candidatesOf,
  isOptionWord,
  parseInvocation,
  readOptionWord,
  readWords,
  refusesValue,
};
