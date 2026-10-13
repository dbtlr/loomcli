import { refreshByRunning } from '../refresh.js';
import type { RefreshContext } from '../refresh.js';

/**
 * An `afterReplace` function for the self-update plugin: a page is fixed text and the replaced
 * process holds the old version's graph, so it runs the new binary with `manpage update` and passes
 * the child's output through. A child that fails or cannot start adds a `warn` log event and
 * resolves, because the binary update succeeded.
 */
async function refreshManpages(context: RefreshContext): Promise<void> {
  await refreshByRunning(context, {
    notStarted: (path, name) =>
      `The man pages were not refreshed because ${path} could not start. Run ${name} manpage update.\n`,
    warning: 'Man pages were not refreshed after the update.',
    words: ['manpage', 'update'],
  });
}

export { refreshManpages };
