import {
  escapeControlCharacters,
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
  OptionNode,
  Plugin,
} from '@loomcli/core';

import { packageName } from '../constants.js';
import { nearest } from './match.js';

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
 * `undefined` when nothing matched. Every quoted text is escaped, a declared option name included,
 * because the declared-name rule allows a control character.
 */
function sentence(kind: string, typed: string, names: readonly string[]): string | undefined {
  const quoted = names.map((name) => escapeControlCharacters(name));
  const [first, second] = quoted;
  if (first === undefined) {
    return undefined;
  }
  const fix =
    second === undefined
      ? `Did you mean "${first}"?`
      : `Did you mean one of these: ${quoted.join(', ')}?`;
  return `Unknown ${kind} "${escapeControlCharacters(typed)}". ${fix}`;
}

function suggestion(
  failure: Readonly<LoomError>,
  { command, graph, invokedBy }: FailureHookContext,
): string | undefined {
  // A failure an action built may carry a replaced field, so the typed word is checked first.
  if (failure instanceof UnknownCommandError && typeof failure.token === 'string') {
    return sentence(
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
    return sentence('option', failure.spelling, matches);
  }
  return undefined;
}

/**
 * Records the sentence for this run. It first forgets any an earlier run recorded for the same
 * instance, because an application may keep one failure and throw it again where nothing is near,
 * and a hook that throws midway must not leave the earlier sentence behind.
 */
const suggest: FailureHook = (failure, context) => {
  sentences.delete(failure);
  const written = suggestion(failure, context);
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

/**
 * A plugin that offers the declared name nearest a mistyped Command or option as the fix inside
 * the failure's sentence. Its hook reads the graph and adds no hint; its two views write the
 * sentence, and write core's text when no name is near.
 */
export function suggestions(): Plugin {
  return plugin(`${packageName}/suggestions`, {
    onFailure: suggest,
    views: [
      override(UnknownCommandError, unknownCommand),
      override(UnknownOptionError, unknownOption),
    ],
  });
}
