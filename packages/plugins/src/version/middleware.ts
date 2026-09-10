import type { CommandGraph, Middleware } from '@loomcli/core';

import type { version } from './plugin.js';

/**
 * The one line the plugin prints. A declared version that already starts with a lowercase `v`
 * carries that `v` once; every other first character is printed after the added one. The rule is
 * presentation alone, and `graph.version` keeps the declared string.
 */
function line(graph: CommandGraph): string {
  const declared = graph.version;
  return `${graph.name} ${declared.startsWith('v') ? declared : `v${declared}`}`;
}

/**
 * Prints the version and ends the invocation by returning without calling `next()`, so nothing
 * after routing runs and the exit code is 0. The routed Command never changes the line, because the
 * version is a fact of the Application.
 */
const middleware: Middleware<typeof version> = ({ graph, out }) => out.print(line(graph));

export default middleware;
