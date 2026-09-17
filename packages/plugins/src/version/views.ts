import { view } from '@loomcli/core';
import type { CommandGraph } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };

/**
 * The declared view of the version line. A declared version that already starts with a lowercase
 * `v` carries that `v` once; every other first character is printed after the added one. The rule
 * is rendering alone, and `graph.version` keeps the declared string.
 */
export const versionLine = view<CommandGraph>(`${Package.name}/version/line`, {
  render: ({ name, version }, { style }) =>
    `${style.highlight.bold(style.escape(name))} ${style.primary(style.escape(version.startsWith('v') ? version : `v${version}`))}\n`,
});
