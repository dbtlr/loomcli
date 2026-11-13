import { view } from '@loomcli/core';
import type { CommandGraph } from '@loomcli/core';

import { packageName } from '../constants.js';

/**
 * What the version line reads: the graph, and the postfix the application gave `version()`.
 *
 * @public @sealed
 */
export interface VersionLine {
  /** The Command graph, which holds the application's name and declared version. */
  readonly graph: CommandGraph;
  /** The text printed after the version, or `undefined` when there is none. */
  readonly postfix: string | undefined;
}

/**
 * The declared view of the version line. A declared version that already starts with a lowercase
 * `v` carries that `v` once; every other first character is printed after the added one. The rule
 * is rendering alone, and `graph.version` keeps the declared string. A postfix follows after one
 * unstyled space, escaped and dim.
 *
 * @example
 * ```ts
 * import { Application, override } from '@loomcli/core';
 * import { version } from '@loomcli/plugins/version';
 * import { versionLine } from '@loomcli/plugins/version/views';
 *
 * export const app = new Application('notes', {
 *   plugins: [version()],
 *   views: [
 *     override(versionLine, {
 *       render: ({ graph }, { style }) => `${style.escape(graph.name)} ${style.escape(graph.version ?? '')}\n`,
 *     }),
 *   ],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/version.md
 *
 * @public
 */
export const versionLine = view<VersionLine>(`${packageName}/version/line`, {
  render: ({ graph: { name, version }, postfix }, { style }) => {
    const line = `${style.highlight.bold(style.escape(name))} ${style.primary(style.escape(version.startsWith('v') ? version : `v${version}`))}`;
    return postfix === undefined ? `${line}\n` : `${line} ${style.dim(style.escape(postfix))}\n`;
  },
});
