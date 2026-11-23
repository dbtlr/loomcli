import { Command, provider } from '@loomcli/core';
import type { Opener, Provider } from '@loomcli/core';

// Where the Application's registration is visible, a Command's globals are that Application's.
declare const openQuiet: Opener<typeof quiet>;
const quiet: Provider<'quiet', boolean, { quiet: boolean }> = provider('quiet', {
  load: async () => ({ default: openQuiet }),
});
declare const openPool: Opener<typeof pool>;
const pool: Provider<'pool', number, { 'database-url': string | undefined }, 'persistent'> =
  provider('pool', { lifetime: 'persistent', load: async () => ({ default: openPool }) });

// A provider that reads a registered option opts in, and its action reads the value typed.
const muted = new Command('muted', { uses: [quiet] }).action(({ provided }) => {
  const value: boolean = provided.quiet;
  return value;
});

// @ts-expect-error TS2322: The registered Application declares no option the pool reads.
const unmet = new Command('unmet', { uses: [pool] });

export { muted, unmet };
