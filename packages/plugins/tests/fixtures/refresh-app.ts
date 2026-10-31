import { Application, Command, plugin } from '@loomcli/core';
import { refreshCompletion } from '@loomcli/plugins/completion';
import { refreshManpages } from '@loomcli/plugins/manpage';
import { refreshSkills } from '@loomcli/plugins/skills';

/** One log event the observer saw. */
interface Observed {
  readonly level: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Each refresh a self-update's `afterReplace` may call, and what its application says it does. */
const refreshes = {
  completion: { description: 'Refresh completion.', refresh: refreshCompletion },
  manpage: { description: 'Refresh the man pages.', refresh: refreshManpages },
  skills: { description: 'Refresh the skills.', refresh: refreshSkills },
};

/**
 * An application whose `refresh` Command calls `refreshSkills`, `refreshManpages`, or
 * `refreshCompletion` with the binary at `path`, as a self-update's `afterReplace` would. `observe` receives every log event, and
 * `resolved` is called once the refresh has resolved.
 */
function refreshApplication(
  kind: keyof typeof refreshes,
  path: string,
  effects: { readonly observe: (event: Observed) => void; readonly resolved: () => void },
) {
  const observer = plugin('observer', {
    onLog: ({ fields, level, message }) => {
      effects.observe({ fields, level, message });
    },
  });
  const { description, refresh } = refreshes[kind];
  return new Application('notes', { description, plugins: [observer] }).command(
    new Command('refresh', { description }).action(async ({ host, log, out, signal }) => {
      await refresh({ host, log, path, signal });
      effects.resolved();
      await out.print('resolved');
    }),
  );
}

export { refreshApplication };
export type { Observed };
