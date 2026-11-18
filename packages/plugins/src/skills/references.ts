/*
 * The command references: one CommonMark file for each Command a selection gives a file, and the
 * index of them, derived from the graph and the extension values its nodes carry and from no host
 * fact, so a graph gives the same bytes on every host. A row, a left cell, and a right cell are the
 * help page's, through help's own cells, with no option alias.
 */
import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode } from '@loomcli/core';

import { optionAccepts } from '../help-accepted.js';
import {
  aliasLabels,
  aliasSeparator,
  isEmpty,
  optionLabel,
  plainFact,
  rightCellWith,
  unaliasedOptionFacts,
} from '../help-cells.js';
import type { CellText, CellWriter, Fact } from '../help-cells.js';
import {
  argumentRows,
  needsProducer,
  pathOf,
  stdinParts,
  terminalNeed,
  usageForms,
  visible,
} from '../help-page.js';
import { singleLineOf } from '../lines.js';
import { manifestCommand } from '../manifest/extension.js';
import { groupSentences } from '../option-groups.js';
import { skillCommand } from './extension.js';
import { authoredMarkdown, codeSpan, shownText } from './markdown.js';
import { indexFile, referenceName, selectedCommands } from './selection.js';
import type { CommandReferenceFile, CommandReferenceSettings } from './types.js';

/** Help's right cell as plain text, each fact as help words it with no style. */
const plainCell: CellWriter = {
  fact: (fact: Fact) => plainFact(fact),
  mark: (mark) => mark,
  prose: (prose) => prose,
};

/** Help's right cell for a row as the escaped text of a list item. */
function cellText(text: CellText, facts: readonly Fact[]): string {
  return shownText(rightCellWith(text, facts, plainCell), { paragraph: false });
}

/** A paragraph of text Loom shows. */
function paragraph(text: string): string {
  return shownText(text, { paragraph: true });
}

/** A list item: its label as a code span, then `: ` and its text when it has one. */
function labelledItem(label: string, text: string): string {
  return text === '' ? `- ${codeSpan(label)}` : `- ${codeSpan(label)}: ${text}`;
}

/** A block under its `##` heading, or nothing when it has nothing to show. */
function headed(heading: string, blocks: readonly string[]): string[] {
  return isEmpty(blocks) ? [] : [`## ${heading}`, ...blocks];
}

/** A list's items as one block, or no block when it has none. */
function list(items: readonly string[]): string[] {
  return isEmpty(items) ? [] : [items.join('\n')];
}

/**
 * One option entry: help's left cell without its short spelling as the label, and help's right
 * cell with the alias fact left out as its text.
 */
function optionEntry(option: OptionNode): string {
  return labelledItem(
    optionLabel(option),
    cellText(
      { accepts: optionAccepts(option), description: option.description },
      unaliasedOptionFacts(option),
    ),
  );
}

/** What every block of one Command's file reads. */
interface Subject {
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly guidance: boolean;
}

/** The heading, the alias, terminal, and deprecated paragraphs, and the description. */
function opening({ command, graph }: Subject): string[] {
  const names = command.visibleAliases;
  const description = singleLineOf(command.description);
  return [
    `# ${shownText(pathOf(graph, command), { paragraph: false })}`,
    ...(isEmpty(names)
      ? []
      : [paragraph(`${aliasLabels(names).line}${names.join(aliasSeparator)}`)]),
    ...(command.needsTerminal ? [`${terminalNeed.label}${terminalNeed.text}`] : []),
    ...(command.deprecated === undefined
      ? []
      : [`Deprecated: ${shownText(command.deprecated, { paragraph: false })}`]),
    ...(description === undefined ? [] : [paragraph(description)]),
  ];
}

/** A usage form's word as written, with no style and no escape. */
function plainWord(text: string): string {
  return text;
}

/**
 * Each usage form help prints, without its indent, in a fenced `text` block, the action form
 * beginning `<producer> | ` for a required standalone stdin.
 */
function usage({ command, graph }: Subject): string[] {
  const [first, ...rest] = usageForms(
    { children: visible(command.children), command, graph },
    { path: plainWord, spelling: plainWord, word: plainWord },
  );
  if (first === undefined) {
    return [];
  }
  const stdinFirst = needsProducer(command);
  const lines = [stdinFirst ? `<producer> | ${first}` : first, ...rest];
  return headed('Usage', [['```text', ...lines, '```'].join('\n')]);
}

/** Each row help's ARGUMENTS block prints, its left cell a code span. */
function argumentsBlock({ command }: Subject): string[] {
  const rows = argumentRows({ children: visible(command.children), command });
  return headed(
    'Arguments',
    list(
      rows.map(({ facts, lead, text, word }) =>
        labelledItem(`${lead}${word}`, cellText(text, facts)),
      ),
    ),
  );
}

/** Each line help's INPUT block prints, each a paragraph. */
function input({ command, graph }: Subject): string[] {
  const parts = stdinParts(command, graph);
  if (parts === undefined) {
    return [];
  }
  return headed(
    'Input',
    [parts.summary, parts.sentence, parts.example]
      .filter((line) => line !== undefined)
      .map((line) => paragraph(line)),
  );
}

