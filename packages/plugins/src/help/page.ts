import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode, ViewContext } from '@loomcli/core';

import { breaks } from '../lines.js';
import { argumentAccepts, optionAccepts } from './accepted.js';
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
import { helpCommand, helpInput } from './extension.js';
import { sectionBlocks } from './sections.js';
import type { HelpPage, HelpVariant } from './views.js';

/**
 * The members one page shows. A member is visible when it is not hidden, and this is the one place
 * that filter lands. Every list the page prints, and every decision about whether it prints one,
 * runs through here. A question about a node's own shape, such as whether it is a group, reads the
 * raw list instead. `foldsGlobals` below reads the raw `graph.root.children` for that reason, so an
 * Application whose only children are hidden still prints GLOBAL OPTIONS as its own section.
 */
function visible<Member extends { readonly hidden: boolean }>(
  members: readonly Member[],
): readonly Member[] {
  return members.filter((member) => !member.hidden);
}

/** The help facts one Command carries, read through the descriptor's typed accessor. */
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
function masthead(path: string, command: CommandNode, { style }: ViewContext): string[] {
  const { deprecated, description } = command;
  const name = style.highlight.bold(style.escape(path));
  const opening =
    description === undefined
      ? name
      : `${name} ${style.dim('·')} ${style.primary(style.escape(description))}`;
  return deprecated === undefined
    ? [opening]
    : [opening, `  ${style.warning(style.escape(`Deprecated: ${deprecated}`))}`];
}

/** The routed node's prose, one authored line per page line, each indented two spaces. */
function details(command: CommandNode, { style }: ViewContext): string[] {
  const prose = commandHelp(command)?.details;
  return prose === undefined
    ? []
    : prose.split(breaks).map((line) => `  ${style.primary(style.escape(line))}`);
}

/**
 * The visible required options the action form names. Only a Command's own options can be
 * required, because a global option declares no presence rule.
 */
function requiredOptions(command: CommandNode): StringOption[] {
  const reachable: readonly OptionNode[] = visible(command.options);
  // Core rejects `required` on a Boolean option, so every option this keeps takes a value.
  return reachable.filter((option) => option.type === 'string').filter((option) => option.required);
}

/**
 * One line per form. A node with an action prints the action form, and a node with a visible child
 * prints the children form after it, which is the only form a group has. Groupness reads the raw
 * list, so a group whose children are all hidden prints the children form still: it has no other.
 */
function usage(
  {
    command,
    graph,
    children,
  }: {
    command: CommandNode;
    graph: CommandGraph;
    children: readonly CommandNode[];
  },
  context: ViewContext,
): string[] {
  const { style } = context;
  const path = style.highlight(style.escape(pathOf(graph, command)));
  const forms: string[] = [];
  if (command.hasAction) {
    const parts = [
      ...command.arguments.map((argument) => argumentForm(argument, context)),
      ...requiredOptions(command).map((option) => optionForm(option, context)),
      // `[options]` is always present, because the help option is one.
      style.dim.italic('[options]'),
    ];
    forms.push(`${path} ${parts.join(' ')}`);
  }
  const group = !command.hasAction && !isEmpty(command.children);
  if (!isEmpty(children) || group) {
    forms.push(`${path} ${style.dim.italic('<command>')} ${style.dim.italic('[options]')}`);
  }
  return isEmpty(forms) ? [] : [style.dim('USAGE'), ...forms.map((form) => `  ${form}`)];
}

/**
 * One child row: its name, the form it answers to, and the right cell it carries. A group is a
 * Command with children and no action, so groupness reads the child's own children and its action,
 * not the visible ones: a group whose every child is hidden is a group still.
 */
function childRow(child: CommandNode, context: ViewContext): Row {
  const { style } = context;
  const parent = !isEmpty(child.children);
  const suffix = child.hasAction ? '[command]' : '<command>';
  // `deprecated` is this row's one possible fact.
  return {
    left: `${style.highlight(style.escape(child.name ?? ''))}${parent ? ` ${style.dim.italic(suffix)}` : ''}`,
    right: rightCell({ description: child.description }, deprecatedFacts(child, context), context),
  };
}

function commands(
  { command, children }: { command: CommandNode; children: readonly CommandNode[] },
  context: ViewContext,
): string[][] {
  return sectionBlocks(
    {
      order: commandHelp(command)?.commandSections,
      rows: children.map((child) => ({
        fallback: 'COMMANDS',
        path: commandHelp(child)?.section,
        row: childRow(child, context),
      })),
    },
    context,
  );
}

