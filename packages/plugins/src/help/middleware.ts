import type { Middleware } from '@loomcli/core';

import type { help } from './plugin.js';
import { helpPage } from './views.js';

/**
 * Renders the help page of the routed Command and ends the invocation by returning without calling
 * `next()`, so the remaining tokens are never parsed and the exit code is 0. The view owns the page
 * and its one line terminator, and an application replaces it through `views`.
 */
const middleware: Middleware<typeof help> = ({ command, graph, out }) =>
  out.render({ command, graph }, helpPage);

export default middleware;