/** The visible local options as entries, then each option-group sentence as a paragraph. */
function optionsBlock({ command }: Subject): string[] {
  const entries = visible(command.options).map((option) => optionEntry(option));
  return headed('Options', [
    ...list(entries),
    ...groupSentences(command).map((sentence) => paragraph(sentence)),
  ]);
}

/** The result's kind and its views, the default marked. */
function resultBlock({ command }: Subject): string[] {
  const { result } = command;
  if (result === null) {
    return [];
  }
  const views = result.views
    .map((view) => (view === result.default ? `${codeSpan(view)} (default)` : codeSpan(view)))
    .join(', ');
  return headed('Result', [`Kind: ${codeSpan(result.kind)}. Views: ${views}.`]);
}

/** The Command's skill guidance, as the author wrote it, unless the settings leave it out. */
function guidanceBlock({ command, guidance }: Subject): string[] {
  const value = guidance ? readExtension(command, skillCommand) : undefined;
  return headed('Guidance', value === undefined ? [] : [authoredMarkdown(value.guidance)]);
}

/** The `details` of each `manifestCommand` value that holds one, in collection order. */
function details({ command }: Subject): string[] {
  return headed(
    'Details',
    readExtension(command, manifestCommand).flatMap((value) =>
      value.details === undefined ? [] : [authoredMarkdown(value.details)],
    ),
  );
}

/** The examples the `manifestCommand` values hold, each invocation a code span. */
function examples({ command, graph }: Subject): string[] {
  const items = readExtension(command, manifestCommand).flatMap((value) =>
    (value.examples ?? []).map((example) =>
      labelledItem(
        `${graph.name} ${example.command}`,
        example.note === undefined ? '' : shownText(example.note, { paragraph: false }),
      ),
    ),
  );
  return headed('Examples', list(items));
}

/** The failures the `manifestCommand` values declare, each code a code span. */
function failures({ command }: Subject): string[] {
  const items = readExtension(command, manifestCommand).flatMap((value) =>
    (value.failures ?? []).map(
      (failure) =>
        `- ${codeSpan(failure.code)} (exit ${String(failure.exitCode)}): ${shownText(failure.meaning, { paragraph: false })}`,
    ),
  );
  return headed('Failures', list(items));
}

/** A file's blocks, one blank line between two of them and one LF after the last. */
function fileText(blocks: readonly string[]): string {
  return `${blocks.join('\n\n')}\n`;
}

/** One Command's command reference. */
function referenceText(subject: Subject): string {
  return fileText(
    [
      opening,
      usage,
      argumentsBlock,
      input,
      optionsBlock,
      resultBlock,
      guidanceBlock,
      details,
      examples,
      failures,
    ].flatMap((block) => block(subject)),
  );
}

/** One index entry: the link to the Command's file, its description, and its alias, terminal, and deprecated facts. */
function indexEntry(graph: CommandGraph, command: CommandNode): string {
  const link = `[${shownText(pathOf(graph, command), { paragraph: false })}](${referenceName(graph, command)})`;
  const description = singleLineOf(command.description);
  const names = command.visibleAliases;
  const facts = [
    ...(isEmpty(names) ? [] : [`${aliasLabels(names).fact}${names.join(aliasSeparator)}`]),
    ...(command.needsTerminal ? ['needs a terminal'] : []),
    ...(command.deprecated === undefined ? [] : ['deprecated']),
  ];
  return [
    `- ${link}`,
    description === undefined ? '' : `: ${shownText(description, { paragraph: false })}`,
    isEmpty(facts) ? '' : ` (${facts.join(', ')})`,
  ].join('');
}

/** The index: its frontmatter, its heading, an entry per file, and the visible global options. */
function indexText(graph: CommandGraph, commands: readonly CommandNode[]): string {
  const frontmatter = [
    '---',
    `application: ${JSON.stringify(graph.name)}`,
    `version: ${JSON.stringify(graph.version)}`,
    '---',
  ].join('\n');
  const globals = visible(graph.globals).map((option) => optionEntry(option));
  return fileText([
    frontmatter,
    `# ${shownText(graph.name, { paragraph: false })} commands`,
    commands.map((command) => indexEntry(graph, command)).join('\n'),
    ...headed('Global options', list(globals)),
  ]);
}

/**
 * The files the paths select, judged as the build judges them: `index.md` first, then each
 * Command's file in graph order, or none when the paths select no Command an operator can find.
 * `skill` names the skill in a fault's sentence, and is left out by `commandReferences`.
 */
function renderReferences(
  graph: CommandGraph,
  settings: CommandReferenceSettings,
  skill?: string,
): CommandReferenceFile[] {
  const commands = selectedCommands(
    graph,
    settings.commands,
    skill === undefined ? undefined : { skill },
  );
  if (isEmpty(commands)) {
    return [];
  }
  return [
    { content: indexText(graph, commands), name: indexFile },
    ...commands.map((command) => ({
      content: referenceText({ command, graph, guidance: settings.guidance }),
      name: referenceName(graph, command),
    })),
  ];
}

export { renderReferences };
