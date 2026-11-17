import { refreshByRunning } from '../refresh.js';
import type { RefreshContext } from '../refresh.js';
import { recordName } from './pages.js';

/**
 * An `afterReplace` function for the self-update plugin: a page is fixed text and the replaced
 * process holds the old version's graph, so it runs the new binary with `manpage update` and passes
 * the child's output through. A context that carries the application's name starts no child when
 * the installation record holds no file of the plugin's. A child that fails or cannot start adds a
 * `warn` log event and resolves, because the binary update succeeded.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { manpage, refreshManpages } from '@loomcli/plugins/manpage';
 * import { selfUpdate } from '@loomcli/plugins/self-update';
 *
 * export const app = new Application('notes', {
 *   plugins: [manpage(), selfUpdate({ afterReplace: refreshManpages })],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/manpage.md
 *
 * @public
 */
async function refreshManpages(context: RefreshContext): Promise<void> {
  // The sentence loads with the refresh, so the entry that exports it loads no message module.
  const { manpagesNotRefreshed, manpagesRefreshSkipped } = await import('./messages.js');
  await refreshByRunning(context, {
    notStarted: manpagesNotRefreshed,
    records: [recordName],
    skipped: manpagesRefreshSkipped,
    warning: 'Man pages were not refreshed after the update.',
    words: ['manpage', 'update'],
  });
}

export { refreshManpages };
