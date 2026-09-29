import type { BuiltCommand, BuiltGraph } from './command.js';
import { argumentSlot, readsAsChild, route } from './command.js';
import { UsageError } from './errors.js';
import type { ArgumentNode, CommandGraph, CommandNode, OptionNode } from './inspect.js';
import { graphMismatch, linkOf } from './inspect.js';
import type { AwaitingValue, GlobalScan, InputScan } from './options.js';
import { isOptionToken, longStringOption, longToken, scanGlobals, scanInputs } from './options.js';

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

/** The complete words as the parser reads them, stopped before any validation. */
interface EarlierWords {
  awaiting: AwaitingValue | undefined;
  command: BuiltCommand;
  /** Whether a token after the route reached the routed Command, so no bare word names a child. */
  committed: boolean;
  delimited: boolean;
  positionals: number;
  supplied: readonly string[];
}

/** What the last word is read against: both readings of the graph and the earlier words. */
interface Scope {
  built: BuiltGraph;
  command: CommandNode;
  earlier: EarlierWords;
  graph: CommandGraph;
}

/**
 * The option names the earlier words supplied, globals and locals merged into token order.
 * Routing consumed the first `offset` rest tokens, so local token `i` is rest token `i + offset`.
 */
function suppliedOrder(
  count: number,
  scans: { globals: GlobalScan; local: InputScan; offset: number },
): string[] {
  const { globals, local, offset } = scans;
  const byToken: string[][] = Array.from({ length: count }, () => []);
  for (const { name, token } of globals.supplied) {
    byToken[token]?.push(name);
  }
  for (const { name, token } of local.supplied) {
    byToken[globals.positions[token + offset] ?? count]?.push(name);
  }
  return byToken.flat();
}

/**
 * The parser's own pre-scan, routing, and local scan over the complete words. An earlier
 * positional that no slot accepts is the unexpected-argument fault, so it reads as no position.
 */
function readStructure(graph: BuiltGraph, earlier: readonly string[]): EarlierWords | undefined {
  const globals = scanGlobals(graph.globals.options, earlier);
  const routed = route(graph.root, globals.rest);
  const local = scanInputs(routed.command.options, routed.tokens);
  const positionals = local.positionals.length;
  if (positionals > 0 && !argumentSlot(routed.command.arguments, positionals - 1)) {
    return undefined;
  }
  return {
    awaiting: globals.awaiting ?? local.awaiting,
    command: routed.command,
    committed: routed.tokens.length > 0,
    delimited: local.delimited,
    positionals,
    supplied: suppliedOrder(earlier.length, { globals, local, offset: routed.path.length }),
  };
}

/** Every structural fault the grammar raises is a usage error, and it reads as no position. */
function readEarlier(graph: BuiltGraph, earlier: readonly string[]): EarlierWords | undefined {
  try {
    return readStructure(graph, earlier);
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

/** A long token with an inline value is that option's value when it names a string option. */
function inlineValue(scope: Scope, spelling: string, inline: string): WordPosition {
  const name =
    longStringOption(scope.built.globals.options, spelling) ??
    longStringOption(scope.earlier.command.options, spelling);
  return name === undefined ? none : valueOf(scope, name, { lead: `${spelling}=`, prefix: inline });
}

/** The word after a string option that ended the earlier words is that option's value. */
function awaitedValue(scope: Scope, awaiting: AwaitingValue, last: string): WordPosition {
  return isOptionToken(last) ? none : valueOf(scope, awaiting.name, { lead: '', prefix: last });
}

/** A bare word names a child until routing commits, and fills the next positional after. */
function bareWord(scope: Scope, last: string): WordPosition {
  const { command, earlier } = scope;
  if (!earlier.committed && readsAsChild(earlier.command, last)) {
    return { command, kind: 'command', prefix: last };
  }
  const slot = argumentSlot(earlier.command.arguments, earlier.positionals);
  const argument = slot && command.arguments[earlier.command.arguments.indexOf(slot)];
  return argument ? { argument, command, kind: 'argument', prefix: last } : none;
}

/** An option token: a long token's inline value, or else an option spelling being completed. */
function optionWord(scope: Scope, last: string): WordPosition {
  const long = longToken(last);
  if (long?.inline !== undefined) {
    return inlineValue(scope, long.spelling, long.inline);
  }
  return { command: scope.command, kind: 'option', prefix: last, supplied: scope.earlier.supplied };
}

/** The last word, read as the parser would read the next token. */
function lastWord(scope: Scope, last: string): WordPosition {
  const { command, earlier } = scope;
  if (earlier.delimited) {
    return { command, kind: 'passthrough', prefix: last };
  }
  if (earlier.awaiting) {
    return awaitedValue(scope, earlier.awaiting, last);
  }
  return isOptionToken(last) ? optionWord(scope, last) : bareWord(scope, last);
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
  return lastWord({ built: link.graph, command, earlier, graph }, words.at(-1) ?? '');
}

export type { WordPosition };
export { locate };
