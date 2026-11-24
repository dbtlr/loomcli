import { nowrap, readExtension } from '@loomcli/core';
import type {
  CommandGraph,
  CommandNode,
  ContextualStyle,
  OptionNode,
  Phrase,
  ViewContext,
} from '@loomcli/core';

import { argumentAcceptsSaid, optionAcceptsSaid } from './help-accepted.js';
import {
  aliasLabelPhrases,
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
import type { CellText, Fact, Row, StringOption, UsageWriter } from './help-cells.js';
import { renderDetails } from './help-details.js';
import { epilogsOf } from './help-epilogs.js';
import { hangLines, onTerminal, prose } from './help-layout.js';
import { sectionBlocks } from './help-sections.js';
import type { SectionMember } from './help-sections.js';
import { helpCommand, helpInput } from './help/extension.js';
import { helpPhrase } from './help/phrases.js';
import type { HelpPage, HelpVariant } from './help/views.js';
import { singleLineOf } from './lines.js';
import { groupPhrases } from './option-groups.js';
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
    {
      label: context.localize(aliasLabelPhrases(names).line),
      text: names.join(aliasSeparator),
      tone: 'dim',
    },
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
      : labeled(
          {
            label: context.localize(helpPhrase('deprecatedLabel')),
            text: deprecated,
            tone: 'warning',
          },
          context,
        );
  const terminal = command.needsTerminal
    ? labeled(
        {
          label: context.localize(terminalNeedPhrases.label),
          text: context.localize(terminalNeedPhrases.text),
          tone: 'dim',
        },
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

/** The line that says a Command needs a terminal, as phrases help says in the run's language. */
const terminalNeedPhrases = {
  label: helpPhrase('needsTerminalLabel'),
  text: helpPhrase('needsTerminalText'),
};

/** The line that says a Command needs a terminal, in English, as the man page and a command reference show it. */
const terminalNeed = { label: terminalNeedPhrases.label.text, text: terminalNeedPhrases.text.text };

/** A fixed label of the page, said in the run's language and printed dim. */
function dimLabel(phrase: Phrase, { localize, style }: ViewContext): string {
  return style.dim(style.escape(localize(phrase)));
}

/** Whether the first usage form begins with a producer for required standalone input. */
function needsProducer(command: CommandNode): boolean {
  return command.stdin?.required === true && command.hasAction;
}

/** The USAGE block: one line per form, its words styled as the page styles them. */
function usage(subject: UsageSubject, context: ViewContext): string[] {
  const { style } = context;
  const forms = usageForms(subject, {
    path: (text) => style.highlight(style.escape(text)),
    spelling: (text) => style.highlight(style.escape(text)),
    word: (text) => style.dim.italic(style.escape(text)),
  });
  const [firstForm] = forms;
  return isEmpty(forms)
    ? []
    : [
        dimLabel(helpPhrase('usageHeading'), context),
        ...forms.map(
          (form) =>
            `  ${needsProducer(subject.command) && form === firstForm ? `${style.dim.italic('<producer>')} | ` : ''}${form}`,
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
      labels: new Map([['COMMANDS', helpPhrase('commandsHeading')]]),
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
const escapePhrase = helpPhrase('escapeDescription');

/** The right cell of the `--` row in English, as the man page shows it. */
const escapeDescription = escapePhrase.text;

/**
 * Whether the page notes the `--` escape: the node declares an argument, holds a visible child
 * whose name an operator might mean as one, and has no passthrough mode, whose own row names `--`.
 */
function notesEscape(command: CommandNode, children: readonly CommandNode[]): boolean {
  return !isEmpty(command.arguments) && !isEmpty(children) && !command.passthrough;
}

/** The parts of a right cell that are help's own sentences, which help says in the run's language. */
interface SaidText {
  readonly accepts?: Phrase | undefined;
  readonly description?: Phrase;
}

/**
 * One ARGUMENTS row before a projection styles it: the left cell's literal lead and the word after
 * it that help prints dim and italic, and the right cell's text and facts, in English. A part of
 * the text that is help's own sentence, not declared, is in `said` too as a phrase.
 */
interface ArgumentRowParts {
  readonly lead: string;
  readonly word: string;
  readonly text: CellText;
  readonly facts: readonly Fact[];
  readonly said: SaidText;
}

/** A sentence that is declared text or help's own phrase, split into its English and its phrase. */
function sentenceParts(sentence: string | Phrase | undefined): {
  readonly english: string | undefined;
  readonly phrase: Phrase | undefined;
} {
  return typeof sentence === 'object'
    ? { english: sentence.text, phrase: sentence }
    : { english: sentence, phrase: undefined };
}

/** A right cell's text with help's own sentences said in the run's language. */
function saidText(text: CellText, said: SaidText, { localize }: ViewContext): CellText {
  return {
    accepts: said.accepts === undefined ? text.accepts : localize(said.accepts),
    description: said.description === undefined ? text.description : localize(said.description),
  };
}

/**
 * The ARGUMENTS rows of a Command, in help's order: each argument, the passthrough row, and the
 * `--` row when the page notes the escape.
 */
function argumentRows({
  command,
  children,
}: {
  command: CommandNode;
  children: readonly CommandNode[];
}): ArgumentRowParts[] {
  const rows: ArgumentRowParts[] = command.arguments.map((argument) => {
    const accepts = sentenceParts(argumentAcceptsSaid(argument));
    return {
      facts: argumentFacts(argument),
      lead: '',
      said: { accepts: accepts.phrase },
      text: { accepts: accepts.english, description: argument.description },
      word: argument.name,
    };
  });
  if (command.passthrough) {
    rows.push({
      facts: [],
      lead: '-- ',
      said: {},
      text: { description: command.passthrough.description },
      word: '<args>...',
    });
  }
  if (notesEscape(command, children)) {
    rows.push({
      facts: [],
      lead: '--',
      said: { description: escapePhrase },
      text: { description: escapeDescription },
      word: '',
    });
  }
  return rows;
}

function args(
  subject: { command: CommandNode; children: readonly CommandNode[] },
  context: ViewContext,
): string[] {
  const { style } = context;
  const rows = argumentRows(subject).map(({ facts, lead, said, text, word }) => ({
    left: `${lead}${word === '' ? '' : style.dim.italic(style.escape(word))}`,
    right: rightCell(saidText(text, said, context), facts, context),
  }));
  return isEmpty(rows)
    ? []
    : [dimLabel(helpPhrase('argumentsHeading'), context), ...column(rows, context)];
}

function optionRow(option: OptionNode, context: ViewContext): Row {
  const accepts = sentenceParts(optionAcceptsSaid(option));
  return {
    left: optionCell(option, context),
    right: rightCell(
      saidText(
        { accepts: accepts.english, description: option.description },
        { accepts: accepts.phrase },
        context,
      ),
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
      labels: new Map([
        ['GLOBAL OPTIONS', helpPhrase('globalOptionsHeading')],
        ['OPTIONS', helpPhrase('optionsHeading')],
      ]),
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
  return isEmpty(lines) ? [] : [dimLabel(helpPhrase('examplesHeading'), context), ...lines];
}

/**
 * One hint: the sentence the run's language says around the command it names. On a terminal the
 * hint wraps at the left margin, and the command sits in `nowrap`, so it stays on one line.
 */
function hint(
  command: string,
  say: (named: string, style: ContextualStyle) => Phrase,
  context: ViewContext,
): string[] {
  const named = onTerminal(context) ? nowrap(command) : command;
  return prose(context.localize(say(named, context.style)), { lead: '' }, context);
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
        (named, said) => helpPhrase('childHint', named, said),
        context,
      ),
    );
  }
  if (variant === 'compact' && omitted) {
    lines.push(
      ...hint(
        `${name} ${style.highlight('--help')}`,
        (named, said) => helpPhrase('extendedHint', named, said),
        context,
      ),
    );
  }
  return lines;
}

/**
 * The INPUT block's lines for a Command that declares a standalone stdin, as phrases: the
 * description on one line, when it has one, the sentence that says whether stdin is required, and
 * the example line. A Command with no stdin has none.
 */
function stdinPhrases(
  command: CommandNode,
  graph: CommandGraph,
): { summary: string | undefined; sentence: Phrase; example: Phrase } | undefined {
  const input = command.stdin;
  if (input === undefined) {
    return undefined;
  }
  return {
    example: helpPhrase('stdinExample', pathOf(graph, command)),
    sentence: helpPhrase(input.required ? 'stdinRequired' : 'stdinOptional'),
    summary: singleLineOf(input.description),
  };
}

/** The plain English text of the INPUT block's lines, as a command reference shows them. */
function stdinParts(
  command: CommandNode,
  graph: CommandGraph,
): { summary: string | undefined; sentence: string; example: string } | undefined {
  const parts = stdinPhrases(command, graph);
  return parts === undefined
    ? undefined
    : { example: parts.example.text, sentence: parts.sentence.text, summary: parts.summary };
}

function stdinInput(command: CommandNode, graph: CommandGraph, context: ViewContext): string[] {
  const { localize, style } = context;
  const parts = stdinPhrases(command, graph);
  if (parts === undefined) {
    return [];
  }
  // The description and the stdin sentence are prose, and the example line is a literal.
  const description =
    parts.summary === undefined
      ? []
      : prose(style.primary(style.escape(parts.summary)), { lead: '  ' }, context);
  const sentence = style.escape(localize(parts.sentence));
  const example = style.escape(localize(parts.example));
  return [
    dimLabel(helpPhrase('inputHeading'), context),
    ...description,
    ...prose(style.primary(sentence), { lead: '  ' }, context),
    `  ${style.primary(example)}`,
  ];
}

/**
 * Each option-group sentence is prose, said in the run's language, so on a terminal it wraps and
 * continues at its indent.
 */
function groupLines(command: CommandNode, context: ViewContext): string[] {
  const { localize, style } = context;
  return groupPhrases(command).flatMap((phrase) => {
    const sentence = style.escape(localize(phrase));
    return prose(style.primary(sentence), { lead: '  ' }, context);
  });
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

export type { ArgumentRowParts, Example, UsageSubject };
export {
  argumentRows,
  childSuffix,
  commandHelp,
  commandMembers,
  escapeDescription,
  foldsGlobals,
  notesEscape,
  optionMembers,
  pathOf,
  renderPage,
  stdinParts,
  usageForms,
  needsProducer,
  terminalNeed,
  visible,
};
