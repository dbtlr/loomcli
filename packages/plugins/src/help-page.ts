import { nowrap, readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode, ViewContext } from '@loomcli/core';

import { argumentAccepts, optionAccepts } from './help-accepted.js';
import {
  aliasLabels,
  aliasSeparator,
  argumentFacts,
  argumentForm,
  column,
  commandFacts,
  isEmpty,
  optionCell,
  optionForm,
  pageOptionFacts,
  rightCell,
} from './help-cells.js';
import type { Row, StringOption, UsageWriter } from './help-cells.js';
import { renderDetails } from './help-details.js';
import { epilogsOf } from './help-epilogs.js';
import { hangLines, onTerminal, prose } from './help-layout.js';
import { sectionBlocks } from './help-sections.js';
import type { SectionMember } from './help-sections.js';
import { helpCommand, helpInput } from './help/extension.js';
import type { HelpPage, HelpVariant } from './help/views.js';
import { singleLineOf } from './lines.js';
import { groupSentences } from './option-groups.js';
import { continuation } from './text-lines.js';

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

/** The indent of each labeled line under a masthead: the alias line and the deprecation line. */
const labeledIndent = '  ';

/** Where a masthead description continues when its hang after the path cannot fit. */
const mastheadBase = 2;

/** One labeled line under a masthead: its label, its text, and the tone the whole line prints in. */
interface LabeledLine {
  readonly label: string;
  readonly text: string;
  readonly tone: 'dim' | 'warning';
}

/**
 * A labeled line under a masthead, such as `Deprecated: <message>`. On a terminal its text wraps
 * and continues under its first character, after the label, or at the line's indent when that hang
 * cannot fit. Each line is one value in the line's tone, so the first line's label and text stay
 * one value, as they are off a terminal.
 */
function labeled({ label, text, tone }: LabeledLine, context: ViewContext): string[] {
  const { style } = context;
  const styled = style[tone];
  const head = style.escape(label);
  const body = style.escape(text);
  if (!onTerminal(context)) {
    return [`${labeledIndent}${styled(head + body)}`];
  }
  const base = context.width(labeledIndent);
  const { first, indent, rest } = hangLines(
    body,
    { base, columns: context.columns, lead: base + context.width(head) },
    context,
  );
  return [
    `${labeledIndent}${styled(head + first)}`,
    ...rest.map((line) => continuation(styled(line), ' '.repeat(indent), context)),
  ];
}

/**
 * The line under the masthead of a Command with visible aliases, `Alias: ls` or
 * `Aliases: ls, dir`, printed dim; a Command with none prints no line.
 */
function aliasLine(command: CommandNode, context: ViewContext): string[] {
  const names = command.visibleAliases;
  if (isEmpty(names)) {
    return [];
  }
  return labeled(
    { label: aliasLabels(names).line, text: names.join(aliasSeparator), tone: 'dim' },
    context,
  );
}

/**
 * `<path> · <description>`, or `<path>` alone when the node has no description. The description
 * and the migration message each print as one line of prose, a line break the author wrote read as
 * a space. On a terminal the description wraps and continues under its first character, or at
 * indent 2 when that hang cannot fit. A Command with visible aliases follows it with its alias
 * line, a Command that needs a terminal with the line that says so, and a deprecated Command with
 * its migration message, in the same block.
 */
function masthead(path: string, command: CommandNode, context: ViewContext): string[] {
  const { style } = context;
  const deprecated = singleLineOf(command.deprecated);
  const description = singleLineOf(command.description);
  const name = style.highlight.bold(style.escape(path));
  const opening =
    description === undefined
      ? [name]
      : prose(
          style.primary(style.escape(description)),
          { base: mastheadBase, lead: `${name} ${style.dim('·')} ` },
          context,
        );
  const deprecation =
    deprecated === undefined
      ? []
      : labeled({ label: 'Deprecated: ', text: deprecated, tone: 'warning' }, context);
  const terminal = command.needsTerminal
    ? labeled(
        { label: 'Needs a terminal: ', text: 'stdin and stderr, outside CI.', tone: 'dim' },
        context,
      )
    : [];
  return [...opening, ...aliasLine(command, context), ...terminal, ...deprecation];
}

