import {
  failureLines,
  InputError,
  issuePhrase,
  override,
  Phrase,
  plugin,
  replaceValue,
  UnknownCommandError,
  UnknownOptionError,
} from '@loomcli/core';
import type {
  CommandGraph,
  CommandNode,
  FailureHook,
  FailureHookContext,
  FailureView,
  FailureViewContext,
  LoomError,
  InputIdentity,
  InputProblem,
  OptionNode,
  Plugin,
  StandardSchemaV1,
} from '@loomcli/core';

import { closedSet } from '../closed-set.js';
import { packageName } from '../constants.js';
import { nearest } from './match.js';
import { suggestionsPhrase } from './phrases.js';

/** One line the hook wrote: a phrase, or a string core's lines repeat as written. */
type Line = string | Phrase;

/**
 * The lines the hook wrote, keyed by the failure instance core hands to both the hook and the
 * view. A failure view's context carries no graph, so the hook is where the graph is read, and the
 * view reads its context's message when no lines were recorded.
 */
const recorded = new WeakMap<Readonly<LoomError>, readonly Line[]>();

/** A member an operator may be pointed at: neither hidden nor deprecated. */
function offered(member: CommandNode | OptionNode): boolean {
  return !member.hidden && member.deprecated === undefined;
}

/**
 * The canonical name of each child of the Command routing reached, in authoring order. A node
 * carries its aliases apart from its name, so no alias is ever a candidate.
 */
function commandNames(command: CommandNode): string[][] {
  return command.children
    .filter(offered)
    .flatMap(({ name }) => (typeof name === 'string' ? [[name]] : []));
}

/**
 * The spellings of each option in the globals and then the routed Command's options: the long
 * spelling, and a Boolean's negative spelling after it. A short spelling is never offered.
 */
function optionSpellings(graph: CommandGraph, command: CommandNode): string[][] {
  return [...graph.globals, ...command.options]
    .filter(offered)
    .map((option) =>
      (option.type === 'boolean' ? [option.long, option.negative] : [option.long]).filter(
        (spelling) => typeof spelling === 'string',
      ),
    );
}

/**
 * The declared name of each option in the globals and then the routed Command's options, which an
 * invocation by name writes in place of a spelling.
 */
function optionNames(graph: CommandGraph, command: CommandNode): string[][] {
  return [...graph.globals, ...command.options].filter(offered).map(({ name }) => [name]);
}

/** The sentence that names an unknown command or option and its nearest names, if any matched. */
function unknownSuggestion(
  kind: 'command' | 'option',
  typed: string,
  names: readonly string[],
): Phrase | undefined {
  const [first, second] = names;
  if (first === undefined) {
    return undefined;
  }
  return second === undefined
    ? suggestionsPhrase('unknownWithSuggestion', kind, typed, first)
    : suggestionsPhrase('unknownWithSuggestions', kind, typed, names);
}

/**
 * The sentence that names what the operator typed and offers the matches as its fix, or
 * `undefined` when nothing matched.
 */
function suggestion(
  failure: Readonly<LoomError>,
  { command, graph, invokedBy }: FailureHookContext,
): Phrase | undefined {
  // A failure an action built may carry a replaced field, so the typed word is checked first.
  if (failure instanceof UnknownCommandError && typeof failure.token === 'string') {
    return unknownSuggestion(
      'command',
      failure.token,
      nearest(failure.token, commandNames(command), 'command'),
    );
  }
  if (failure instanceof UnknownOptionError && typeof failure.spelling === 'string') {
    // An invocation by name names an option by its declared name, so it is offered names alone.
    const matches =
      invokedBy === 'name'
        ? nearest(failure.spelling, optionNames(graph, command), 'name')
        : nearest(failure.spelling, optionSpellings(graph, command), 'option');
    return unknownSuggestion('option', failure.spelling, matches);
  }
  return undefined;
}

/** A collected input's issue path selects its element; a scalar issue reads the scalar itself. */
function receivedAt(raw: unknown, path: StandardSchemaV1.Issue['path']): unknown {
  let value = raw;
  for (const segment of path ?? []) {
    const key = typeof segment === 'object' ? segment.key : segment;
    if (!Array.isArray(value) || typeof key !== 'number') {
      return undefined;
    }
    value = value[key];
  }
  return value;
}

/** The closed set of the declaration a problem identifies, subject to the visibility rules. */
function acceptedValues(input: InputIdentity, context: FailureHookContext) {
  if (input.kind === 'stdin') {
    return undefined;
  }
  const options = input.global ? context.graph.globals : context.command.options;
  const nodes = input.kind === 'argument' ? context.command.arguments : options;
  const node = nodes.find(({ name }) => name === input.name);
  return node === undefined || ('hidden' in node && !offered(node))
    ? undefined
    : closedSet(node.schema);
}

/** A membership miss offers only accepted values, using the name comparison without dash folding. */
function valueFix(value: unknown, values: readonly string[] | undefined): Phrase | undefined {
  if (values === undefined || typeof value !== 'string' || values.includes(value)) {
    return undefined;
  }
  const names = nearest(
    value,
    values.map((candidate) => [candidate]),
    'name',
  );
  const [first, second] = names;
  if (first === undefined) {
    return undefined;
  }
  return second === undefined
    ? suggestionsPhrase('valueSuggestion', first)
    : suggestionsPhrase('valueSuggestions', names);
}

