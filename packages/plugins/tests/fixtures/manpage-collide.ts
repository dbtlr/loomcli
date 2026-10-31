import { Application, Command } from '@loomcli/core';
import type { ActionContext } from '@loomcli/core';
import { manpage } from '@loomcli/plugins/manpage';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';

/**
 * One run of an application whose page names collide, as the scenario argument names, built as a
 * development or a distributed build by `FIXTURE_BUILD`. The rest of argv is the run's.
 */
const noop = ({ out }: Pick<ActionContext<unknown>, 'out'>) => out.print('ran');

const scenarios = {
  hyphen: () =>
    new Application('kit', { description: 'A kit.', plugins: [manpage()] })
      .command(new Command('foo-bar', { description: 'Flat.' }).action(noop))
      .command(
        new Command('foo', { description: 'Group.' }).command(
          new Command('bar', { description: 'Nested.' }).action(noop),
        ),
      ),
};

async function run(args: string[], env: Record<string, string | undefined> = {}) {
  const [name, ...argv] = args;
  const factory = Object.entries(scenarios).find(([key]) => key === name)?.[1];
  if (factory === undefined) {
    throw new Error(`Unknown fixture scenario: ${name}`);
  }
  return await runOnMock(factory(), {
    argv,
    release: {
      build: z
        .enum(['source', 'distributed', 'development'])
        .parse(env.FIXTURE_BUILD ?? 'distributed'),
    },
  });
}
export { run };
