/*
 * One man page: roff for the man macro package, derived from the graph and the help and
 * configuration values each Command carries, and from no host fact, so a graph gives the same
 * bytes on every host.
 */
import { readExtension } from '@loomcli/core';
import type { ArgumentNode, CommandGraph, CommandNode, OptionNode } from '@loomcli/core';

import { configInput } from '../config/extension.js';
import { argumentAccepts, optionAccepts } from '../help/accepted.js';
import {
  argumentFacts,
  delimiterLiteral,
  deprecatedFacts,
  isEmpty,
  optionCellParts,
  optionFacts,
  rightCellWith,
} from '../help/cells.js';
import type { CellText, CellWriter, Fact } from '../help/cells.js';
import {
  childSuffix,
  commandHelp,
  commandMembers,
  foldsGlobals,
  optionMembers,
  usageForms,
  visible,
} from '../help/page.js';
import type { Example } from '../help/page.js';
import { orderedSections } from '../help/sections.js';
import type { OrderedSection, SectionMember } from '../help/sections.js';
import { singleLine, singleLineOf } from '../lines.js';
import { detailsLines } from './markdown.js';
import { findable, pageFile, pageName } from './pages.js';
import { escapeText, escapeUnbroken, inFont, request, textLine } from './roff.js';

/** The page section every page is in. */
const section = '1';

/** The indentation of an example's note under its command. */
const noteIndent = 4;

/** The index of a list's first member. */
const firstIndex = 0;

/** Help's right cell as plain text, which the page escapes as one filled line. */
const plainCell: CellWriter = {
  fact: (fact: Fact) => fact.text,
  mark: (mark) => mark,
  prose: (prose) => prose,
};

/** Help's right cell for a row, as the text of a page entry. */
function entryText(text: CellText, facts: readonly Fact[]): string {
  return escapeText(rightCellWith(text, facts, plainCell));
}

/**
 * One entry: `.TP`, its tag, and its text, a filled paragraph. An extra line follows a `.br`, and
 * an entry with no text writes its first extra line right after the tag.
 */
function entry(tag: string, text: string, extras: readonly string[] = []): string[] {
  const lines = ['.TP', textLine(tag)];
  if (text !== '') {
    lines.push(textLine(text));
  }
  extras.forEach((extra, index) => {
    if (index > firstIndex || text !== '') {
      lines.push('.br');
    }
    lines.push(textLine(extra));
  });
  return lines;
}

/** A section's heading and its lines, or nothing when it has nothing to show. */
function headed(heading: string, lines: readonly string[]): string[] {
  return isEmpty(lines) ? [] : [request('SH', [heading]), ...lines];
}

/** Help's ordered sections as `.SH` and `.SS` sections, each row written as entries. */
function sectionLines<Shown>(
  sections: readonly OrderedSection<Shown>[],
  write: (row: Shown) => string[],
): string[] {
  return sections.flatMap((outer) => [
    request('SH', [outer.heading]),
    ...outer.rows.flatMap(write),
    ...outer.subsections.flatMap((inner) => [
      request('SS', [inner.heading]),
      ...inner.rows.flatMap(write),
    ]),
  ]);
}

/** The rows of ordered sections in the order the page lists them. */
function listed<Shown>(sections: readonly OrderedSection<Shown>[]): Shown[] {
  return sections.flatMap((outer) => [
    ...outer.rows,
    ...outer.subsections.flatMap((inner) => inner.rows),
  ]);
}

/** What every section of one page reads. */
interface Subject {
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly parent: CommandNode | undefined;
  readonly children: readonly CommandNode[];
  readonly commandSections: readonly OrderedSection<CommandNode>[];
  readonly optionSections: readonly OrderedSection<OptionNode>[];
}

/** The page name with its ASCII letters in uppercase, as `.TH` names it. */
function titleName(name: string): string {
  return name.replaceAll(/[a-z]/gu, (letter) => letter.toUpperCase());
}

function title({ command, graph }: Subject): string[] {
  const name = pageName(graph, command);
  return [request('TH', [titleName(name), section, '', `${graph.name} ${graph.version}`, ''])];
}

function nameSection({ command, graph }: Subject): string[] {
  const name = escapeText(pageName(graph, command));
  const line =
    command.description === undefined
      ? name
      : `${name} \\- ${escapeText(singleLine(command.description))}`;
  return headed('NAME', [textLine(line)]);
}

