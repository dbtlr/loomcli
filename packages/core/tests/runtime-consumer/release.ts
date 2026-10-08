import { Application, Command } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';

/**
 * The release facts probe, compiled against the declarations the packed core emits. `build` prints
 * the build its run reads: `source` from this file and from its unbundled compile, and the build a
 * bundle baked in. `fail` throws a foreign error, so the build decides what its operator reads.
 */
const probe = new Application('release-probe', { description: 'Probe the release facts.' })
  .command(
    new Command('build', { description: 'Print the build.' }).action(({ host, out }) => {
      const facts: ReleaseFacts = host.release;
      return out.print(facts.build);
    }),
  )
  .command(
    new Command('fail', { description: 'Throw a foreign error.' }).action(() => {
      throw new TypeError('The probe cannot read its input.');
    }),
  );

await probe.run({ host: { argv: process.argv.slice(2) } });