/**
 * The routed node's Markdown, rendered in extended help: as authored lines off a terminal, and
 * reflowed to the width on one.
 */
function details(command: CommandNode, context: ViewContext): string[] {
  const source = commandHelp(command)?.details;
  return source === undefined ? [] : renderDetails(source, context);
}

/**
 * The visible required options the action form names. Only a Command's own options can be
 * required, because a global option declares no presence rule.
 */
function requiredOptions(command: CommandNode): StringOption[] {
  const reachable: readonly OptionNode[] = visible(command.options);
  // Core rejects `required` on a Boolean option, so every option this keeps takes a value.
  return reachable
    .filter((option) => option.type === 'string' || option.type === 'content')
    .filter((option) => option.required && !(option.type === 'content' && option.stdin));
}

/** The routed node, the graph, and its visible children, which the usage forms read. */
interface UsageSubject {
  readonly command: CommandNode;
  readonly graph: CommandGraph;
  readonly children: readonly CommandNode[];
}

/**
 * One string per form. A node with an action has the action form, and a node with a visible child
 * the children form after it, which is the only form a group has. Groupness reads the raw list, so
 * a group whose children are all hidden has the children form still: it has no other.
 */
function usageForms({ children, command, graph }: UsageSubject, writer: UsageWriter): string[] {
  const path = writer.path(pathOf(graph, command));
  const forms: string[] = [];
  if (command.hasAction) {
    const parts = [
      ...command.arguments.map((argument) => argumentForm(argument, writer)),
      ...requiredOptions(command).map((option) => optionForm(option, writer)),
      // `[options]` is always present, because the help option is one.
      writer.word('[options]'),
      ...(command.passthrough ? [writer.word('[-- <args>...]')] : []),
    ];
    forms.push(`${path} ${parts.join(' ')}`);
  }
  const group = !command.hasAction && !isEmpty(command.children);
  if (!isEmpty(children) || group) {
    forms.push(`${path} ${writer.word('<command>')} ${writer.word('[options]')}`);
  }
  return forms;
}

/** The USAGE block: one line per form, its words styled as the page styles them. */
function usage(subject: UsageSubject, { style }: ViewContext): string[] {
  const forms = usageForms(subject, {
    path: (text) => style.highlight(style.escape(text)),
    spelling: (text) => style.highlight(style.escape(text)),
    word: (text) => style.dim.italic(style.escape(text)),
  });
  const [firstForm] = forms;
  return isEmpty(forms)
    ? []
    : [
        style.dim('USAGE'),
        ...forms.map(
          (form) =>
            `  ${subject.command.stdin?.required && subject.command.hasAction && form === firstForm ? `${style.dim.italic('<producer>')} | ` : ''}${form}`,
        ),
      ];
}

/**
 * The form a child row names after the child's name: `<command>` for a group, `[command]` for a
 * Command with an action and children, and none for a leaf. A group is a Command with children and
 * no action, so groupness reads the child's own children and its action, not the visible ones: a
 * group whose every child is hidden is a group still.
 */
function childSuffix(child: CommandNode): string | undefined {
  if (isEmpty(child.children)) {
    return undefined;
  }
  return child.hasAction ? '[command]' : '<command>';
}

/** One child row: its name, the form it answers to, and the right cell it carries. */
function childRow(child: CommandNode, context: ViewContext): Row {
  const { style } = context;
  const suffix = childSuffix(child);
  // The alias fact and `deprecated` are this row's possible facts.
  return {
    left: `${style.highlight(style.escape(child.name ?? ''))}${suffix === undefined ? '' : ` ${style.dim.italic(suffix)}`}`,
    right: rightCell({ description: child.description }, commandFacts(child), context),
  };
}

/** The visible children as section members, under COMMANDS unless an authored section holds one. */
function commandMembers(children: readonly CommandNode[]): SectionMember<CommandNode>[] {
  return children.map((child) => ({
    fallback: 'COMMANDS',
    path: commandHelp(child)?.section,
    row: child,
  }));
}

