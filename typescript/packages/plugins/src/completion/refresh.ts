import { refreshByRunning } from '../refresh.js';
import type { RefreshContext } from '../refresh.js';
import { recordName, shells } from './shell-names.js';

/**
 * An `afterReplace` function for the self-update plugin: it runs the new binary with
 * `completion update`, because the replaced process holds the old version's scripts, and passes
 * the child's output through. A context that carries the application's name starts no child when
 * the installation record holds no shell's file. A child that fails or cannot start adds a `warn`
 * log event and resolves, because the binary update succeeded.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { completion, refreshCompletion } from '@loomcli/plugins/completion';
 * import { selfUpdate } from '@loomcli/plugins/self-update';
 *
 * export const app = new Application('notes', {
 *   plugins: [completion(), selfUpdate({ afterReplace: refreshCompletion })],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/completion.md
 *
 * @public
 */
async function refreshCompletion(context: RefreshContext): Promise<void> {
  // The phrases load with the refresh, so the entry that exports it loads no message module.
  const { completionPhrase } = await import('./phrases.js');
  await refreshByRunning(context, {
    // The line goes to the host's stderr, which has no language to render a phrase in, so it is English.
    notStarted: (path, name) => completionPhrase('completionNotRefreshed', path, name).text,
    records: shells.map(recordName),
    skipped: completionPhrase('completionRefreshSkipped'),
    warning: completionPhrase('completionRefreshFailed'),
    words: ['completion', 'update'],
  });
}

export { refreshCompletion };
