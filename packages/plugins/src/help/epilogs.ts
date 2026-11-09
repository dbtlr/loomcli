import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode } from '@loomcli/core';

import { helpCommand } from './extension.js';

/** The ancestors of `command`, its parent first and the root last, reached through its path. */
function ancestorsOf(graph: CommandGraph, command: CommandNode): CommandNode[] {
  const ancestors: CommandNode[] = [];
  let reached = graph.root;
  for (const name of command.path) {
    ancestors.unshift(reached);
    const child = reached.children.find((each) => each.name === name);
    // The page's own graph names every segment of its path, so this stop is never reached.
    if (child === undefined) {
      break;
    }
    reached = child;
  }
  return ancestors;
}

/**
 * The epilogs a page of `command` ends with: its own first, then each ancestor's, the root's last.
 * The help page and the man page both read them here, so the two print the same epilogs in one order.
 */
function epilogsOf(graph: CommandGraph, command: CommandNode): string[] {
  return [command, ...ancestorsOf(graph, command)].flatMap(
    (node) => readExtension(node, helpCommand)?.epilog ?? [],
  );
}

export { epilogsOf };