function args(command: CommandNode, context: ViewContext): string[] {
  const rows = command.arguments.map((argument) => ({
    left: context.style.dim.italic(context.style.escape(argument.name)),
    right: rightCell(
      { accepts: argumentAccepts(argument), description: argument.description },
      argumentFacts(argument, context),
      context,
    ),
  }));
  return isEmpty(rows) ? [] : [context.style.dim('ARGUMENTS'), ...column(rows, context)];
}

function optionRow(option: OptionNode, context: ViewContext): Row {
  return {
    left: optionCell(option, context),
    right: rightCell(
      { accepts: optionAccepts(option), description: option.description },
      optionFacts(option, context),
      context,
    ),
  };
}

/** Whether this page folds the globals into OPTIONS, which the root of a leaf Application does. */
function foldsGlobals(graph: CommandGraph): boolean {
  return isEmpty(graph.root.children);
}

function options(command: CommandNode, graph: CommandGraph, context: ViewContext): string[][] {
  const member = (option: OptionNode, fallback: string) => ({
    fallback,
    path: readExtension(option, helpInput)?.section,
    row: optionRow(option, context),
  });
  const globalHeading = foldsGlobals(graph) ? 'OPTIONS' : 'GLOBAL OPTIONS';
  return sectionBlocks(
    {
      order: commandHelp(command)?.optionSections,
      rows: [
        ...visible(command.options).map((option) => member(option, 'OPTIONS')),
        ...visible(graph.globals).map((option) => member(option, globalHeading)),
      ],
    },
    context,
  );
}

/** One example: the invocation, then its note on the next line indented two more spaces. */
function exampleLines(name: string, example: Example, { style }: ViewContext): string[] {
  const lines = [
    `  ${style.dim('$')} ${style.highlight(style.escape(name))} ${style.primary(style.escape(example.command))}`,
  ];
  if (example.note !== undefined) {
    lines.push(`    ${style.dim(style.escape(example.note))}`);
  }
  return lines;
}

function examples(graph: CommandGraph, command: CommandNode, context: ViewContext): string[] {
  const listed = commandHelp(command)?.examples ?? [];
  const lines = listed.flatMap((example) => exampleLines(graph.name, example, context));
  return isEmpty(lines) ? [] : [context.style.dim('EXAMPLES'), ...lines];
}

/**
 * The closing hints. The child hint prints when the page printed child rows and spells the variant's
 * own help option. The pointer prints on the compact page alone, when the extended page of the
 * same node holds a block the compact page omitted.
 */
function hints(
  {
    children,
    omitted,
    path,
    variant,
  }: {
    children: readonly CommandNode[];
    omitted: boolean;
    path: string;
    variant: HelpVariant;
  },
  { style }: ViewContext,
): string[] {
  const run = `${style.dim('Run')} ${style.highlight(style.escape(path))}`;
  const lines: string[] = [];
  if (!isEmpty(children)) {
    const spelling = variant === 'compact' ? '-h' : '--help';
    lines.push(
      `${run} ${style.dim.italic('<command>')} ${style.highlight(spelling)} ${style.dim('for command details.')}`,
    );
  }
  if (variant === 'compact' && omitted) {
    lines.push(`${run} ${style.highlight('--help')} ${style.dim('for details and examples.')}`);
  }
  return lines;
}

/**
 * The help page of one routed Command, derived from the graph and the variant and nothing else. It
 * is a sequence of blocks separated by one blank line, no block holds a blank line of its own, a
 * block with nothing to show is omitted, and the page carries no line terminator of its own at
 * either end. The compact page omits Details and EXAMPLES.
 */
function renderPage({ command, graph, variant }: HelpPage, context: ViewContext): string {
  const path = pathOf(graph, command);
  // One reading of the visible children answers three questions.
  // They are the children usage form, the Command sections, and the child hint.
  const children = visible(command.children);
  const prose = details(command, context);
  const listed = examples(graph, command, context);
  const extended = variant === 'extended';
  const omitted = !extended && !(isEmpty(prose) && isEmpty(listed));
  return [
    masthead(path, command, context),
    extended ? prose : [],
    usage({ children, command, graph }, context),
    ...commands({ children, command }, context),
    args(command, context),
    ...options(command, graph, context),
    extended ? listed : [],
    hints({ children, omitted, path, variant }, context),
  ]
    .filter((block) => !isEmpty(block))
    .map((block) => block.join('\n'))
    .join('\n\n');
}

export { renderPage };
