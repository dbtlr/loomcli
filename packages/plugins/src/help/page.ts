import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode } from '@loomcli/core';

import {
  argumentFacts,
  argumentForm,
  column,
  isEmpty,
  optionCell,
  optionFacts,
  optionForm,
  rightCell,
} from './cells.js';
import type { Row } from './cells.js';
import { helpCommand } from './extension.js';

/**
 * The members one page shows. A member is visible when it is not hidden, and `hidden` is not a graph
 * fact yet, so every member is visible and this is where the filter belongs once it lands.
 */
function visible<Member>(members: readonly Member[]): readonly Member[] {
  return members;
}

/** The line terminators the schema recognizes, which the page joins with LF. */
const breaks = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/u;

/** The routed path: the application name, then the route to the node, space-separated. */
function pathOf(graph: CommandGraph, command: CommandNode): string {
  return [graph.name, ...command.path].join(' ');
}

/** `<path> · <description>`, or `<path>` alone when the node has no description. */
function masthead(path: string, command: CommandNode): string[] {
  // A `  Deprecated: <message>` line joins this block once the graph carries the fact.
  const { description } = command;
  return [description === undefined ? path : `${path} · ${description}`];
}

/** The routed node's prose, one authored line per page line, each indented two spaces. */
function details(command: CommandNode): string[] {
  const prose = readExtension(command, helpCommand)?.details;
  return prose === undefined ? [] : prose.split(breaks).map((line) => `  ${line}`);
}

/** The visible required options the action form names: the node's own, then the globals. */
function requiredOptions(command: CommandNode, graph: CommandGraph): OptionNode[] {
  return [...visible(command.options), ...visible(graph.globals)].filter(
    (option) => option.type === 'string' && option.required,
  );
}

/**
 * One line per form. A node with an action prints the action form, and a node with children prints
 * the children form after it, which is the only form a group has.
 */
function usage(path: string, command: CommandNode, graph: CommandGraph): string[] {
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
  if (!isEmpty(command.children)) {
    forms.push(`${path} <command> [options]`);
  }
  return isEmpty(forms) ? [] : ['USAGE', ...forms.map((form) => `  ${form}`)];
}

/** One child row: its name, the form it answers to, and the right cell it carries. */
function childRow(child: CommandNode): Row {
  const parent = !isEmpty(visible(child.children));
  const suffix = child.hasAction ? ' [command]' : ' <command>';
  // `deprecated` is this row's one possible fact once the graph carries it.
  return {
    left: `${child.name ?? ''}${parent ? suffix : ''}`,
    right: rightCell(child.description, []),
  };
}

function commands(command: CommandNode): string[] {
  const children = visible(command.children);
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

/** One example as the graph stores it: read-only, with an omitted note absent. */
interface Example {
  readonly command: string;
  readonly note?: string | undefined;
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
  const listed = readExtension(command, helpCommand)?.examples ?? [];
  const lines = listed.flatMap((example) => exampleLines(graph.name, example));
  return isEmpty(lines) ? [] : ['EXAMPLES', ...lines];
}

/** The closing hint, which the page prints when it printed COMMANDS. */
function hint(path: string, command: CommandNode): string[] {
  return isEmpty(visible(command.children))
    ? []
    : [`Run ${path} <command> --help for command details.`];
}

/**
 * The help page of one routed Command, derived from the graph and nothing else. It is a sequence of
 * blocks separated by one blank line, no block holds a blank line of its own, a block with nothing
 * to show is omitted, and the page carries no line terminator of its own at either end.
 */
function renderPage(graph: CommandGraph, command: CommandNode): string {
  const path = pathOf(graph, command);
  return [
    masthead(path, command),
    details(command),
    usage(path, command, graph),
    commands(command),
    args(command),
    options(command, graph),
    globalOptions(graph),
    examples(graph, command),
    hint(path, command),
  ]
    .filter((block) => !isEmpty(block))
    .map((block) => block.join('\n'))
    .join('\n\n');
}

export { renderPage };
