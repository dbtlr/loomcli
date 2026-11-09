import type { Host, MiddlewareContext } from '@loomcli/core';

import { outgrowsScreen, pagerOf, showInPager } from './pager.js';
import { helpPage } from './views.js';
import type { HelpPage } from './views.js';

/** What printing a page reads of a run: the host, the output, and the run's lifetime. */
type ShowContext = Pick<MiddlewareContext, 'onShutdown' | 'out' | 'signal'> & {
  readonly host: Host;
};

/**
 * Prints one help page through the declared `helpPage` view. With paging on, a page that outgrows
 * the terminal goes to the operator's pager instead, and prints as before when the pager cannot
 * start. The help option's middleware and the help Command's action both print through this one
 * function, so `--help` and `help <command>` cannot drift apart.
 */
export async function showPage(context: ShowContext, page: HelpPage, paging: boolean) {
  const { host, out } = context;
  const pager = paging ? pagerOf(host) : undefined;
  if (pager !== undefined) {
    const text = out.text(page, helpPage);
    if (outgrowsScreen(host, text) && (await showInPager(context, pager, text))) {
      return;
    }
  }
  await out.render(page, helpPage);
}
