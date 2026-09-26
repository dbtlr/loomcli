import { view } from '@loomcli/core';
import type { CommandGraph, CommandNode } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { renderPage } from './page.js';

/**
 * Which page an invocation asked for: `compact` orients a reader who needs the syntax, and
 * `extended` teaches with the details and examples as well.
 */
export type HelpVariant = 'compact' | 'extended';

/**
 * The data the help page presents: the whole graph, the Command the invocation routed to, and the
 * variant the operator's spelling selected.
 */
export interface HelpPage {
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly variant: HelpVariant;
}

/**
 * The declared view of the help page. Its default derives the page from the graph, the routed
 * node, and the variant alone. It escapes each raw fragment before styling and measuring it, and
 * ends the page with exactly one newline. A replacement owns both obligations.
 */
export const helpPage = view<HelpPage>(`${Package.name}/help/page`, {
  render: (page, context) => `${renderPage(page, context)}\n`,
});