interface InputLines {
  lines: Line[];
  offset: number;
  changed: boolean;
}

/**
 * Replaces one issue inside its line with the fix, keeping core's subject and position, and
 * advances to the next line. A line is one issue, a multiline issue included, and a multiline
 * issue keeps its lines byte for byte.
 */
function replaceIssue(
  state: InputLines,
  issue: StandardSchemaV1.Issue,
  received: { raw: unknown; values: readonly string[] | undefined },
) {
  const line = state.lines[state.offset];
  const fix = issue.message.includes('\n')
    ? undefined
    : valueFix(receivedAt(received.raw, issue.path), received.values);
  const replaced =
    fix !== undefined && line instanceof Phrase
      ? replaceValue(line, issuePhrase(issue) ?? issue.message, fix)
      : undefined;
  if (replaced !== undefined) {
    state.lines[state.offset] = replaced;
    state.changed = true;
  }
  state.offset += 1;
}

/** Missing and group problems retain their line; invalid problems retain every unmatched issue. */
function replaceProblem(state: InputLines, problem: InputProblem, context: FailureHookContext) {
  if (problem.reason === 'invalid') {
    const received = {
      raw: context.received(problem),
      values: acceptedValues(problem.input, context),
    };
    for (const issue of problem.issues) {
      replaceIssue(state, issue, received);
    }
  } else {
    state.offset += oneLine;
  }
}

/** The line a problem other than an invalid value keeps. */
const oneLine = 1;

/** No lines yet. */
const none = 0;

/** The number of lines an input failure core raises keeps: one per issue, one per other problem. */
function lineCount(problems: readonly InputProblem[]): number {
  let count = none;
  for (const problem of problems) {
    count += problem.reason === 'invalid' ? problem.issues.length : oneLine;
  }
  return count;
}

/**
 * Replaces only invalid issues, preserving every other line core wrote. A failure whose lines do
 * not follow its problems, such as one an action built with its own sentence, is left as it is.
 */
function inputSuggestion(
  failure: InputError,
  context: FailureHookContext,
): readonly Line[] | undefined {
  const lines = failureLines(failure);
  if (lines === undefined || lines.length !== lineCount(failure.problems)) {
    return undefined;
  }
  const state: InputLines = { changed: false, lines: [...lines], offset: 0 };
  for (const problem of failure.problems) {
    replaceProblem(state, problem, context);
  }
  return state.changed ? state.lines : undefined;
}

/** The lines the hook writes for one failure, or `undefined` when nothing is near. */
function written(
  failure: Readonly<LoomError>,
  context: FailureHookContext,
): readonly Line[] | undefined {
  if (failure instanceof InputError) {
    return inputSuggestion(failure, context);
  }
  const sentence = suggestion(failure, context);
  return sentence === undefined ? undefined : [sentence];
}

/**
 * Records the lines for this run. It first forgets any an earlier run recorded for the same
 * instance, because an application may keep one failure and throw it again where nothing is near,
 * and a hook that throws midway must not leave the earlier lines behind.
 */
const suggest: FailureHook = (failure, context) => {
  recorded.delete(failure);
  const lines = written(failure, context);
  if (lines !== undefined) {
    recorded.set(failure, lines);
  }
  return undefined;
};

/**
 * The failure's lines as core's default text writes a usage error, each opened by the application
 * name and the whole escaped, then each hint on its own line. The recorded lines render in the
 * run's language; with none recorded the text is the context's message, so the bytes are core's.
 */
function render(
  failure: Readonly<LoomError>,
  { application, hints, localize, message, style }: FailureViewContext,
): string {
  const lines = recorded.get(failure);
  const text =
    lines === undefined
      ? message
      : lines.map((line) => (typeof line === 'string' ? line : localize(line))).join('\n');
  const prefixed = text
    .split('\n')
    .map((line) => `${application}: ${line}\n`)
    .join('');
  return `${style.escape(prefixed)}${hints.map((hint) => `${hint}\n`).join('')}`;
}

const unknownCommand: FailureView<UnknownCommandError> = { render };

const unknownOption: FailureView<UnknownOptionError> = { render };

const invalidInput: FailureView<InputError> = { render };

/**
 * A plugin that offers the declared name or accepted value nearest a mistyped input as the fix
 * inside the failure's sentence. Its hook reads the graph and adds no hint; its views write the
 * sentence, and write core's text when no candidate is near.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { suggestions } from '@loomcli/plugins/suggestions';
 *
 * export const app = new Application('notes', { plugins: [suggestions()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/suggestions.md
 *
 * @public
 */
export function suggestions(): Plugin {
  return plugin(`${packageName}/suggestions`, {
    onFailure: suggest,
    views: [
      override(InputError, invalidInput),
      override(UnknownCommandError, unknownCommand),
      override(UnknownOptionError, unknownOption),
    ],
  });
}

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