/** Each usage form help prints, in no-fill text, with the path in bold. */
function synopsis({ children, command, graph }: Subject): string[] {
  const forms = usageForms(
    { children, command, graph },
    {
      path: (text) => inFont(text, 'bold', 'noFill'),
      spelling: (text) => escapeText(text, 'noFill'),
      word: (text) => escapeText(text, 'noFill'),
    },
  );
  const [firstForm] = forms;
  return isEmpty(forms)
    ? []
    : headed('SYNOPSIS', [
        '.nf',
        ...forms.map((form) =>
          textLine(
            command.stdin?.required && command.hasAction && form === firstForm
              ? `${escapeText('<producer> | ', 'noFill')}${form}`
              : form,
          ),
        ),
        '.fi',
      ]);
}

/** The deprecation paragraph, then the details. */
function description({ command }: Subject): string[] {
  const deprecation =
    command.deprecated === undefined
      ? []
      : [textLine(escapeText(`Deprecated: ${singleLine(command.deprecated)}`))];
  const source = commandHelp(command)?.details;
  const details =
    source === undefined ? [] : detailsLines(source, { preceded: !isEmpty(deprecation) });
  return headed('DESCRIPTION', [...deprecation, ...details]);
}

/** One child's entry: its name in bold and help's suffix, and help's right cell for the row. */
function childEntry(child: CommandNode): string[] {
  const suffix = childSuffix(child);
  const tag = `${inFont(child.name ?? '', 'bold')}${suffix === undefined ? '' : ` ${escapeText(suffix)}`}`;
  return entry(tag, entryText({ description: child.description }, deprecatedFacts(child)));
}

function argumentEntry(argument: ArgumentNode): string[] {
  return entry(
    inFont(argument.name, 'italic'),
    entryText(
      { accepts: argumentAccepts(argument), description: argument.description },
      argumentFacts(argument),
    ),
  );
}

function stdinSection({ command, graph }: Subject): string[] {
  const input = command.stdin;
  if (input === undefined) {
    return [];
  }
  const commandName = [graph.name, ...command.path].join(' ');
  const summary = singleLineOf(input.description);
  return headed('INPUT', [
    ...(summary === undefined ? [] : [textLine(escapeText(summary))]),
    textLine(
      escapeText(
        `${input.required ? 'Required.' : 'Optional.'} Reads piped or redirected stdin. Terminal input is not accepted.`,
      ),
    ),
    textLine(escapeText(`Example: <producer> | ${commandName}`)),
  ]);
}

function argumentsSection({ command }: Subject): string[] {
  return headed('ARGUMENTS', command.arguments.flatMap(argumentEntry));
}

/**
 * An option's tag: help's left cell without its indentation, each spelling in bold, each
 * placeholder in italic, and the separators, brackets, `=`, and `...` regular.
 */
function optionTag(option: OptionNode): string {
  const parts = optionCellParts(option);
  const spellings = [parts.short, parts.long]
    .filter((spelling) => spelling !== null)
    .map((spelling) => inFont(spelling, 'bold'))
    .join(', ');
  if (parts.trailingEllipsis) {
    return `${spellings}...`;
  }
  if (parts.value === undefined) {
    return spellings;
  }
  const { after, before, placeholder, separator } = parts.value;
  return `${spellings}${escapeText(`${separator}${before}`)}${inFont(placeholder, 'italic')}${escapeText(after)}`;
}

/**
 * The delimiter a multiple option's variable is a list under, as help writes it, with a space that
 * never breaks the line, or `undefined` for an option whose variable holds one value.
 */
function listDelimiter(option: OptionNode): string | undefined {
  const literal = delimiterLiteral(option);
  return literal === undefined ? undefined : escapeUnbroken(literal);
}

/** The lines an option's entry adds after its text: its environment and configuration bindings. */
function bindings(option: OptionNode): string[] {
  const path = readExtension(option, configInput)?.path;
  const delimiter = listDelimiter(option);
  return [
    ...(isEmpty(option.env)
      ? []
      : [
          `Environment: ${option.env.map((name) => inFont(name, 'bold')).join(', ')}${
            delimiter === undefined ? '' : ` (a list separated by ${delimiter})`
          }`,
        ]),
    ...(path === undefined ? [] : [`Configuration: ${inFont(path, 'bold')}`]),
  ];
}

