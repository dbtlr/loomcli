import { DeclarationError, escapeControlCharacters, readExtension } from '@loomcli/core';
import type {
  ArgumentNode,
  CommandGraph,
  CommandNode,
  GraphBuiltHook,
  OptionNode,
} from '@loomcli/core';

import { completionUnknownCompleter } from '../rules.js';
import type { CompletionSettings } from './completer.js';
import { completionArgument, completionInput } from './extension.js';

/*
 * The fault's sentence and correction are a Developer Diagnostic, which addresses the author, so
 * they stay here beside the code that raises them, under ADR-0164, as the MCP plugin's faults do.
 * Every launch of an application that installs the plugin runs this judge at the graph build, and
 * the plugin's message module, whose sentences only its children's work says, does not load.
 */

/** A name as the fault's sentence quotes it, escaped. */
const quoted = (name: string): string => `"${escapeControlCharacters(name)}"`;

/** The input that names a completer, as the fault's sentence opens with it. */
function subject(found: {
  readonly command: CommandNode | undefined;
  readonly input: OptionNode | ArgumentNode;
}): string {
  const { command, input } = found;
  if (command === undefined) {
    return `Global option ${quoted(input.name)}`;
  }
  const kind = 'short' in input ? 'Option' : 'Argument';
  const [first] = command.path;
  const owner =
    first === undefined ? 'the root Command' : `Command ${quoted(command.path.join(' '))}`;
  return `${kind} ${quoted(input.name)} of ${owner}`;
}

/** Whether the settings define a completer of this name, read only from their own entries. */
function isDefined(settings: CompletionSettings, name: string): boolean {
  const { values } = settings;
  return values !== undefined && Object.hasOwn(values, name);
}

/** The name of a completer an option or an argument holds, if it names one. */
function namesOf(input: OptionNode | ArgumentNode): string | undefined {
  const hint =
    'short' in input
      ? readExtension(input, completionInput)
      : readExtension(input, completionArgument);
  return hint?.values;
}

/** Every option and argument of a Command, then each child's, in graph order, with its owner. */
function inputsOf(
  command: CommandNode,
): { command: CommandNode; input: OptionNode | ArgumentNode }[] {
  return [
    ...[...command.options, ...command.arguments].map((input) => ({ command, input })),
    ...command.children.flatMap((child) => inputsOf(child)),
  ];
}

/** The first completer name an input of the graph holds that the settings do not define. */
function undefinedName(graph: CommandGraph, settings: CompletionSettings) {
  const inputs = [
    ...graph.globals.map((input) => ({ command: undefined, input })),
    ...inputsOf(graph.root),
  ];
  for (const { command, input } of inputs) {
    const name = namesOf(input);
    if (name !== undefined && !isDefined(settings, name)) {
      return { command, input, name };
    }
  }
  return undefined;
}

/**
 * The `onGraphBuilt` hook that reports an input naming a completer the settings do not define,
 * because that input would complete nothing and no run would say why.
 */
function judgeCompleters(settings: CompletionSettings): GraphBuiltHook {
  return (graph) => {
    const found = undefinedName(graph, settings);
    if (found !== undefined) {
      const { name } = found;
      throw new DeclarationError(completionUnknownCompleter, {
        correction: `Add a completer named ${quoted(name)} to the values setting of completion(), or name one it defines.`,
        sentence: `${subject(found)} names completer ${quoted(name)}, which the values setting of the completion plugin does not define.`,
      });
    }
    return undefined;
  };
}

export { judgeCompleters };
