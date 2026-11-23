import type { BuiltGraph } from '../commands/build.js';
import { UsageError } from '../failures/errors.js';
import {
  argumentSlot,
  isOptionWord,
  noWords,
  readOptionWord,
  readWords,
  refusesValue,
  typedWords,
} from '../invocation/parse.js';
import type { AwaitingValue, WordsRead } from '../invocation/parse.js';
import type { ArgumentNode, CommandGraph, CommandNode, OptionNode } from './inspect.js';
import { graphMismatch, linkOf } from './inspect.js';

/**
 * The words the earlier words of an unfinished invocation gave each option and each argument, by
 * the input's name, exactly as the parser read them and before any validation. An option's words
 * are every word of every occurrence in the order read, a global option's included, and an arity
 * option's words of all occurrences are one flat list, ending with the words an occurrence the line
 * left open has received so far. A parent's own option that routing still holds unbound is listed
 * under the name the reached Command's own entry gives its spelling. A bare spelling's implied value
 * was never typed, so it adds none. A Boolean and a counted option take no word, so they have no
 * entry, and neither has an input the earlier words gave nothing. An argument's words are its one
 * word, or a variadic argument's every word so far.
 *
 * @public
 * @sealed
 */
interface TypedInputs {
  /** Each argument's words, by its declared name. */
  readonly arguments: ReadonlyMap<string, readonly string[]>;
  /** Each option's words, by its declared name, a global option's included. */
  readonly options: ReadonlyMap<string, readonly string[]>;
}

/**
 * Where the last word of an unfinished invocation sits. Every node is the given graph's own, so a
 * reader compares by identity. `prefix` is the part of the word being completed.
 *
 * @public
 * @sealed
 */
type WordPosition =
  | {
      readonly kind: 'command';
      readonly command: CommandNode;
      /**
       * The argument the word fills when it names no child: the routed Command's first argument
       * when it declares one, and `null` otherwise.
       */
      readonly argument: ArgumentNode | null;
      readonly prefix: string;
      /** What the earlier words gave each input. */
      readonly typed: TypedInputs;
    }
  | {
      readonly kind: 'option';
      readonly command: CommandNode;
      readonly prefix: string;
      readonly supplied: readonly string[];
      readonly counts: ReadonlyMap<string, number>;
      /** The value the earlier words gave each Boolean option, so a reader sees which gave false. */
      readonly booleans: ReadonlyMap<string, boolean>;
      readonly typed: TypedInputs;
    }
  | {
      readonly kind: 'value';
      readonly command: CommandNode;
      readonly option: OptionNode;
      readonly lead: string;
      readonly prefix: string;
      /** What the earlier words gave each input. */
      readonly typed: TypedInputs;
    }
  | {
      readonly kind: 'argument';
      readonly command: CommandNode;
      readonly argument: ArgumentNode;
      readonly prefix: string;
      /** What the earlier words gave each input. */
      readonly typed: TypedInputs;
    }
  | {
      readonly kind: 'passthrough';
      readonly command: CommandNode;
      readonly prefix: string;
      readonly typed: TypedInputs;
    }
  | { readonly kind: 'none' };

const none: WordPosition = Object.freeze({ kind: 'none' });

/** What the last word is read against: the inspected graph, its routed node, and the earlier words. */
interface Scope {
  command: CommandNode;
  earlier: WordsRead;
  graph: CommandGraph;
  typed: TypedInputs;
}

/**
 * The words before the last, as the parser reads them, stopped before any validation. Every
 * structural fault among them, an unknown Command included, reads as no position. When they run
 * out at a Command with children, the last word may still continue routing, whatever it holds, so
 * routing has not ended and a parent's own option among them stays unbound.
 */
function readEarlier(graph: BuiltGraph, words: readonly string[]): WordsRead | undefined {
  try {
    const read = readWords(graph, words.slice(0, -1), { partial: true });
    return read.fault === undefined ? read : undefined;
  } catch (error) {
    if (error instanceof UsageError) {
      return undefined;
    }
    throw error;
  }
}

/** The value position of one option in scope: a global, or the routed Command's own. */
function valueOf(scope: Scope, name: string, word: { lead: string; prefix: string }): WordPosition {
  const { command, graph, typed } = scope;
  const option: OptionNode | undefined =
    graph.globals.find((entry) => entry.name === name) ??
    command.options.find((entry) => entry.name === name);
  if (!option) {
    throw graphMismatch(`Option "${name}" is not in the inspected graph.`);
  }
  return { command, kind: 'value', lead: word.lead, option, prefix: word.prefix, typed };
}

/**
 * The word after a string option that ended the earlier words is that option's value, and so is
 * each word after an arity option's spelling until its count is met.
 */