function optionEntry(option: OptionNode): string[] {
  return entry(
    optionTag(option),
    entryText(
      { accepts: optionAccepts(option), description: option.description },
      optionFacts(option),
    ),
    bindings(option),
  );
}

/** The spelling an ENVIRONMENT entry names: the tag's long spelling, or its short one. */
function suppliedSpelling(option: OptionNode): string {
  const { long, short } = optionCellParts(option);
  return long ?? short ?? '';
}

function environment({ optionSections }: Subject): string[] {
  const lines = listed(optionSections).flatMap((option) =>
    option.env.flatMap((name) => {
      const delimiter = listDelimiter(option);
      const list = delimiter === undefined ? '' : ` as a list separated by ${delimiter}`;
      return entry(
        inFont(name, 'bold'),
        `Supplies ${inFont(suppliedSpelling(option), 'bold')}${list}.`,
      );
    }),
  );
  return headed('ENVIRONMENT', lines);
}

/** One example: its command in bold as one no-fill line, then its note indented under it. */
function exampleLines(name: string, example: Example): string[] {
  const lines = ['.nf', textLine(inFont(`$ ${name} ${example.command}`, 'bold', 'noFill')), '.fi'];
  if (example.note !== undefined) {
    lines.push(`.RS ${noteIndent}`, textLine(escapeText(example.note)), '.RE');
  }
  return lines;
}

/** Each example, a `.PP` between one and the next. */
function examples({ command, graph }: Subject): string[] {
  const lines: string[] = [];
  for (const example of commandHelp(command)?.examples ?? []) {
    if (!isEmpty(lines)) {
      lines.push('.PP');
    }
    lines.push(...exampleLines(graph.name, example));
  }
  return headed('EXAMPLES', lines);
}

/** The root page, the parent's page when it is not the root, then each visible child's page. */
function seeAlso({ commandSections, graph, parent }: Subject): string[] {
  const named = [
    ...(parent === undefined ? [] : [graph.root]),
    ...(parent === undefined || parent === graph.root ? [] : [parent]),
    ...listed(commandSections),
  ].map((node) => `${inFont(pageName(graph, node), 'bold')}(${section})`);
  return headed('SEE ALSO', isEmpty(named) ? [] : [named.join(', ')]);
}

/** The sections a page's members fall in, read once for every section that lists them. */
function subjectOf(
  graph: CommandGraph,
  command: CommandNode,
  parent: CommandNode | undefined,
): Subject {
  const children = visible(command.children);
  const help = commandHelp(command);
  const globals = parent === undefined ? graph.globals : [];
  const members: SectionMember<OptionNode>[] = optionMembers(command, {
    globalHeading: foldsGlobals(graph) ? 'OPTIONS' : 'GLOBAL OPTIONS',
    globals,
  });
  return {
    children,
    command,
    commandSections: orderedSections(help?.commandSections, commandMembers(children)),
    graph,
    optionSections: orderedSections(help?.optionSections, members),
    parent,
  };
}

/**
 * The text of one page: its sections in order, each omitted when it has nothing to show, every
 * line ended by a line feed. `parent` is the Command the page's Command is under, `undefined` for
 * the root.
 */
function renderManPage(
  graph: CommandGraph,
  command: CommandNode,
  parent: CommandNode | undefined,
): string {
  const subject = subjectOf(graph, command, parent);
  const lines = [
    ...title(subject),
    ...nameSection(subject),
    ...synopsis(subject),
    ...description(subject),
    ...sectionLines(subject.commandSections, childEntry),
    ...argumentsSection(subject),
    ...stdinSection(subject),
    ...sectionLines(subject.optionSections, optionEntry),
    ...examples(subject),
    ...environment(subject),
    ...seeAlso(subject),
  ];
  return `${lines.map((line) => line.trimEnd()).join('\n')}\n`;
}

/** One page of the set: its file name and its text. */
interface ManPage {
  readonly file: string;
  readonly text: string;
}

/** The page set of a graph: one page for the root and each findable Command, in graph order. */
function manPages(graph: CommandGraph): ManPage[] {
  return findable(graph).map(({ command, parent }) => ({
    file: pageFile(pageName(graph, command)),
    text: renderManPage(graph, command, parent),
  }));
}

export type { ManPage };
export { manPages, renderManPage };
