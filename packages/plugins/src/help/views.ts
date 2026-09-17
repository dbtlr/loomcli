import { view } from '@loomcli/core';
import type { CommandGraph, CommandNode } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { renderPage } from './page.js';

/** The data the help page presents: the whole graph, and the Command the invocation routed to. */
export interface HelpPage {
  readonly graph: CommandGraph;
  readonly command: CommandNode;
}

/**
 * The declared view of the help page. Its default derives the page from the graph and the routed
 * node alone. It escapes each raw fragment before styling and measuring it, and ends the page
 * with exactly one newline. A replacement owns both obligations.
 */
export const helpPage = view<HelpPage>(`${Package.name}/help/page`, {
  render: ({ command, graph }, context) => `${renderPage(graph, command, context)}\n`,
});
