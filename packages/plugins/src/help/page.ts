import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode } from '@loomcli/core';

import {
  argumentFacts,
  argumentForm,
  column,
  deprecatedFacts,
  isEmpty,
  optionCell,
  optionFacts,
  optionForm,
  rightCell,
} from './cells.js';
import type { Row, StringOption } from './cells.js';
import { helpCommand } from './extension.js';
import { breaks } from './lines.js';

/**
 * The members one page shows. A member is visible when it is not hidden, and this is the one place
 * that filter lands. Every list the page prints, and every decision about whether it prints one,
 * runs through here. A question about a node's own shape, such as whether it is a group, reads the
 * raw list instead.
 */
function visible<Member extends { readonly hidden: boolean }>(
  members: readonly Member[],
): readonly Member[] {
  return members.filter((member) => !member.hidden);
}

/** The help facts one Command carries, which the page reads once per rendering. */
function commandHelp(command: CommandNode) {
  return readExtension(command, helpCommand);
}

/** One example as the graph stores it, read from the descriptor's own output type. */
type Example = NonNullable<NonNullable<ReturnType<typeof commandHelp>>['examples']>[number];

/** The routed path: the application name, then the route to the node, space-separated. */
function pathOf(graph: CommandGraph, command: CommandNode): string {
  return [graph.name, ...command.path].join(' ');
}

/**
 * `<path> · <description>`, or `<path>` alone when the node has no description. A deprecated
 * Command follows it with its migration message on a second line of the same block.
 */
function masthead(path: string, command: CommandNode): string[] {
  const { deprecated, description } = command;
  const opening = description === undefined ? path : `${path} · ${description}`;
  return deprecated === undefined ? [opening] : [opening, `  Deprecated: ${deprecated}`];
}

/** The routed node's prose, one authored line per page line, each indented two spaces. */
function details(command: CommandNode): string[] {
  const prose = commandHelp(command)?.details;
  return prose === undefined ? [] : prose.split(breaks).map((line) => `  ${line}`);
}

/** The visible required options the action form names: the node's own, then the globals. */
function requiredOptions(command: CommandNode, graph: CommandGraph): StringOption[] {
  const reachable: readonly OptionNode[] = [...visible(command.options), ...visible(graph.globals)];
  // Core rejects `required` on a Boolean option, so every option this keeps takes a value.
  return reachable.filter((option) => option.type === 'string').filter((option) => option.required);
}

/**
 * One line per form. A node with an action prints the action form, and a node with a visible child
 * prints the children form after it, which is the only form a group has. Groupness reads the raw
 * list, so a group whose children are all hidden prints the children form still: it has no other.
 */
function usage(
  command: CommandNode,
  graph: CommandGraph,
  children: readonly CommandNode[],
): string[] {
  const path = pathOf(graph, command);
  const forms: string[] = [];
  if (command.hasAction) {
    const parts = [
      ...command.arguments.map(argumentForm),
      ...requiredOptions(command, graph).map(optionForm),
      // `[options]` is always present, because the help option is one.
      '[options]',
    ];
    forms.push(`${path} ${parts.join(' ')}`);
  }
  const group = !command.hasAction && !isEmpty(command.children);
  if (!isEmpty(children) || group) {
    forms.push(`${path} <command> [options]`);
  }
  return isEmpty(forms) ? [] : ['USAGE', ...forms.map((form) => `  ${form}`)];
}

/**
 * One child row: its name, the form it answers to, and the right cell it carries. A group is a
 * Command with children and no action, so groupness reads the child's own children and its action,
 * not the visible ones: a group whose every child is hidden is a group still.
 */
function childRow(child: CommandNode): Row {
  const parent = !isEmpty(child.children);
  const suffix = child.hasAction ? ' [command]' : ' <command>';
  // `deprecated` is this row's one possible fact.
  return {
    left: `${child.name ?? ''}${parent ? suffix : ''}`,
    right: rightCell(child.description, deprecatedFacts(child)),
  };
}

function commands(children: readonly CommandNode[]): string[] {
  return isEmpty(children) ? [] : ['COMMANDS', ...column(children.map(childRow))];
}

function args(command: CommandNode): string[] {
  const rows = command.arguments.map((argument) => ({
    left: argument.name,
    right: rightCell(argument.description, argumentFacts(argument)),
  }));
  return isEmpty(rows) ? [] : ['ARGUMENTS', ...column(rows)];
}

function optionRow(option: OptionNode): Row {
  return { left: optionCell(option), right: rightCell(option.description, optionFacts(option)) };
}

/** Whether this page folds the globals into OPTIONS, which the root of a leaf Application does. */
function foldsGlobals(graph: CommandGraph): boolean {
  return isEmpty(graph.root.children);
}

function options(command: CommandNode, graph: CommandGraph): string[] {
  const folded = foldsGlobals(graph) ? visible(graph.globals) : [];
  const rows = [...visible(command.options), ...folded].map(optionRow);
  return isEmpty(rows) ? [] : ['OPTIONS', ...column(rows)];
}

/** The options that reach every Command, on every page except a leaf Application's root. */
function globalOptions(graph: CommandGraph): string[] {
  if (foldsGlobals(graph)) {
    return [];
  }
  const rows = visible(graph.globals).map(optionRow);
  return isEmpty(rows) ? [] : ['GLOBAL OPTIONS', ...column(rows)];
}

/** One example: the invocation, then its note on the next line indented two more spaces. */
function exampleLines(name: string, example: Example): string[] {
  const lines = [`  $ ${name} ${example.command}`];
  if (example.note !== undefined) {
    lines.push(`    ${example.note}`);
  }
  return lines;
}

function examples(graph: CommandGraph, command: CommandNode): string[] {
  const listed = commandHelp(command)?.examples ?? [];
  const lines = listed.flatMap((example) => exampleLines(graph.name, example));
  return isEmpty(lines) ? [] : ['EXAMPLES', ...lines];
}

/** The closing hint, which the page prints when it printed COMMANDS. */
function hint(path: string, children: readonly CommandNode[]): string[] {
  return isEmpty(children) ? [] : [`Run ${path} <command> --help for command details.`];
}

/**
 * The help page of one routed Command, derived from the graph and nothing else. It is a sequence of
 * blocks separated by one blank line, no block holds a blank line of its own, a block with nothing
 * to show is omitted, and the page carries no line terminator of its own at either end.
 */
function renderPage(graph: CommandGraph, command: CommandNode): string {
  const path = pathOf(graph, command);
  // One reading of the visible children answers three questions.
  // They are the children usage form, the COMMANDS section, and the closing hint.
  const children = visible(command.children);
  return [
    masthead(path, command),
    details(command),
    usage(command, graph, children),
    commands(children),
    args(command),
    options(command, graph),
    globalOptions(graph),
    examples(graph, command),
    hint(path, children),
  ]
    .filter((block) => !isEmpty(block))
    .map((block) => block.join('\n'))
    .join('\n\n');
}

export { renderPage };
