import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, Middleware } from '@loomcli/core';

import { explainCommand } from './extension.js';
import type { explain } from './plugin.js';

/**
 * The lines one explanation prints: the routed path, or the application's own name for the root,
 * then the core `description` fact, then the details and examples the declaration carries.
 */
function lines(command: CommandNode, graph: CommandGraph): string[] {
  // No first segment means the root was routed, which answers to the application's own name.
  const [segment] = command.path;
  const routed = segment !== undefined;
  // The root Command carries no description of its own: the Application's is the graph's fact.
  const description = routed ? command.description : graph.description;
  const explanation = readExtension(command, explainCommand);
  return [
    routed ? `${graph.name} ${command.path.join(' ')}` : graph.name,
    ...(description === undefined ? [] : [description]),
    ...(explanation
      ? [explanation.details, ...(explanation.examples ?? []).map((example) => `  ${example}`)]
      : []),
  ];
}

/**
 * Explains the routed Command and ends the invocation by returning without calling `next()`, so the
 * remaining tokens are never parsed and no document or file is ever read.
 */
const middleware: Middleware<typeof explain> = async ({ command, graph, out }) => {
  for (const line of lines(command, graph)) {
    await out.print(line);
  }
};

export default middleware;
