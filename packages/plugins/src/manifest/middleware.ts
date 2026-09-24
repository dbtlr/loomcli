import type { Middleware } from '@loomcli/core';

import { manifestDocument, manifestView } from './document.js';
import type { manifest } from './plugin.js';

/**
 * Prints the routed Command's manifest and ends the invocation by returning without calling
 * `next()`, so the action never dispatches and a fault core held from parsing or validation is
 * never raised: a group and a Command missing a required input still print.
 */
const middleware: Middleware<typeof manifest> = ({ command, graph, out }) =>
  out.render(manifestDocument(graph, command), manifestView);

export default middleware;
