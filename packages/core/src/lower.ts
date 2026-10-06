import type { ArgumentSlot, BuiltCommand, BuiltGraph } from './command.js';
import { undeclaredArgument, UnknownCommandError, unknownOptionName } from './errors.js';
import type { LoomError } from './errors.js';
import { emptyValues } from './options.js';
import type { OptionValues, TableSpelling } from './options.js';
import { candidatesOf, write } from './parse.js';
import type { BoundArguments, Occurrence, ParsedInvocation } from './parse.js';
import type { InputDeclaration } from './validation.js';

/**
 * What an invocation by name names, read once where the call entered: the path from the root, the
 * values keyed by declared name in the caller's key order, and the passthrough tail. A key whose
 * value is `undefined` is left out, because it reads as an absent key.
 */
interface NamedCall {
  path: readonly string[];
  args: readonly (readonly [string, unknown])[];
  options: readonly (readonly [string, unknown])[];
  passthrough: readonly string[];
}

/** The issue each kind of input reports for a value no token spells, which says what it takes. */
const takes = {
  boolean: 'Use true or false.',
  count: 'Use a whole number of 0 or more.',
  implied: 'Use a string, a number, or true.',
  list: 'Use a string, a number, or a list of them.',
  listOrImplied: 'Use a string, a number, true, or a list of strings and numbers.',
  scalar: 'Use a string or a number.',
} as const;

/** The token one value gives: a string as it is, a finite number as `String` writes it, or none. */
function tokenOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

/** The tokens one value of a collecting input gives, one per element, or none when one cannot be. */
function tokensOf(value: unknown): string[] | undefined {
  const elements: readonly unknown[] = Array.isArray(value) ? value : [value];
  const tokens: string[] = [];
  for (const element of elements) {
    const token = tokenOf(element);
    if (token === undefined) {
      return undefined;
    }
    tokens.push(token);
  }
  return tokens;
}

/**
 * Routing by name: each element reads as a plain word reads during routing, a canonical name or an
 * alias descending and a hidden Command routing. An element no child holds is the unknown Command
 * routing raises, and so is one after a Command with no children, which offers no candidates
 * because a path names Commands alone. `walked` hears the path as each name routes.
 */
function routeByName(
  graph: BuiltGraph,
  path: readonly string[],
  walked: (path: readonly string[]) => void,
): { command: BuiltCommand; path: string[] } {
  let command = graph.root;
  const routed: string[] = [];
  for (const name of path) {
    const child = command.routes.get(name);
    if (!child) {
      throw new UnknownCommandError(name, command.children.size === 0 ? [] : candidatesOf(command));
    }
    command = child.command;
    routed.push(child.name);
    walked(Object.freeze([...routed]));
  }
  return { command, path: routed };
}

/** What one lowering collects: the values, the bound arguments, the unlowered inputs, the fault. */
interface Reading {
  args: Map<InputDeclaration, string | string[]>;
  command: BuiltCommand;
  fault: LoomError | undefined;
  graph: BuiltGraph;
  path: readonly string[];
  unlowered: Map<InputDeclaration, string>;
  values: { globals: OptionValues; locals: OptionValues };
}

/**
 * The entries of one declared option in the routed Command's table, its alias spellings left out,
 * and the spelling a problem names it by: its long form, else its negative or short form.
 */
function formsOf(
  command: BuiltCommand,
  name: string,
): { entries: TableSpelling[]; reported: string } | undefined {
  const forms = [...command.table].filter(
    ([, entry]) => entry.name === name && entry.role !== 'alias',
  );
  const role = (wanted: TableSpelling['role']) => forms.find(([, entry]) => entry.role === wanted);
  const [reported] = role('long') ?? role('negative') ?? role('short') ?? [];
  return reported === undefined
    ? undefined
    : { entries: forms.map(([, entry]) => entry), reported };
}

/** The declaration one table entry names, in the globals or among the routed Command's inputs. */
function declarationOf(read: Reading, entry: TableSpelling): InputDeclaration | undefined {
  const inputs = entry.global ? read.graph.globals.inputs : read.command.inputs;
  return inputs.find((input) => input.kind === 'option' && input.name === entry.name);
}

/** One occurrence a value lowers to: the table entry it reads as, and the value it supplies. */
type Lowered = Pick<Occurrence & { kind: 'value' }, 'implied' | 'option' | 'value'>;

/** What one value lowers to: the occurrences argv would give, or the issue that says what it takes. */
type Lowering<Occurrences> = { occurrences: Occurrences } | { issue: string };

/** The tokens of one scalar input's value: its one token, or none when no token spells it. */
function scalarTokens(value: unknown): string[] | undefined {
  const token = tokenOf(value);
  return token === undefined ? undefined : [token];
}

/** A Boolean lowers to the spelling that reads its value, or to absence where none reads it. */
function booleanOccurrences(
  entries: readonly TableSpelling[],
  value: unknown,
): Lowering<Lowered[]> {
  if (typeof value !== 'boolean') {
    return { issue: takes.boolean };
  }
  const reading = entries.find((entry) => entry.type === 'boolean' && entry.value === value);
  return { occurrences: reading ? [{ option: reading, value }] : [] };
}

/** A whole number of 0 or more is that many occurrences of a counted option, so 0 is absence. */
function countOccurrences(option: TableSpelling, value: unknown): Lowering<Lowered[]> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { issue: takes.count };
  }
  return { occurrences: value > 0 ? [{ option, value }] : [] };
}

