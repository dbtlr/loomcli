import type { Middleware } from '@loomcli/core';

import { outgrowsScreen, pagerOf, showInPager } from './pager.js';
import type { help } from './plugin.js';
import { helpPage } from './views.js';
import type { HelpVariant } from './views.js';

/**
 * The middleware for one `help()` call. It renders the help page of the routed Command and ends the
 * invocation by returning without calling `next()`, so the remaining tokens are never parsed and the
 * exit code is 0. `-h` asks for the compact page, and every other case, `--help` or a value no token
 * supplied, for the extended one. The view owns the page and its one line terminator, and an
 * application replaces it through `views`. With paging on, a page that outgrows the terminal goes to
 * the operator's pager instead, and prints as before when the pager cannot start.
 */
export function helpMiddleware(paging: boolean): Middleware<typeof help> {
  return async (context) => {
    const { command, graph, host, out, spellings } = context;
    const variant: HelpVariant = spellings.help === '-h' ? 'compact' : 'extended';
    const page = { command, graph, variant };
    const pager = paging ? pagerOf(host) : undefined;
    if (pager !== undefined) {
      const text = out.text(page, helpPage);
      if (outgrowsScreen(host, text) && (await showInPager(context, pager, text))) {
        return;
      }
    }
    await out.render(page, helpPage);
  };
}
