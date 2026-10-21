import { Application, Command } from '@loomcli/core';
import { manpage } from '@loomcli/plugins/manpage';

/**
 * One run of an application whose page names collide, as the scenario argument names, built as a
 * development or a distributed build by `FIXTURE_BUILD`. The rest of argv is the run's.
 */
const noop = ({ out }) => out.print('ran');
const release = { build: process.env.FIXTURE_BUILD ?? 'distributed' };

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

const [name, ...argv] = process.argv.slice(2);
process.exitCode = await scenarios[name]().run({ host: { argv, release } });
