import { view } from '@loomcli/core';
import type { CommandGraph, ReleaseFacts } from '@loomcli/core';

import { packageName } from '../constants.js';
import { recordBlock } from '../record-block.js';

/** The labels of the block's six rows, in the order they print, with the member each reads. */
const factRows = [
  ['channel', 'channel'],
  ['build', 'build'],
  ['asset', 'asset'],
  ['installation method', 'installationMethod'],
  ['runtime', 'runtime'],
  ['platform', 'platform'],
] as const;

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
 *       render: ({ graph }, { style }) =>
 *         `${style.escape(graph.name)} ${style.escape(graph.version)}\n`,
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

/**
 * What the extended version block reads: the run's release facts, runtime, and platform, each
 * `undefined` when the run does not hold it.
 *
 * @public @sealed
 */
export interface VersionFacts {
  /** The release channel core derives from the release version, such as `stable` or `next`. */
  readonly channel: string | undefined;
  /** How the running copy was built: `source`, `development`, or `distributed`. */
  readonly build: ReleaseFacts['build'];
  /** The release asset's name, such as `notes-linux-x64`, present for a compiled binary alone. */
  readonly asset: string | undefined;
  /** How the application was installed, such as `script`. */
  readonly installationMethod: string | undefined;
  /** The JavaScript runtime's name and version, such as `bun 1.3.2`. */
  readonly runtime: string | undefined;
  /** The operating system and architecture, such as `linux-x64`. */
  readonly platform: string;
}

/**
 * The declared view of the extended version block: six rows in the records layout, `channel`,
 * `build`, `asset`, `installation method`, `runtime`, and `platform`, each a dim label and an
 * escaped value. A fact the run does not hold prints an empty value, which the records layout ends
 * at its label on a terminal. A replacement reads the six members of `VersionFacts`.
 *
 * @example
 * ```ts
 * import { Application, override } from '@loomcli/core';
 * import { version } from '@loomcli/plugins/version';
 * import { versionFacts } from '@loomcli/plugins/version/views';
 *
 * export const app = new Application('notes', {
 *   plugins: [version({ extended: true })],
 *   views: [
 *     override(versionFacts, {
 *       render: ({ platform, runtime }, { style }) =>
 *         `${style.escape(platform)} on ${style.escape(runtime ?? 'an unknown runtime')}\n`,
 *     }),
 *   ],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/version.md#extended-output
 *
 * @public
 */
export const versionFacts = view<VersionFacts>(`${packageName}/version/facts`, {
  render: (facts, context) =>
    recordBlock(
      factRows.map(([label, key]) => ({
        label,
        value: context.style.primary(context.style.escape(facts[key] ?? '')),
      })),
      context,
    ),
});
