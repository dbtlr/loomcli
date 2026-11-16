import { refreshByRunning } from '../refresh.js';
import type { RefreshContext } from '../refresh.js';
import { recordName, targets } from './targets.js';

/**
 * An `afterReplace` function for the self-update plugin: it runs the new binary with
 * `skills update`, because the replaced process holds the old skills, and passes the child's output
 * through. A context that carries the application's name starts no child when the installation
 * record holds no target's file. A child that fails or cannot start adds a `warn` log event and
 * resolves, because the binary update succeeded.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { selfUpdate } from '@loomcli/plugins/self-update';
 * import { refreshSkills, skills } from '@loomcli/plugins/skills';
 *
 * export const app = new Application('notes', {
 *   plugins: [
 *     skills({ folder: new URL('../skills/', import.meta.url) }),
 *     selfUpdate({ afterReplace: refreshSkills }),
 *   ],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md
 *
 * @public
 */
async function refreshSkills(context: RefreshContext): Promise<void> {
  // The sentence loads with the refresh, so the entry that exports it loads no message module.
  const { skillsNotRefreshed, skillsRefreshed, skillsRefreshSkipped } =
    await import('./messages.js');
  await refreshByRunning(context, {
    notStarted: skillsNotRefreshed,
    records: targets.map(recordName),
    refreshed: skillsRefreshed,
    skipped: skillsRefreshSkipped,
    warning: 'Skills were not refreshed after the update.',
    words: ['skills', 'update'],
  });
}

export { refreshSkills };