function commands(
  { command, children }: { command: CommandNode; children: readonly CommandNode[] },
  context: ViewContext,
): string[][] {
  return sectionBlocks(
    {
      order: commandHelp(command)?.commandSections,
      rows: commandMembers(children).map(({ fallback, path, row }) => ({
        fallback,
        path,
        row: childRow(row, context),
      })),
    },
    context,
  );
}

/** The right cell of the `--` row that tells an operator how to pass a child's name as an argument. */
const escapeDescription = 'Read every later word as an argument, even a command name.';

/**
 * Whether the page notes the `--` escape: the node declares an argument, holds a visible child
 * whose name an operator might mean as one, and has no passthrough mode, whose own row names `--`.
 */
function notesEscape(command: CommandNode, children: readonly CommandNode[]): boolean {
  return !isEmpty(command.arguments) && !isEmpty(children) && !command.passthrough;
}

function args(
  { command, children }: { command: CommandNode; children: readonly CommandNode[] },
  context: ViewContext,
): string[] {
  const rows = command.arguments.map((argument) => ({
    left: context.style.dim.italic(context.style.escape(argument.name)),
    right: rightCell(
      { accepts: argumentAccepts(argument), description: argument.description },
      argumentFacts(argument),
      context,
    ),
  }));
  if (command.passthrough) {
    rows.push({
      left: `-- ${context.style.dim.italic('<args>...')}`,
      right: rightCell({ description: command.passthrough.description }, [], context),
    });
  }
  if (notesEscape(command, children)) {
    rows.push({
      left: '--',
      right: rightCell({ description: escapeDescription }, [], context),
    });
  }
  return isEmpty(rows) ? [] : [context.style.dim('ARGUMENTS'), ...column(rows, context)];
}

function optionRow(option: OptionNode, context: ViewContext): Row {
  return {
    left: optionCell(option, context),
    right: rightCell(
      { accepts: optionAccepts(option), description: option.description },
      pageOptionFacts(option),
      context,
    ),
  };
}

/** Whether this page folds the globals into OPTIONS, which the root of a leaf Application does. */
function foldsGlobals(graph: CommandGraph): boolean {
  return isEmpty(graph.root.children);
}

/** One option as a section member, under its fallback heading unless an authored section holds it. */
function optionMember(option: OptionNode, fallback: string): SectionMember<OptionNode> {
  return { fallback, path: readExtension(option, helpInput)?.section, row: option };
}

/**
 * The visible local options under OPTIONS, then the visible globals given under the global heading,
 * as section members, unless an authored section holds one.
 */
function optionMembers(
  command: CommandNode,
  { globals, globalHeading }: { globals: readonly OptionNode[]; globalHeading: string },
): SectionMember<OptionNode>[] {
  return [
    ...visible(command.options).map((option) => optionMember(option, 'OPTIONS')),
    ...visible(globals).map((option) => optionMember(option, globalHeading)),
  ];
}

function options(command: CommandNode, graph: CommandGraph, context: ViewContext): string[][] {
  const globalHeading = foldsGlobals(graph) ? 'OPTIONS' : 'GLOBAL OPTIONS';
  return sectionBlocks(
    {
      order: commandHelp(command)?.optionSections,
      rows: optionMembers(command, { globalHeading, globals: graph.globals }).map(
        ({ fallback, path, row }) => ({ fallback, path, row: optionRow(row, context) }),
      ),
    },
    context,
  );
}

/**
 * One example: the invocation, which stays whole, then its note on the next line indented two more
 * spaces. On a terminal the note wraps and continues at its indent.
 */
function exampleLines(name: string, example: Example, context: ViewContext): string[] {
  const { style } = context;
  const lines = [
    `  ${style.dim('$')} ${style.highlight(style.escape(name))} ${style.primary(style.escape(example.command))}`,
  ];
  if (example.note !== undefined) {
    const note = style.dim(style.escape(example.note));
    lines.push(...prose(note, { lead: '    ' }, context));
  }
  return lines;
}

function examples(graph: CommandGraph, command: CommandNode, context: ViewContext): string[] {
  const listed = commandHelp(command)?.examples ?? [];
  const lines = listed.flatMap((example) => exampleLines(graph.name, example, context));
  return isEmpty(lines) ? [] : [context.style.dim('EXAMPLES'), ...lines];
}

