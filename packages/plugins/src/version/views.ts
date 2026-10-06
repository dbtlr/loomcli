import { view } from '@loomcli/core';
import type { CommandGraph } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };

/** What the version line reads: the graph, and the postfix the application gave `version()`. */
export interface VersionLine {
  readonly graph: CommandGraph;
  readonly postfix: string | undefined;
}

/**
 * The declared view of the version line. A declared version that already starts with a lowercase
 * `v` carries that `v` once; every other first character is printed after the added one. The rule
 * is rendering alone, and `graph.version` keeps the declared string. A postfix follows after one
 * unstyled space, escaped and dim.
 */
export const versionLine = view<VersionLine>(`${Package.name}/version/line`, {
  render: ({ graph: { name, version }, postfix }, { style }) => {
    const line = `${style.highlight.bold(style.escape(name))} ${style.primary(style.escape(version.startsWith('v') ? version : `v${version}`))}`;
    return postfix === undefined ? `${line}\n` : `${line} ${style.dim(style.escape(postfix))}\n`;
  },
});
