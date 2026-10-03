import type { BuiltGraph } from './command.js';
import { UsageError } from './errors.js';
import type { ArgumentNode, CommandGraph, CommandNode, OptionNode } from './inspect.js';
import { graphMismatch, linkOf } from './inspect.js';
import { argumentSlot, isOptionWord, readOptionWord, readWords, refusesValue } from './parse.js';
import type { AwaitingValue, WordsRead } from './parse.js';

/**
 * Where the last word of an unfinished invocation sits. Every node is the given graph's own, so a
 * reader compares by identity. `prefix` is the part of the word being completed.
 */
type WordPosition =
  | { readonly kind: 'command'; readonly command: CommandNode; readonly prefix: string }
  | {
      readonly kind: 'option';
      readonly command: CommandNode;
      readonly prefix: string;
      readonly supplied: readonly string[];
    }
  | {
      readonly kind: 'value';
      readonly command: CommandNode;
      readonly option: OptionNode;
      readonly lead: string;
      readonly prefix: string;
    }
  | {
      readonly kind: 'argument';
      readonly command: CommandNode;
      readonly argument: ArgumentNode;
      readonly prefix: string;
    }
  | { readonly kind: 'passthrough'; readonly command: CommandNode; readonly prefix: string }
  | { readonly kind: 'none' };

const none: WordPosition = Object.freeze({ kind: 'none' });

/** What the last word is read against: the inspected graph, its routed node, and the earlier words. */
interface Scope {
  command: CommandNode;
  earlier: WordsRead;
  graph: CommandGraph;
}

/**
 * The earlier words as the parser reads them, stopped before any validation. Every structural
 * fault among them, an unknown Command included, reads as no position.
 */
function readEarlier(graph: BuiltGraph, earlier: readonly string[]): WordsRead | undefined {
  try {
    const read = readWords(graph, earlier);
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
  const { command, graph } = scope;
  const option: OptionNode | undefined =
    graph.globals.find((entry) => entry.name === name) ??
    command.options.find((entry) => entry.name === name);
  if (!option) {
    throw graphMismatch(`Option "${name}" is not in the inspected graph.`);
  }
  return { command, kind: 'value', lead: word.lead, option, prefix: word.prefix };
}

/** The word after a string option that ended the earlier words is that option's value. */
function awaitedValue(scope: Scope, awaiting: AwaitingValue, last: string): WordPosition {
  return refusesValue(last) ? none : valueOf(scope, awaiting.name, { lead: '', prefix: last });
}

/** A plain word names a child until routing ends, and fills the next positional after. */
function plainWord(scope: Scope, last: string): WordPosition {
  const { command, earlier } = scope;
  if (!earlier.committed && earlier.command.children.size > 0) {
    return { command, kind: 'command', prefix: last };
  }
  const slot = argumentSlot(earlier.command.arguments, earlier.positionals.length);
  const argument = slot && command.arguments[earlier.command.arguments.indexOf(slot)];
  return argument ? { argument, command, kind: 'argument', prefix: last } : none;
}

/**
 * A word the walk reads against the routed Command's table, as the parser reads it: no position
 * where the walk faults, the value a long spelling carries after `=` or a short value letter
 * carries after it, and otherwise `undefined`, an option spelling.
 */
function carriedValue(scope: Scope, last: string): WordPosition | undefined {
  const { occurrences } = readOptionWord(scope.earlier.command.table, last, undefined);
  for (const occurrence of occurrences) {
    if (occurrence.kind === 'unknown' || occurrence.kind === 'unexpected') {
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
 * An option word. A long spelling without `=` is still being typed, so it is an option spelling
 * whatever it names; any other word is read by the walk.
 */
function optionWord(scope: Scope, last: string): WordPosition {
  const typing = last.startsWith('--') && !last.includes('=');
  return (
    (typing ? undefined : carriedValue(scope, last)) ?? {
      command: scope.command,
      kind: 'option',
      prefix: last,
      supplied: scope.earlier.supplied,
    }
  );
}

/** The last word, read as the parser would read the next word. */
function lastWord(scope: Scope, last: string): WordPosition {
  const { command, earlier } = scope;
  if (earlier.delimited) {
    return { command, kind: 'passthrough', prefix: last };
  }
  if (earlier.awaiting) {
    return awaitedValue(scope, earlier.awaiting, last);
  }
  if (last === '-' || last === '--') {
    return { command, kind: 'option', prefix: last, supplied: earlier.supplied };
  }
  return isOptionWord(last) ? optionWord(scope, last) : plainWord(scope, last);
}

/**
 * Reads an unfinished invocation against a graph `inspect()` returned and reports where its last
 * word sits. `words` holds the tokens after the application name; an empty list reads as one empty
 * word. It runs no validator, input source, or middleware, and a structural fault among the earlier
 * words reads as `none`.
 */
function locate(graph: CommandGraph, words: readonly string[]): WordPosition {
  const link = linkOf(graph);
  const earlier = readEarlier(link.graph, words.slice(0, -1));
  if (!earlier) {
    return none;
  }
  const command = link.nodes.get(earlier.command);
  if (!command) {
    throw graphMismatch('The routed command is not in the inspected graph.');
  }
  return lastWord({ command, earlier, graph }, words.at(-1) ?? '');
}

export type { WordPosition };
export { locate };
