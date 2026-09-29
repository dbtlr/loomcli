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
  FailureView,
  FailureViewContext,
  LoomError,
  OptionNode,
  Plugin,
} from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { nearest } from './match.js';

/**
 * The near matches the hook found, keyed by the failure instance core hands to both the hook and
 * the view. A failure view's context carries no graph, so the hook is where the graph is read.
 */
const found = new WeakMap<Readonly<LoomError>, readonly string[]>();

/** A member an operator is never pointed at: hidden, deprecated, or, for a Command, an alias. */
function offered(member: CommandNode | OptionNode): boolean {
  return !member.hidden && member.deprecated === undefined;
}

/** The canonical names of the children of the Command routing reached, in authoring order. */
function commandNames(command: CommandNode): string[] {
  return command.children
    .filter(offered)
    .flatMap(({ name }) => (typeof name === 'string' ? [name] : []));
}

/**
 * The long spellings, and a Boolean's negative spelling, of the globals and then the routed
 * Command's options, each long spelling ahead of its negative. A short spelling is never offered.
 */
function optionSpellings(graph: CommandGraph, command: CommandNode): string[] {
  return [...graph.globals, ...command.options]
    .filter(offered)
    .flatMap((option) =>
      option.type === 'boolean' ? [option.long, option.negative] : [option.long],
    )
    .filter((spelling) => typeof spelling === 'string');
}

const suggest: FailureHook = (failure, { command, graph }) => {
  if (failure instanceof UnknownCommandError) {
    found.set(failure, nearest(failure.token, commandNames(command), 'command'));
  } else if (failure instanceof UnknownOptionError) {
    found.set(failure, nearest(failure.spelling, optionSpellings(graph, command), 'option'));
  }
  return undefined;
};

/** The fix that replaces core's clause: one name, or the names in rank order. */
function fix(names: readonly string[]): string {
  const quoted = names.map((name) => escapeControlCharacters(name));
  const [only, second] = quoted;
  return second === undefined
    ? `Did you mean "${only ?? ''}"?`
    : `Did you mean one of these: ${quoted.join(', ')}?`;
}

/**
 * The failure's lines as core's default text writes a usage error, each opened by the application
 * name and the whole escaped, then each hint on its own line. With no match the sentence is the
 * failure's own message, so the bytes are core's.
 */
function written(
  failure: Readonly<LoomError>,
  subject: string,
  { application, hints, style }: FailureViewContext,
): string {
  const names = found.get(failure) ?? [];
  const [first] = names;
  const sentence = first === undefined ? failure.message : `Unknown ${subject}. ${fix(names)}`;
  const lines = sentence
    .split('\n')
    .map((line) => `${application}: ${line}\n`)
    .join('');
  return `${style.escape(lines)}${hints.map((hint) => `${hint}\n`).join('')}`;
}

const unknownCommand: FailureView<UnknownCommandError> = {
  render: (failure, context) =>
    written(failure, `command "${escapeControlCharacters(failure.token)}"`, context),
};

const unknownOption: FailureView<UnknownOptionError> = {
  render: (failure, context) =>
    written(failure, `option "${escapeControlCharacters(failure.spelling)}"`, context),
};

/**
 * A plugin that offers the declared name nearest a mistyped Command or option as the fix inside
 * the failure's sentence. Its hook reads the graph and adds no hint; its two views write the
 * sentence, and write core's text when no name is near.
 */
export function suggestions(): Plugin {
  return plugin(`${Package.name}/suggestions`, {
    onFailure: suggest,
    views: [
      override(UnknownCommandError, unknownCommand),
      override(UnknownOptionError, unknownOption),
    ],
  });
}