/**
 * One hint: `Run`, the command it names, and what that command shows. On a terminal the hint wraps
 * at the left margin, and the command sits in `nowrap`, so it stays on one line.
 */
function hint(command: string, rest: string, context: ViewContext): string[] {
  const { style } = context;
  const named = onTerminal(context) ? nowrap(command) : command;
  return prose(`${style.dim('Run')} ${named} ${style.dim(rest)}`, { lead: '' }, context);
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
  context: ViewContext,
): string[] {
  const { style } = context;
  const name = style.highlight(style.escape(path));
  const lines: string[] = [];
  if (!isEmpty(children)) {
    const spelling = variant === 'compact' ? '-h' : '--help';
    lines.push(
      ...hint(
        `${name} ${style.dim.italic('<command>')} ${style.highlight(spelling)}`,
        'for command details.',
        context,
      ),
    );
  }
  if (variant === 'compact' && omitted) {
    lines.push(
      ...hint(`${name} ${style.highlight('--help')}`, 'for details and examples.', context),
    );
  }
  return lines;
}

function stdinInput(command: CommandNode, graph: CommandGraph, context: ViewContext): string[] {
  const { style } = context;
  const input = command.stdin;
  if (input === undefined) {
    return [];
  }
  // The description and the stdin sentence are prose, and the example line is a literal.
  const summary = singleLineOf(input.description);
  const description =
    summary === undefined
      ? []
      : prose(style.primary(style.escape(summary)), { lead: '  ' }, context);
  const sentence = style.primary(
    `${input.required ? 'Required.' : 'Optional.'} Reads piped or redirected stdin. Terminal input is not accepted.`,
  );
  return [
    style.dim('INPUT'),
    ...description,
    ...prose(sentence, { lead: '  ' }, context),
    `  ${style.primary(style.escape(`Example: <producer> | ${pathOf(graph, command)}`))}`,
  ];
}

/** Each option-group sentence is prose, so on a terminal it wraps and continues at its indent. */
function groupLines(command: CommandNode, context: ViewContext): string[] {
  return groupSentences(command).flatMap((sentence) =>
    prose(context.style.primary(context.style.escape(sentence)), { lead: '  ' }, context),
  );
}

/**
 * The help page of one routed Command, derived from the graph and the variant and nothing else. It
 * separates blocks by one blank line; Details and each epilog also keep authored blank lines inside
 * them. A block with nothing to show is omitted, and the page carries no line terminator of its own
 * at either end. The compact page omits Details and EXAMPLES, and both pages end with the epilogs.
 */
function renderPage({ command, graph, variant }: HelpPage, context: ViewContext): string {
  const path = pathOf(graph, command);
  // One reading of the visible children answers four questions.
  // They are the children usage form, the Command sections, the ARGUMENTS `--` row, and the child hint.
  const children = visible(command.children);
  const detailLines = details(command, context);
  const listed = examples(graph, command, context);
  const extended = variant === 'extended';
  const omitted = !extended && !(isEmpty(detailLines) && isEmpty(listed));
  const page = [
    masthead(path, command, context),
    extended ? detailLines : [],
    usage({ children, command, graph }, context),
    ...commands({ children, command }, context),
    args({ children, command }, context),
    stdinInput(command, graph, context),
    ...options(command, graph, context),
    groupLines(command, context),
    extended ? listed : [],
    hints({ children, omitted, path, variant }, context),
    ...epilogsOf(graph, command).map((source) => renderDetails(source, context)),
  ]
    .filter((block) => !isEmpty(block))
    .map((block) => block.join('\n'))
    .join('\n\n');
  // On a terminal the page holds no tab, so a literal's tab expands from its line's start.
  // Prose expanded its own tabs before it wrapped, so this pass reaches literals alone.
  return onTerminal(context) ? context.expandTabs(page) : page;
}

export type { Example, UsageSubject };
export {
  childSuffix,
  commandHelp,
  commandMembers,
  escapeDescription,
  foldsGlobals,
  notesEscape,
  optionMembers,
  pathOf,
  renderPage,
  usageForms,
  visible,
};
