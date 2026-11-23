import { Application, Command, plugin } from '@loomcli/core';
import { refreshCompletion } from '@loomcli/plugins/completion';
import { refreshManpages } from '@loomcli/plugins/manpage';
import { refreshSkills } from '@loomcli/plugins/skills';
import { verbose } from '@loomcli/plugins/verbose';

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
 * What the `refresh` Command hands the refresh beside the binary, as a self-update's context
 * carries it: the graph's name, which finds the installation record.
 */
interface Handed {
  readonly name?: boolean;
}

/**
 * An application, with the verbose plugin, whose `refresh` Command calls `refreshSkills`,
 * `refreshManpages`, or `refreshCompletion` with the binary at `path`, as a self-update's
 * `afterReplace` would, and the graph's name when `handed` asks. `observe` receives
 * every log event, and `resolved` is called once the refresh has resolved.
 */
function refreshApplication(
  kind: keyof typeof refreshes,
  path: string,
  effects: { readonly observe: (event: Observed) => void; readonly resolved: () => void },
  handed: Handed = {},
) {
  const observer = plugin('observer', {
    onLog: ({ fields, level, message }) => {
      effects.observe({ fields, level, message });
    },
  });
  const { description, refresh } = refreshes[kind];
  return new Application('notes', { description, plugins: [observer, verbose()] }).command(
    new Command('refresh', { description }).action(async ({ graph, host, log, out, signal }) => {
      await refresh({
        host,
        log,
        path,
        signal,
        ...(handed.name === true ? { name: graph.name } : {}),
      });
      effects.resolved();
      await out.print('resolved');
    }),
  );
}

export { refreshApplication };
export type { Handed, Observed };
