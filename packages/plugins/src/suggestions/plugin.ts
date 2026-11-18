import {
  InputError,
  override,
  plugin,
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
import { unknownWithSuggestion, valueSuggestion } from './messages.js';

/**
 * The sentence the hook wrote, keyed by the failure instance core hands to both the hook and the
 * view. A failure view's context carries no graph, so the hook is where the graph is read, and the
 * view reads nothing of the failure but its message when no sentence was recorded.
 */
const sentences = new WeakMap<Readonly<LoomError>, string>();

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

/**
 * The sentence that names what the operator typed and offers the matches as its fix, or
 * `undefined` when nothing matched.
 */
function suggestion(
  failure: Readonly<LoomError>,
  { command, graph, invokedBy }: FailureHookContext,
): string | undefined {
  // A failure an action built may carry a replaced field, so the typed word is checked first.
  if (failure instanceof UnknownCommandError && typeof failure.token === 'string') {
    return unknownWithSuggestion(
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
    return unknownWithSuggestion('option', failure.spelling, matches);
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
function valueFix(value: unknown, values: readonly string[] | undefined) {
  if (values === undefined || typeof value !== 'string' || values.includes(value)) {
    return undefined;
  }
  return valueSuggestion(
    nearest(
      value,
      values.map((candidate) => [candidate]),
      'name',
    ),
  );
}

interface InputLines {
  lines: string[];
  offset: number;
  changed: boolean;
}

/** Replaces one issue sentence and advances over its original lines, including a multiline issue. */
function replaceIssue(
  state: InputLines,
  issue: StandardSchemaV1.Issue,
  received: { raw: unknown; values: readonly string[] | undefined },
) {
  const line = state.lines[state.offset];
  const issueSentence = issue.message;
  const fix = valueFix(receivedAt(received.raw, issue.path), received.values);
  if (fix !== undefined && line !== undefined && line.endsWith(issueSentence)) {
    state.lines[state.offset] = line.slice(undefined, line.length - issueSentence.length) + fix;
    state.changed = true;
  }
  state.offset += issueSentence.split('\n').length;
}

/** Missing and group problems retain their line; invalid problems retain every unmatched issue. */
function replaceProblem(state: InputLines, problem: InputProblem, context: FailureHookContext) {
  const oneLine = 1;
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

/** Replaces only invalid issue sentences, preserving every other byte core wrote. */
function inputSuggestion(failure: InputError, context: FailureHookContext): string | undefined {
  const state: InputLines = { changed: false, lines: failure.message.split('\n'), offset: 0 };
  for (const problem of failure.problems) {
    replaceProblem(state, problem, context);
  }
  return state.changed ? state.lines.join('\n') : undefined;
}

/**
 * Records the sentence for this run. It first forgets any an earlier run recorded for the same
 * instance, because an application may keep one failure and throw it again where nothing is near,
 * and a hook that throws midway must not leave the earlier sentence behind.
 */
const suggest: FailureHook = (failure, context) => {
  sentences.delete(failure);
  const written =
    failure instanceof InputError
      ? inputSuggestion(failure, context)
      : suggestion(failure, context);
  if (written !== undefined) {
    sentences.set(failure, written);
  }
  return undefined;
};

/**
 * The failure's lines as core's default text writes a usage error, each opened by the application
 * name and the whole escaped, then each hint on its own line. With no recorded sentence the lines
 * are the failure's own message, so the bytes are core's.
 */
function render(
  failure: Readonly<LoomError>,
  { application, hints, style }: FailureViewContext,
): string {
  const lines = (sentences.get(failure) ?? failure.message)
    .split('\n')
    .map((line) => `${application}: ${line}\n`)
    .join('');
  return `${style.escape(lines)}${hints.map((hint) => `${hint}\n`).join('')}`;
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