function awaitedValue(scope: Scope, awaiting: AwaitingValue, last: string): WordPosition {
  return refusesValue(last) ? none : valueOf(scope, awaiting.name, { lead: '', prefix: last });
}

/**
 * A plain word names a child until routing ends, and fills the next positional after. Where it may
 * still name a child, a Command that declares arguments also offers its first as the word's other
 * reading.
 */
function plainWord(scope: Scope, last: string): WordPosition {
  const { command, earlier, typed } = scope;
  if (!earlier.delimited && !earlier.committed && earlier.command.children.size > 0) {
    return {
      argument: command.arguments[0] ?? null,
      command,
      kind: 'command',
      prefix: last,
      typed,
    };
  }
  const slot = argumentSlot(earlier.command.arguments, earlier.positionals.length);
  const argument = slot && command.arguments[earlier.command.arguments.indexOf(slot)];
  return argument ? { argument, command, kind: 'argument', prefix: last, typed } : none;
}

/**
 * A word the walk reads against the routed Command's table and the earlier words' values, as the
 * parser reads it: no position where the walk faults, a repeat of an earlier option included, the
 * value a long spelling carries after `=` or a short value letter carries after it, and otherwise
 * `undefined`, an option spelling.
 */
function carriedValue(scope: Scope, last: string): WordPosition | undefined {
  const { earlier } = scope;
  const context = { table: earlier.command.table, values: earlier.values };
  const { occurrences } = readOptionWord(context, last, noWords);
  for (const occurrence of occurrences) {
    if (occurrence.kind !== 'value' && occurrence.kind !== 'awaiting') {
      return none;
    }
    if (occurrence.kind === 'value' && occurrence.lead !== undefined) {
      const { lead, option } = occurrence;
      return valueOf(scope, option.name, { lead, prefix: last.slice(lead.length) });
    }
  }
  return undefined;
}

/**
 * The option position of a last word: the names the earlier words supplied, how many times they
 * supplied each counted option, a global's and a bound own option's alike, and the value they gave
 * each Boolean option, a held-back own option's included.
 */
function optionPosition(scope: Scope, last: string): WordPosition {
  const { globals, locals } = scope.earlier.values;
  return {
    booleans: new Map([...globals.booleans, ...locals.booleans, ...scope.earlier.heldBooleans]),
    command: scope.command,
    counts: new Map([...globals.counts, ...locals.counts]),
    kind: 'option',
    prefix: last,
    supplied: scope.earlier.supplied,
    typed: scope.typed,
  };
}

/**
 * An option word. A long spelling without `=` is still being typed, so it is an option spelling
 * whatever it names; any other word is read by the walk.
 */
function optionWord(scope: Scope, last: string): WordPosition {
  const typing = last.startsWith('--') && !last.includes('=');
  return (typing ? undefined : carriedValue(scope, last)) ?? optionPosition(scope, last);
}

/** The last word, read as the parser would read the next word. */
function lastWord(scope: Scope, last: string): WordPosition {
  const { command, earlier, typed } = scope;
  if (earlier.delimited) {
    return command.passthrough
      ? { command, kind: 'passthrough', prefix: last, typed }
      : plainWord(scope, last);
  }
  if (earlier.awaiting) {
    return awaitedValue(scope, earlier.awaiting, last);
  }
  if (last === '-' || last === '--') {
    return optionPosition(scope, last);
  }
  return isOptionWord(last) ? optionWord(scope, last) : plainWord(scope, last);
}

/**
 * Reads an unfinished invocation against a graph `inspect()` returned and reports where its last
 * word sits. `words` holds the tokens after the application name; an empty list reads as one empty
 * word. It runs no validator, input source, or middleware, and a structural fault among the earlier
 * words reads as `none`.
 *
 * @example
 * ```ts
 * import { Application, locate } from '@loomcli/core';
 *
 * const graph = new Application('jsonkit').inspect();
 * const position = locate(graph, ['--ver']);
 * if (position.kind === 'option') {
 *   console.log(position.prefix);
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/graph-inspection.md#locating-a-word
 * @public
 */
function locate(graph: CommandGraph, words: readonly string[]): WordPosition {
  const link = linkOf(graph);
  const earlier = readEarlier(link.graph, words);
  if (!earlier) {
    return none;
  }
  const command = link.nodes.get(earlier.command);
  if (!command) {
    throw graphMismatch('The routed command is not in the inspected graph.');
  }
  return lastWord({ command, earlier, graph, typed: typedWords(earlier) }, words.at(-1) ?? '');
}

export type { TypedInputs, WordPosition };
export { locate };
