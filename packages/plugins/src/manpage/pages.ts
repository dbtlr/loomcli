/*
 * The page set: one page for the root and for every Command that is not hidden and has no hidden
 * ancestor, named like git's pages, and the judgment that no two names are one file on a file
 * system that ignores case.
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

/** A name with its ASCII letters in lowercase, the name a file system that ignores case compares. */
function folded(name: string): string {
  return name.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

/** The fault of two Commands whose page names are one file without ASCII case. */
function nameTaken(
  earlier: { readonly command: CommandNode; readonly name: string },
  later: { readonly command: CommandNode; readonly name: string },
): DeclarationError {
  const pair = `Commands "${earlier.command.path.join(' ')}" and "${later.command.path.join(' ')}"`;
  const sentence =
    earlier.name === later.name
      ? `${pair} both give the man page ${later.name}.`
      : `${pair} give the man pages ${earlier.name} and ${later.name}, which one file holds on a file system that ignores case.`;
  return new DeclarationError(manpagePageNameTaken, {
    correction: 'Rename one of them, or hide one.',
    sentence,
  });
}

/**
 * Judges the page names of every build: no two findable Commands give names that are equal when
 * ASCII letters are compared without case. A hidden Command gives no page, so it collides with
 * nothing.
 */
const judgePageNames: GraphBuiltHook = (graph) => {
  const seen = new Map<string, { readonly command: CommandNode; readonly name: string }>();
  for (const { command } of findable(graph)) {
    const name = pageName(graph, command);
    const earlier = seen.get(folded(name));
    if (earlier !== undefined) {
      throw nameTaken(earlier, { command, name });
    }
    seen.set(folded(name), { command, name });
  }
  return undefined;
};

export type { Findable };
export { findable, judgePageNames, pageFile, pageName };
