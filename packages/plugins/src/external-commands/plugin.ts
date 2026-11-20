import { plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import { packageName } from '../constants.js';

const identity = `${packageName}/external-commands`;

/**
 * A plugin that lets an operator extend the application from `PATH`: when the first word of argv
 * names no Command, it runs the first executable `<application>-<word>` on the run's `PATH` with the
 * words after it, and the run exits with the program's code. With no such program, the unknown
 * command reports as it does without the plugin. A declared Command, hidden ones included, always
 * wins, and an invocation by name never starts a program. The annotated return type is the boundary
 * that breaks the cycle between this module and the middleware module `load` names.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { externalCommands } from '@loomcli/plugins/external-commands';
 *
 * // `notes sync --all` runs `notes-sync --all` when a notes-sync program is on PATH.
 * export const notes = new Application('notes', { plugins: [externalCommands()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/external-commands.md
 *
 * @public
 */
export function externalCommands(): Plugin {
  return plugin(identity, {
    middleware: { activate: 'always', load: () => import('./middleware.js') },
  });
}

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
