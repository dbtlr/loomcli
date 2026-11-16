import { refreshByRunning } from '../refresh.js';
import type { RefreshContext } from '../refresh.js';

/**
 * An `afterReplace` function for the self-update plugin: it runs the new binary with
 * `completion update`, because the replaced process holds the old version's scripts, and passes
 * the child's output through. A child that fails or cannot start adds a `warn` log event and
 * resolves, because the binary update succeeded.
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
  // The sentence loads with the refresh, so the entry that exports it loads no message module.
  const { completionNotRefreshed } = await import('./messages.js');
  await refreshByRunning(context, {
    notStarted: completionNotRefreshed,
    warning: 'Completion was not refreshed after the update.',
    words: ['completion', 'update'],
  });
}

export { refreshCompletion };
