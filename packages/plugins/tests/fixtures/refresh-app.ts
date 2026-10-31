import { Application, Command, plugin } from '@loomcli/core';
import { refreshManpages } from '@loomcli/plugins/manpage';
import { refreshSkills } from '@loomcli/plugins/skills';

/** One log event the observer saw. */
interface Observed {
  readonly level: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * An application whose `refresh` Command calls `refreshSkills` or `refreshManpages` with the binary
 * at `path`, as a self-update's `afterReplace` would. `observe` receives every log event, and
 * `resolved` is called once the refresh has resolved.
 */
function refreshApplication(
  kind: 'skills' | 'manpage',
  path: string,
  effects: { readonly observe: (event: Observed) => void; readonly resolved: () => void },
) {
  const observer = plugin('observer', {
    onLog: ({ fields, level, message }) => {
      effects.observe({ fields, level, message });
    },
  });
  const refresh = kind === 'skills' ? refreshSkills : refreshManpages;
  return new Application('notes', {
    description: kind === 'skills' ? 'Refresh skills.' : 'Refresh man pages.',
    plugins: [observer],
  }).command(
    new Command('refresh', {
      description: kind === 'skills' ? 'Refresh the skills.' : 'Refresh the man pages.',
    }).action(async ({ host, log, out, signal }) => {
      await refresh({ host, log, path, signal });
      effects.resolved();
      await out.print('resolved');
    }),
  );
}

export { refreshApplication };
export type { Observed };
