/*
 * The page set: one page for the root and for every Command that is not hidden and has no hidden
 * ancestor, named like git's pages, and the judgment that no two Commands give one name.
 */
import { DeclarationError } from '@loomcli/core';
import type { CommandGraph, CommandNode, GraphBuiltHook } from '@loomcli/core';

import { visible } from '../help/page.js';
import { manpagePageNameTaken } from '../rules.js';

/** One findable Command with the Command it is under, `undefined` for the root. */
interface Findable {
  readonly command: CommandNode;
  readonly parent: CommandNode | undefined;
}

/** A Command, then each visible child and its findable descendants, in graph order. */
function walk(command: CommandNode, parent: CommandNode | undefined): Findable[] {
  return [
    { command, parent },
    ...visible(command.children).flatMap((child) => walk(child, command)),
  ];
}

/** The root, then each visible child and its findable descendants, in graph order. */
function findable(graph: CommandGraph): Findable[] {
  return walk(graph.root, undefined);
}

/** A page's name: the application name, then each name on the Command's path, joined with `-`. */
function pageName(graph: CommandGraph, command: CommandNode): string {
  return [graph.name, ...command.path].join('-');
}

/** A page's file: its name in section 1. */
function pageFile(name: string): string {
  return `${name}.1`;
}

/** The fault of two Commands that give one page name. */
function nameTaken(earlier: CommandNode, later: CommandNode, name: string): DeclarationError {
  return new DeclarationError(manpagePageNameTaken, {
    correction: 'Rename one of them, or hide one.',
    sentence: `Commands "${earlier.path.join(' ')}" and "${later.path.join(' ')}" both give the man page ${name}.`,
  });
}

/**
 * Judges the page names of every build: no two findable Commands give one name, as `config-set`
 * and `config set` do. A hidden Command gives no page, so it collides with nothing.
 */
const judgePageNames: GraphBuiltHook = (graph) => {
  const seen = new Map<string, CommandNode>();
  for (const { command } of findable(graph)) {
    const name = pageName(graph, command);
    const earlier = seen.get(name);
    if (earlier !== undefined) {
      throw nameTaken(earlier, command, name);
    }
    seen.set(name, command);
  }
  return undefined;
};

export type { Findable };
export { findable, judgePageNames, pageFile, pageName };
