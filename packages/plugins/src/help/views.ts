import { view } from '@loomcli/core';
import type { CommandGraph, CommandNode } from '@loomcli/core';

import { packageName } from '../constants.js';
import { renderPage } from './page.js';

/**
 * Which page an invocation asked for: `compact` orients a reader who needs the syntax, and
 * `extended` teaches with the details and examples as well.
 *
 * @public @sealed
 */
export type HelpVariant = 'compact' | 'extended';

/**
 * The data the help page presents: the whole graph, the Command the invocation routed to, and the
 * variant the operator's spelling selected.
 *
 * @public @sealed
 */
export interface HelpPage {
  /** The whole Command graph, which the page reads for the application's name and every Command. */
  readonly graph: CommandGraph;
  /** The Command the invocation routed to, whose page this is. */
  readonly command: CommandNode;
  /** The variant the operator's spelling selected. */
  readonly variant: HelpVariant;
}

/**
 * The declared view of the help page. Its default derives the page from the graph, the routed
 * node, and the variant alone. It escapes each raw fragment before styling and measuring it, and
 * ends the page with exactly one newline. A replacement owns both obligations.
 *
 * @example
 * ```ts
 * import { Application, override } from '@loomcli/core';
 * import { help } from '@loomcli/plugins/help';
 * import { helpPage } from '@loomcli/plugins/help/views';
 *
 * export const app = new Application('notes', {
 *   plugins: [help()],
 *   views: [
 *     override(helpPage, {
 *       render: ({ graph, command }, { style }) =>
 *         `${style.primary(style.escape([graph.name, ...command.path].join(' ')))}\n`,
 *     }),
 *   ],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/help.md
 *
 * @public
 */
export const helpPage = view<HelpPage>(`${packageName}/help/page`, {
  render: (page, context) => `${renderPage(page, context)}\n`,
});
