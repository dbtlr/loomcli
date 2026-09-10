import type { Middleware } from '@loomcli/core';

import { renderPage } from './page.js';
import type { help } from './plugin.js';

/**
 * Renders the help page of the routed Command and ends the invocation by returning without calling
 * `next()`, so the remaining tokens are never parsed and the exit code is 0. The page carries no
 * line terminator of its own, so stdout ends with the one newline `out.print` appends.
 */
const middleware: Middleware<typeof help> = ({ command, graph, out }) =>
  out.print(renderPage(graph, command));

export default middleware;