/** The issue a string option reports for a value no token spells, by what the option takes. */
function stringIssue(option: TableSpelling & { type: 'string' }): string {
  const implied = option.valueClass === 'implied';
  if (option.multiple) {
    return implied ? takes.listOrImplied : takes.list;
  }
  return implied ? takes.implied : takes.scalar;
}

/**
 * A string option's value: one token, or one per element on a multiple option, and `true` on an
 * option with an implied value, which is the bare spelling that supplies it.
 */
function stringOccurrences(
  option: TableSpelling & { type: 'string' },
  value: unknown,
): Lowering<Lowered[]> {
  if (value === true && option.valueClass === 'implied') {
    return { occurrences: [{ implied: true, option, value: option.implied }] };
  }
  const tokens = option.multiple ? tokensOf(value) : scalarTokens(value);
  return tokens === undefined
    ? { issue: stringIssue(option) }
    : { occurrences: tokens.map((token) => ({ option, value: token })) };
}

/** One option's value lowered by the value class its table entries read words by. */
function optionOccurrences(entries: readonly TableSpelling[], value: unknown): Lowering<Lowered[]> {
  const [option] = entries;
  if (!option) {
    return { occurrences: [] };
  }
  switch (option.valueClass) {
    case 'boolean': {
      return booleanOccurrences(entries, value);
    }
    case 'count': {
      return countOccurrences(option, value);
    }
    case 'implied':
    case 'separate': {
      return stringOccurrences(option, value);
    }
    default: {
      const exhaustive: never = option;
      return exhaustive;
    }
  }
}

/** One argument's value bound to its slot by name: one token, or one per element on a variadic. */
function argumentTokens(slot: ArgumentSlot, value: unknown): Lowering<string | string[]> {
  if (!slot.variadic) {
    const token = tokenOf(value);
    return token === undefined ? { issue: takes.scalar } : { occurrences: token };
  }
  const tokens = tokensOf(value);
  return tokens === undefined ? { issue: takes.list } : { occurrences: tokens };
}

/** Records one occurrence a value lowered to, under the spelling a problem names its option by. */
function supplyOccurrence(read: Reading, occurrence: Lowered, spelling: string): void {
  const values = occurrence.option.global ? read.values.globals : read.values.locals;
  values.spellings.set(occurrence.option.name, spelling);
  write(values, { kind: 'value', spelling, ...occurrence });
}

/**
 * Records each occurrence one option's value lowered to, or the issue against its declaration when
 * no token spells the value.
 */
function supplyOption(
  read: Reading,
  forms: { entries: readonly TableSpelling[]; reported: string },
  value: unknown,
): void {
  const lowered = optionOccurrences(forms.entries, value);
  const [entry] = forms.entries;
  const input = entry && declarationOf(read, entry);
  if (!('issue' in lowered)) {
    for (const occurrence of lowered.occurrences) {
      supplyOccurrence(read, occurrence, forms.reported);
    }
  } else if (input) {
    read.unlowered.set(input, lowered.issue);
  }
}

/**
 * Binds one argument's value to its slot, an empty list binding nothing, or records the issue
 * against its declaration when no token spells the value.
 */
function supplyArgument(read: Reading, slot: ArgumentSlot, value: unknown): void {
  const lowered = argumentTokens(slot, value);
  if ('issue' in lowered) {
    read.unlowered.set(slot.input, lowered.issue);
  } else if (lowered.occurrences.length > 0) {
    read.args.set(slot.input, lowered.occurrences);
  }
}

/**
 * Each `options` key read against the routed Command's table by declared name. A key the table
 * does not hold is the unknown option, held as argv holds one, and the first held fault wins.
 */
function lowerOptions(read: Reading, entries: NamedCall['options']): void {
  for (const [name, value] of entries) {
    const forms = formsOf(read.command, name);
    if (forms === undefined) {
      read.fault ??= unknownOptionName(name);
    } else {
      supplyOption(read, forms, value);
    }
  }
}

/**
 * Each `args` key bound to the slot its name declares, so a value never shifts into another
 * argument's slot. A key the routed Command does not declare is the unexpected argument, which
 * names the key.
 */
function lowerArguments(read: Reading, entries: NamedCall['args']): void {
  const { command, path } = read;
  for (const [name, value] of entries) {
    const slot = command.arguments.find((candidate) => candidate.input.name === name);
    if (slot) {
      supplyArgument(read, slot, value);
    } else {
      read.fault ??= undeclaredArgument(path, command.arguments.length, name);
    }
  }
}

/**
 * An invocation by name read into the result the parser produces for argv words: routing by path,
 * then each value lowered to the tokens a command line would give, once, with no argv text built.
 * The first held fault is the first in the order `options` keys and then `args` keys arrive. Only
 * an unknown Command throws.
 */
function lowerInvocation(
  graph: BuiltGraph,
  call: NamedCall,
  walked: (path: readonly string[]) => void,
): ParsedInvocation {
  const { command, path } = routeByName(graph, call.path, walked);
  const read: Reading = {
    args: new Map(),
    command,
    fault: undefined,
    graph,
    path,
    unlowered: new Map(),
    values: { globals: emptyValues(), locals: emptyValues() },
  };
  lowerOptions(read, call.options);
  lowerArguments(read, call.args);
  const args: BoundArguments = read.args;
  return {
    args,
    command,
    fault: read.fault,
    globalFault: false,
    passthrough: [...call.passthrough],
    path,
    unlowered: read.unlowered,
    values: read.values,
  };
}

export type { NamedCall };
export { lowerInvocation };
