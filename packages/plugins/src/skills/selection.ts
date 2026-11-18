/*
 * The Commands a skill selects, and the rules a selection meets on every build: each path names a
 * Command, and no two Commands that get a command reference give one file name. This module holds
 * the judging apart from the rendering. The entry loads the renderer because `commandReferences`
 * is synchronous.
 */
import { DeclarationError, escapeControlCharacters } from '@loomcli/core';
import type { CommandGraph, CommandNode } from '@loomcli/core';

import { skillsCommands, skillsReferenceNameTaken } from '../rules.js';

/** The index every selecting skill's `references/commands/` holds beside the command references. */
const indexFile = 'index.md';

/** The folder of a skill that holds its command references. */
const referencesFolder = 'references/commands/';

/** The Command a path names, from the root down by canonical names, or none. */
function commandAt(graph: CommandGraph, path: readonly string[]): CommandNode | undefined {
  let command: CommandNode | undefined = graph.root;
  for (const name of path) {
    command = command?.children.find((child) => child.name === name);
  }
  return command;
}

/**
 * Each Command that gets a file: one a path selects, by itself or through a Command above it, that
 * is neither hidden nor under a hidden Command, in graph order, the root first and then each
 * Command's children depth first in authoring order.
 */
function filedCommands(graph: CommandGraph, named: ReadonlySet<CommandNode>): CommandNode[] {
  const walk = (command: CommandNode, selected: boolean): CommandNode[] => {
    const inside = selected || named.has(command);
    return [
      ...(inside ? [command] : []),
      ...command.children.filter((child) => !child.hidden).flatMap((child) => walk(child, inside)),
    ];
  };
  return walk(graph.root, false);
}

/** A Command's file: the application name, then each name on its path, joined with `-`, and `.md`. */
function referenceName(graph: CommandGraph, command: CommandNode): string {
  return `${[graph.name, ...command.path].join('-')}.md`;
}

/** How a fault names the skill whose selection it judges, or no skill for `commandReferences`. */
type Subject = { readonly skill: string } | undefined;

/** A path as a sentence shows it: each name as a JSON string literal, in brackets. */
function shownPath(path: readonly string[]): string {
  return escapeControlCharacters(`[${path.map((name) => JSON.stringify(name)).join(', ')}]`);
}

/** The fault of a path whose names lead to no Command. */
function unknownPath(subject: Subject, path: readonly string[]): DeclarationError {
  return new DeclarationError(skillsCommands, {
    correction:
      'Name each Command on the path from the root down, such as ["note", "add"], or select [] for the whole application.',
    sentence:
      subject === undefined
        ? `The path ${shownPath(path)} names no Command.`
        : `Skill "${subject.skill}" selects the path ${shownPath(path)}, which names no Command.`,
  });
}

/** A Command's path as a sentence shows it: its names joined with a space. */
function spokenPath(command: CommandNode): string {
  return command.path.join(' ');
}

/** The fault of two Commands that give one file, the earlier in graph order named first. */
function sameName(
  subject: Subject,
  { earlier, file, later }: { earlier: CommandNode; later: CommandNode; file: string },
): DeclarationError {
  const commands = `Commands "${spokenPath(earlier)}" and "${spokenPath(later)}"`;
  return new DeclarationError(skillsReferenceNameTaken, {
    correction: 'Rename one of them, hide one, or select one of them alone.',
    sentence:
      subject === undefined
        ? `${commands} both give the file ${file}.`
        : `Skill "${subject.skill}" selects ${commands}, which both give the file ${referencesFolder}${file}.`,
  });
}

/** The fault of a selected root whose file would be the index's. */
function rootIsIndex(subject: Subject, graph: CommandGraph): DeclarationError {
  return new DeclarationError(skillsReferenceNameTaken, {
    correction: 'Select the root\'s Commands by their own paths, such as ["get"], in place of [].',
    sentence:
      subject === undefined
        ? `The root of ${graph.name} gives the file ${indexFile}, which is the name of the index.`
        : `Skill "${subject.skill}" selects the root of ${graph.name}, whose file ${referencesFolder}${indexFile} is the name of the index.`,
  });
}

/** Throws the first file a later Command gives that an earlier one, or the index, already gives. */
function judgeNames(subject: Subject, graph: CommandGraph, filed: readonly CommandNode[]): void {
  const seen = new Map<string, CommandNode>();
  for (const command of filed) {
    const file = referenceName(graph, command);
    if (file === indexFile) {
      throw rootIsIndex(subject, graph);
    }
    const earlier = seen.get(file);
    if (earlier !== undefined) {
      throw sameName(subject, { earlier, file, later: command });
    }
    seen.set(file, command);
  }
}

/**
 * The Commands the paths select that get a file, in graph order, after judging them: each path in
 * order names a Command, then no two of the Commands give one file. A hidden Command, and every
 * Command under one, gets no file, so a path into one selects nothing and is no fault.
 */
function selectedCommands(
  graph: CommandGraph,
  paths: readonly (readonly string[])[],
  subject: Subject,
): CommandNode[] {
  const named = new Set<CommandNode>();
  for (const path of paths) {
    const command = commandAt(graph, path);
    if (command === undefined) {
      throw unknownPath(subject, path);
    }
    named.add(command);
  }
  const filed = filedCommands(graph, named);
  judgeNames(subject, graph, filed);
  return filed;
}

export { indexFile, referenceName, referencesFolder, selectedCommands };
