import { refreshByRunning } from '../refresh.js';
import type { RefreshContext } from '../refresh.js';

/**
 * An `afterReplace` function for the self-update plugin: it runs the new binary with `completion
 * update`, because the replaced process holds the old version's scripts, and passes the child's
 * output through. A child that fails or cannot start adds a `warn` log event and resolves, because
 * the binary update succeeded.
 */
async function refreshCompletion(context: RefreshContext): Promise<void> {
  await refreshByRunning(context, {
    notStarted: (path, name) =>
      `Completion was not refreshed because ${path} could not start. Run ${name} completion update.\n`,
    warning: 'Completion was not refreshed after the update.',
    words: ['completion', 'update'],
  });
}

export { refreshCompletion };
